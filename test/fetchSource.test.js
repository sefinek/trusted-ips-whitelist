const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { stubModule, respondWith } = require('./helpers/mocks.js');

const getASNPrefixes = stubModule('scripts/services/whois.js', mock.fn());
const getYandexIPs = stubModule('scripts/parser/yandex.js', mock.fn());
const getRenderedHtml = stubModule('scripts/parser/browserHtml.js', mock.fn());

const fetchSource = require('../scripts/fetchSource.js');
const axios = require('../scripts/services/axios.js');

describe('fetchSource', () => {
	let get;

	beforeEach(() => {
		get = mock.method(axios, 'get');
	});

	afterEach(() => {
		mock.restoreAll();
	});

	describe('whois type', () => {
		it('returns records from WHOIS/RIPEstat', async () => {
			respondWith(getASNPrefixes, [{ ip: '1.2.3.4', source: 'whois' }]);

			const out = await fetchSource({ name: 'Test', asn: 'AS123', type: 'whois' });
			assert.deepEqual(out, [{ ip: '1.2.3.4', sources: ['whois'] }]);
		});

		it('returns empty array when no records', async () => {
			respondWith(getASNPrefixes, []);

			const out = await fetchSource({ name: 'Test', asn: 'AS123', type: 'whois' });
			assert.deepEqual(out, []);
		});
	});

	describe('yandex type', () => {
		it('returns Yandex IPs', async () => {
			respondWith(getYandexIPs, [{ ip: '77.88.5.5', source: 'yandex' }]);

			const out = await fetchSource({ name: 'YandexBot', type: 'yandex' });
			assert.deepEqual(out, [{ ip: '77.88.5.5', sources: ['yandex'] }]);
		});
	});

	describe('hosts type', () => {
		it('parses plain-text IP list', async () => {
			respondWith(get, { data: '1.1.1.1\n2.2.2.2\n' });

			const out = await fetchSource({ name: 'Test', url: 'https://example.com/ips.txt', type: 'hosts' });
			assert.deepEqual(out, [
				{ ip: '1.1.1.1', sources: ['https://example.com/ips.txt'] },
				{ ip: '2.2.2.2', sources: ['https://example.com/ips.txt'] },
			]);
		});

		it('skips comment lines and blank lines', async () => {
			respondWith(get, { data: '# comment\n1.1.1.1\n\n2.2.2.2' });

			const out = await fetchSource({ name: 'Test', url: 'https://example.com/ips.txt', type: 'hosts' });
			assert.deepEqual(out.map(r => r.ip), ['1.1.1.1', '2.2.2.2']);
		});

	});

	describe('textMulti type', () => {
		it('fetches and merges multiple URLs', async () => {
			respondWith(get, { data: '1.1.1.1' }, { data: '2.2.2.2' });

			const out = await fetchSource({
				name: 'Test',
				url: ['https://example.com/ipv4', 'https://example.com/ipv6'],
				type: 'textMulti',
			});
			assert.deepEqual(out.map(r => r.ip).sort(), ['1.1.1.1', '2.2.2.2'].sort());
		});

		it('fails the whole source when any URL fails', async () => {
			respondWith(get, { data: '1.1.1.1' }, new Error('Request failed with status code 404'));

			await assert.rejects(fetchSource({
				name: 'Test',
				url: ['https://example.com/ipv4', 'https://example.com/ipv6'],
				type: 'textMulti',
			}), /404/);
		});
	});

	describe('jsonPrefixes type', () => {
		it('parses ipv4Prefix entries', async () => {
			respondWith(get, {
				data: { prefixes: [{ ipv4Prefix: '23.98.142.0/28' }, { ipv4Prefix: '20.15.240.64/28' }] },
			});

			const out = await fetchSource({ name: 'GPTBot', url: 'https://openai.com/gptbot.json', type: 'jsonPrefixes' });
			assert.deepEqual(out.map(r => r.ip).sort(), ['23.98.142.0/28', '20.15.240.64/28'].sort());
		});

		it('parses ipv6Prefix entries', async () => {
			respondWith(get, {
				data: { prefixes: [{ ipv6Prefix: '2001:db8::/32' }] },
			});

			const out = await fetchSource({ name: 'TestBot', url: 'https://example.com/bot.json', type: 'jsonPrefixes' });
			assert.ok(out.map(r => r.ip).includes('2001:db8::/32'));
		});

		it('accepts array of URLs and merges results', async () => {
			respondWith(get, { data: { prefixes: [{ ipv4Prefix: '1.2.3.0/24' }] } }, { data: { prefixes: [{ ipv4Prefix: '5.6.7.0/24' }] } });

			const out = await fetchSource({
				name: 'TestBot',
				url: ['https://example.com/a.json', 'https://example.com/b.json'],
				type: 'jsonPrefixes',
			});
			assert.deepEqual(out.map(r => r.ip).sort(), ['1.2.3.0/24', '5.6.7.0/24'].sort());
		});
	});

	describe('jsonPrefixes failures', () => {
		it('fails the whole source when any URL fails', async () => {
			respondWith(get, { data: { prefixes: [{ ipv4Prefix: '1.2.3.0/24' }] } }, new Error('Request failed with status code 404'));

			await assert.rejects(fetchSource({
				name: 'TestBot',
				url: ['https://example.com/a.json', 'https://example.com/b.json'],
				type: 'jsonPrefixes',
			}), /404/);
		});

		it('rejects a non-JSON response', async () => {
			respondWith(get, { data: '<html></html>' });

			await assert.rejects(fetchSource({ name: 'TestBot', url: 'https://example.com/a.json', type: 'jsonPrefixes' }), /Invalid JSON response/);
		});
	});

	describe('jsonIps type', () => {
		it('parses ip_address entries', async () => {
			respondWith(get, {
				data: { ips: [{ ip_address: '1.2.3.4' }, { ip_address: '5.6.7.8' }] },
			});

			const out = await fetchSource({ name: 'AhrefsBot', url: 'https://api.ahrefs.com/crawler-ips', type: 'jsonIps' });
			assert.deepEqual(out.map(r => r.ip), ['1.2.3.4', '5.6.7.8']);
		});
	});

	describe('jsonPath type', () => {
		it('reads array from nested path and merges multiple URLs', async () => {
			respondWith(get, { data: { data: { ipv4_cidrs: ['34.237.3.244/32', '34.195.105.136/32'] } } }, { data: { data: { ipv4_cidrs: ['3.208.120.145/32'] } } });

			const out = await fetchSource({
				name: 'Paddle',
				url: ['https://api.paddle.com/ips', 'https://sandbox-api.paddle.com/ips'],
				path: 'data.ipv4_cidrs',
				type: 'jsonPath',
			});
			assert.deepEqual(out, [
				{ ip: '34.237.3.244/32', sources: ['https://api.paddle.com/ips'] },
				{ ip: '34.195.105.136/32', sources: ['https://api.paddle.com/ips'] },
				{ ip: '3.208.120.145/32', sources: ['https://sandbox-api.paddle.com/ips'] },
			]);
		});

		it('throws when path does not point to an array', async () => {
			respondWith(get, { data: { data: {} } });

			await assert.rejects(fetchSource({ name: 'Paddle', url: 'https://api.paddle.com/ips', path: 'data.ipv4_cidrs', type: 'jsonPath' }), { message: /is not an array/ });
		});

		it('throws when path is missing', async () => {
			await assert.rejects(fetchSource({ name: 'Paddle', url: 'https://api.paddle.com/ips', type: 'jsonPath' }), { message: /Missing JSON path/ });
		});
	});

	describe('htmlCidrs type', () => {
		it('extracts unique CIDRs and ignores bare IPv4-like strings', async () => {
			respondWith(get, {
				data: '<script src="/lib-152.0.0.0.js"></script><p>64.4.240.0/21<br>173.0.80.0/20</p><p>64.4.240.0/21</p>',
			});

			const out = await fetchSource({ name: 'PayPal', url: 'https://www.paypal.com/help', type: 'htmlCidrs' });
			assert.deepEqual(out.map(r => r.ip), ['64.4.240.0/21', '173.0.80.0/20']);
		});

		it('renders the page in a browser when source.browser is set', async () => {
			respondWith(getRenderedHtml, '<p>64.4.240.0/21</p>');

			const out = await fetchSource({ name: 'PayPal', url: 'https://www.paypal.com/help', type: 'htmlCidrs', browser: true });
			assert.deepEqual(out.map(r => r.ip), ['64.4.240.0/21']);
			assert.equal(get.mock.callCount(), 0);
		});
	});

	describe('unknown type', () => {
		it('throws on unknown source type', async () => {
			await assert.rejects(fetchSource({ name: 'Test', type: 'nonexistent' }), { message: /Unknown source type/ });
		});
	});
});
