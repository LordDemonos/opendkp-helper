# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows the **same semver** as `manifest.json` (single version for Firefox and Chrome packages).

## [1.2.7] - 2026-04-12

### Added

- `gecko.data_collection_permissions` with `required: ["none"]` for AMO alignment (no off-extension data collection; see MDN `browser_specific_settings`).
- `npm run package:release` — lint, both builds, `dist/opendkp-helper-firefox-{version}.zip`, `dist/opendkp-helper-chrome-{version}.zip`, and `dist/SHA256SUMS.txt`.
- `npm run lint:webext` — Firefox manifest/source lint (addons-linter).
- Release / Stores documentation in README.

### Fixed

- Options and storage paths that referenced `chrome` without a Firefox-safe API surface (see prior commits).

[1.2.7]: https://github.com/LordDemonos/opendkp-helper/compare/v1.2.6...v1.2.7
