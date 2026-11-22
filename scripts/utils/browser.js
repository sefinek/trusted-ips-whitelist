const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('./logger.js');

puppeteer.use(StealthPlugin());

const BASE_ARGS = [
	'--no-sandbox',
	'--disable-setuid-sandbox',
	'--disable-dev-shm-usage',
	'--no-first-run',
	'--no-zygote',
	'--disable-gpu',
	'--window-size=1920,1080',
];

const withPage = async (url, task, { args = [], timeoutMs = 30000 } = {}) => {
	const browser = await puppeteer.launch({ headless: 'new', timeout: 30000, args: [...BASE_ARGS, ...args] });

	try {
		const page = await browser.newPage();
		const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
		return await task(page, response);
	} finally {
		await browser.close().catch(err => logger.warn(`Failed to close browser: ${err.message}`));
	}
};

module.exports = { withPage };
