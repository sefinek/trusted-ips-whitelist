const axios = require('./axios.js');
const { parseIP } = require('../ipUtils.js');
const { executeWithRetry } = require('../utils/retry.js');
const logger = require('../utils/logger.js');
const sleep = require('../utils/sleep.js');

const sleepWithJitter = (baseMs, randomMs = 0) => sleep(baseMs + Math.floor(Math.random() * randomMs));

const fetchFromRIPEstat = async (src, shouldDelay = true, retryCount = 0) => {
	const maxRetries = 3;

	try {
		if (shouldDelay) {
			const baseDelay = retryCount === 0 ? 5000 : 3000;
			const randomDelay = retryCount === 0 ? 5000 : 2000;
			await sleepWithJitter(baseDelay, randomDelay);
		}

		const res = await executeWithRetry(
			() => axios.get(`https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${src.asn}`, {
				headers: { 'Accept': 'application/json' },
			}),
			{ label: `RIPEstat AS${src.asn}` }
		);

		const { data } = res;
		if (!data || data.status !== 'ok' || !data.data || !data.data.prefixes) {
			logger.warn(`Invalid RIPEstat response for AS${src.asn} (status: ${data?.status})`);
			return [];
		}

		const prefixes = Array.isArray(data.data.prefixes) ? data.data.prefixes : [];
		const result = [];

		for (const p of prefixes) {
			if (!p || !p.prefix) continue;

			if (!parseIP(p.prefix)) {
				logger.warn(`Invalid IP prefix from RIPEstat: ${p.prefix} (ASN ${src.asn})`);
				continue;
			}

			result.push({ ip: p.prefix, source: 'https://stat.ripe.net' });
		}

		return result;
	} catch (err) {
		if (err.response && err.response.status === 429 && retryCount < maxRetries) {
			const backoffDelay = Math.pow(2, retryCount) * 10000; // 10s, 20s, 40s
			logger.warn(`RIPEstat rate limit for AS${src.asn}, retry in ${backoffDelay / 1000}s (${retryCount + 1}/${maxRetries})`);
			await sleep(backoffDelay);
			return fetchFromRIPEstat(src, false, retryCount + 1);
		}

		logger.warn(`RIPEstat failed for AS${src.asn}: ${err.message}`);
		return [];
	}
};

module.exports = fetchFromRIPEstat;
