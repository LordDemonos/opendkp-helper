# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows the **same semver** as `manifest.json` (single version for Firefox and Chrome packages).

## [2.0.0] - 2026-07-03

### Added

- **OpenDKP HTTP API (Raid Leader)** — Cognito sign-in, guild subdomain, list/create raids, current-raid selection in Settings and popup, token refresh, and pools cache.
- **Loot bidding queue** — Queue parsed EQ loot items to the current raid via Create Auction API (`lib/loot-queue.js`, `lib/opendkp-api.js`).
- **Popup API session** — Sign-in, current-raid picker (last 3 raids + persisted selection), RaidTick slot queue UI (`lib/popup-api-session.js`, `lib/raidtick-queue.js`).
- **Loot monitor enhancements** — Auto-post toggle, post-all / per-item queue, today's loot panel, clear-today, loot line exception rules (`eqlog-exceptions.html`), Chrome File System Access file picker with busy-file retry.
- **Settings** — Appearance theme (light/dark/system), backup & restore (settings + custom sounds), item watchlist alarm, domain exceptions for reminders, auction pay strategy & duration defaults.
- **Build** — `lib/` shared modules, `npm run package:release`, Chrome smoke test (`npm run test:chrome`).

### Fixed

- Chrome popup boot (Firefox vs Chrome script selection, settings cog, status timeout).
- Chrome loot monitor log file locking while EverQuest is running.
- Current raid cleared incorrectly on transient API errors or when raid was outside the “last 3” list; local `storage.local` mirror for raid context.
- Removed invalid `license` key from manifest (Chrome Web Store warning).

### Changed

- Major version **2.0.0** reflects API integration and shared `lib/` architecture.

## [1.3.0] - 2026-05-10

### Restored (from prior dev / `build/temp-firefox-build.zip`)

- Merged **options / popup / background / content / reminder / eqlog-monitor** sources that were only in the local Firefox package (Appearance `#theme`, `#onlyNotifyOnOpenDKP`, Read New Auctions day controls, **Backup & Restore** `#exportBackup` / `#importBackupFile`, and related `options.js` behavior). `manifest.json` keeps **AMO** fields (`data_collection_permissions`, current signing rules); version bumped because AMO cannot replace an already-published build under the same version.

## [1.2.9] - 2026-05-10

### Release

- Bump version for **AMO listed** submission: `1.2.8` was already registered on the add-on (e.g. prior self/unlisted upload). Mozilla rejects submitting the same `manifest.json` `version` again; use **1.2.9** for the next `web-ext sign --channel listed` run.

## [1.2.7] - 2026-04-12

### Added

- `gecko.data_collection_permissions` with `required: ["none"]` for AMO alignment (no off-extension data collection; see MDN `browser_specific_settings`).
- `npm run package:release` — lint, both builds, `dist/opendkp-helper-firefox-{version}.zip`, `dist/opendkp-helper-chrome-{version}.zip`, and `dist/SHA256SUMS.txt`.
- `npm run lint:webext` — Firefox manifest/source lint (addons-linter).
- Release / Stores documentation in README.

### Fixed

- Options and storage paths that referenced `chrome` without a Firefox-safe API surface (see prior commits).

[1.2.7]: https://github.com/LordDemonos/opendkp-helper/compare/v1.2.6...v1.2.7
