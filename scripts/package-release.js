#!/usr/bin/env node
/**
 * One-shot store-oriented packages: lint → build Firefox tree → zip → build Chrome tree → zip → SHA256SUMS.
 * Requires: Node 20+, zip (macOS/Linux) or PowerShell (Windows). Root manifest.json is restored after each build:*.
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function runNpm(script) {
  const isWin = process.platform === 'win32';
  execFileSync(isWin ? 'npm.cmd' : 'npm', ['run', script], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWin,
  });
}

function readVersion() {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  return m.version;
}

/**
 * Zip directory contents so manifest.json is at zip root (store requirement).
 */
function zipDirContents(sourceDir, destZip) {
  if (!fs.existsSync(sourceDir)) {
    console.error('Missing build output:', sourceDir);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(destZip), { recursive: true });
  if (process.platform === 'win32') {
    const src = sourceDir.replace(/'/g, "''");
    const dst = destZip.replace(/'/g, "''");
    const cmd = `Compress-Archive -Path (Join-Path '${src}' '*') -DestinationPath '${dst}' -Force`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-rq', destZip, '.'], { cwd: sourceDir, stdio: 'inherit' });
  }
}

function sha256Hex(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function main() {
  const version = readVersion();
  console.log(`\n📦 package-release (manifest version ${version})\n`);

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  runNpm('validate:manifest');
  runNpm('lint:webext');

  runNpm('build:firefox');
  const firefoxDir = path.join(ROOT, 'build', 'temp-firefox-build');
  const firefoxZip = path.join(DIST, `opendkp-helper-firefox-${version}.zip`);
  zipDirContents(firefoxDir, firefoxZip);
  console.log('✅', firefoxZip);

  runNpm('build:chrome');
  const chromeDir = path.join(ROOT, 'build', 'temp-chrome-build');
  const chromeZip = path.join(DIST, `opendkp-helper-chrome-${version}.zip`);
  zipDirContents(chromeDir, chromeZip);
  console.log('✅', chromeZip);

  const sumsPath = path.join(DIST, 'SHA256SUMS.txt');
  const lines = [firefoxZip, chromeZip].map((p) => `${sha256Hex(p)}  ${path.basename(p)}`);
  fs.writeFileSync(sumsPath, lines.join('\n') + '\n', 'utf8');
  console.log('✅', sumsPath);

  console.log('\nDone. Upload dist/*.zip to AMO and Chrome Web Store (see README → Stores).\n');
}

main();
