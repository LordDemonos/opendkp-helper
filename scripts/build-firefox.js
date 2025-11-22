#!/usr/bin/env node
/**
 * Build script for Firefox extension package
 * 
 * Prepares files for manual zipping by:
 * 1. Temporarily modifying manifest.json for Firefox (background.scripts, data_collection_permissions)
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
  return path.join(BUILD_DIR, `opendkp-helper-firefox-${getVersion()}.zip`);
}

// Files/directories to exclude from build
const EXCLUDE_PATTERNS = [
  // Documentation
  '**/*.md',
  '!README.md', // Keep README for reference
  'Docs/**', // Docs folder (reference documentation, not needed in builds)
  
  // Git files
  '.git/**',
  '.github/**',
  
  // Development files
  'node_modules/**',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  
  // Build scripts (keep scripts directory structure but exclude build scripts)
  'scripts/build-*.js',
  'scripts/build-*.sh',
  'scripts/**/*.sh',
  'scripts/increment-version.js',
  'scripts/update-version.js',
  
  // Firefox-specific: exclude Chrome popup.js (Firefox uses popup-firefox.js)
  'popup.js',
  
  // Test files
  'test_audio.html',
  'test_audio.js',
  
  // Generated/development files
  'generate_chime*.html',
  'generate_chime*.js',
  'generate_chime*.py',
  'create_icons.*',
  'create_simple_chime.*',
  
  // Build output
  'build/**',
  '*.zip',
  
  // OS files
  '.DS_Store',
  'Thumbs.db',
  '*.swp',
  '*.swo',
  '*~',
  
  // Editor files
  '.project',
  '.classpath',
  '.settings/**',
  '.vscode/**',
  '.idea/**',
  
  // Temporary files
  '*.tmp',
  '*.bak',
  '*.log',
  
  // Source SVG (not needed in package, PNGs are included)
  'icons/icon.svg'
];

// Files that MUST be included
// Note: popup.js is excluded for Firefox (uses popup-firefox.js instead)
const REQUIRED_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'options.html',
  'options.js',
  'popup.html',
  // 'popup.js', // Excluded for Firefox - uses popup-firefox.js instead
  'popup-firefox.js',
  'popup-loader.js',
  'reminder.html',
  'reminder.js',
  'eqlog-monitor.html',
  'eqlog-monitor.js',
  'eqlog-window.html',
  'eqlog-window.js',
  'copy-window.html',
  'copy-window.js',
  'utils/sanitize.js',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  'bell.mp3',
  'hotel.mp3',
  'ding1.mp3',
  'ding2.mp3',
  'ding3.mp3',
  'ding4.mp3',
  'jobsdone.mp3',
  'workcomplete.mp3',
  'LICENSE'
];

function getVersion() {
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    return manifest.version || '1.0.0';
  } catch (e) {
    console.error('Failed to read version from manifest.json:', e.message);
    return '1.0.0';
  }
}

function modifyManifestForFirefox() {
  console.log('📝 Modifying manifest.json for Firefox...');
  
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const original = JSON.parse(JSON.stringify(manifest)); // Deep copy
  
  // Change background from service_worker to scripts
  if (manifest.background && manifest.background.service_worker) {
    manifest.background = {
      scripts: [manifest.background.service_worker]
    };
    delete manifest.background.service_worker;
  }
  
  // Ensure browser_specific_settings exists
  if (!manifest.browser_specific_settings) {
    manifest.browser_specific_settings = {
      gecko: {
        id: 'opendkp-helper@opendkp.com',
        strict_min_version: '126.0'
      }
    };
  } else if (manifest.browser_specific_settings.gecko) {
    // Remove data_collection_permissions if it exists but is empty
    // Firefox requires at least 1 item in required array, so omit entirely if no data collection
    if (manifest.browser_specific_settings.gecko.data_collection_permissions) {
      const dcp = manifest.browser_specific_settings.gecko.data_collection_permissions;
      if (!dcp.required || (Array.isArray(dcp.required) && dcp.required.length === 0)) {
        // Remove empty data_collection_permissions (no data collection = don't declare it)
        delete manifest.browser_specific_settings.gecko.data_collection_permissions;
      }
    }
  }
  
  // Verify icons are configured (Firefox requires icons in both 'icons' and 'action.default_icon')
  if (!manifest.icons) {
    console.warn('⚠️  Warning: No top-level "icons" field found in manifest');
  } else {
    console.log('✅ Icons configured:', Object.keys(manifest.icons).join(', '));
  }
  
  if (!manifest.action || !manifest.action.default_icon) {
    console.warn('⚠️  Warning: No "action.default_icon" field found in manifest');
  } else {
    console.log('✅ Action icon configured:', Object.keys(manifest.action.default_icon).join(', '));
  }
  
  // Write modified manifest
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  
  return original;
}

function restoreManifest(original) {
  console.log('↩️  Restoring original manifest.json...');
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(original, null, 2) + '\n');
}

function createBuildDirectory() {
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }
}

function getFilesToInclude() {
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
  console.log(`📦 Creating ZIP file with ${files.length} files...`);
  
  const OUTPUT_ZIP = getOutputZipPath();
  const tempDir = path.join(BUILD_DIR, 'temp-firefox-build');
  
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
  
  // Leave temp directory for manual zipping
  // User will manually zip the folder and rename it
  console.log('\n📁 Files ready for manual zipping:');
  console.log(`   Folder: ${tempDir}`);
  console.log(`\n💡 To create ZIP file:`);
  if (process.platform === 'win32') {
    console.log(`   1. Right-click "${tempDir}"`);
    console.log(`   2. Select "Send to" → "Compressed (zipped) folder"`);
    console.log(`   3. Rename the ZIP file to: ${path.basename(OUTPUT_ZIP)}`);
    console.log(`   4. Move it to: ${BUILD_DIR}`);
  } else {
    console.log(`   1. Open terminal in: ${BUILD_DIR}`);
    console.log(`   2. Run: cd temp-firefox-build && zip -r ../${path.basename(OUTPUT_ZIP)} .`);
  }
  console.log(`\n📦 Expected ZIP name: ${path.basename(OUTPUT_ZIP)}`);
  console.log(`📦 Expected ZIP location: ${OUTPUT_ZIP}`);
  console.log(`\n✅ Build complete! Files are ready in: ${tempDir}`);
  
  return true;
}

function main() {
  console.log('🚀 Building Firefox extension package...\n');
  
  let originalManifest = null;
  
  try {
    // Create build directory
    createBuildDirectory();
    
    // Modify manifest for Firefox
    originalManifest = modifyManifestForFirefox();
    
    // Get list of files to include
    const files = getFilesToInclude();
    console.log(`\n📋 Including ${files.length} files in package\n`);
    
    // Verify icon files are included
    const iconFiles = files.filter(f => f.startsWith('icons/') && f.endsWith('.png'));
    if (iconFiles.length === 0) {
      console.warn('⚠️  WARNING: No icon PNG files found in file list!');
    } else {
      console.log(`✅ Icon files found: ${iconFiles.join(', ')}`);
    }
    
    // Prepare files for manual zipping
    createZip(files);
    
    const outputZip = getOutputZipPath();
    console.log(`\n✅ Build preparation complete!`);
    console.log(`📦 After manually zipping, your package will be: ${outputZip}`);
    console.log(`\n💡 To test: Load the ZIP file as temporary add-on in Firefox`);
    
  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  } finally {
    // Always restore manifest
    if (originalManifest) {
      restoreManifest(originalManifest);
    }
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { main, getVersion };

