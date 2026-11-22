const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildRecords, countRecs } = require('../scripts/lists.js');

const entry = (names, sources = []) => ({ names: new Set(names), sources: new Set(sources) });

describe('lists', () => {
	describe('countRecs', () => {
		it('splits plain IPs from CIDRs', () => {
			assert.deepEqual(countRecs([{ ip: '1.1.1.1' }, { ip: '2.2.2.0/24' }, { ip: '::1' }]), { ips: 2, cidrs: 1 });
		});
	});

	describe('buildRecords', () => {
		it('skips an IP covered by a CIDR from the same source only', () => {
			const map = new Map([
				['10.0.0.0/8', entry(['A'])],
				['10.1.2.3', entry(['A'])],
				['10.9.9.9', entry(['B'])],
			]);
			assert.deepEqual(buildRecords(map).map(r => r.ip), ['10.0.0.0/8', '10.9.9.9']);
		});

		it('merges names and sources, sorted', () => {
			const map = new Map([['1.1.1.1', entry(['B', 'A'], ['s2', 's1'])]]);
			assert.deepEqual(buildRecords(map), [{ ip: '1.1.1.1', name: 'A|B', sources: ['s1', 's2'] }]);
		});

		it('keeps IPv4 before IPv6 and orders by address', () => {
			const map = new Map([['::1', entry(['A'])], ['8.8.8.8', entry(['A'])], ['1.1.1.1', entry(['A'])]]);
			assert.deepEqual(buildRecords(map).map(r => r.ip), ['1.1.1.1', '8.8.8.8', '::1']);
		});
	});
});
