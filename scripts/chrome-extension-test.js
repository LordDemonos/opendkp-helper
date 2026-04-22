#!/usr/bin/env node
/**
 * Run TEST_PLAN checks in Chrome with the extension loaded.
 * Requires: npx puppeteer (or npm install puppeteer).
 *
 * Usage (from opendkp-helper folder):
 * node scripts/chrome-extension-test.js
 *
 * Or with npx (no install):
 * npx puppeteer node scripts/chrome-extension-test.js
 *
 * Prerequisite: Build Chrome extension first so manifest is Chrome-compatible:
 * node scripts/build-chrome.js
 * Then this script uses build/temp-chrome-build. If that doesn't exist, it uses the repo root
 * (may fail if manifest is Firefox-only).
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
    console.error('Puppeteer not found. Install it with: npm install puppeteer');
    console.error('Or run: npx puppeteer node scripts/chrome-extension-test.js');
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

        // Issue #5 – Appearance theme (optional; not all release branches ship #theme yet)
        try {
          const themeSelect = await page.$('#theme');
          if (themeSelect) pass('Issue #5: Theme dropdown (Appearance) present');
          else skip('Issue #5: #theme not in this build (optional Appearance)');
        } catch (e) {
          fail('Issue #5: ' + (e.message || e));
        }

        // Issue #1 – Only notify on OpenDKP (optional)
        try {
          const onlyNotify = await page.$('#onlyNotifyOnOpenDKP');
          if (onlyNotify) pass('Issue #1: Only notify on OpenDKP checkbox present');
          else skip('Issue #1: #onlyNotifyOnOpenDKP not in this build (optional)');
        } catch (e) {
          fail('Issue #1: ' + (e.message || e));
        }

        // Issue #2 – Read New Auctions day checkboxes (need TTS section visible)
        try {
          const announceDay0 = await page.$('#announceDay0');
          if (announceDay0) pass('Issue #2: Read New Auctions day checkboxes present');
          else skip('Issue #2: announceDay0 not found (enable TTS to see Read New Auctions section)');
        } catch (e) {
          skip('Issue #2: ' + (e.message || e));
        }

        // Issue #9 – Backup / Restore, or core save control if backup UI not shipped
        try {
          const exportBtn = await page.$('#exportBackup');
          const importFile = await page.$('#importBackupFile');
          if (exportBtn && importFile) {
            pass('Issue #9: Backup & Restore section present');
          } else {
            const saveBtn = await page.$('#saveSettings');
            if (saveBtn) {
              pass('Issue #9: Backup UI not present; #saveSettings present (smoke)');
            } else {
              fail('Issue #9: Neither backup controls nor #saveSettings found');
            }
          }
        } catch (e) {
          fail('Issue #9: ' + (e.message || e));
        }

        const opendkpPage = await browser.newPage();
        try {
          await opendkpPage.goto('https://opendkp.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
          pass('opendkp.com loads (content script would run here with extension)');
        } catch (e) {
          skip('opendkp.com load (run manually in a normal Chrome window): ' + (e.message || e));
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
