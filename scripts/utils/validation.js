const { ValidationError, SecurityError } = require('./errors.js');
const { isValidIP, isPrivateIP } = require('../ipUtils.js');

const isValidUrl = url => {
	if (!url || typeof url !== 'string') return false;

	try {
		const parsed = new URL(url);
		if (!['http:', 'https:'].includes(parsed.protocol)) return false;

		const hostname = parsed.hostname.toLowerCase().replace(/^\[|]$/g, '');
		if (hostname === 'localhost') return false;
		return !(isValidIP(hostname) && isPrivateIP(hostname));
	} catch {
		return false;
	}
};

const validateUrl = url => {
	if (!isValidUrl(url)) throw new SecurityError(`Invalid URL: ${url}`);
	return url;
};

const validateSource = source => {
	if (!source || typeof source !== 'object') throw new ValidationError('Invalid source configuration', 'source');
	if (!source.name || typeof source.name !== 'string') throw new ValidationError('Source name is required', 'name');
	if (!source.type || typeof source.type !== 'string') throw new ValidationError('Source type is required', 'type');

	if (source.url) {
		if (Array.isArray(source.url)) {
			source.url.forEach(validateUrl);
		} else {
			validateUrl(source.url);
		}
	}

	return source;
};

const VALID_CATEGORIES = new Set(['crawlers', 'monitoring', 'infrastructure', 'ai']);

const validateSourcesConfig = config => {
	if (!Array.isArray(config) || !config.length) throw new ValidationError('Sources configuration must be a non-empty array', 'sources');

	return config.map((src, index) => {
		const validated = { ...validateSource(src) };
		if (!validated.dir || typeof validated.dir !== 'string') throw new ValidationError('Source dir is required', `sources[${index}].dir`);

		if (validated.category !== undefined) {
			if (!VALID_CATEGORIES.has(validated.category)) {
				throw new ValidationError(`Invalid category "${validated.category}" for source "${validated.name}". Valid: ${[...VALID_CATEGORIES].join(', ')}`, `sources[${index}].category`);
			}
		}

		if (validated.extraFiles) {
			const extra = Array.isArray(validated.extraFiles) ? validated.extraFiles : [validated.extraFiles];
			validated.extraFiles = extra.filter(f => typeof f === 'string' && f.trim());
		}

		return validated;
	});
};

module.exports = {
	isValidUrl,
	validateUrl,
	validateSource,
	validateSourcesConfig,
};
