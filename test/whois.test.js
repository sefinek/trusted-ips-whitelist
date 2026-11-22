const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { stubModule, respondWith } = require('./helpers/mocks.js');

const fetchFromRIPEstat = stubModule('scripts/services/ripestat.js', mock.fn());
const getASNPrefixes = require('../scripts/services/whois.js');

const makeMockSocket = (whoisText = '', { simulateError = null, simulateTimeout = false } = {}) => {
	const sock = new EventEmitter();
	sock.setEncoding = mock.fn();
	sock.setTimeout = mock.fn();
	sock.destroy = mock.fn();
	sock.write = mock.fn((_, cb) => {
		if (cb) cb();
	});
	sock.end = mock.fn(() => {
		setImmediate(() => {
			if (simulateError) { sock.emit('error', simulateError); }
			else if (simulateTimeout) { sock.emit('timeout'); }
			else {
				if (whoisText) { sock.emit('data', whoisText); }
				sock.emit('end');
			}
		});
	});
	return sock;
};

describe('whois module', () => {
	let createConnection;

	beforeEach(() => {
		createConnection = mock.method(net, 'createConnection');
		respondWith(fetchFromRIPEstat, []);
	});

	afterEach(() => {
		mock.restoreAll();
	});

	it('exports a function', () => {
		assert.equal(typeof getASNPrefixes, 'function');
	});

	it('returns an array', async () => {
		createConnection.mock.mockImplementation(() => makeMockSocket());
		const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
		assert.ok(Array.isArray(result));
	});

	describe('route block parsing', () => {
		it('parses IPv4 route: blocks', async () => {
			const response = 'route: 203.0.113.0/24\ndescr: Test Network\norigin: AS12345\n\n';
			createConnection.mock.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			assert.ok(result.some(r => r.ip === '203.0.113.0/24'));
		});

		it('parses IPv6 route6: blocks', async () => {
			const response = 'route6: 2001:db8::/32\ndescr: Test IPv6\norigin: AS12345\n\n';
			createConnection.mock.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			assert.ok(result.some(r => r.ip === '2001:db8::/32'));
		});

		it('deduplicates IPs from WHOIS and RIPEstat', async () => {
			const response = 'route: 203.0.113.0/24\ndescr: Test\n\n';
			createConnection.mock.mockImplementation(() => makeMockSocket(response));
			respondWith(fetchFromRIPEstat, [{ ip: '203.0.113.0/24', source: 'https://stat.ripe.net' }]);

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			assert.equal(result.filter(r => r.ip === '203.0.113.0/24').length, 1);
		});

		it('merges sources array for duplicate IPs', async () => {
			const response = 'route: 203.0.113.0/24\ndescr: Test\n\n';
			createConnection.mock.mockImplementation(() => makeMockSocket(response));
			respondWith(fetchFromRIPEstat, [{ ip: '203.0.113.0/24', source: 'https://stat.ripe.net' }]);

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			const entry = result.find(r => r.ip === '203.0.113.0/24');
			assert.equal(Array.isArray(entry.sources), true);
			assert.ok(entry.sources.length >= 1);
		});

		it('includes RIPEstat-only IPs when no keywords', async () => {
			createConnection.mock.mockImplementation(() => makeMockSocket(''));
			respondWith(fetchFromRIPEstat, [{ ip: '10.20.30.0/24', source: 'https://stat.ripe.net' }]);

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			assert.ok(result.some(r => r.ip === '10.20.30.0/24'));
		});
	});

	describe('keyword filtering', () => {
		it('includes only keyword-matching routes', async () => {
			const response = [
				'route: 180.76.0.0/24', 'descr: BAIDU-CN-BJTELECOM', '',
				'route: 1.2.3.0/24', 'descr: SomeOtherCompany', '',
			].join('\n');
			createConnection.mock.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Baidu', asn: 'AS38365', keywords: ['baidu'] });
			assert.ok(result.some(r => r.ip === '180.76.0.0/24'));
			assert.ok(!result.some(r => r.ip === '1.2.3.0/24'));
		});

		it('excludes nullable blocks when acceptNullable is false', async () => {
			const response = [
				'route: 1.2.3.0/24', 'descr: MatchingOrg', '',
				'route: 5.6.7.0/24', '',
			].join('\n');
			createConnection.mock.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345', keywords: ['matchingorg'] });
			assert.ok(result.some(r => r.ip === '1.2.3.0/24'));
			assert.ok(!result.some(r => r.ip === '5.6.7.0/24'));
		});

		it('includes nullable blocks when acceptNullable is true', async () => {
			const response = [
				'route: 1.2.3.0/24', 'descr: Facebook Ireland Ltd', '',
				'route: 5.6.7.0/24', '',
			].join('\n');
			createConnection.mock.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({
				name: 'FacebookBot',
				asn: 'AS32934',
				keywords: ['facebook'],
				acceptNullable: true,
			});
			assert.ok(result.some(r => r.ip === '1.2.3.0/24'));
			assert.ok(result.some(r => r.ip === '5.6.7.0/24'));
		});

		it('discards RIPEstat results when keywords set without acceptNullable', async () => {
			respondWith(fetchFromRIPEstat, [{ ip: '5.5.5.0/24', source: 'https://stat.ripe.net' }]);
			createConnection.mock.mockImplementation(() =>
				makeMockSocket('route: 10.0.0.0/24\ndescr: Canonical Ltd\n\n')
			);

			const result = await getASNPrefixes({ name: 'Canonical', asn: 'AS41231', keywords: ['canonical'] });
			assert.ok(!result.some(r => r.ip === '5.5.5.0/24'));
			assert.ok(result.some(r => r.ip === '10.0.0.0/24'));
		});

		it('includes RIPEstat results when acceptNullable is true', async () => {
			respondWith(fetchFromRIPEstat, [{ ip: '5.5.5.0/24', source: 'https://stat.ripe.net' }]);
			createConnection.mock.mockImplementation(() => makeMockSocket(''));

			const result = await getASNPrefixes({
				name: 'FacebookBot',
				asn: 'AS32934',
				keywords: ['facebook'],
				acceptNullable: true,
			});
			assert.ok(result.some(r => r.ip === '5.5.5.0/24'));
		});

		it('returns all blocks when no keywords specified', async () => {
			const response = [
				'route: 1.2.3.0/24', 'descr: CompanyA', '',
				'route: 4.5.6.0/24', 'descr: CompanyB', '',
			].join('\n');
			createConnection.mock.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Semrush', asn: 'AS209366' });
			assert.ok(result.some(r => r.ip === '1.2.3.0/24'));
			assert.ok(result.some(r => r.ip === '4.5.6.0/24'));
		});
	});

	describe('error handling', () => {
		it('returns empty array on socket error', async () => {
			createConnection.mock.mockImplementation(() =>
				makeMockSocket('', { simulateError: new Error('ECONNREFUSED') })
			);

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS99999' });
			assert.ok(Array.isArray(result));
		});

		it('returns empty array on socket timeout', async () => {
			createConnection.mock.mockImplementation(() =>
				makeMockSocket('', { simulateTimeout: true })
			);

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS99999' });
			assert.ok(Array.isArray(result));
		});

		it('returns empty array for invalid IP in WHOIS response', async () => {
			const response = 'route: not-an-ip\ndescr: Test\n\n';
			createConnection.mock.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			assert.ok(!result.some(r => r.ip === 'not-an-ip'));
		});
	});
});
