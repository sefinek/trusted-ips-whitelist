const axios = require('axios');
const http = require('node:http');
const https = require('node:https');
const { version } = require('../../package.json');

const api = axios.create({
	timeout: 60000,
	httpAgent: new http.Agent({ maxSockets: 10 }),
	httpsAgent: new https.Agent({ maxSockets: 10 }),
	headers: {
		'User-Agent': `Mozilla/5.0 (compatible; KnownIPsWhitelist/${version}; +https://github.com/sefinek/trusted-ips-whitelist)`,
		'Accept': 'application/json',
		'Cache-Control': 'no-cache',
		'Connection': 'keep-alive',
	},
});

module.exports = api;
