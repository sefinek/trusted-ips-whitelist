const cheerio = require('cheerio');
const { withPage } = require('../utils/browser.js');
const { isCIDR, isValidIP } = require('../ipUtils.js');
const sleep = require('../utils/sleep.js');
const logger = require('../utils/logger.js');

const URL = 'https://yandex.com/ips';
const SELECTORS = [
	'.lc-features__description .lc-rich-text span',
	'.lc-rich-text span',
	'span',
];

const waitForAnySelector = async page => {
	for (const selector of SELECTORS) {
		try {
			await page.waitForSelector(selector, { timeout: 6000 });
			return;
		} catch {
			// try the next selector
		}
	}

	logger.warn('No specific selector found, waiting 2s as fallback');
	await sleep(2000);
};

const extractCidrs = html => {
	const $ = cheerio.load(html);

	for (const selector of [...SELECTORS, 'p']) {
		const found = new Set();
		$(selector).each((_, el) => {
			const text = $(el).text().trim();
			if (isCIDR(text) && isValidIP(text)) found.add(text);
		});
		if (found.size) return [...found];
	}

	return [];
};

const getYandexIPs = async () => {
	logger.debug('Starting Yandex IP extraction');

	const html = await withPage(URL, async page => {
		await waitForAnySelector(page);
		return page.content();
	}, { args: ['--blink-settings=imagesEnabled=false'] });

	if (!html || html.length < 100) throw new Error('Failed to load page content');

	const ips = extractCidrs(html);
	if (!ips.length) logger.warn('No IPs found on Yandex page, page structure may have changed');

	return ips.map(ip => ({ ip, source: URL }));
};

module.exports = getYandexIPs;
