# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows the **same semver** as `manifest.json` (single version for Firefox and Chrome packages).

## [2.0.0] - 2026-07-03

### Added

- **Connect to your guild's OpenDKP site (raid leaders)** — Sign in with your guild name and OpenDKP login. Create raids, pick tonight's active raid, and refresh your session from Settings or the popup without opening the website.
- **Send loot to bidding from the game** — Items parsed from your EQ log can be queued to the current raid on OpenDKP. Queue one at a time or post everything in one go.
- **Raid controls in the popup (raid leaders)** — Sign in, choose which raid is live tonight, and stage RaidTick files in numbered slots for upload when you're ready.
- **Better loot monitor** — Turn on auto-post for new loot lines, see today's drops in one list, clear today's list, skip spell lines and unwanted items, and on Chrome keep reading the log even while EverQuest has the file open.
- **Item watchlist alarm** — Build a list of item names you want to track. When one is posted on opendkp.com, the extension alerts you with sound, a screen flash, and a notification so you do not miss it.
- **Settings** — Light/dark/system theme, backup and restore (settings plus custom sounds), reminder domain exceptions, and default pay strategy and auction length for queued loot.
- **Build** — Shared `lib/` modules, `npm run package:release`, Chrome smoke test (`npm run test:chrome`).

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
