const axios = require('axios');
const { name, version, homepage } = require('../../package.json');

const api = axios.create({
	timeout: 60000,
	headers: {
		'User-Agent': `Mozilla/5.0 (compatible; ${name}/${version}; +${homepage})`,
		'Accept': 'application/json',
		'Cache-Control': 'no-cache',
		'Connection': 'keep-alive',
	},
});

module.exports = api;
