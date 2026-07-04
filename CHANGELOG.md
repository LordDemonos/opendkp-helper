# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows the **same semver** as `manifest.json` (single version for Firefox and Chrome packages).

## [2.3.0] - 2026-07-04

### Added

- **Auto-bid** — Set per-item rules (item name, max DKP, character, rank). The extension polls active auctions through the OpenDKP API and places bids in configurable increments until you are winning, hit your max, or run out of DKP. Available in both Raider and Raid Leader modes.
- **Rank bid limits** — Reads your guild's Bid Rules from opendkp.com (for example "Maximum Bid for Raid Alt is: 400") and applies those caps in auto-bid rules and the settings UI.
- **Character roster for auto-bid** — Refresh characters from the API to pick which toon bids on each rule; rank is loaded from OpenDKP.
- **Rule auto-disable on win** — When your character wins a matching item, that rule turns off so you do not bid again on the same piece unless you re-enable it.

### Fixed

- **Release CI packages** — GitHub Actions now use `npm run package:release` instead of copying the whole repo, so release ZIPs match local store builds (no store screenshots, build scripts, or other dev files).
- **Loot queue during API outages** — Keeps your selected raid when OpenDKP verify is temporarily unavailable instead of clearing it on transient errors.
- **Raid context caching** — Short-lived cache so repeated loot queue actions do not re-verify the raid on every click.

### Changed

- **Loot monitor and popup** — Improved API session handling, queue feedback, and raid leader popup controls.
- **RaidTick queue** — More reliable parsing and upload flow from the popup.

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
