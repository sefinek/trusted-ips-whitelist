const fs = require('node:fs/promises');
const path = require('node:path');
const fetchSource = require('./fetchSource.js');
const ipUtils = require('./ipUtils.js');
const { writeListFiles, countRecs } = require('./lists.js');
const RateLimiter = require('./utils/rateLimiter.js');
const logger = require('./utils/logger.js');
const { startTimer, getDurationMs, formatDuration } = require('./utils/timing.js');

const processAllSources = async (base, sources) => {
	const allMap = new Map();
	const categoryMaps = new Map();
	const concurrency = Math.max(1, Number(process.env.SOURCE_CONCURRENCY) || 3);
	const delayMs = Math.max(0, Number(process.env.SOURCE_DELAY_MS) || 500);
	const limiter = new RateLimiter(concurrency, delayMs);

	const addToMaps = (src, ip, displayName, sourcesArray) => {
		const addToMap = map => {
			const entry = map.get(ip) || { names: new Set(), sources: new Set() };
			entry.names.add(displayName);
			sourcesArray.forEach(s => entry.sources.add(s));
			map.set(ip, entry);
		};

		addToMap(allMap);

		if (src.category) {
			if (!categoryMaps.has(src.category)) categoryMaps.set(src.category, new Map());
			addToMap(categoryMaps.get(src.category));
		}
	};

	const reusePreviousRecords = async (src, reason) => {
		try {
			const raw = await fs.readFile(path.join(base, src.dir, 'ips.json'), 'utf8');
			const previous = JSON.parse(raw);
			if (!Array.isArray(previous) || !previous.length) throw new Error('previous list is empty');

			let reused = 0;
			for (const r of previous) {
				if (!r?.ip || !Array.isArray(r.sources)) continue;
				addToMaps(src, r.ip, r.name || src.name, r.sources);
				reused++;
			}

			if (!reused) throw new Error('previous list has no valid records');
			logger.warn(`[${src.name}] ${reason}; reusing ${reused} entries from the previous run`);
			return { name: src.name, stale: true };
		} catch (err) {
			logger.err(`[${src.name}] ${reason}; no usable previous list (${err.message}), source is missing from combined lists`);
			return { name: src.name, missing: true };
		}
	};

	const handleSource = async src => {
		const sourceTimer = startTimer();
		try {
			logger.debug(`[${src.name}] Fetching...`);
			const records = await fetchSource(src);

			if (!Array.isArray(records) || !records.length) {
				return reusePreviousRecords(src, 'No records fetched');
			}

			const filteredRecords = records.filter(r => {
				if (!r?.ip) return false;
				if (ipUtils.isPrivateIP(r.ip)) {
					logger.warn(`[${src.name}] Skipping private IP ${r.ip}`);
					return false;
				}
				if (ipUtils.isTooBroadCIDR(r.ip)) {
					logger.warn(`[${src.name}] Skipping overly broad CIDR ${r.ip}`);
					return false;
				}
				return true;
			});

			if (!filteredRecords.length) {
				return reusePreviousRecords(src, 'No usable records after filtering');
			}

			const sortedRecords = ipUtils.sortByIP(filteredRecords, r => r.ip);
			const dir = path.join(base, src.dir);
			await fs.mkdir(dir, { recursive: true });

			const listRecords = sortedRecords.map(r => ({ ip: r.ip, name: r.label || src.name, sources: r.sources }));
			for (const r of listRecords) addToMaps(src, r.ip, r.name, r.sources);
			await writeListFiles(dir, 'ips', listRecords);

			logger.success(`[${src.name}] ${sortedRecords.length} IPs in ${formatDuration(getDurationMs(sourceTimer))}`);
			return { name: src.name, ...countRecs(sortedRecords) };
		} catch (err) {
			const failure = `Failed after ${formatDuration(getDurationMs(sourceTimer))}: ${err.message}`;
			return reusePreviousRecords(src, failure);
		}
	};

	const results = (await Promise.all(sources.map(src => limiter.execute(() => handleSource(src))))).filter(Boolean);
	const sourceStats = new Map(results.filter(r => !r.stale && !r.missing).map(r => [r.name, r]));
	const degraded = results.filter(r => r.stale || r.missing);
	return { allMap, categoryMaps, sourceStats, degraded };
};

module.exports = processAllSources;
