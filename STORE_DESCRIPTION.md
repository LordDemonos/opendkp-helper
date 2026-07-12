# Web store listing copy (v2.0.0)

Use these fields when updating the Chrome Web Store and Firefox Add-ons (AMO) listings. Plain language, no emoji.

---

## Short description (manifest / store summary, ~132 characters)

OpenDKP auction alerts, RaidTick reminders, and loot queue for raid leaders. Works in Chrome and Firefox.

---

## Full description (detailed listing)

OpenDKP Helper is a browser extension for guilds that use opendkp.com. It watches live auctions on the site, plays alerts when timers finish, and adds tools for raid leaders who run DKP nights in EverQuest.

Works in Chrome and Firefox. Most settings stay on your computer. Raid leader features that connect to your guild's OpenDKP site only send data to OpenDKP and Amazon Cognito when you sign in with your guild credentials.

### Auction timer monitoring

- Watches auction timer bars on opendkp.com, including timers that load after the page opens
- Plays a sound when a timer you have been watching reaches zero
- Avoids repeating the same alert for one auction
- Only alerts for auctions you actually saw counting down

### Sound alerts

- Two profiles: Raid Leader (stronger alert sounds) and Raider (gentler sounds)
- Built-in sounds: bell, chime (hotel bell), ding variations, and optional Warcraft-style clips
- Upload up to three custom MP3, WAV, or OGG files
- Volume slider and per-profile sound choice

### Text-to-speech

- Optional spoken announcements when auctions end
- Pick a voice and speed
- Custom message templates with placeholders for winner, bid amount, and item name
- Optional readout when a new auction appears on the page

### Smart notifications

- Raider profile: optional mode that only alerts when your character wins (reads character names from the page header)
- Quiet hours: mute sounds during times you choose; visual alerts can still show
- Screen flash for a visible cue without sound
- Desktop notifications with winner, item, and bid amount

### RaidTick tools (raid leader)

- Copy RaidTick file contents to the clipboard for pasting into OpenDKP
- Browse a RaidTick folder or pick individual files
- Parses raid list output from Zeal's `/outputfile raidlist` command

### Loot parser (raid leader)

- Point the extension at your EverQuest log file
- Finds loot lines that contain your configured tag (for example a guild tag before Link Loot)
- Shows today's loot in the popup and in a dedicated monitor window
- Copy item names to the clipboard for the bidding tool
- Filter out spell lines and specific item names you want to ignore

### OpenDKP API and loot queue (raid leader, v2.0)

Sign in once with your guild subdomain and OpenDKP login. Then you can:

- Select or create the active raid for tonight
- Queue loot from the monitor or popup straight into OpenDKP bidding (no manual copy-paste for each item)
- Turn on auto-post so new loot lines are queued automatically
- Set default pay strategy and auction duration for queued items
- Stage RaidTick files in the popup and upload ticks to the current raid (when enabled in settings)
- Refresh your session from the popup when the login expires

API sign-in stores tokens in your browser. Use backup and restore in settings to move your configuration to another machine.

### RaidTick reminders (raid leader)

- Schedule reminders to run `/outputfile raidlist` during a raid
- Daily or weekly schedules, or specific days of the week
- Remind via screen flash, desktop notification, or popup
- Copy the slash command to the clipboard from the reminder

### Other

- Full settings page for all options
- Light, dark, or system appearance theme
- Export and import a backup of settings and custom sounds
- Test sounds, notifications, and speech before you save

### Permissions in plain terms

- opendkp.com: watch auctions and interact with the page
- api.opendkp.com: raid leader loot queue and raid management (only when you use API features)
- cognito-idp.us-east-2.amazonaws.com: sign-in for the API (only when you sign in)

Auction alerts and local settings do not leave your browser unless you turn on API features and sign in.
