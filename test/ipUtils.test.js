const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseIP, isValidIP, compareIPs, isPrivateIP, parseCIDREntry, isTooBroadCIDR, findCoveringCIDR } = require('../scripts/ipUtils.js');

describe('ipUtils', () => {
	describe('isTooBroadCIDR', () => {
		it('rejects IPv4 prefixes shorter than /8 and IPv6 shorter than /16', () => {
			assert.equal(isTooBroadCIDR('1.0.0.0/1'), true);
			assert.equal(isTooBroadCIDR('8.0.0.0/7'), true);
			assert.equal(isTooBroadCIDR('2000::/3'), true);
		});

		it('accepts reasonable prefixes and single IPs', () => {
			assert.equal(isTooBroadCIDR('104.16.0.0/13'), false);
			assert.equal(isTooBroadCIDR('2400:da00::/22'), false);
			assert.equal(isTooBroadCIDR('1.2.3.4'), false);
			assert.equal(isTooBroadCIDR('2606:4700:4700::1111'), false);
		});
	});

	describe('parseIP', () => {
		it('parses valid IPv4', () => {
			assert.equal(parseIP('1.2.3.4').toString(), '1.2.3.4');
		});

		it('parses valid IPv6', () => {
			assert.equal(parseIP('2001:4860:4860::8888').toString(), '2001:4860:4860::8888');
		});

		it('parses CIDR and returns base address', () => {
			assert.equal(parseIP('8.8.8.0/24').toString(), '8.8.8.0');
			assert.equal(parseIP('2606:4700::/32').toString(), '2606:4700::');
		});

		it('trims whitespace before parsing', () => {
			assert.equal(parseIP('  1.1.1.1  ').toString(), '1.1.1.1');
		});

		it('returns null for invalid input', () => {
			assert.equal(parseIP('not-an-ip'), null);
			assert.equal(parseIP(''), null);
			assert.equal(parseIP(null), null);
			assert.equal(parseIP(undefined), null);
			assert.equal(parseIP(123), null);
		});

		it('returns null for prefix out of range', () => {
			assert.equal(parseIP('1.2.3.4/33'), null);
			assert.equal(parseIP('::1/129'), null);
		});

		it('returns null for negative prefix', () => {
			assert.equal(parseIP('1.2.3.4/-1'), null);
		});
	});

	describe('isValidIP', () => {
		it('accepts valid IPv4', () => {
			assert.equal(isValidIP('8.8.8.8'), true);
		});

		it('accepts valid IPv6', () => {
			assert.equal(isValidIP('2001:4860:4860::8844'), true);
		});

		it('accepts valid CIDR', () => {
			assert.equal(isValidIP('10.0.0.0/8'), true);
			assert.equal(isValidIP('2606:4700::/32'), true);
		});

		it('rejects invalid input', () => {
			assert.equal(isValidIP('not-an-ip'), false);
			assert.equal(isValidIP(''), false);
			assert.equal(isValidIP(null), false);
			assert.equal(isValidIP(undefined), false);
		});
	});

	describe('compareIPs', () => {
		it('sorts IPv4 addresses numerically', () => {
			const list = ['8.8.8.8', '1.1.1.1', '192.168.1.1'];
			assert.deepEqual([...list].sort(compareIPs), ['1.1.1.1', '8.8.8.8', '192.168.1.1']);
		});

		it('sorts IPv6 addresses correctly', () => {
			const list = ['2001:db8::2', '2001:db8::1', '::1'];
			assert.deepEqual([...list].sort(compareIPs), ['::1', '2001:db8::1', '2001:db8::2']);
		});

		it('places IPv4 before IPv6', () => {
			const list = ['2001:db8::1', '8.8.8.8', '::1'];
			const sorted = [...list].sort(compareIPs);
			assert.equal(sorted[0], '8.8.8.8');
		});

		it('sorts CIDRs by prefix length when base is equal', () => {
			const list = ['10.0.0.0/16', '10.0.0.0/8', '10.0.0.0/24'];
			assert.deepEqual([...list].sort(compareIPs), ['10.0.0.0/8', '10.0.0.0/16', '10.0.0.0/24']);
		});
	});

	describe('isPrivateIP', () => {
		it('detects RFC 1918 private ranges', () => {
			assert.equal(isPrivateIP('10.0.0.1'), true);
			assert.equal(isPrivateIP('172.16.0.1'), true);
			assert.equal(isPrivateIP('172.31.255.255'), true);
			assert.equal(isPrivateIP('192.168.1.1'), true);
		});

		it('detects loopback addresses', () => {
			assert.equal(isPrivateIP('127.0.0.1'), true);
			assert.equal(isPrivateIP('::1'), true);
		});

		it('detects link-local addresses', () => {
			assert.equal(isPrivateIP('169.254.1.1'), true);
			assert.equal(isPrivateIP('fe80::1'), true);
		});

		it('detects unspecified addresses', () => {
			assert.equal(isPrivateIP('0.0.0.0'), true);
			assert.equal(isPrivateIP('::'), true);
		});

		it('detects IPv6 unique local addresses', () => {
			assert.equal(isPrivateIP('fc00::1'), true);
			assert.equal(isPrivateIP('fd12:3456:789a::1'), true);
		});

		it('returns false for public IPs', () => {
			assert.equal(isPrivateIP('8.8.8.8'), false);
			assert.equal(isPrivateIP('1.1.1.1'), false);
			assert.equal(isPrivateIP('2606:4700:4700::1111'), false);
		});

		it('returns false for invalid input', () => {
			assert.equal(isPrivateIP('not-an-ip'), false);
			assert.equal(isPrivateIP(null), false);
		});
	});

	describe('parseCIDREntry', () => {
		it('parses valid IPv4 CIDR', () => {
			const result = parseCIDREntry('192.168.0.0/16');
			assert.notEqual(result, null);
			assert.equal(result.cidr, '192.168.0.0/16');
			assert.equal(result.prefix, 16);
		});

		it('parses valid IPv6 CIDR', () => {
			const result = parseCIDREntry('2606:4700::/32');
			assert.notEqual(result, null);
			assert.equal(result.cidr, '2606:4700::/32');
			assert.equal(result.prefix, 32);
		});

		it('returns null for invalid CIDR', () => {
			assert.equal(parseCIDREntry('not-a-cidr'), null);
			assert.equal(parseCIDREntry('1.2.3.4'), null);
		});
	});

	describe('findCoveringCIDR', () => {
		it('finds covering CIDR for an IP', () => {
			const cidrs = [parseCIDREntry('8.8.0.0/16')].filter(Boolean);
			assert.notEqual(findCoveringCIDR('8.8.8.8', cidrs), null);
			assert.equal(findCoveringCIDR('8.8.8.8', cidrs).cidr, '8.8.0.0/16');
		});

		it('returns null when no CIDR covers the IP', () => {
			const cidrs = [parseCIDREntry('10.0.0.0/8')].filter(Boolean);
			assert.equal(findCoveringCIDR('8.8.8.8', cidrs), null);
		});

		it('matches IPv6 IP against IPv6 CIDR', () => {
			const cidrs = [parseCIDREntry('2606:4700::/32')].filter(Boolean);
			assert.notEqual(findCoveringCIDR('2606:4700:4700::1113', cidrs), null);
		});

		it('does not match IPv4 against IPv6 CIDR', () => {
			const cidrs = [parseCIDREntry('2606:4700::/32')].filter(Boolean);
			assert.equal(findCoveringCIDR('1.1.1.1', cidrs), null);
		});

		it('returns null for empty CIDR list', () => {
			assert.equal(findCoveringCIDR('8.8.8.8', []), null);
		});

		it('cross-source scenario: Cloudflare CIDR does not absorb DNS resolver IP when filtered by name', () => {
			const cloudflareCIDR = { ...parseCIDREntry('2606:4700::/32'), names: new Set(['Cloudflare']) };
			const dnsIP = '2606:4700:4700::1113';
			const dnsNames = new Set(['DNS Resolvers']);

			const hasSharedName = c => [...c.names].some(n => dnsNames.has(n));
			const sameSourceCIDRs = [cloudflareCIDR].filter(hasSharedName);
			assert.equal(findCoveringCIDR(dnsIP, sameSourceCIDRs), null);
		});

		it('cross-source scenario: same-source CIDR does absorb its own IP', () => {
			const cloudflareCIDR = { ...parseCIDREntry('2606:4700::/32'), names: new Set(['Cloudflare']) };
			const ipNames = new Set(['Cloudflare']);

			const hasSharedName = c => [...c.names].some(n => ipNames.has(n));
			const sameSourceCIDRs = [cloudflareCIDR].filter(hasSharedName);
			assert.notEqual(findCoveringCIDR('2606:4700:4700::1113', sameSourceCIDRs), null);
		});
	});
});
