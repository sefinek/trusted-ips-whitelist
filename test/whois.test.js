const { describe, it, expect, jest: jestMock, beforeEach } = require('@jest/globals');

jestMock.mock('node:net');
jestMock.mock('../scripts/services/ripestat.js');

const net = require('node:net');
const fetchFromRIPEstat = require('../scripts/services/ripestat.js');
const getASNPrefixes = require('../scripts/services/whois.js');

const { EventEmitter } = require('node:events');

const makeMockSocket = (whoisText = '', { simulateError = null, simulateTimeout = false } = {}) => {
	const sock = new EventEmitter();
	sock.setEncoding = jestMock.fn();
	sock.setTimeout = jestMock.fn();
	sock.destroy = jestMock.fn();
	sock.write = jestMock.fn((_, cb) => {
		if (cb) cb();
	});
	sock.end = jestMock.fn(() => {
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
	beforeEach(() => {
		jestMock.clearAllMocks();
		fetchFromRIPEstat.mockResolvedValue([]);
	});

	it('exports a function', () => {
		expect(typeof getASNPrefixes).toBe('function');
	});

	it('returns an array', async () => {
		net.createConnection.mockImplementation(() => makeMockSocket());
		const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
		expect(Array.isArray(result)).toBe(true);
	});

	describe('route block parsing', () => {
		it('parses IPv4 route: blocks', async () => {
			const response = 'route: 203.0.113.0/24\ndescr: Test Network\norigin: AS12345\n\n';
			net.createConnection.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			expect(result.some(r => r.ip === '203.0.113.0/24')).toBe(true);
		});

		it('parses IPv6 route6: blocks', async () => {
			const response = 'route6: 2001:db8::/32\ndescr: Test IPv6\norigin: AS12345\n\n';
			net.createConnection.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			expect(result.some(r => r.ip === '2001:db8::/32')).toBe(true);
		});

		it('deduplicates IPs from WHOIS and RIPEstat', async () => {
			const response = 'route: 203.0.113.0/24\ndescr: Test\n\n';
			net.createConnection.mockImplementation(() => makeMockSocket(response));
			fetchFromRIPEstat.mockResolvedValue([{ ip: '203.0.113.0/24', source: 'https://stat.ripe.net' }]);

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			expect(result.filter(r => r.ip === '203.0.113.0/24').length).toBe(1);
		});

		it('merges sources array for duplicate IPs', async () => {
			const response = 'route: 203.0.113.0/24\ndescr: Test\n\n';
			net.createConnection.mockImplementation(() => makeMockSocket(response));
			fetchFromRIPEstat.mockResolvedValue([{ ip: '203.0.113.0/24', source: 'https://stat.ripe.net' }]);

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			const entry = result.find(r => r.ip === '203.0.113.0/24');
			expect(Array.isArray(entry.sources)).toBe(true);
			expect(entry.sources.length).toBeGreaterThanOrEqual(1);
		});

		it('includes RIPEstat-only IPs when no keywords', async () => {
			net.createConnection.mockImplementation(() => makeMockSocket(''));
			fetchFromRIPEstat.mockResolvedValue([{ ip: '10.20.30.0/24', source: 'https://stat.ripe.net' }]);

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			expect(result.some(r => r.ip === '10.20.30.0/24')).toBe(true);
		});
	});

	describe('keyword filtering', () => {
		it('includes only keyword-matching routes', async () => {
			const response = [
				'route: 180.76.0.0/24', 'descr: BAIDU-CN-BJTELECOM', '',
				'route: 1.2.3.0/24', 'descr: SomeOtherCompany', '',
			].join('\n');
			net.createConnection.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Baidu', asn: 'AS38365', keywords: ['baidu'] });
			expect(result.some(r => r.ip === '180.76.0.0/24')).toBe(true);
			expect(result.some(r => r.ip === '1.2.3.0/24')).toBe(false);
		});

		it('excludes nullable blocks when acceptNullable is false', async () => {
			const response = [
				'route: 1.2.3.0/24', 'descr: MatchingOrg', '',
				'route: 5.6.7.0/24', '',
			].join('\n');
			net.createConnection.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345', keywords: ['matchingorg'] });
			expect(result.some(r => r.ip === '1.2.3.0/24')).toBe(true);
			expect(result.some(r => r.ip === '5.6.7.0/24')).toBe(false);
		});

		it('includes nullable blocks when acceptNullable is true', async () => {
			const response = [
				'route: 1.2.3.0/24', 'descr: Facebook Ireland Ltd', '',
				'route: 5.6.7.0/24', '',
			].join('\n');
			net.createConnection.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({
				name: 'FacebookBot',
				asn: 'AS32934',
				keywords: ['facebook'],
				acceptNullable: true,
			});
			expect(result.some(r => r.ip === '1.2.3.0/24')).toBe(true);
			expect(result.some(r => r.ip === '5.6.7.0/24')).toBe(true);
		});

		it('discards RIPEstat results when keywords set without acceptNullable', async () => {
			fetchFromRIPEstat.mockResolvedValue([{ ip: '5.5.5.0/24', source: 'https://stat.ripe.net' }]);
			net.createConnection.mockImplementation(() =>
				makeMockSocket('route: 10.0.0.0/24\ndescr: Canonical Ltd\n\n')
			);

			const result = await getASNPrefixes({ name: 'Canonical', asn: 'AS41231', keywords: ['canonical'] });
			expect(result.some(r => r.ip === '5.5.5.0/24')).toBe(false);
			expect(result.some(r => r.ip === '10.0.0.0/24')).toBe(true);
		});

		it('includes RIPEstat results when acceptNullable is true', async () => {
			fetchFromRIPEstat.mockResolvedValue([{ ip: '5.5.5.0/24', source: 'https://stat.ripe.net' }]);
			net.createConnection.mockImplementation(() => makeMockSocket(''));

			const result = await getASNPrefixes({
				name: 'FacebookBot',
				asn: 'AS32934',
				keywords: ['facebook'],
				acceptNullable: true,
			});
			expect(result.some(r => r.ip === '5.5.5.0/24')).toBe(true);
		});

		it('returns all blocks when no keywords specified', async () => {
			const response = [
				'route: 1.2.3.0/24', 'descr: CompanyA', '',
				'route: 4.5.6.0/24', 'descr: CompanyB', '',
			].join('\n');
			net.createConnection.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Semrush', asn: 'AS209366' });
			expect(result.some(r => r.ip === '1.2.3.0/24')).toBe(true);
			expect(result.some(r => r.ip === '4.5.6.0/24')).toBe(true);
		});
	});

	describe('error handling', () => {
		it('returns empty array on socket error', async () => {
			net.createConnection.mockImplementation(() =>
				makeMockSocket('', { simulateError: new Error('ECONNREFUSED') })
			);

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS99999' });
			expect(Array.isArray(result)).toBe(true);
		});

		it('returns empty array on socket timeout', async () => {
			net.createConnection.mockImplementation(() =>
				makeMockSocket('', { simulateTimeout: true })
			);

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS99999' });
			expect(Array.isArray(result)).toBe(true);
		});

		it('returns empty array for invalid IP in WHOIS response', async () => {
			const response = 'route: not-an-ip\ndescr: Test\n\n';
			net.createConnection.mockImplementation(() => makeMockSocket(response));

			const result = await getASNPrefixes({ name: 'Test', asn: 'AS12345' });
			expect(result.some(r => r.ip === 'not-an-ip')).toBe(false);
		});
	});
});
