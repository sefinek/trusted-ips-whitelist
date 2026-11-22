const fs = require('node:fs/promises');
const path = require('node:path');
const getYandexIPs = require('./parser/yandex.js');
const getRenderedHtml = require('./parser/browserHtml.js');
const getASNPrefixes = require('./services/whois.js');
const axios = require('./services/axios.js');
const logger = require('./utils/logger.js');
const { NetworkError, TimeoutError } = require('./utils/errors.js');
const { executeWithRetry } = require('./utils/retry.js');
const { validateSource } = require('./utils/validation.js');
const { isValidIP, CIDR_PATTERN } = require('./ipUtils.js');

const splitAndFilter = data => {
	if (typeof data !== 'string') return [];
	return data
		.split(/\r?\n/)
		.map(l => l.trim())
		.filter(l => l && !l.startsWith('#') && isValidIP(l));
};

const parseList = (list, source) => {
	if (!Array.isArray(list)) return [];
	return list
		.filter(ip => ip && typeof ip === 'string' && isValidIP(ip.trim()))
		.map(ip => ({ ip: ip.trim(), source }));
};

const parseCustomFileData = (data, source) => {
	if (typeof data !== 'string') return [];
	const lines = data.split(/\r?\n/);
	let currentLabel = null;
	const results = [];

	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;

		if (line.startsWith('#')) {
			currentLabel = line.slice(1).trim() || null;
			continue;
		}

		const hashIdx = line.indexOf('#');
		const ipPart = hashIdx !== -1 ? line.slice(0, hashIdx).trim() : line;
		if (!ipPart || !isValidIP(ipPart)) continue;

		const record = { ip: ipPart, source };
		if (currentLabel) record.label = currentLabel;
		results.push(record);
	}

	return results;
};

const mergeRecordsByIp = records => {
	const map = new Map();

	for (const record of records) {
		if (!record?.ip) continue;
		const entry = map.get(record.ip) || { ip: record.ip, sources: new Set(), labels: new Set() };
		const sources = Array.isArray(record.sources)
			? record.sources
			: (record.source ? [record.source] : []);

		for (const src of sources) {
			if (typeof src !== 'string') continue;
			const trimmed = src.trim();
			if (trimmed) entry.sources.add(trimmed);
		}

		if (record.label) entry.labels.add(record.label);
		map.set(record.ip, entry);
	}

	return Array.from(map.values()).map(entry => {
		const result = { ip: entry.ip, sources: Array.from(entry.sources).sort() };
		if (entry.labels.size > 0) result.label = Array.from(entry.labels).join(' | ');
		return result;
	});
};

const readCustomFiles = async files => {
	const fileList = (Array.isArray(files) ? files : [files]).filter(Boolean);
	if (!fileList.length) throw new Error('Custom file name is required');

	const results = await Promise.all(fileList.map(async file => {
		const filePath = path.join(__dirname, '../custom', file);
		try {
			const data = await fs.readFile(filePath, 'utf8');
			return parseCustomFileData(data, `https://github.com/sefinek/trusted-ips-whitelist/blob/main/custom/${file}`);
		} catch (err) {
			throw new Error(`Failed to read file ${file}: ${err.message}`, { cause: err });
		}
	}));

	return results.flat();
};

const REQUEST_TIMEOUT_MS = 60000;

const withTimeout = async (promise, timeoutMs = REQUEST_TIMEOUT_MS) => {
	let timeoutId;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timeoutId = setTimeout(() => reject(new TimeoutError(`Operation timeout after ${timeoutMs}ms`, timeoutMs)), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timeoutId);
	}
};

const fetchWithTimeout = async (url, config = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await axios.get(url, { ...config, signal: controller.signal });
	} catch (err) {
		if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
			throw new TimeoutError(`Operation timeout after ${timeoutMs}ms`, timeoutMs);
		}
		throw err;
	} finally {
		clearTimeout(timeoutId);
	}
};

const requireUrl = source => {
	if (!source.url) throw new Error(`Missing URL for ${source.name}`);
};

const getData = async (source, url, config) => {
	const { data } = await executeWithRetry(() => fetchWithTimeout(url, config), { label: `${source.name} ${url}` });
	return data;
};

const fetchEach = async (source, parse) => {
	const urls = Array.isArray(source.url) ? source.url : [source.url];
	const results = await Promise.all(urls.map(async u => parse(await getData(source, u), u)));
	return results.flat();
};

const parseTextLines = (data, url) => {
	if (typeof data === 'string') return parseList(splitAndFilter(data), url);
	if (Array.isArray(data)) return parseList(data.map(String).map(l => l.trim()).filter(Boolean), url);
	return [];
};

const jsonSource = extract => async source => {
	requireUrl(source);
	return fetchEach(source, (data, url) => {
		if (!data || typeof data !== 'object') throw new Error(`Invalid JSON response from ${url}`);
		return parseList(extract(data, source, url), url);
	});
};

const HANDLERS = {
	whois: source => {
		if (!source.asn) throw new Error(`Missing ASN for ${source.name}`);
		return executeWithRetry(() => withTimeout(getASNPrefixes(source)), { label: `${source.name} WHOIS` });
	},

	yandex: source => executeWithRetry(() => withTimeout(getYandexIPs()), { label: `${source.name} Yandex` }),

	file: source => {
		if (!source.file) throw new Error(`Missing file for ${source.name}`);
		return readCustomFiles(source.file);
	},

	hosts: source => {
		requireUrl(source);
		return fetchEach(source, parseTextLines);
	},

	textMulti: source => {
		if (!Array.isArray(source.url) || !source.url.length) throw new Error(`Missing URLs array for ${source.name}`);
		return fetchEach(source, parseTextLines);
	},

	jsonPrefixes: jsonSource(data => (data.prefixes || []).map(p => p.ipv4Prefix || p.ipv6Prefix).filter(Boolean)),

	jsonIps: jsonSource(data => (data.ips || []).map(o => o.ip_address).filter(Boolean)),

	jsonAddresses: jsonSource(data => {
		if (!data.data) throw new Error('Invalid JSON response structure');
		return Object.values(data.data).flatMap(d => d.addresses || []).filter(Boolean);
	}),

	jsonPath: async source => {
		if (!source.path || typeof source.path !== 'string') throw new Error(`Missing JSON path for ${source.name}`);

		const keys = source.path.split('.');
		return jsonSource((data, _, url) => {
			const list = keys.reduce((obj, key) => obj?.[key], data);
			if (!Array.isArray(list)) throw new Error(`Path "${source.path}" is not an array in ${url}`);
			return list;
		})(source);
	},

	htmlCidrs: async source => {
		requireUrl(source);

		const html = await executeWithRetry(
			async () => source.browser ? getRenderedHtml(source.url) : (await fetchWithTimeout(source.url, { headers: { Accept: 'text/html' } })).data,
			{ label: `${source.name} HTML` }
		);
		if (typeof html !== 'string') throw new Error('Expected HTML response');

		// CIDR notation only - bare IPv4-like strings in HTML are often asset versions, not addresses
		const cidrs = html.match(new RegExp(String.raw`(?<![\d.])${CIDR_PATTERN}(?![\d.])`, 'g')) || [];
		return parseList([...new Set(cidrs)], source.url);
	},

	mdList: async source => {
		requireUrl(source);

		const data = await getData(source, source.url);
		if (typeof data !== 'string') throw new Error('Expected text response for markdown');

		const items = data.split(/\r?\n/).filter(l => l.startsWith('- ')).map(l => l.slice(2).trim()).filter(Boolean);
		return parseList(items, source.url);
	},
};

module.exports = async source => {
	try {
		validateSource(source);

		if (!Object.hasOwn(HANDLERS, source.type)) throw new Error(`Unknown source type: ${source.type}`);
		let out = await HANDLERS[source.type](source);

		if (source.extraFiles) {
			try {
				out = out.concat(await readCustomFiles(source.extraFiles));
			} catch (err) {
				logger.warn(`Failed to append extra files for ${source.name}: ${err.message}`);
			}
		}

		out = mergeRecordsByIp(out);
		if (!out.length) logger.warn(`No valid IPs found for ${source.name}`);

		return out;
	} catch (err) {
		if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') throw new NetworkError(`Network error for ${source.name}: ${err.message}`, err);
		throw err;
	}
};
