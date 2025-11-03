#!/usr/bin/env node
/**
 * Updates version number across all files in the project
 * Usage: node scripts/update-version.js <newVersion>
 */

const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];
if (!newVersion) {
  console.error('Usage: node scripts/update-version.js <newVersion>');
  process.exit(1);
}

// Validate version format (x.y.z)
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('Error: Version must be in format x.y.z (e.g., 1.2.0)');
  process.exit(1);
}

console.log(`Updating version to ${newVersion}...`);

// Files to update with their patterns
const filesToUpdate = [
  {
    file: 'manifest.json',
    patterns: [
      { pattern: /"version":\s*"[^"]+"/g, replacement: `"version": "${newVersion}"` }
    ]
  },
  {
    file: 'options.html',
    patterns: [
      // Match "OpenDKP Helper v" followed by any version number (1-4 parts) to handle edge cases
      // This will match v1.2.3, v1.2.3.4, v1.2, etc. and replace with the correct newVersion
      { pattern: /OpenDKP Helper v[\d.]+/g, replacement: `OpenDKP Helper v${newVersion}` }
    ]
  }
];

let updatedFiles = 0;

filesToUpdate.forEach(({ file, patterns }) => {
  const filePath = path.join(__dirname, '..', file);
  
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: ${file} not found, skipping...`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  patterns.forEach(({ pattern, replacement }) => {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      modified = true;
    }
  });

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Updated ${file}`);
    updatedFiles++;
  } else {
    console.warn(`⚠ No version pattern found in ${file}`);
  }
});

console.log(`\n✅ Version updated in ${updatedFiles} file(s)`);
console.log(`Current version: ${newVersion}`);

