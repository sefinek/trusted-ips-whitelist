const { hrtime } = require('node:process');

const startTimer = () => hrtime.bigint();
const getDurationMs = start => Number(hrtime.bigint() - start) / 1e6;
const formatDuration = ms => {
	if (ms >= 3600000) return `${(ms / 3600000).toFixed(2)}h`;
	if (ms >= 60000) return `${(ms / 60000).toFixed(2)}m`;
	if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
	return `${ms.toFixed(0)}ms`;
};

module.exports = { startTimer, getDurationMs, formatDuration };
