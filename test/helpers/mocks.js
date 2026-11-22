const path = require('node:path');

const rootDir = path.join(__dirname, '../..');

const stubModule = (relPath, exports) => {
	const id = require.resolve(path.join(rootDir, relPath));
	require.cache[id] = { id, filename: id, loaded: true, exports };
	return exports;
};

const respondWith = (fn, ...results) => {
	let call = 0;
	fn.mock.mockImplementation(async () => {
		const result = results[Math.min(call++, results.length - 1)];
		if (result instanceof Error) throw result;
		return result;
	});
};

module.exports = { stubModule, respondWith };
