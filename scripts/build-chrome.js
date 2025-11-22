#!/usr/bin/env node
/**
 * Build script for Chrome extension package
 * 
 * Prepares files for manual zipping by:
 * 1. Temporarily modifying manifest.json for Chrome (background.service_worker instead of scripts)
 * 2. Copying only necessary files to temp directory
 * 3. Restoring original manifest.json
 * 
 * User must manually zip the temp directory and rename to the expected filename.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'manifest.json');
const BUILD_DIR = path.join(ROOT_DIR, 'build');

function getOutputZipPath() {
  return path.join(BUILD_DIR, `opendkp-helper-chrome-${getVersion()}.zip`);
}

// Files/directories to exclude from build
const EXCLUDE_PATTERNS = [
  // Documentation
  '**/*.md',
  'Docs/**',
  
  // Git files
  '.git/**',
  '.github/**',
  
  // Development files
  'node_modules/**',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  
  // Build scripts
  'scripts/**',
  
  // Chrome-specific: exclude Firefox popup-firefox.js (Chrome uses popup.js)
  'popup-firefox.js',
  
  // Debug/test files
  'test_audio.html',
  'test_audio.js',
  'dom-viewer.html',
  
  // Build directories
  'build/**',
  
  // Assets folder (screenshots, not needed in extension)
  'assets/**',
];

// Required files (for verification)
const REQUIRED_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'options.html',
  'options.js',
  'popup.html',
  'popup.js',
  'popup-loader.js',
  'reminder.html',
  'reminder.js',
  'eqlog-monitor.html',
  'eqlog-monitor.js',
  'eqlog-window.html',
  'eqlog-window.js',
  'copy-window.html',
  'copy-window.js',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  'utils/sanitize.js',
  'bell.mp3',
  'ding1.mp3',
  'ding2.mp3',
  'ding3.mp3',
  'ding4.mp3',
  'hotel.mp3',
  'jobsdone.mp3',
  'workcomplete.mp3',
];

function getVersion() {
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    return manifest.version || '1.0.0';
  } catch (error) {
    console.error('❌ Error reading version from manifest.json:', error.message);
    process.exit(1);
  }
}

function modifyManifestForChrome() {
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const originalManifest = JSON.stringify(manifest, null, 2);
    
    // Chrome requires background.service_worker, not background.scripts
    if (manifest.background && manifest.background.scripts) {
      delete manifest.background.scripts;
    }
    
    // Ensure service_worker is set
    if (!manifest.background) {
      manifest.background = {};
    }
    manifest.background.service_worker = 'background.js';
    
    // Write modified manifest
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    
    console.log('✅ Manifest configured for Chrome: background.service_worker = background.js');
    
    return originalManifest;
  } catch (error) {
    console.error('❌ Error modifying manifest:', error.message);
    process.exit(1);
  }
}

function restoreManifest(originalManifest) {
  try {
    fs.writeFileSync(MANIFEST_PATH, originalManifest);
    console.log('✅ Manifest restored to original state');
  } catch (error) {
    console.error('❌ Error restoring manifest:', error.message);
  }
}

function getAllFiles() {
  const files = [];
  
  // Add required files first (these are guaranteed to be included)
  REQUIRED_FILES.forEach(file => {
    const fullPath = path.join(ROOT_DIR, file);
    if (fs.existsSync(fullPath)) {
      // Normalize path separators for cross-platform compatibility
      const normalized = file.replace(/\\/g, '/');
      if (!files.includes(normalized)) {
        files.push(normalized);
      }
    } else {
      console.warn(`⚠️  Warning: Required file not found: ${file}`);
    }
  });
  
  // File extensions to include
  const extensions = ['.js', '.html', '.css', '.json', '.mp3', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
  
  // Directories to skip entirely
  const skipDirs = ['node_modules', '.git', '.github', 'build', 'assets', 'Docs'];
  
  function scanDirectory(dir, baseDir = '') {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = baseDir ? path.join(baseDir, entry.name) : entry.name;
        const normalizedPath = relativePath.replace(/\\/g, '/');
        
        // Skip excluded patterns
        if (shouldExclude(normalizedPath)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          // Skip certain directories
          if (skipDirs.includes(entry.name)) {
            continue;
          }
          // Recursively scan subdirectories
          scanDirectory(fullPath, normalizedPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          // Include files with matching extensions
          if (extensions.includes(ext)) {
            // Only add if not already in list and not excluded
            if (!files.includes(normalizedPath) && !shouldExclude(normalizedPath)) {
              files.push(normalizedPath);
            }
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Warning: Could not scan directory ${dir}:`, error.message);
    }
  }
  
  // Scan from root directory
  scanDirectory(ROOT_DIR);
  
  // Sort files for consistent output
  files.sort();
  
  console.log(`📋 Found ${files.length} files to include`);
  console.log(`   Icons: ${files.filter(f => f.startsWith('icons/')).join(', ') || 'none found!'}`);
  
  return files;
}

function shouldExclude(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  
  // Skip empty patterns and negation patterns (starting with !)
  const patterns = EXCLUDE_PATTERNS.filter(p => p && !p.startsWith('!'));
  
  // Check against exclude patterns
  for (const pattern of patterns) {
    // Convert glob pattern to regex
    // ** matches any number of directories
    // * matches any characters except /
    let regexPattern = pattern
      .replace(/\*\*/g, '__GLOB_DOUBLE_STAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__GLOB_DOUBLE_STAR__/g, '.*')
      .replace(/\./g, '\\.');
    
    // Pattern can match from start or anywhere in path
    const regex = new RegExp('^' + regexPattern + '$');
    
    if (regex.test(normalized)) {
      return true;
    }
    
    // Also check if pattern matches any part of the path (for ** patterns)
    if (pattern.includes('**')) {
      const flexibleRegex = new RegExp(regexPattern);
      if (flexibleRegex.test(normalized)) {
        return true;
      }
    }
  }
  
  return false;
}

function createZip(files) {
  console.log(`📦 Preparing files for manual ZIP with ${files.length} files...`);

  const OUTPUT_ZIP = getOutputZipPath();
  const tempDir = path.join(BUILD_DIR, 'temp-chrome-build');

  // Clean temp directory
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  // Copy files to temp directory
  console.log('📋 Copying files...');
  let copiedCount = 0;
  let skippedCount = 0;

  files.forEach(file => {
    const srcPath = path.join(ROOT_DIR, file);
    const destPath = path.join(tempDir, file);
    const destDir = path.dirname(destPath);

    try {
      // Ensure destination directory exists
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Verify source file exists
      if (!fs.existsSync(srcPath)) {
        console.warn(`⚠️  Warning: Source file not found: ${file}`);
        skippedCount++;
        return;
      }

      // Copy file
      fs.copyFileSync(srcPath, destPath);
      copiedCount++;

      // Log icon files for verification
      if (file.startsWith('icons/')) {
        console.log(`   ✓ Copied icon: ${file}`);
      }
    } catch (error) {
      console.error(`❌ Error copying ${file}:`, error.message);
      skippedCount++;
    }
  });

  console.log(`✅ Copied ${copiedCount} files${skippedCount > 0 ? `, skipped ${skippedCount}` : ''}`);

  console.log(`\n📁 Files ready for manual zipping:`);
  console.log(`   Folder: ${tempDir}`);
  console.log(`\n💡 To create ZIP file:`);
  console.log(`   1. Right-click "${path.relative(ROOT_DIR, tempDir)}"`);
  console.log(`   2. Select "Send to" → "Compressed (zipped) folder"`);
  console.log(`   3. Rename the ZIP file to: ${path.basename(OUTPUT_ZIP)}`);
  console.log(`   4. Move it to: ${path.relative(ROOT_DIR, BUILD_DIR)}\\`);
  console.log(`\n📦 Expected ZIP name: ${path.basename(OUTPUT_ZIP)}`);
  console.log(`📦 Expected ZIP location: ${OUTPUT_ZIP}`);
  console.log(`\n✅ Build complete! Files are ready in: ${tempDir}`);

  return true;
}

function main() {
  console.log('🔨 Building Chrome extension package...\n');
  
  // Ensure build directory exists
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }
  
  // Verify required files exist
  console.log('🔍 Verifying required files...');
  const missingFiles = REQUIRED_FILES.filter(file => {
    const filePath = path.join(ROOT_DIR, file);
    return !fs.existsSync(filePath);
  });
  
  if (missingFiles.length > 0) {
    console.error('❌ Missing required files:');
    missingFiles.forEach(file => console.error(`   - ${file}`));
    process.exit(1);
  }
  console.log('✅ All required files found\n');
  
  // Modify manifest for Chrome
  const originalManifest = modifyManifestForChrome();
  
  try {
    // Get all files to include
    const allFiles = getAllFiles();
    
    // Create ZIP (actually just prepare files for manual zipping)
    createZip(allFiles);
    
  } finally {
    // Always restore original manifest
    restoreManifest(originalManifest);
  }
}

main();

