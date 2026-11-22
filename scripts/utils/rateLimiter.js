const sleep = require('./sleep.js');

class RateLimiter {
	#maxConcurrent;
	#delayMs;
	#running = 0;
	#queue = [];

	constructor(maxConcurrent = 3, delayMs = 1000) {
		if (maxConcurrent <= 0 || delayMs < 0) throw new Error('Invalid rate limiter configuration');
		this.#maxConcurrent = maxConcurrent;
		this.#delayMs = delayMs;
	}

	execute(fn) {
		if (typeof fn !== 'function') throw new TypeError('Rate limiter expects a function');

		return new Promise((resolve, reject) => {
			this.#queue.push({ fn, resolve, reject });
			this.#drain();
		});
	}

	#drain() {
		while (this.#running < this.#maxConcurrent && this.#queue.length) {
			this.#run(this.#queue.shift());
		}
	}

	async #run({ fn, resolve, reject }) {
		this.#running++;
		try {
			resolve(await fn());
		} catch (err) {
			reject(err);
		} finally {
			await sleep(this.#delayMs);
			this.#running--;
			this.#drain();
		}
	}
}

module.exports = RateLimiter;
