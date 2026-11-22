const { NetworkError, TimeoutError } = require('./errors.js');
const logger = require('./logger.js');
const sleep = require('./sleep.js');

const RETRYABLE_ERROR_CODES = new Set([
	'ECONNRESET',
	'ETIMEDOUT',
	'ECONNABORTED',
	'ECONNREFUSED',
	'EAI_AGAIN',
	'ENETUNREACH',
	'EHOSTUNREACH',
	'EPIPE',
]);

const isRetryableError = err => {
	if (err instanceof NetworkError || err instanceof TimeoutError) return true;
	if (err?.response?.status >= 500 && err.response.status < 600) return true;
	return Boolean(err?.code) && RETRYABLE_ERROR_CODES.has(err.code);
};

const executeWithRetry = async (operation, {
	retries = 2,
	delay = 1000,
	backoff = 2,
	label = 'operation',
	retryPredicate = isRetryableError,
} = {}) => {
	let attempt = 0;
	while (attempt <= retries) {
		try {
			return await operation();
		} catch (err) {
			if (!retryPredicate(err) || attempt === retries) throw err;
			const waitMs = delay * backoff ** attempt;
			logger.warn(`[${label}] Retry ${attempt + 1}/${retries} in ${waitMs}ms: ${err.message}`);
			await sleep(waitMs);
			attempt++;
		}
	}
};

module.exports = {
	executeWithRetry,
	isRetryableError,
};
