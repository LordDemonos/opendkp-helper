# OpenDKP Helper

A browser extension for [opendkp.com](https://opendkp.com) that watches live auctions, plays alerts when timers finish, and helps raid leaders manage loot and raids without leaving the game.

Works in **Chrome**, **Edge**, and **Firefox**.

---

## What it does

OpenDKP Helper runs in the background while you have opendkp.com open. It can:

- Alert you when an auction timer hits zero (sound, screen flash, or desktop notification).
- Speak auction results with text-to-speech (optional).
- Let **raiders** get alerts only when they win an item they bid on.
- Let **raid leaders** copy RaidTick files, monitor EverQuest loot logs, queue items to OpenDKP, and manage raids through the OpenDKP API.
- **Auto-bid** on items you care about through the OpenDKP API (raiders and raid leaders).

All settings are stored in your browser. API passwords and tokens stay on your machine.

---

## Features

### For everyone

| Feature | Description |
|--------|-------------|
| **Auction timer alerts** | Watches progress bars on opendkp.com and alerts when a timer reaches 0%. |
| **Sounds** | Built-in bell, chime, ding, and optional Warcraft-style clips. Upload up to 3 custom sounds. |
| **Text-to-speech** | Optional voice announcements for finished auctions and new items. |
| **Quiet hours** | Mute sounds during hours you choose (visual alerts can still show). |
| **Item watchlist** | List item names you want to track. Get an alert when one appears on the site. |
| **Auto-bid** | Set rules per item (name, max DKP, character, rank). The extension polls active auctions and bids for you via the OpenDKP API. Rank bid limits from your guild's Bid Rules page are applied automatically. Rules turn off when you win that item. |
| **Appearance** | Light, dark, or follow your system theme. |
| **Backup and restore** | Export and import all settings (including custom sound metadata). |

### Raider mode

Select **Raider Profile** in Settings for a simpler setup focused on personal alerts:

- **Smart bidding alerts** — Only notifies you when *your* character wins an auction you participated in.
- **Auto-bid sign-in** — Sign in to the OpenDKP API directly from the Auto-Bid section (same credentials as the website).

### Raid Leader mode

Select **Raid Leader Profile** for guild management tools:

| Feature | Description |
|--------|-------------|
| **RaidTick copy** | Copy `/outputfile raidlist` output from disk to your clipboard for OpenDKP import. |
| **RaidTick reminders** | Scheduled reminders to run `/outputfile raidlist` in game. |
| **Loot monitor** | Watch your EverQuest log file for tagged loot lines, list today's drops, and copy or queue items. |
| **OpenDKP API** | Sign in, create raids, pick the active raid, queue loot to bidding, and upload RaidTick ticks from the popup. |
| **Loot exceptions** | Skip spell lines or specific item names in the parser. |

---

## Installation

### From GitHub Releases (recommended)

Download the latest release from [GitHub Releases](https://github.com/LordDemonos/opendkp-helper/releases).

**Chrome or Edge**

1. Download `opendkp-helper-chrome-X.X.X.zip`.
2. Extract the ZIP. You should see `manifest.json` and the extension files in one folder (not inside another nested folder).
3. Open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked** and select that folder.

**Firefox**

1. Download `opendkp-helper-firefox-X.X.X.zip`.
2. Open `about:debugging` → **This Firefox**.
3. Click **Load Temporary Add-on** and choose the ZIP file.

Release ZIPs are built for each browser automatically. You do not need to edit `manifest.json`.

### From browser stores

- **Chrome Web Store** — Coming soon.
- **Firefox Add-ons (AMO)** — [addons.mozilla.org](https://addons.mozilla.org/) (when published).

---

## Quick start

1. **Install** the extension (see above).

2. **Open Settings** — Right-click the extension icon → Options, or open the popup and click Settings.

3. **Pick a profile**
   - **Raider** — Personal win alerts and auto-bid.
   - **Raid Leader** — Full toolkit including loot monitor and API tools.

4. **Set up alerts** (all users)
   - Choose a notification sound and volume.
   - Optionally enable screen flash, browser notifications, quiet hours, or text-to-speech.
   - Test sounds from the Settings page before saving.

5. **Set up auto-bid** (optional)
   - Enable **Auto-Bid** in Settings.
   - Enter your guild subdomain (the part before `.opendkp.com`) and sign in with your OpenDKP username and password.
   - Click **Refresh my characters**, then **Add item rule** for each item you want to bid on.
   - Keep an opendkp.com tab open while auto-bid is enabled.
   - Open your guild's opendkp.com page once so rank bid limits can sync from the Bid Rules panel.

6. **Raid leaders only — OpenDKP API**
   - Settings → **OpenDKP API** → enter guild subdomain → **Sign in to API**.
   - Refresh pools, create or select tonight's raid.
   - In the popup, use the session control and raid dropdown during raid night.

7. **Raid leaders only — Loot monitor**
   - Open the loot monitor from the popup.
   - Select your EverQuest log file and set your loot tag (for example `FG`).
   - Enable **Auto post** to send new loot lines to the current raid automatically.

8. **Save settings** and browse to your guild's opendkp.com page to start.

---

## Settings overview

Most options live on the Settings page (`options.html`):

- **Mode** — Raid Leader vs Raider profile.
- **Auto-Bid** — API sign-in, bid increment, poll interval, per-item rules.
- **Audio** — Sound profile, volume, custom uploads.
- **Text-to-speech** — Voice, speed, templates, read-new-auctions schedule.
- **Smart notifications** — Smart bidding (raider), quiet hours, screen flash, browser notifications.
- **Watchlist** — Item names that trigger a special alarm when posted.
- **RaidTick** — Folder selection, copy button, scheduled reminders.
- **OpenDKP API** — Guild sign-in, raids, pools, loot queue defaults, tick upload (raid leaders).
- **Backup and restore** — JSON export/import.

The extension popup gives quick access to the loot monitor, API session refresh, and raid selection during a raid night.

---

## Browser support

| Browser | Minimum version | Notes |
|---------|-----------------|-------|
| Chrome / Edge | 88+ | Manifest V3, service worker background |
| Firefox | 126+ | Manifest V3, background scripts |

Chrome and Firefox use slightly different packaging. Always install the ZIP built for your browser from the release page.

---

## Privacy and permissions

The extension requests access to:

- **opendkp.com** — Read auction timers and page content for alerts.
- **api.opendkp.com** — OpenDKP API (raids, loot queue, auto-bid) when you sign in.
- **AWS Cognito** — Login only; credentials you enter in Settings.
- **Storage, notifications, clipboard, alarms** — Save settings, show alerts, copy RaidTick/loot text, and run reminders reliably.

Auction alerts and local settings stay in your browser. API features only contact OpenDKP and AWS Cognito using credentials you provide.

---

## Building from source (developers)

Requires Node.js 20+.

```bash
git clone https://github.com/LordDemonos/opendkp-helper.git
cd opendkp-helper
npm ci
npm run build:chrome    # → build/temp-chrome-build/
npm run build:firefox   # → build/temp-firefox-build/
npm run package:release # → dist/opendkp-helper-{browser}-X.X.X.zip + SHA256SUMS.txt
```

Load `build/temp-chrome-build` or `build/temp-firefox-build` as an unpacked extension for testing. Do not load the repository root directly.

Publishing a GitHub Release (tag `vX.Y.Z` matching `manifest.json`) runs CI that builds and attaches store-ready ZIPs automatically.

---

## License

MIT License — free to use, modify, and distribute.

## Support

- [GitHub Issues](https://github.com/LordDemonos/opendkp-helper/issues) for bugs and feature requests.
- Use the test buttons in Settings to verify sounds and notifications.
- Check the browser console (F12) if something does not load after install.

This extension targets opendkp.com. If the site changes its layout, some features may need an update.
