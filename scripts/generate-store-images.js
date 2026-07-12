#!/usr/bin/env node
/**
 * Build Chrome Web Store listing graphics from demo screenshots.
 * Outputs JPEG (no alpha) at exact store sizes:
 *   assets/images/1280x800.jpg  — required screenshot
 *   assets/images/440x280.jpg   — small promo tile
 *   assets/images/1400x560.jpg  — marquee promo tile
 * Plus optional extra screenshots (up to 5 total allowed).
 *
 * Usage: node scripts/generate-store-images.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMG = path.join(ROOT, 'assets', 'images');
const ICON = path.join(ROOT, 'icons', 'icon-128.png');

function dataUrl(filePath) {
  const abs = path.resolve(filePath);
  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function src(name) {
  return dataUrl(path.join(IMG, name));
}

function iconSrc() {
  return dataUrl(ICON);
}

async function renderJpeg(browser, { width, height, html, outPath }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  // Wait for images
  await page.evaluate(async () => {
    const imgs = [...document.images];
    await Promise.all(
      imgs.map(
        (img) =>
          img.complete && img.naturalWidth > 0
            ? Promise.resolve()
            : new Promise((res) => {
                img.onload = () => res();
                img.onerror = () => res();
              })
      )
    );
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({
    path: outPath,
    type: 'jpeg',
    quality: 92,
    omitBackground: false
  });
  await page.close();
  const st = fs.statSync(outPath);
  console.log('[ok]', path.basename(outPath), `${width}x${height}`, `${Math.round(st.size / 1024)} KB`);
}

function shellCss() {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 100%;
      height: 100%;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      color: #1a2332;
      overflow: hidden;
      background: #e8eef5;
    }
    .label {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #2c5282;
      margin-bottom: 8px;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(26, 35, 50, 0.12);
      overflow: hidden;
      border: 1px solid #d5deea;
    }
    .card img { display: block; width: 100%; height: auto; }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-row img.icon {
      width: 56px;
      height: 56px;
      border-radius: 12px;
    }
    .brand-title {
      font-size: 28px;
      font-weight: 800;
      color: #152033;
      line-height: 1.1;
    }
    .brand-sub {
      font-size: 14px;
      color: #4a5a70;
      margin-top: 4px;
    }
  `;
}

function smallPromoHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${shellCss()}
    body {
      background: linear-gradient(145deg, #f4f7fb 0%, #d9e4f2 55%, #c5d4e8 100%);
      display: flex;
      align-items: stretch;
      padding: 16px 18px;
      gap: 14px;
    }
    .left {
      flex: 0 0 168px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 10px;
    }
    .left .brand-title { font-size: 22px; }
    .left .brand-sub { font-size: 12px; line-height: 1.35; }
    .left img.icon { width: 48px; height: 48px; }
    .pill {
      display: inline-block;
      align-self: flex-start;
      background: #1e3a5f;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 5px 10px;
      border-radius: 999px;
    }
    .right {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .right .card {
      width: 210px;
      max-height: 248px;
      border-radius: 10px;
    }
    .right img { width: 100%; height: auto; max-height: 248px; object-fit: cover; object-position: top; }
  </style></head><body>
    <div class="left">
      <div class="brand-row">
        <img class="icon" src="${iconSrc()}" alt="">
      </div>
      <div>
        <div class="brand-title">OpenDKP Helper</div>
        <div class="brand-sub">Auction alerts, auto-bid, RaidTick &amp; loot tools for opendkp.com</div>
      </div>
      <div class="pill">Chrome · Edge · Firefox</div>
    </div>
    <div class="right">
      <div class="card"><img src="${src('Popup.png')}" alt="Popup"></div>
    </div>
  </body></html>`;
}

function marqueeHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${shellCss()}
    body {
      background: linear-gradient(120deg, #1a2740 0%, #243656 40%, #1e334f 100%);
      color: #fff;
      padding: 28px 32px 24px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand-title { color: #fff; font-size: 32px; }
    .brand-sub { color: #c5d4e8; font-size: 15px; }
    .brand-row img.icon { width: 52px; height: 52px; }
    .panels {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 18px;
      flex: 1;
      min-height: 0;
    }
    .panel { display: flex; flex-direction: column; min-height: 0; }
    .panel .label { color: #9ec1e8; margin-bottom: 10px; font-size: 14px; }
    .panel .card {
      flex: 1;
      background: #0f1724;
      border-color: #334155;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 8px;
    }
    .panel .card img {
      width: auto;
      max-width: 100%;
      max-height: 380px;
      object-fit: contain;
      object-position: top;
      border-radius: 6px;
    }
    .caption {
      margin-top: 10px;
      font-size: 13px;
      color: #b8c7db;
      line-height: 1.3;
    }
  </style></head><body>
    <div class="top">
      <div class="brand-row">
        <img class="icon" src="${iconSrc()}" alt="">
        <div>
          <div class="brand-title">OpenDKP Helper</div>
          <div class="brand-sub">Raid night toolkit for opendkp.com — alerts, bidding, loot &amp; RaidTick</div>
        </div>
      </div>
    </div>
    <div class="panels">
      <div class="panel">
        <div class="label">Auto-bid rules</div>
        <div class="card"><img src="${src('Bidding.png')}" alt=""></div>
        <div class="caption">Per-item max DKP, characters, and rank limits</div>
      </div>
      <div class="panel">
        <div class="label">Raid night popup</div>
        <div class="card"><img src="${src('Popup.png')}" alt=""></div>
        <div class="caption">Raid select, RaidTick queue, and loot queue</div>
      </div>
      <div class="panel">
        <div class="label">Reminders &amp; alerts</div>
        <div class="card"><img src="${src('RaidTickReminderSettings.png')}" alt=""></div>
        <div class="caption">Scheduled RaidTick reminders and notification prefs</div>
      </div>
    </div>
  </body></html>`;
}

function screenshotCollageHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${shellCss()}
    body {
      background: linear-gradient(160deg, #eef3f9 0%, #dce6f2 100%);
      padding: 22px 24px 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand-title { font-size: 26px; }
    .brand-sub { font-size: 13px; }
    .grid {
      display: grid;
      grid-template-columns: 1.05fr 0.7fr 1.05fr;
      grid-template-rows: 1fr 1fr;
      gap: 12px;
      flex: 1;
      min-height: 0;
    }
    .cell { display: flex; flex-direction: column; min-height: 0; }
    .cell .label { font-size: 12px; margin-bottom: 6px; }
    .cell .card {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      background: #fff;
      padding: 6px;
    }
    .cell .card img {
      width: 100%;
      height: 100%;
      max-height: 320px;
      object-fit: contain;
      object-position: top;
    }
    .cell.popup .card img { max-height: 340px; width: auto; max-width: 100%; }
    .cell.span2 { grid-column: span 1; }
    .footer {
      font-size: 12px;
      color: #5a6b80;
      text-align: center;
    }
  </style></head><body>
    <div class="header">
      <div class="brand-row">
        <img class="icon" src="${iconSrc()}" alt="" style="width:44px;height:44px;border-radius:10px;">
        <div>
          <div class="brand-title">OpenDKP Helper</div>
          <div class="brand-sub">Demo screenshots — auction alerts, auto-bid, loot monitor, RaidTick</div>
        </div>
      </div>
    </div>
    <div class="grid">
      <div class="cell">
        <div class="label">OpenDKP Raids</div>
        <div class="card"><img src="${src('OpenDkpRaids.png')}" alt=""></div>
      </div>
      <div class="cell popup">
        <div class="label">Popup</div>
        <div class="card"><img src="${src('Popup.png')}" alt=""></div>
      </div>
      <div class="cell">
        <div class="label">Bidding</div>
        <div class="card"><img src="${src('Bidding.png')}" alt=""></div>
      </div>
      <div class="cell">
        <div class="label">Alerts &amp; watchlist</div>
        <div class="card"><img src="${src('SmartRaidLeader.png')}" alt=""></div>
      </div>
      <div class="cell">
        <div class="label">Loot monitor</div>
        <div class="card"><img src="${src('LootMonitor.png')}" alt=""></div>
      </div>
      <div class="cell">
        <div class="label">Reminders</div>
        <div class="card"><img src="${src('RaidTickReminderSettings.png')}" alt=""></div>
      </div>
    </div>
    <div class="footer">Works with Chrome, Edge, and Firefox · Settings stay on your device</div>
  </body></html>`;
}

function framedFeatureHtml(title, imageName, subtitle) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${shellCss()}
    body {
      background: linear-gradient(160deg, #eef3f9 0%, #d5e0ee 100%);
      padding: 28px 36px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .header { display: flex; align-items: center; gap: 14px; }
    .header img { width: 48px; height: 48px; border-radius: 10px; }
    .title { font-size: 28px; font-weight: 800; }
    .sub { font-size: 15px; color: #4a5a70; margin-top: 2px; }
    .stage {
      flex: 1;
      min-height: 0;
      background: #fff;
      border-radius: 14px;
      border: 1px solid #d5deea;
      box-shadow: 0 10px 30px rgba(26,35,50,0.1);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 16px;
      overflow: hidden;
    }
    .stage img {
      max-width: 100%;
      max-height: 660px;
      object-fit: contain;
      object-position: top;
    }
  </style></head><body>
    <div class="header">
      <img src="${iconSrc()}" alt="">
      <div>
        <div class="title">${title}</div>
        <div class="sub">${subtitle}</div>
      </div>
    </div>
    <div class="stage"><img src="${src(imageName)}" alt=""></div>
  </body></html>`;
}

async function main() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.error('puppeteer required');
    process.exit(1);
  }

  const needed = ['Popup.png', 'Bidding.png', 'OpenDkpRaids.png', 'RaidTickReminderSettings.png', 'SmartRaidLeader.png', 'LootMonitor.png'];
  for (const n of needed) {
    if (!fs.existsSync(path.join(IMG, n))) {
      console.error('Missing', n, '— run capture-readme-screenshots.js first');
      process.exit(1);
    }
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files']
  });

  try {
    // Required trio (JPEG = no alpha, accepted by CWS)
    await renderJpeg(browser, {
      width: 1280,
      height: 800,
      html: screenshotCollageHtml(),
      outPath: path.join(IMG, '1280x800.jpg')
    });
    await renderJpeg(browser, {
      width: 440,
      height: 280,
      html: smallPromoHtml(),
      outPath: path.join(IMG, '440x280.jpg')
    });
    await renderJpeg(browser, {
      width: 1400,
      height: 560,
      html: marqueeHtml(),
      outPath: path.join(IMG, '1400x560.jpg')
    });

    // Optional extra store screenshots (upload up to 5 total)
    await renderJpeg(browser, {
      width: 1280,
      height: 800,
      html: framedFeatureHtml('Raid night popup', 'Popup.png', 'Raid select, RaidTick queue slots, and loot Copy / Queue'),
      outPath: path.join(IMG, 'store-screenshot-popup.jpg')
    });
    await renderJpeg(browser, {
      width: 1280,
      height: 800,
      html: framedFeatureHtml('Automatic bidding', 'Bidding.png', 'Item rules with max DKP, character, and rank bid limits'),
      outPath: path.join(IMG, 'store-screenshot-bidding.jpg')
    });
    await renderJpeg(browser, {
      width: 1280,
      height: 800,
      html: framedFeatureHtml('OpenDKP Raids & loot', 'OpenDkpRaids.png', 'API sign-in, raid setup, loot queue defaults, and exceptions'),
      outPath: path.join(IMG, 'store-screenshot-raids.jpg')
    });

    // Also write PNG copies via JPEG→canvas flatten if dashboard prefers PNG filenames
    // Keep legacy PNG names as JPEG is preferred for no-alpha; note in console.
    console.log('\nUpload to Chrome Web Store:');
    console.log('  Screenshots (1–5): 1280x800.jpg (+ optional store-screenshot-*.jpg)');
    console.log('  Small promo:       440x280.jpg');
    console.log('  Marquee promo:     1400x560.jpg');
    console.log('All use demo data only (demoguild / Demochar / sample loot).');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
