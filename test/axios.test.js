const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { name, version, homepage } = require('../package.json');

describe('axios instance', () => {
	const api = require('../scripts/services/axios.js');

	it('exports a function with get method', () => {
		assert.equal(typeof api.get, 'function');
	});

	it('has 60 second timeout', () => {
		assert.equal(api.defaults.timeout, 60000);
	});

	it('includes project User-Agent header', () => {
		const headers = api.defaults.headers;
		const ua = headers?.common?.['User-Agent'] ?? headers?.['User-Agent'];
		assert.ok(ua.includes(`${name}/${version}`));
		assert.ok(ua.includes(homepage));
	});

	it('sets Accept to application/json', () => {
		const headers = api.defaults.headers;
		const accept = headers?.common?.Accept ?? headers?.Accept;
		assert.ok(accept.includes('application/json'));
	});
});
