const { simpleGit } = require('simple-git');
const { spawn } = require('node:child_process');
const logger = require('./utils/logger.js');

const git = simpleGit();

const runTests = () => {
	logger.info('Running tests...');

	return new Promise((resolve, reject) => {
		const child = spawn('npm test', [], {
			shell: true,
			stdio: ['inherit', 'pipe', 'pipe'],
			timeout: 300000,
		});

		let stderr = '', stdout = '';

		child.stdout.on('data', chunk => stdout += chunk);
		child.stderr.on('data', chunk => stderr += chunk);

		child.on('exit', code => {
			if (code !== 0) {
				logger.err(`Tests failed with exit code ${code}`);
				if (stdout.trim()) logger.info(stdout.trim());
				if (stderr.trim()) logger.err(stderr.trim());
				reject(new Error(`Tests failed with exit code ${code}`));
			} else {
				logger.success('Tests passed successfully');
				resolve();
			}
		});

		child.on('error', err => {
			logger.err(`Test execution error: ${err.message}`);
			reject(err);
		});
	});
};

const pullLatestChanges = async () => {
	logger.info('Pulling latest changes...');
	await git.pull('origin', 'main');
};

const commitAndPushChanges = async () => {
	const status = await git.status(['lists', 'README.md']);
	if (status.files.length > 0) {
		await runTests();

		logger.info(`Committing & pushing ${status.files.length} changed files...`);

		const now = new Date();
		const pad = n => String(n).padStart(2, '0');
		const timestamp = `${pad(now.getUTCDate())}.${pad(now.getUTCMonth() + 1)}.${now.getUTCFullYear()}, ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
		await git.add(['./lists', 'README.md']);
		await git.commit(
			`Auto-update IP lists (${status.files.length} modified files) - ${timestamp}`,
			{ '--author': `"Sefinek Actions <${process.env.GITHUB_EMAIL}>"` }
		);
		await git.push('origin', 'main');

		logger.success('Changes committed and pushed successfully');
	} else {
		logger.info('No changes detected, skipping commit');
	}
};

module.exports = { pullLatestChanges, commitAndPushChanges };
