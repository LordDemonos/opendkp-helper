#!/usr/bin/env node
/**
 * Build script for Firefox extension package
 * 
 * Creates a Firefox-compatible ZIP file by:
 * 1. Temporarily modifying manifest.json for Firefox (background.scripts)
 * 2. Creating ZIP with only necessary files
 * 3. Restoring original manifest.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  'scripts/increment-version.js',
  'scripts/update-version.js',
  
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
const REQUIRED_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'options.html',
  'options.js',
  'popup.html',
  'popup.js',
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
  const skipDirs = ['node_modules', '.git', '.github', 'build', 'assets'];
  
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
  
  // Try to create ZIP using available methods
  let zipCreated = false;
  
  // Method 1: Try PowerShell (Windows)
  // CRITICAL: PowerShell Compress-Archive with wildcard (*) FLATTENS directory structure!
  // We need to manually build the ZIP using .NET System.IO.Compression.ZipFile
  if (process.platform === 'win32') {
    try {
      // Verify temp directory exists
      if (!fs.existsSync(tempDir)) {
        throw new Error(`Temp directory does not exist: ${tempDir}`);
      }
      
      // Verify output directory exists, create if needed
      const outputDir = path.dirname(OUTPUT_ZIP);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(`📁 Created output directory: ${outputDir}`);
      }
      
      // Use .NET ZipFile class which properly preserves directory structure
      // PowerShell needs paths properly escaped and quoted
      // Use single quotes to handle paths with spaces, and escape single quotes by doubling them
      const tempDirEscaped = tempDir.replace(/'/g, "''");
      const outputZipEscaped = OUTPUT_ZIP.replace(/'/g, "''");
      
      // Build PowerShell script with proper error handling
      // Use absolute paths to avoid any path resolution issues
      const tempDirAbs = path.resolve(tempDir);
      const outputZipAbs = path.resolve(OUTPUT_ZIP);
      
      const psScript = `$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $tempDir = [System.IO.Path]::GetFullPath('${tempDirAbs.replace(/\\/g, '\\\\').replace(/'/g, "''")}')
  $outputZip = [System.IO.Path]::GetFullPath('${outputZipAbs.replace(/\\/g, '\\\\').replace(/'/g, "''")}')
  Write-Host "Creating ZIP from: $tempDir"
  Write-Host "Output ZIP: $outputZip"
  if (-not (Test-Path $tempDir)) {
    throw "Temp directory does not exist: $tempDir"
  }
  $outputDir = Split-Path $outputZip -Parent
  if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    Write-Host "Created output directory: $outputDir"
  }
  if (Test-Path $outputZip) {
    Remove-Item $outputZip -Force
    Write-Host "Removed existing ZIP file"
  }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $outputZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  if (Test-Path $outputZip) {
    $size = (Get-Item $outputZip).Length
    Write-Host "ZIP created successfully: $size bytes"
  } else {
    throw "ZIP file was not created at: $outputZip"
  }
} catch {
  Write-Host "ERROR: $_" -ForegroundColor Red
  Write-Host "Error details: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}`;
      
      try {
        // Write PowerShell script to temp file to avoid quoting issues
        const psScriptFile = path.join(BUILD_DIR, 'create-zip.ps1');
        fs.writeFileSync(psScriptFile, psScript, 'utf8');
        
        console.log(`   Running PowerShell script: ${psScriptFile}`);
        console.log(`   Temp dir: ${tempDir}`);
        console.log(`   Output ZIP: ${OUTPUT_ZIP}`);
        
        const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptFile}"`, { 
          stdio: 'pipe',
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });
        
        // Clean up temp script
        try {
          fs.unlinkSync(psScriptFile);
        } catch (_) {}
        
        // Log PowerShell output for debugging
        if (result && result.trim()) {
          console.log(`   PowerShell output: ${result.trim()}`);
        }
      } catch (execError) {
        // execSync throws on non-zero exit, capture stderr/stdout
        const stdout = execError.stdout || '';
        const stderr = execError.stderr || '';
        const output = stdout + stderr;
        
        if (output && output.trim()) {
          console.warn(`   PowerShell output:\n${output.trim()}`);
        } else {
          console.warn(`   PowerShell command failed with no output`);
        }
        
        // Clean up temp script if it exists
        try {
          const psScriptFile = path.join(BUILD_DIR, 'create-zip.ps1');
          if (fs.existsSync(psScriptFile)) {
            fs.unlinkSync(psScriptFile);
          }
        } catch (_) {}
        
        throw execError;
      }
      
      // Verify ZIP was actually created
      if (!fs.existsSync(OUTPUT_ZIP)) {
        throw new Error(`ZIP file was not created at: ${OUTPUT_ZIP}`);
      }
      
      const stats = fs.statSync(OUTPUT_ZIP);
      if (stats.size === 0) {
        throw new Error(`ZIP file is empty: ${OUTPUT_ZIP}`);
      }
      
      console.log(`✅ ZIP created using PowerShell (.NET ZipFile): ${OUTPUT_ZIP} (${(stats.size / 1024).toFixed(1)} KB)`);
      zipCreated = true;
    } catch (error) {
      console.warn(`⚠️  PowerShell ZIP attempt failed: ${error.message}`);
      if (error.stderr) {
        console.warn(`   PowerShell stderr: ${error.stderr}`);
      }
      // Fall through to try other methods
    }
  }
  
  // Method 2: Try native zip command (Linux/Mac)
  if (!zipCreated) {
    try {
      const zipCommand = `cd "${tempDir}" && zip -r "${OUTPUT_ZIP}" .`;
      execSync(zipCommand, { stdio: 'pipe', shell: true });
      console.log(`✅ ZIP created using zip command: ${OUTPUT_ZIP}`);
      zipCreated = true;
    } catch (error) {
      // zip command failed, try next method
    }
  }
  
  // Method 3: Try adm-zip if available
  if (!zipCreated) {
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      zip.addLocalFolder(tempDir);
      zip.writeZip(OUTPUT_ZIP);
      console.log(`✅ ZIP created using adm-zip: ${OUTPUT_ZIP}`);
      zipCreated = true;
    } catch (error) {
      // adm-zip not available
    }
  }
  
  // If all methods failed, leave temp directory and provide instructions
  if (!zipCreated) {
    console.log('\n⚠️  Could not create ZIP automatically.');
    console.log(`📁 Files copied to: ${tempDir}`);
    console.log('\n💡 Options to create ZIP:');
    console.log('   1. Install adm-zip: npm install adm-zip');
    console.log('   2. Manually zip the folder:');
    if (process.platform === 'win32') {
      console.log(`      Right-click "${tempDir}" → Send to → Compressed (zipped) folder`);
    } else {
      console.log(`      cd "${tempDir}" && zip -r "${OUTPUT_ZIP}" .`);
    }
    console.log(`\n📦 Or manually zip and rename to: ${path.basename(OUTPUT_ZIP)}`);
    return false;
  }
  
  // Clean up temp directory if ZIP was created successfully
  fs.rmSync(tempDir, { recursive: true, force: true });
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
    
    // Create ZIP
    const zipCreated = createZip(files);
    
    console.log(`\n✅ Build complete!`);
    if (zipCreated) {
      const outputZip = getOutputZipPath();
      console.log(`📦 Firefox package: ${outputZip}`);
      console.log(`\n💡 To test: Load '${outputZip}' as temporary add-on in Firefox`);
    } else {
      console.log(`\n💡 Manual ZIP required - see instructions above`);
    }
    
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

