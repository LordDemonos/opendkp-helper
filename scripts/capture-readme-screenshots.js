#!/usr/bin/env node
/**
 * Capture README screenshots with demo (non-private) chrome.storage data.
 *
 * Usage:
 *   node scripts/build-chrome.js
 *   node scripts/capture-readme-screenshots.js
 *
 * Writes PNGs to assets/images/
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'images');
const EXTENSION_PATH = path.join(ROOT, 'build', 'temp-chrome-build');

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function demoSync() {
  const today = todayYmd();
  return {
    soundProfile: 'raidleader',
    theme: 'light',
    darkMode: false,
    volume: 70,
    soundType: 'bell',
    raidleaderSound: 'bell',
    raiderSound: 'chime',
    enableTTS: true,
    voice: 'Microsoft Zira - English (United States)',
    voiceSpeed: 1.0,
    enableAdvancedTTS: true,
    ttsTemplate: 'Auction Finished. {winner} for {bidAmount} DKP on {itemName}',
    smartBidding: false,
    quietHours: true,
    quietStart: '22:00',
    quietEnd: '08:00',
    flashScreen: true,
    browserNotifications: true,
    announceAuctions: true,
    announceStart: '19:00',
    announceEnd: '23:59',
    announceNewAuctionsDays: [3, 4, 5],
    watchlistAlarmEnabled: true,
    watchlistItems: "Yelinak's Talisman\nEssence Emerald\nRing of the Ancients",
    autoBidEnabled: true,
    autoBidIncrement: 10,
    autoBidPollIntervalSec: 15,
    autoBidPriority: 1,
    itemPriceHistoryEnabled: true,
    autoBidRules: [
      {
        id: 'rule-demo-1',
        enabled: true,
        itemPattern: 'Ring of the Ancients',
        maxDkp: 400,
        characterId: 101,
        characterName: 'Demochar',
        rank: 'Raid Alt',
        priority: 1
      },
      {
        id: 'rule-demo-2',
        enabled: true,
        itemPattern: 'Essence Emerald',
        maxDkp: 150,
        characterId: 101,
        characterName: 'Demochar',
        rank: 'Raid Alt',
        priority: 1
      }
    ],
    opendkpClientSlug: 'demoguild',
    opendkpCognitoUsername: 'demouser',
    opendkpRaidListCount: 3,
    opendkpBiddingToolRaidLock: true,
    opendkpCurrentRaidId: 9001,
    opendkpCurrentRaidSummaryJson: JSON.stringify({
      name: 'Wednesday VT',
      ticks: [
        { id: 1, description: 'Hour #1', value: 25 },
        { id: 2, description: 'Hour #2', value: 25 },
        { id: 3, description: 'Hour #3', value: 25 }
      ]
    }),
    opendkpRaidtickUploadEnabled: true,
    opendkpRaidTickDefs: [
      { id: 't-hour1', description: 'Hour #1', value: 25 },
      { id: 't-hour2', description: 'Hour #2', value: 25 },
      { id: 't-hour3', description: 'Hour #3', value: 25 }
    ],
    opendkpTickDkpValue: 25,
    opendkpAttendance: 1,
    opendkpPreferredPoolId: '1',
    opendkpAuctionPayStrategy: 'exact',
    opendkpAuctionDuration: 2,
    eqLogTag: 'FG',
    eqLogMonitoring: false,
    eqLogAutoPost: false,
    eqLogFileMeta: { name: 'eqlog_Demouser_project1999.txt', lastModified: 0 },
    eqLogLootExceptions: ['Spell:', 'A Glowing Orb of Luclinite'],
    eqLogEvents: [
      {
        id: 'evt-demo-1',
        timestamp: `Sun Jul 12 20:15:33 2026`,
        date: today,
        items: ['Ring of the Ancients', 'Pearl of Power'],
        logLine:
          "[Sun Jul 12 20:15:33 2026] Jacinth tells the raid, 'FG Ring of the Ancients, Pearl of Power'",
        opendkpQueued: false
      },
      {
        id: 'evt-demo-2',
        timestamp: `Sun Jul 12 20:42:01 2026`,
        date: today,
        items: ["Yelinak's Talisman"],
        logLine: "[Sun Jul 12 20:42:01 2026] Bob tells the raid, 'Yelinak\\'s Talisman FG'",
        opendkpQueued: false
      }
    ],
    reminders: [
      {
        id: 'rem-1',
        enabled: true,
        start: '20:00',
        end: '23:00',
        message: 'Run /outputfile raidlist'
      },
      {
        id: 'rem-2',
        enabled: true,
        start: '21:00',
        end: '23:30',
        message: 'Upload tick to OpenDKP'
      }
    ],
    reminderPrefs: {
      remindersEnabled: true,
      flash: true,
      notifications: true,
      enabledDays: [0, 1, 2, 3, 4, 5, 6]
    },
    raidLeaderNotification: true,
    raidTickEnabled: false,
    customSounds: {}
  };
}

function demoPriceHistoryWins() {
  const rows = [
    ['07/12/2026', 'Bob', 395],
    ['07/05/2026', 'Carol', 380],
    ['06/28/2026', 'Alice', 410],
    ['06/21/2026', 'Demochar', 365],
    ['06/14/2026', 'Eve', 390],
    ['06/07/2026', 'Frank', 375],
    ['05/31/2026', 'Grace', 420],
    ['05/24/2026', 'Henry', 360],
    ['05/17/2026', 'Ivy', 385],
    ['05/10/2026', 'Jack', 370]
  ];
  return rows.map((row, i) => {
    const [date, winnerName, bidAmount] = row;
    const parts = date.split('/');
    const dateMs = Date.parse(`${parts[2]}-${parts[0]}-${parts[1]}T12:00:00Z`);
    return {
      itemName: 'Ring of the Ancients',
      itemId: 88001,
      auctionId: 8800 + i,
      date,
      dateMs: Number.isNaN(dateMs) ? Date.now() - i * 7 * 86400000 : dateMs,
      winnerName,
      bidAmount
    };
  });
}

function demoLocal() {
  const priceWins = demoPriceHistoryWins();
  const priceAmounts = priceWins.map((w) => w.bidAmount);
  const sortedAmounts = priceAmounts.slice().sort((a, b) => a - b);
  const mid = Math.floor(sortedAmounts.length / 2);
  const median =
    sortedAmounts.length % 2 === 0
      ? Math.round((sortedAmounts[mid - 1] + sortedAmounts[mid]) / 2)
      : sortedAmounts[mid];
  const windowMedian = median;

  return {
    autoBidCharactersCache: {
      fetchedAt: Date.now(),
      clientSlug: 'demoguild',
      characters: [{ id: 101, name: 'Demochar', rank: 'Raid Alt' }]
    },
    opendkpRankBidLimitsBySlug: {
      demoguild: {
        ranks: {
          'Raid Alt': { max: 400 },
          Main: { max: 1000 }
        },
        updatedAt: Date.now()
      }
    },
    opendkpPoolsCache: {
      pools: [
        { id: '1', name: 'Classic' },
        { id: '2', name: 'Alt' }
      ]
    },
    opendkpRaidtickUploadQueue: {
      '9001': {
        slots: {
          '0': {
            tickId: 1,
            tickDescription: 'Hour #1',
            names: ['Alice', 'Bob', 'Carol', 'Demochar'],
            fileName: 'RaidTick-demo-hour1.txt',
            queuedAt: new Date().toISOString()
          }
        }
      }
    },
    // Fake far-future tokens so popup shows “signed in” chrome without real secrets
    opendkpIdToken: 'demo.header.payload',
    opendkpAccessToken: 'demo.access.token',
    opendkpRefreshToken: 'demo.refresh.token',
    opendkpTokenExpiresAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
    bidParticipationSnapshot: {
      updatedAt: Date.now(),
      clientSlug: 'demoguild',
      items: [
        {
          itemName: 'Ring of the Ancients',
          source: 'auto-bid',
          auctionId: 5001,
          itemId: 88001,
          characterName: 'Demochar',
          myHighBid: 320,
          endTimestamp: new Date(Date.now() + 120000).toISOString()
        }
      ]
    },
    itemPriceHistoryCache: {
      'demoguild|ring of the ancients': {
        fetchedAt: Date.now(),
        wins: priceWins,
        stats: {
          estimate: windowMedian,
          last: priceWins[0].bidAmount,
          median,
          high: Math.max(...priceAmounts),
          count: priceWins.length
        },
        meta: { strategy: 'auctions', includeAll: true, fromCache: false, lookupName: 'Ring of the Ancients' }
      }
    }
  };
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function seedStorage(page) {
  const sync = demoSync();
  const local = demoLocal();
  await page.evaluate(
    async (syncData, localData) => {
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();
      await chrome.storage.sync.set(syncData);
      await chrome.storage.local.set(localData);
    },
    sync,
    local
  );
}

async function shotEl(page, selector, fileName, opts = {}) {
  const el = await page.$(selector);
  if (!el) {
    console.warn('[skip]', fileName, '- missing', selector);
    return false;
  }
  await el.scrollIntoViewIfNeeded();
  await wait(250);
  const outPath = path.join(OUT, fileName);
  await el.screenshot({ path: outPath, ...opts });
  console.log('[ok]', fileName);
  return true;
}

async function shotClip(page, selectors, fileName, padding = 12) {
  const box = await page.evaluate((sels, pad) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = 0;
    let maxY = 0;
    let found = false;
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      found = true;
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right);
      maxY = Math.max(maxY, r.bottom);
    }
    if (!found) return null;
    return {
      x: Math.max(0, Math.floor(minX - pad)),
      y: Math.max(0, Math.floor(minY - pad)),
      width: Math.ceil(maxX - minX + pad * 2),
      height: Math.ceil(maxY - minY + pad * 2)
    };
  }, selectors, padding);
  if (!box) {
    console.warn('[skip]', fileName, '- no boxes for', selectors.join(', '));
    return false;
  }
  await page.screenshot({ path: path.join(OUT, fileName), clip: box });
  console.log('[ok]', fileName);
  return true;
}

async function main() {
  if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    console.error('Missing Chrome build at', EXTENSION_PATH);
    console.error('Run: npm run build:chrome');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.error('Install puppeteer first: npm install');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
    defaultViewport: { width: 1100, height: 900 }
  });

  try {
    await wait(2000);
    const targets = browser.targets();
    const worker =
      targets.find((t) => t.type() === 'service_worker' && (t.url() || '').includes('chrome-extension://')) ||
      targets.find((t) => (t.url() || '').startsWith('chrome-extension://'));
    if (!worker) {
      console.error('Extension service worker not found. Targets:', targets.map((t) => t.url()));
      process.exit(1);
    }
    const match = (worker.url() || '').match(/chrome-extension:\/\/([a-z]+)\//);
    const extensionId = match && match[1];
    if (!extensionId) {
      console.error('Could not parse extension id from', worker.url());
      process.exit(1);
    }
    console.log('Extension ID:', extensionId);

    // --- Options page ---
    const options = await browser.newPage();
    await options.setViewport({ width: 1100, height: 1400 });
    await options.goto(`chrome-extension://${extensionId}/options.html`, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    await seedStorage(options);
    await options.reload({ waitUntil: 'networkidle0' });
    await wait(2000);

    // Ensure expanded sections + demo form values after seed
    await options.evaluate(() => {
      const toggle = (id, on) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (!!el.checked !== on) {
          el.checked = on;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };
      toggle('autoBidEnabled', true);
      toggle('enableTTS', true);
      toggle('enableAdvancedTTS', true);
      toggle('watchlistAlarmEnabled', true);
      toggle('quietHours', true);
      toggle('announceAuctions', true);

      const slug = document.getElementById('opendkpClientSlug');
      if (slug) slug.value = 'demoguild';
      const user = document.getElementById('opendkpCognitoUser');
      if (user) user.value = 'demouser';

      document.querySelectorAll('#autoBidRulesList select').forEach((sel) => {
        if ([...sel.options].some((o) => o.value === '101')) sel.value = '101';
      });
    });
    await wait(800);

    async function withStickyHidden(fn) {
      await options.evaluate(() => {
        const m = document.getElementById('modeGroup');
        if (m) {
          m.dataset._shotPrev = m.style.visibility || '';
          m.style.visibility = 'hidden';
        }
      });
      try {
        await fn();
      } finally {
        await options.evaluate(() => {
          const m = document.getElementById('modeGroup');
          if (m) {
            m.style.visibility = m.dataset._shotPrev || '';
            delete m.dataset._shotPrev;
          }
        });
      }
    }

    await shotEl(options, '#modeGroup', 'Mode.png');
    await withStickyHidden(async () => {
      await shotEl(options, '#autoBidGroup', 'Bidding.png');
      await shotClip(
        options,
        ['#alertsSoundsGroup h4', '#volume', '#soundType', '#customSoundManager'],
        'Audio.png',
        16
      );
      await shotClip(
        options,
        ['#enableTTS', '#ttsSettings', '#ttsSpeedSettings', '#ttsAdvancedSettings', '#ttsTemplateSettings'],
        'AdvancedTTS.png',
        16
      );
      await shotClip(
        options,
        ['#announceHeading', '#announceRow', '#announceWindow', '#announceDaysRow', '#announceDesc'],
        'ReadNewAuctions.png',
        12
      );
      await shotClip(
        options,
        [
          '#watchlistHeading',
          '#watchlistRow',
          '#watchlistItemsRow',
          '#watchlistDesc',
          '#quietHours',
          '#quietHoursSettings',
          '#flashScreen',
          '#browserNotifications'
        ],
        'SmartRaidLeader.png',
        12
      );
      await shotEl(options, '#openDkpApiGroup', 'OpenDkpRaids.png');
      await shotEl(options, '#raidTickGroup', 'RaidTickReminderSettings.png');
      await shotEl(options, '#backupGroup', 'BackupRestore.png');
    });

    // Full settings overview (tall crop of main content)
    await options.evaluate(() => window.scrollTo(0, 0));
    await wait(300);
    await options.screenshot({
      path: path.join(OUT, 'SettingsFull.png'),
      clip: { x: 0, y: 0, width: 1100, height: 1600 }
    });
    console.log('[ok] SettingsFull.png');

    // Smart raider variant: switch profile, enable smart bidding
    await options.evaluate(async () => {
      await chrome.storage.sync.set({ soundProfile: 'raider', smartBidding: true });
    });
    await options.reload({ waitUntil: 'networkidle0' });
    await wait(1000);
    await options.evaluate(() => {
      const sb = document.getElementById('smartBidding');
      if (sb && !sb.checked) {
        sb.checked = true;
        sb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await wait(400);
    await shotClip(options, ['#autoBidGroup', '#smartBiddingRow', '#smartBiddingDescription'], 'SmartRaider.png', 12);

    // Restore raid leader for remaining shots
    await options.evaluate(async () => {
      await chrome.storage.sync.set({ soundProfile: 'raidleader', smartBidding: false });
    });
    await options.close();

    // --- Popup ---
    const popup = await browser.newPage();
    await popup.setViewport({ width: 360, height: 900 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    await seedStorage(popup);
    await popup.reload({ waitUntil: 'networkidle0' });
    await wait(2000);
    await popup.evaluate(async () => {
      if (window.PopupItemPriceHistory && window.PopupItemPriceHistory.init) {
        await window.PopupItemPriceHistory.init();
      }
    });
    await wait(1200);
    await popup.screenshot({ path: path.join(OUT, 'Popup.png'), fullPage: true });
    console.log('[ok] Popup.png');
    await shotClip(popup, ['#itemPriceHistorySection'], 'PriceHistory.png', 10);
    await shotEl(popup, '#eqLogSection', 'LootParser.png');
    await shotClip(popup, ['#apiSessionRow', '#apiRaidtickQueueRow', '#apiRaidtickSlotPanel'], 'PopupRaidTick.png', 8);
    await popup.close();

    // --- Loot monitor ---
    const monitor = await browser.newPage();
    await monitor.setViewport({ width: 720, height: 800 });
    await monitor.goto(`chrome-extension://${extensionId}/eqlog-monitor.html`, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    await seedStorage(monitor);
    await monitor.reload({ waitUntil: 'networkidle0' });
    await wait(1500);
    await monitor.screenshot({ path: path.join(OUT, 'LootMonitor.png'), fullPage: true });
    console.log('[ok] LootMonitor.png');
    await monitor.close();

    // --- Reminder window ---
    const reminder = await browser.newPage();
    await reminder.setViewport({ width: 420, height: 320 });
    await reminder.goto(`chrome-extension://${extensionId}/reminder.html`, {
      waitUntil: 'networkidle0',
      timeout: 15000
    });
    await reminder.evaluate(() => {
      const msg = document.getElementById('message');
      if (msg) msg.textContent = 'Run /outputfile raidlist';
    });
    await wait(300);
    await reminder.screenshot({ path: path.join(OUT, 'RaidlistReminder.png') });
    console.log('[ok] RaidlistReminder.png');
    await reminder.close();

    console.log('\nDone. Screenshots in', OUT);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
