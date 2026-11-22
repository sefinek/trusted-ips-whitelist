process.loadEnvFile();
const { CronJob } = require('cron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createCategoryLists, createGlobalLists, countRecs } = require('./scripts/lists.js');
const processAllSources = require('./scripts/processSources.js');
const { pullLatestChanges, commitAndPushChanges } = require('./scripts/publish.js');
const { updateReadmeStats } = require('./scripts/readme.js');
const logger = require('./scripts/utils/logger.js');
const { startTimer, getDurationMs, formatDuration } = require('./scripts/utils/timing.js');
const { validateSourcesConfig } = require('./scripts/utils/validation.js');

const isDevelopment = process.env.NODE_ENV === 'development';

const loadSourcesConfig = async () => {
	const filePath = path.join(__dirname, 'sources.json');
	const raw = await fs.readFile(filePath, 'utf8');
	const parsed = JSON.parse(raw);
	return validateSourcesConfig(parsed);
};

const setupDirectories = async () => {
	const base = path.join(__dirname, 'lists');
	await fs.mkdir(base, { recursive: true });
	return base;
};

const cleanupOrphanedDirs = async (base, sources) => {
	const validDirs = new Set(sources.map(s => s.dir));
	const entries = await fs.readdir(base, { withFileTypes: true });
	const orphans = entries.filter(e => e.isDirectory() && !validDirs.has(e.name));

	await Promise.all(orphans.map(async e => {
		const dirPath = path.join(base, e.name);
		await fs.rm(dirPath, { recursive: true, force: true });
		logger.info(`Removed orphaned directory: lists/${e.name}`);
	}));
};

const generateLists = async () => {
	await pullLatestChanges();
	const sources = await loadSourcesConfig();

	const totalTimer = startTimer();
	try {
		logger.info('Starting IP list generation...');

		const base = await setupDirectories();
		await cleanupOrphanedDirs(base, sources);

		const { allMap, categoryMaps, sourceStats, degraded } = await processAllSources(base, sources);
		const [globalRecs, catRecs] = await Promise.all([
			createGlobalLists(base, allMap),
			createCategoryLists(base, categoryMaps),
		]);

		const { ips: ipCount, cidrs: cidrCount } = countRecs(globalRecs);
		logger.success(`Generation complete: ${globalRecs.length} total (${ipCount} IPs, ${cidrCount} CIDRs) in ${formatDuration(getDurationMs(totalTimer))}`);

		if (degraded.length) logger.warn(`Sources served from the previous run or missing: ${degraded.map(d => d.name).join(', ')}`);

		await updateReadmeStats(globalRecs, catRecs, sourceStats);
		if (!isDevelopment) await commitAndPushChanges();
	} catch (err) {
		logger.err(`Failed to generate lists: ${err.message}`);
		throw err;
	}
};

const addGracefulShutdown = () => {
	const gracefulShutdown = async signal => {
		logger.info(`Received ${signal}, shutting down gracefully`);
		process.exit(0);
	};

	process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
	process.on('SIGINT', () => gracefulShutdown('SIGINT'));
};

addGracefulShutdown();

if (isDevelopment) {
	generateLists()
		.then(() => {
			process.exit(0);
		})
		.catch(err => {
			logger.err(`Development run failed: ${err.message}`);
			process.exit(1);
		});
} else {
	new CronJob('0 */6 * * *', async () => {
		try {
			await generateLists();
		} catch (err) {
			logger.err(`Cron job failed: ${err.message}`);
		}
	}, null, true, 'utc');

	logger.info('Production mode: Cron job scheduled for every 6 hours');

	process.on('unhandledRejection', reason => {
		const details = reason instanceof Error ? (reason.stack || reason.message) : JSON.stringify(reason);
		logger.err(`Unhandled Rejection: ${details}`);
	});

	process.on('uncaughtException', err => {
		logger.err(`Uncaught Exception: ${err.stack || err.message}`);
		process.exit(1);
	});

	process.send?.('ready');
}

