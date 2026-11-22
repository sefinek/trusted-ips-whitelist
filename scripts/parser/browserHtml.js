const { withPage } = require('../utils/browser.js');
const { CIDR_PATTERN } = require('../ipUtils.js');

const getRenderedHtml = (url, timeoutMs = 45000) => withPage(url, async (page, response) => {
	// Anti-bot challenge (e.g. DataDome) resolves via JS, so wait until the CIDRs show up in the DOM
	try {
		await page.waitForFunction(
			pattern => new RegExp(pattern).test(globalThis.document.body?.innerText || ''),
			{ timeout: timeoutMs },
			CIDR_PATTERN
		);
	} catch {
		const status = response?.status();
		throw new Error(`No CIDRs rendered within ${timeoutMs}ms${status ? ` (HTTP ${status})` : ''}, page may be blocked by anti-bot protection`);
	}

	return page.content();
}, { timeoutMs });

module.exports = getRenderedHtml;
