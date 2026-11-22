const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ValidationError, NetworkError, SecurityError, TimeoutError } = require('../scripts/utils/errors.js');

describe('Custom Error Classes', () => {
	describe('ValidationError', () => {
		it('creates error with message and field', () => {
			const error = new ValidationError('Invalid field', 'email');
			assert.equal(error.message, 'Invalid field');
			assert.equal(error.name, 'ValidationError');
			assert.equal(error.field, 'email');
			assert.ok(error instanceof Error);
		});
	});

	describe('NetworkError', () => {
		it('creates error with message only', () => {
			const error = new NetworkError('Connection failed');
			assert.equal(error.message, 'Connection failed');
			assert.equal(error.name, 'NetworkError');
			assert.equal(error.originalError, null);
			assert.ok(error instanceof Error);
		});

		it('creates error with original error', () => {
			const original = new Error('ECONNREFUSED');
			original.code = 'ECONNREFUSED';

			const error = new NetworkError('Connection failed', original);
			assert.equal(error.message, 'Connection failed');
			assert.equal(error.name, 'NetworkError');
			assert.equal(error.originalError, original);
			assert.equal(error.code, 'ECONNREFUSED');
		});
	});

	describe('SecurityError', () => {
		it('creates error with message', () => {
			const error = new SecurityError('Command injection detected');
			assert.equal(error.message, 'Command injection detected');
			assert.equal(error.name, 'SecurityError');
			assert.ok(error instanceof Error);
		});
	});

	describe('TimeoutError', () => {
		it('creates error with message and timeout', () => {
			const error = new TimeoutError('Operation timed out', 5000);
			assert.equal(error.message, 'Operation timed out');
			assert.equal(error.name, 'TimeoutError');
			assert.equal(error.timeout, 5000);
			assert.ok(error instanceof Error);
		});
	});
});
