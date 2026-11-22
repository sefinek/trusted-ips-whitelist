const { stringify } = require('csv-stringify/sync');
const fs = require('node:fs/promises');
const path = require('node:path');
const ipUtils = require('./ipUtils.js');
const logger = require('./utils/logger.js');

const countRecs = recs => {
	const cidrs = recs.filter(r => r.ip.includes('/')).length;
	return { ips: recs.length - cidrs, cidrs };
};

const writeListFiles = async (dir, filename, recs) => {
	await Promise.all([
		fs.writeFile(path.join(dir, `${filename}.txt`), recs.map(r => r.ip).join('\n'), 'utf8'),
		fs.writeFile(path.join(dir, `${filename}.json`), JSON.stringify(recs), 'utf8'),
		fs.writeFile(path.join(dir, `${filename}.csv`), stringify(
			recs.map(r => ({ IP: r.ip, Name: r.name, Sources: r.sources.join('|') })),
			{ header: true, columns: ['IP', 'Name', 'Sources'] }
		), 'utf8'),
	]);
};

const buildRecords = (ipMap, logSkipped = false) => {
	const sortedIPs = ipUtils.sortByIP(Array.from(ipMap.keys()));

	const cidrsByName = new Map();
	for (const ip of sortedIPs) {
		if (!ip.includes('/')) continue;
		const parsed = ipUtils.parseCIDREntry(ip);
		if (!parsed) continue;
		for (const name of ipMap.get(ip).names) {
			if (!cidrsByName.has(name)) cidrsByName.set(name, []);
			cidrsByName.get(name).push(parsed);
		}
	}

	return sortedIPs.flatMap(ip => {
		const entry = ipMap.get(ip);
		const nameList = Array.from(entry.names).sort();

		if (!ip.includes('/')) {
			const sameSourceCIDRs = nameList.flatMap(n => cidrsByName.get(n) ?? []);
			const covering = ipUtils.findCoveringCIDR(ip, sameSourceCIDRs);
			if (covering) {
				if (logSkipped) logger.info(`IP ${ip} (${nameList.join('|')}) is already covered by CIDR ${covering.cidr}, skipping...`);
				return [];
			}
		}

		if (logSkipped && nameList.length > 1) logger.info(`IP ${ip} appears in multiple sources: ${nameList.join(', ')}`);
		return [{ ip, name: nameList.join('|'), sources: Array.from(entry.sources).sort() }];
	});
};

const createCategoryLists = async (base, categoryMaps) => {
	logger.info('Writing category lists...');

	const catRecs = new Map();
	await Promise.all(Array.from(categoryMaps.keys()).map(async category => {
		const catMap = categoryMaps.get(category);
		if (!catMap || !catMap.size) return;

		const recs = buildRecords(catMap);
		catRecs.set(category, recs);
		await writeListFiles(base, `all-${category}-ips`, recs);
		logger.success(`Category ${category}: ${recs.length} IPs written`);
	}));

	return catRecs;
};

const createGlobalLists = async (base, allMap) => {
	logger.info('Writing global lists...');

	const globalRecs = buildRecords(allMap, true);
	await writeListFiles(base, 'all-safe-ips', globalRecs);
	return globalRecs;
};

module.exports = { countRecs, writeListFiles, buildRecords, createCategoryLists, createGlobalLists };
