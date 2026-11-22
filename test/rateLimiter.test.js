const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const RateLimiter = require('../scripts/utils/rateLimiter.js');

describe('RateLimiter', () => {
	it('rejects invalid configuration', () => {
		assert.throws(() => new RateLimiter(0, 0), /Invalid rate limiter configuration/);
		assert.throws(() => new RateLimiter(1, -1), /Invalid rate limiter configuration/);
	});

	it('never exceeds the concurrency limit and returns every result', async () => {
		const limiter = new RateLimiter(2, 0);
		let active = 0, peak = 0;
		const task = n => limiter.execute(async () => {
			peak = Math.max(peak, ++active);
			await new Promise(r => setTimeout(r, 5));
			active--;
			return n;
		});

		assert.deepEqual(await Promise.all([1, 2, 3, 4, 5].map(task)), [1, 2, 3, 4, 5]);
		assert.equal(peak, 2);
	});

	it('propagates task errors without blocking the queue', async () => {
		const limiter = new RateLimiter(1, 0);
		const failing = limiter.execute(async () => { throw new Error('boom'); });
		const next = limiter.execute(async () => 'ok');

		await assert.rejects(failing, /boom/);
		assert.equal(await next, 'ok');
	});

	it('rejects a non-function task', () => {
		assert.throws(() => new RateLimiter(1, 0).execute('x'), /expects a function/);
	});
});
