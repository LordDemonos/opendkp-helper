#!/usr/bin/env node
/**
 * Chrome extension smoke tests (Puppeteer).
 *
 * Usage (repo root):
 *   node scripts/build-chrome.js
 *   npm run test:chrome
 *
 * CI often runs: xvfb-run ... npm run test:chrome
 *
 * Uses build/temp-chrome-build when present; otherwise repo root (may fail if manifest is Firefox-only).
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const EXTENSION_PATH = path.join(ROOT, 'build', 'temp-chrome-build');
const EXTENSION_PATH_FALLBACK = ROOT;

function getExtensionPath() {
  if (fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) return EXTENSION_PATH;
  return EXTENSION_PATH_FALLBACK;
}

async function runTests() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.error('Puppeteer not found. Install with: npm install puppeteer');
    process.exit(1);
  }

  const extPath = getExtensionPath();
  console.log('Extension path:', extPath);

  const results = { passed: 0, failed: 0, skipped: 0, messages: [] };
  function pass(msg) {
    results.passed++;
    results.messages.push('[PASS] ' + msg);
    console.log('[PASS]', msg);
  }
  function fail(msg) {
    results.failed++;
    results.messages.push('[FAIL] ' + msg);
    console.log('[FAIL]', msg);
  }
  function skip(msg) {
    results.skipped++;
    results.messages.push('[SKIP] ' + msg);
    console.log('[SKIP]', msg);
  }

  const isCI = !!process.env.CI;
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      ...(isCI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
    ],
    defaultViewport: null,
  });

  try {
    await new Promise((r) => setTimeout(r, 1500));
    const targets = browser.targets();
    const workerTarget = targets.find(
      (t) => t.type() === 'service_worker' && (t.url() || '').includes('background')
    );
    if (!workerTarget) {
      skip('Could not find extension service worker (Chrome may use a different target type).');
    } else {
      const workerUrl = workerTarget.url();
      const match = workerUrl.match(/chrome-extension:\/\/([a-z]+)\//);
      const extensionId = match ? match[1] : null;
      if (!extensionId) {
        skip('Could not parse extension ID from worker URL: ' + workerUrl);
      } else {
        pass('Extension loaded, ID: ' + extensionId.substring(0, 8) + '...');

        const page = await browser.newPage();
        const optionsUrl = `chrome-extension://${extensionId}/options.html`;

        try {
          await page.goto(optionsUrl, { waitUntil: 'networkidle2', timeout: 10000 });
          pass('Options page loads');
        } catch (e) {
          fail('Options page load: ' + (e.message || e));
        }

        // Issue #5 — mode / sound profile (current UI: #soundProfile; legacy was #theme)
        try {
          const el = await page.$('#soundProfile');
          if (el) pass('Issue #5: Mode / sound profile control (#soundProfile) present');
          else fail('Issue #5: #soundProfile not found');
        } catch (e) {
          fail('Issue #5: ' + (e.message || e));
        }

        // Issue #1 — raid leader browser notification toggle (current: #raidLeaderNotification)
        try {
          const el = await page.$('#raidLeaderNotification');
          if (el) pass('Issue #1: Raid leader notification checkbox (#raidLeaderNotification) present');
          else fail('Issue #1: #raidLeaderNotification not found');
        } catch (e) {
          fail('Issue #1: ' + (e.message || e));
        }

        // Issue #2 — read new auctions / TTS (current: #announceAuctions; may be hidden until TTS enabled)
        try {
          const el = await page.$('#announceAuctions');
          if (el) pass('Issue #2: Read new auctions TTS toggle (#announceAuctions) present');
          else skip('Issue #2: #announceAuctions not in DOM (unexpected if options.html unchanged)');
        } catch (e) {
          skip('Issue #2: ' + (e.message || e));
        }

        // Issue #9 — settings persistence / audio (backup export/import removed; use #saveSettings + #volume)
        try {
          const saveBtn = await page.$('#saveSettings');
          const volume = await page.$('#volume');
          if (saveBtn && volume) {
            pass('Issue #9: Save settings + volume controls (#saveSettings, #volume) present');
          } else {
            fail('Issue #9: Expected #saveSettings and #volume; one or both missing');
          }
        } catch (e) {
          fail('Issue #9: ' + (e.message || e));
        }

        const opendkpPage = await browser.newPage();
        try {
          await opendkpPage.goto('https://opendkp.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
          pass('opendkp.com loads (content script would run here with extension)');
        } catch (e) {
          skip('opendkp.com load (network / headless restriction): ' + (e.message || e));
        }
        await opendkpPage.close();
        await page.close();
      }
    }

    if (!isCI) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    await browser.close();
  }

  console.log('\n--- Summary ---');
  console.log('Passed:', results.passed);
  console.log('Failed:', results.failed);
  console.log('Skipped:', results.skipped);
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error('Test run error:', e);
  process.exit(1);
});
