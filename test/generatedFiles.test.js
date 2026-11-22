const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const ipaddr = require('ipaddr.js');
const { parse } = require('csv-parse/sync');
const sourcesConfig = require('../sources.json');
const listsDir = path.join(__dirname, '../lists');

const validateIP = ip => {
	if (!ip || typeof ip !== 'string') throw new Error(`Invalid IP: ${ip}`);

	try {
		ip.includes('/') ? ipaddr.parseCIDR(ip) : ipaddr.parse(ip);
	} catch (err) {
		throw new Error(`${ip} - ${err.message}`, { cause: err });
	}
};

const parseTxt = raw => {
	const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean);
	assert.ok(lines.length > 0);
	lines.forEach(validateIP);
	return lines;
};

const parseCsv = raw => {
	const records = parse(raw, { columns: true, skip_empty_lines: true });
	assert.ok(records.length > 0);
	return records.map(r => {
		for (const key of ['IP', 'Name', 'Sources']) assert.equal(typeof r[key], 'string', `CSV record is missing ${key}`);
		validateIP(r.IP);
		return r.IP;
	});
};

const parseJson = raw => {
	const records = JSON.parse(raw);
	assert.ok(Array.isArray(records));
	assert.ok(records.length > 0);
	return records.map(r => {
		assert.equal(typeof r.ip, 'string');
		assert.equal(typeof r.name, 'string');
		assert.ok(Array.isArray(r.sources));
		validateIP(r.ip);
		return r.ip;
	});
};

const validateListFiles = async (dir, label) => {
	const [txt, csv, json] = await Promise.all([
		fs.readFile(path.join(dir, 'ips.txt'), 'utf8').catch(() => null),
		fs.readFile(path.join(dir, 'ips.csv'), 'utf8').catch(() => null),
		fs.readFile(path.join(dir, 'ips.json'), 'utf8').catch(() => null),
	]);

	if (!txt || !csv || !json) throw new Error(`Missing files in ${label}`);

	const txtIPs = parseTxt(txt);
	assert.deepEqual(parseCsv(csv), txtIPs);
	assert.deepEqual(parseJson(json), txtIPs);
	return txtIPs;
};

const validateCombinedFiles = async basename => {
	const [txt, csv, json] = await Promise.all([
		fs.readFile(path.join(listsDir, `${basename}.txt`), 'utf8'),
		fs.readFile(path.join(listsDir, `${basename}.csv`), 'utf8'),
		fs.readFile(path.join(listsDir, `${basename}.json`), 'utf8'),
	]);

	const txtIPs = parseTxt(txt);
	const csvIPs = parseCsv(csv);
	const jsonIPs = parseJson(json);

	assert.deepEqual(new Set(csvIPs), new Set(txtIPs));
	assert.deepEqual(new Set(jsonIPs), new Set(txtIPs));
	assert.equal(new Set(txtIPs).size, txtIPs.length);
	return txtIPs;
};

describe('Generated bot IP lists', () => {
	it('validates bot folders and global merged list', { timeout: 20000 }, async () => {
		const entries = await fs.readdir(listsDir, { withFileTypes: true });
		const folders = entries.filter(e => e.isDirectory() && !e.name.startsWith('all-')).map(e => e.name);
		const expectedDirs = new Set(sourcesConfig.map(src => src.dir));

		// no orphaned directories
		folders.forEach(dir => assert.ok(expectedDirs.has(dir), `Orphaned directory: ${dir}`));

		const allIPs = new Set();
		const ipsByFolder = new Map();

		for (const folder of folders) {
			const ips = await validateListFiles(path.join(listsDir, folder), folder);
			ipsByFolder.set(folder, ips);
			ips.forEach(ip => allIPs.add(ip));
		}

		// global list
		const globalIPs = await validateCombinedFiles('all-safe-ips');
		const globalSet = new Set(globalIPs);

		// every source must be represented in the global list
		for (const [folder, ips] of ipsByFolder) {
			assert.ok(ips.some(ip => globalSet.has(ip)), `${folder} is missing from all-safe-ips`);
		}

		globalIPs.forEach(ip => assert.ok(allIPs.has(ip), `${ip} is in all-safe-ips but in no source list`));

		// category lists
		const categories = [...new Set(sourcesConfig.map(s => s.category).filter(Boolean))];
		for (const category of categories) {
			const basename = `all-${category}-ips`;
			const exists = await fs.access(path.join(listsDir, `${basename}.txt`)).then(() => true).catch(() => false);
			if (!exists) continue;

			const catIPs = await validateCombinedFiles(basename);
			catIPs.forEach(ip => assert.ok(allIPs.has(ip), `${ip} is in ${basename} but in no source list`));
		}
	});
});
