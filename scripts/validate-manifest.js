#!/usr/bin/env node
/**
 * CI: ensure manifest.json parses and has required MV3 fields for this project.
 */
const fs = require('fs');
const path = require('path');

const MANIFEST = path.join(__dirname, '..', 'manifest.json');

function fail(msg) {
  console.error('::error::validate-manifest: ' + msg);
  process.exit(1);
}

let m;
try {
  m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (e) {
  fail('manifest.json is not valid JSON: ' + (e && e.message));
}

if (m.manifest_version !== 3) fail('manifest_version must be 3');
if (!m.version || !/^\d+\.\d+\.\d+$/.test(String(m.version))) {
  fail('version must be semver x.y.z (got ' + JSON.stringify(m.version) + ')');
}
if (!m.name || !m.description) fail('name and description are required');

const bg = m.background || {};
if (bg.service_worker && bg.scripts) {
  fail('background must not set both service_worker and scripts in source manifest');
}
if (!bg.service_worker && !(bg.scripts && bg.scripts.length)) {
  fail('background must define service_worker or scripts[]');
}

if (!m.browser_specific_settings || !m.browser_specific_settings.gecko) {
  fail('browser_specific_settings.gecko is required for Firefox packaging');
}
if (!m.browser_specific_settings.gecko.id) fail('gecko.id is required');

// AMO: gecko.data_collection_permissions (MDN browser_specific_settings). Use required: ["none"] when nothing is collected/transmitted off-extension.
const dcp = m.browser_specific_settings.gecko.data_collection_permissions;
if (!dcp || !Array.isArray(dcp.required) || dcp.required.length === 0) {
  fail('gecko.data_collection_permissions.required must be a non-empty array (typically ["none"] for local-only storage)');
}

console.log('✅ manifest.json OK (version ' + m.version + ')');
