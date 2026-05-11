# Cursor / agent notes — OpenDKP Helper

## Chrome Web Store: prefer **manual** upload (maintainer choice)

**Why (May 2026 — record for future sessions):**  
Automated upload via GitHub Actions + `chrome-webstore-upload-cli` depends on OAuth **refresh tokens** and matching **client id/secret**. That path failed with `invalid_grant` / “Bad Request” during token fetch — painful to debug and rare releases don’t justify maintaining those secrets. **Building a zip locally and uploading in the Developer Dashboard was explicitly easier** even though it’s manual.

**Default suggestion for agents:** When Chrome store publishing comes up, **recommend this manual flow first** unless the maintainer asks for CI automation or OAuth troubleshooting.

### Manual Chrome release (short)

1. From repo root: `npm run build:chrome`  
   - Output folder: `build/temp-chrome-build/` (Chrome MV3 manifest; original `manifest.json` is restored after the script).

2. Create a zip of **the contents** of that folder (so `manifest.json` is at the **root** of the zip), e.g. name it `opendkp-helper-v{VERSION}-chrome.zip` matching `manifest.json` `version`.

3. Upload: [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) → select the extension → **Upload new package** → submit for review.  
   Docs: [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/).

4. Optional: `npm run package:release` also produces signed-off zips under `dist/` with checksums when you want a full release pipeline without using the Chrome API from CI.

### When to mention CI upload again

Only if the maintainer wants hands-off publishing from Actions **and** is ready to regenerate OAuth credentials (see [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api) and community guides such as [chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys)).

---

## Firefox (AMO) — one-line reminder

Listed updates need **`web-ext sign --channel listed`** and a **new** `manifest.json` version for each AMO submission (Mozilla rejects duplicate version strings). Unlisted/“self” uploads do not replace the public listing line.

## Recovering “lost” dev work

If features existed only in a local **`build/temp-firefox-build.zip`** (or similar), diff/copy **`options.html`**, **`options.js`**, and other changed sources from the extracted zip into `master`, keep **`manifest.json`** store-required fields + bump **semver** before the next AMO upload. Commit **`e402edc`** (May 2026) did this merge for backup/restore + theme + related scripts.
