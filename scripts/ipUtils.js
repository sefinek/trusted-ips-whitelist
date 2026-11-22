const ipaddr = require('ipaddr.js');

const CIDR_PATTERN = String.raw`\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}`;

const isCIDR = ip => ip.includes('/');

const parseIP = ip => {
	if (typeof ip !== 'string') return null;

	const trimmed = ip.trim();
	if (!trimmed) return null;

	try {
		return isCIDR(trimmed) ? ipaddr.parseCIDR(trimmed)[0] : ipaddr.parse(trimmed);
	} catch {
		return null;
	}
};

const isValidIP = ip => parseIP(ip) !== null;

const describeIP = ip => {
	const parsed = parseIP(ip);
	if (!parsed) return { ip, parsed: null };

	return {
		ip,
		parsed,
		kind: parsed.kind(),
		bytes: parsed.toByteArray(),
		prefix: isCIDR(ip) ? parseInt(ip.split('/')[1], 10) : null,
	};
};

const compareDescribed = (A, B) => {
	if (!A.parsed && !B.parsed) return A.ip.localeCompare(B.ip);
	if (!A.parsed) return 1;
	if (!B.parsed) return -1;

	if (A.kind !== B.kind) return A.kind === 'ipv4' ? -1 : 1;

	const len = Math.max(A.bytes.length, B.bytes.length);
	for (let i = 0; i < len; i++) {
		const diff = (A.bytes[i] || 0) - (B.bytes[i] || 0);
		if (diff !== 0) return diff;
	}

	if (A.prefix !== null && B.prefix !== null) return A.prefix - B.prefix;
	return A.ip.localeCompare(B.ip);
};

const compareIPs = (a, b) => {
	if (!a || !b) return (a || '').localeCompare(b || '');
	return compareDescribed(describeIP(a), describeIP(b));
};

// Parsuje każdy adres raz, zamiast przy każdym porównaniu (compareIPs parsuje oba adresy za każdym razem)
const sortByIP = (items, getIp = item => item) => items
	.map(item => ({ item, key: describeIP(getIp(item)) }))
	.sort((a, b) => compareDescribed(a.key, b.key))
	.map(({ item }) => item);

const isPrivateIP = ip => {
	const parsed = parseIP(ip);
	if (!parsed) return false;

	try {
		const range = parsed.range();
		return range === 'private' || range === 'loopback' || range === 'linkLocal' || range === 'uniqueLocal' || range === 'unspecified';
	} catch {
		return false;
	}
};

const parseCIDREntry = cidr => {
	try {
		const [addr, prefix] = ipaddr.parseCIDR(cidr.trim());
		return { cidr, addr, prefix };
	} catch {
		return null;
	}
};

const MIN_PREFIX = { ipv4: 8, ipv6: 16 };

const isTooBroadCIDR = ip => {
	if (!ip || !isCIDR(ip)) return false;
	const parsed = parseCIDREntry(ip);
	return !parsed || parsed.prefix < MIN_PREFIX[parsed.addr.kind()];
};

const findCoveringCIDR = (ip, parsedCIDRs) => {
	try {
		const parsed = ipaddr.parse(ip.trim());
		const kind = parsed.kind();
		return parsedCIDRs.find(c => c.addr.kind() === kind && parsed.match(c.addr, c.prefix)) ?? null;
	} catch {
		return null;
	}
};

module.exports = {
	CIDR_PATTERN,
	isCIDR,
	parseIP,
	isValidIP,
	compareIPs,
	sortByIP,
	isPrivateIP,
	parseCIDREntry,
	isTooBroadCIDR,
	findCoveringCIDR,
};