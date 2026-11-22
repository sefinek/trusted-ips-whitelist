const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { stubModule, respondWith } = require('./helpers/mocks.js');

stubModule('scripts/utils/retry.js', { executeWithRetry: fn => fn() });

const axios = require('../scripts/services/axios.js');
const fetchFromRIPEstat = require('../scripts/services/ripestat.js');

const src = asn => ({ name: 'TestBot', asn });

describe('fetchFromRIPEstat', () => {
	let get;

	beforeEach(() => {
		get = mock.method(axios, 'get');
	});

	afterEach(() => {
		mock.timers.reset();
		mock.restoreAll();
	});

	it('returns IPs from valid response', async () => {
		respondWith(get, {
			data: {
				status: 'ok',
				data: {
					prefixes: [
						{ prefix: '1.2.3.0/24' },
						{ prefix: '5.6.7.0/24' },
					],
				},
			},
		});

		const result = await fetchFromRIPEstat(src('12345'), false);
		assert.deepEqual(result, [
			{ ip: '1.2.3.0/24', source: 'https://stat.ripe.net' },
			{ ip: '5.6.7.0/24', source: 'https://stat.ripe.net' },
		]);
	});

	it('returns empty array when status is not ok', async () => {
		respondWith(get, {
			data: { status: 'error', data: null },
		});

		const result = await fetchFromRIPEstat(src('12345'), false);
		assert.deepEqual(result, []);
	});

	it('returns empty array when prefixes are missing', async () => {
		respondWith(get, {
			data: { status: 'ok', data: {} },
		});

		const result = await fetchFromRIPEstat(src('12345'), false);
		assert.deepEqual(result, []);
	});

	it('skips entries with invalid prefix', async () => {
		respondWith(get, {
			data: {
				status: 'ok',
				data: {
					prefixes: [
						{ prefix: 'not-an-ip' },
						{ prefix: '1.2.3.0/24' },
					],
				},
			},
		});

		const result = await fetchFromRIPEstat(src('12345'), false);
		assert.equal(result.length, 1);
		assert.equal(result[0].ip, '1.2.3.0/24');
	});

	it('skips entries with null or missing prefix', async () => {
		respondWith(get, {
			data: {
				status: 'ok',
				data: { prefixes: [null, {}, { prefix: '8.8.0.0/16' }] },
			},
		});

		const result = await fetchFromRIPEstat(src('12345'), false);
		assert.equal(result.length, 1);
		assert.equal(result[0].ip, '8.8.0.0/16');
	});

	it('returns empty array on network error', async () => {
		respondWith(get, new Error('ECONNREFUSED'));

		const result = await fetchFromRIPEstat(src('12345'), false);
		assert.deepEqual(result, []);
	});

	it('retries on 429 and returns result after retry', async () => {
		const rateLimitErr = Object.assign(new Error('Too Many Requests'), {
			response: { status: 429 },
		});

		respondWith(get, rateLimitErr, {
			data: {
				status: 'ok',
				data: { prefixes: [{ prefix: '9.9.9.0/24' }] },
			},
		});

		mock.timers.enable({ apis: ['setTimeout'] });
		const pending = fetchFromRIPEstat(src('12345'), false, 0);
		await new Promise(setImmediate);
		mock.timers.tick(10000);

		const result = await pending;
		assert.deepEqual(result, [{ ip: '9.9.9.0/24', source: 'https://stat.ripe.net' }]);
	});
});
