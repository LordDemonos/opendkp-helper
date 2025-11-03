#!/usr/bin/env node
/**
 * Increments the patch version (third octet) of the current version
 * Usage: node scripts/increment-version.js
 * Returns the new version via stdout
 */

const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('Error: manifest.json not found');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const currentVersion = manifest.version;

// Parse version (handles both "1.2.0" and "1.20" formats)
let [major, minor, patch] = currentVersion.split('.').map(Number);

// If patch is undefined, it means old format like "1.20"
if (isNaN(patch)) {
  // Convert "1.20" to "1.2.0"
  const tens = Math.floor(minor / 10);
  const ones = minor % 10;
  patch = ones;
  minor = tens;
}

// Increment patch version
patch++;

// Format as x.y.z
const newVersion = `${major}.${minor}.${patch}`;

// Output new version (for use in GitHub Actions)
console.log(newVersion);

