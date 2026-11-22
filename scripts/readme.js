const fs = require('node:fs/promises');
const path = require('node:path');
const CATEGORIES = require('./categories.js');
const { countRecs } = require('./lists.js');
const logger = require('./utils/logger.js');

const README_PATH = path.join(__dirname, '../README.md');

const fmtNum = n => n.toLocaleString('en-US');
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const injectStats = (text, label, stats) => text.replace(
	new RegExp(`${label} [(][^)]*[)]`),
	`${label} (${fmtNum(stats.ips)} IPs, ${fmtNum(stats.cidrs)} CIDRs)`
);


const updateReadmeStats = async (globalRecs, catRecs, sourceStats) => {
	let content = await fs.readFile(README_PATH, 'utf8');

	const categoryStats = category => countRecs(catRecs.get(category) ?? []);
	const sections = [
		['All', countRecs(globalRecs)],
		...CATEGORIES.flatMap(({ id, label }) => [[`${label} only`, categoryStats(id)], [label, categoryStats(id)]]),
	];
	for (const [label, stats] of sections) content = injectStats(content, label, stats);

	for (const [name, stats] of sourceStats) {
		const re = new RegExp(`(\\| ${escRe(name)} +\\| )([^|]*?)( *\\|)`);
		content = content.replace(re, (_, head, old, tail) => {
			const value = `${fmtNum(stats.ips)} - ${fmtNum(stats.cidrs)}`;
			return `${head}${value.padEnd(old.length + tail.length - 2)} |`;
		});
	}

	await fs.writeFile(README_PATH, content, 'utf8');
	logger.success('README.md stats updated');
};

module.exports = { updateReadmeStats };
