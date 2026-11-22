# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Node.js (CommonJS, requires Node >= 26) daemon that every 6 hours (cron `0 */6 * * *`, UTC) fetches IP ranges of known bots/crawlers/services from external sources, generates lists in `lists/` (TXT/CSV/JSON), updates the stats in `README.md`, runs the tests, and commits + pushes the changes to `main`. The `lists/` directory and the README stats are auto-generated artifacts - do not edit them by hand.

## Commands

- `npm test` - `node --test --test-timeout=30000 "test/**/*.test.js"`
- Single file: `node --test test/ipUtils.test.js`; single test: `node --test --test-name-pattern="name fragment" test/ipUtils.test.js`
- `npm run lint` - ESLint (`eslint.config.mjs`); CI (`.github/workflows/ci.yml`) runs lint + tests
- Running the generator: `NODE_ENV=development node index.js` - a one-off run without cron and without commit/push (it still does `git pull` and writes to `lists/` and `README.md`). With `NODE_ENV=production` it starts the cron job and waits (PM2: `ecosystem.config.js`, app `knownbots`, `wait_ready`).
- Configuration via `.env` (`process.loadEnvFile()`): `NODE_ENV`, `GITHUB_EMAIL` (commit author), optionally `SOURCE_CONCURRENCY` (default 3) and `SOURCE_DELAY_MS` (default 500).

## Architecture

Flow in `index.js` (`generateLists`): `git pull` -> load and validate `sources.json` -> remove orphaned directories in `lists/` (not present in `sources.json`) -> `processAllSources` -> global and category lists -> README update -> (outside development only) `runTests` (`npm test` as a child process) and only then commit + push of `lists/` and `README.md`.

- **Module layout**: `index.js` only orchestrates (`generateLists`) and schedules cron. `scripts/processSources.js` (fetch + per-source files + `reusePreviousRecords`), `scripts/lists.js` (`buildRecords`, global/category lists, `writeListFiles`), `scripts/readme.js` (`updateReadmeStats`), `scripts/publish.js` (git pull, tests, commit + push), `scripts/categories.js` (single category list used by validation and README), `scripts/utils/{timing,sleep,rateLimiter}.js`.
- **`sources.json`** - the single source definition file. Fields: `name`, `dir` (directory in `lists/`), `category` (crawlers/ai/monitoring/infrastructure/payments), `type`, and type-dependent fields (`url`, `asn`, `keywords`, `acceptNullable`, `file`, `extraFiles`, `path`, `browser`). Validated in `scripts/utils/validation.js` (e.g. rejects localhost/private URLs).
- **`scripts/fetchSource.js`** - dispatches on `source.type` through a `HANDLERS` table (`whois`, `yandex`, `file`, `hosts`, `textMulti`, `jsonPrefixes`, `jsonIps`, `jsonAddresses`, `jsonPath`, `htmlCidrs`, `mdList`). Each type returns records `{ ip, sources[], label? }`; at the end `extraFiles` are appended and records are merged by IP (`mergeRecordsByIp`). Requests go through `executeWithRetry` (`utils/retry.js`, retries only network errors/5xx) with a 60 s timeout. A new source type = a new entry in `HANDLERS` here, plus validation and a test where relevant.
- **Helper sources**: `services/whois.js` (WHOIS queries to RADB/ARIN, filtering by `keywords`), `services/ripestat.js` (RIPEstat), `parser/yandex.js`, `parser/browserHtml.js` + `utils/browser.js` (puppeteer-extra with stealth, for `htmlCidrs` with `browser: true`), `services/axios.js`.
- **`custom/*.txt`** - manually maintained lists for `file` / `extraFiles` sources. Format: `# Label` lines set the `label` for the following IPs, and `IP # comment` is allowed. Index in `custom/SOURCES.md`.
- **`scripts/ipUtils.js`** - validation, sorting, `isPrivateIP`, `isTooBroadCIDR`, `findCoveringCIDR` (built on ipaddr.js).
- **Resilience to source failures** (`reusePreviousRecords` in `scripts/processSources.js`): when a source returns nothing or fails, records from the previous `lists/<dir>/ips.json` are reused instead of dropping the source from the combined lists. Preserve this when making changes.
- **Aggregation** (`buildRecords` in `scripts/lists.js`): `all-safe-ips.*` and `all-<category>-ips.*` merge the sources; a single IP covered by a CIDR from the same source is skipped. Per-source files: `lists/<dir>/ips.{txt,csv,json}`.
- **README**: `updateReadmeStats` (`scripts/readme.js`) replaces counters with regexes (`All (X IPs, Y CIDRs)`, table rows matched by service name), so changing the heading/table format in the README may break it. A new source needs a manually added README row.

## Tests

`test/*.test.js` (node:test + `assert/strict`), mocks in `test/helpers/mocks.js`. `generatedFiles.test.js` validates the generated files in `lists/` against `sources.json` (TXT/CSV/JSON consistency, IP validity) - it is the pre-commit gate in production, so a faulty generator output blocks the push.
