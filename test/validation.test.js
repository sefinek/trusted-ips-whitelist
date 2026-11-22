const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateUrl, validateSource, validateSourcesConfig } = require('../scripts/utils/validation.js');
const { SecurityError, ValidationError } = require('../scripts/utils/errors.js');

describe('validateUrl', () => {
	it('accepts https URLs', () => {
		assert.equal(validateUrl('https://example.com'), 'https://example.com');
	});

	it('accepts http URLs', () => {
		assert.equal(validateUrl('http://example.com'), 'http://example.com');
	});

	it('rejects non-http protocols', () => {
		assert.throws(() => validateUrl('file:///etc/passwd'), SecurityError);
		assert.throws(() => validateUrl('ftp://example.com'), SecurityError);
		assert.throws(() => validateUrl('javascript:alert(1)'), SecurityError);
	});

	it('rejects invalid URLs', () => {
		assert.throws(() => validateUrl('not a url'), SecurityError);
		assert.throws(() => validateUrl(''), SecurityError);
		assert.throws(() => validateUrl(null), SecurityError);
	});

	it('rejects loopback and private hosts', () => {
		assert.throws(() => validateUrl('http://127.0.0.1/latest/meta-data'), SecurityError);
		assert.throws(() => validateUrl('http://localhost:8080/internal-api'), SecurityError);
		assert.throws(() => validateUrl('http://169.254.169.254/latest/meta-data/iam/security-credentials/'), SecurityError);
		assert.throws(() => validateUrl('http://10.0.0.5/'), SecurityError);
		assert.throws(() => validateUrl('http://192.168.1.1/'), SecurityError);
		assert.throws(() => validateUrl('http://[::1]/'), SecurityError);
		assert.throws(() => validateUrl('http://[fc00::1]/'), SecurityError);
	});

	it('accepts public hosts that merely resemble private ones in text', () => {
		assert.equal(validateUrl('https://example.com/10.0.0.1'), 'https://example.com/10.0.0.1');
	});
});

describe('validateSource', () => {
	it('accepts valid source', () => {
		assert.doesNotThrow(() => validateSource({ name: 'TestBot', type: 'hosts', url: 'https://example.com/ips.txt' }));
	});

	it('accepts source with array of URLs', () => {
		assert.doesNotThrow(() => validateSource({ name: 'TestBot', type: 'textMulti', url: ['https://example.com/ipv4', 'https://example.com/ipv6'] }));
	});

	it('rejects missing name', () => {
		assert.throws(() => validateSource({ type: 'hosts', url: 'https://example.com' }), ValidationError);
	});

	it('rejects missing type', () => {
		assert.throws(() => validateSource({ name: 'TestBot', url: 'https://example.com' }), ValidationError);
	});

	it('rejects invalid URL in array', () => {
		assert.throws(() => validateSource({ name: 'TestBot', type: 'textMulti', url: ['https://example.com', 'ftp://bad.com'] }), SecurityError);
	});

	it('rejects null or undefined', () => {
		assert.throws(() => validateSource(null), ValidationError);
		assert.throws(() => validateSource(undefined), ValidationError);
	});

	it('rejects non-string name', () => {
		assert.throws(() => validateSource({ name: 123, type: 'hosts' }), ValidationError);
	});
});

describe('validateSourcesConfig', () => {
	const makeSource = (overrides = {}) => ({
		name: 'TestBot',
		dir: 'testbot',
		category: 'crawlers',
		url: 'https://example.com/ips.txt',
		type: 'hosts',
		...overrides,
	});

	it('accepts valid config', () => {
		assert.doesNotThrow(() => validateSourcesConfig([makeSource()]));
	});

	it('accepts all valid categories', () => {
		const categories = ['crawlers', 'monitoring', 'infrastructure', 'ai', 'payments'];
		categories.forEach((category, i) => {
			assert.doesNotThrow(() => validateSourcesConfig([makeSource({ name: `Bot${i}`, dir: `bot${i}`, category })]));
		});
	});

	it('accepts source without category', () => {
		const src = makeSource();
		delete src.category;
		assert.doesNotThrow(() => validateSourcesConfig([src]));
	});

	it('rejects empty array', () => {
		assert.throws(() => validateSourcesConfig([]), ValidationError);
	});

	it('rejects non-array', () => {
		assert.throws(() => validateSourcesConfig(null), ValidationError);
		assert.throws(() => validateSourcesConfig({}), ValidationError);
	});

	it('rejects missing dir', () => {
		const src = makeSource();
		delete src.dir;
		assert.throws(() => validateSourcesConfig([src]), ValidationError);
	});

	it('rejects unknown category', () => {
		assert.throws(() => validateSourcesConfig([makeSource({ category: 'unknown' })]), ValidationError);
	});

	it('normalizes extraFiles to array', () => {
		const result = validateSourcesConfig([makeSource({ extraFiles: ['file.txt'] })]);
		assert.equal(Array.isArray(result[0].extraFiles), true);
	});

	it('accepts multiple sources', () => {
		const sources = [
			makeSource({ name: 'BotA', dir: 'bota' }),
			makeSource({ name: 'BotB', dir: 'botb', category: 'ai' }),
			makeSource({ name: 'BotC', dir: 'botc', category: 'monitoring', url: 'https://example.com/b.txt' }),
		];
		assert.doesNotThrow(() => validateSourcesConfig(sources));
	});
});
