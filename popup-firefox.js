// Popup script for OpenDKP Helper - Firefox Compatible

// Sanitization utilities for safe HTML manipulation
function escapeHtml(text) {
  if (text === null || text === undefined) {
    return '';
  }
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function escapeHtmlAttr(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// Status Message Helper Functions (Phase 2 - Replace innerHTML safely)
// ============================================================================

/**
 * Set a simple status message with automatic restore
 * @param {HTMLElement} container - The status text container (statusText)
 * @param {HTMLElement} statusDiv - The status div (for className)
 * @param {string} message - Message text (will be set as textContent, safe)
 * @param {string} type - Status type: 'success', 'error', 'info', 'active', 'inactive'
 * @param {number} autoRestoreMs - Auto-restore after this many ms (0 = no auto-restore)
 * @param {Function} restoreCallback - Optional callback to rebuild original status (for complex restores)
 * @returns {Object} - { original, originalClass, restore } - For manual restore if needed
 */
function setStatusMessage(container, statusDiv, message, type = 'info', autoRestoreMs = 0, restoreCallback = null) {
  if (!container) return null;
  
  // Save current state - capture both textContent and innerHTML for transition period
  const originalText = container.textContent || '';
  const originalHtml = container.innerHTML || '';
  const originalClass = statusDiv ? statusDiv.className : '';
  
  // Clear and set new message
  container.textContent = '';
  container.textContent = message;
  
  if (statusDiv) {
    statusDiv.className = `status ${type}`;
  }
  
  // Auto-restore if specified
  let restoreTimeout = null;
  if (autoRestoreMs > 0) {
    restoreTimeout = setTimeout(() => {
      if (restoreCallback) {
        // Use callback to rebuild original status properly
        restoreCallback();
      } else {
        // Simple restore - just set textContent
        container.textContent = '';
        container.textContent = originalText;
        if (statusDiv) {
          statusDiv.className = originalClass;
        }
      }
    }, autoRestoreMs);
  }
  
  // Return restore function for manual control
  return {
    original: originalText,
    originalHtml: originalHtml,
    originalClass,
    restore: () => {
      if (restoreTimeout) clearTimeout(restoreTimeout);
      if (restoreCallback) {
        restoreCallback();
      } else {
        container.textContent = '';
        container.textContent = originalText;
        if (statusDiv) {
          statusDiv.className = originalClass;
        }
      }
    }
  };
}

/**
 * Set status message with structured content (icon, main text, details)
 * Uses DOM API to safely build HTML structure without innerHTML
 * @param {HTMLElement} container - The status text container
 * @param {HTMLElement} statusDiv - The status div
 * @param {Object} config - { icon, mainText, details, type, autoRestoreMs, restoreCallback }
 * @returns {Object} - { original, originalClass, restore }
 */
function setStatusMessageStructured(container, statusDiv, config) {
  if (!container) return null;
  
  const { icon = '', mainText = '', details = '', type = 'info', autoRestoreMs = 0, restoreCallback = null } = config;
  
  // Save current state (capture both textContent and innerHTML for transition period)
  const originalText = container.textContent || '';
  const originalHtml = container.innerHTML || '';
  const originalClass = statusDiv ? statusDiv.className : '';
  
  // Clear container
  container.textContent = '';
  
  // Build message structure using DOM API
  if (icon) {
    container.appendChild(document.createTextNode(icon + ' '));
  }
  
  if (mainText) {
    const mainSpan = document.createElement('span');
    mainSpan.textContent = mainText;
    container.appendChild(mainSpan);
  }
  
  if (details) {
    container.appendChild(document.createElement('br'));
    const small = document.createElement('small');
    small.textContent = details;
    container.appendChild(small);
  }
  
  if (statusDiv) {
    statusDiv.className = `status ${type}`;
  }
  
  // Auto-restore if specified
  let restoreTimeout = null;
  if (autoRestoreMs > 0) {
    restoreTimeout = setTimeout(() => {
      if (restoreCallback) {
        // Use callback to rebuild original status properly
        restoreCallback();
      } else {
        // Simple restore - just set textContent
        container.textContent = '';
        container.textContent = originalText;
        if (statusDiv) {
          statusDiv.className = originalClass;
        }
      }
    }, autoRestoreMs);
  }
  
  return {
    original: originalText,
    originalHtml: originalHtml,
    originalClass,
    restore: () => {
      if (restoreTimeout) clearTimeout(restoreTimeout);
      if (restoreCallback) {
        restoreCallback();
      } else {
        container.textContent = '';
        container.textContent = originalText;
        if (statusDiv) {
          statusDiv.className = originalClass;
        }
      }
    }
  };
}

/**
 * Build status text with domain, profile, sound, volume, and extras
 * Uses DOM API to safely create structured HTML
 * @param {HTMLElement} container - The status text container
 * @param {Object} config - { icon, domain, profile, soundType, volume, extras }
 */
function buildStatusTextStructured(container, config) {
  if (!container) return;
  
  const { icon = '✅', domain = '', profile = '', soundType = '', volume = '', extras = [] } = config;
  
  container.textContent = ''; // Clear
  
  // Icon and domain
  container.appendChild(document.createTextNode(icon + ' '));
  if (domain) {
    const domainSpan = document.createElement('span');
    domainSpan.textContent = domain;
    container.appendChild(domainSpan);
  }
  
  // Line break
  container.appendChild(document.createElement('br'));
  
  // Details in small tag
  const small = document.createElement('small');
  const details = [];
  if (profile) details.push(`Profile: ${profile}`);
  if (soundType) details.push(`Sound: ${soundType}`);
  if (volume) details.push(`Volume: ${volume}%`);
  small.textContent = details.join(' | ');
  container.appendChild(small);
  
  // Extras (if any)
  if (extras.length > 0) {
    container.appendChild(document.createElement('br'));
    const extrasSmall = document.createElement('small');
    extrasSmall.textContent = extras.join(' • ');
    container.appendChild(extrasSmall);
  }
}

/**
 * Set empty state message safely
 * @param {HTMLElement} container - Container element
 * @param {string} message - Empty state message
 */
function setEmptyState(container, message) {
  if (!container) return;
  
  container.textContent = ''; // Clear
  
  const emptyDiv = document.createElement('div');
  emptyDiv.className = 'empty-state';
  emptyDiv.textContent = message;
  
  container.appendChild(emptyDiv);
}

// Customizable popup text - modify this before production
const POPUP_QUICK_ACTIONS_TEXT = `Quick Actions:
• Click "Open Settings" to configure RaidTick integration
• Use date navigation to browse RaidTick files
• Click "Copy" to copy file contents to clipboard`;

// Initialize function - can be called on DOMContentLoaded or directly if DOM already loaded
function initializePopup() {
  console.log('Firefox-compatible popup initializing...');
  
  // Initialize popup
  
  const statusDiv = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  // Inline volume controls
  const volumeSlider = document.getElementById('volumeSlider');
  const volumePct = document.getElementById('volumePct');
  const volumeIcon = document.getElementById('volumeIcon');
  const openOptionsBtn = document.getElementById('openOptions');
  const darkModeToggle = document.getElementById('darkModeToggle');
  const darkModeIcon = document.getElementById('darkModeIcon');
  const modeToggle = document.getElementById('modeToggle');
  const modeIcon = document.getElementById('modeIcon');
  const openLootMonitorBtn = document.getElementById('openLootMonitorBtn');
  const copyFromFileBtn = document.getElementById('copyFromFileBtn');
  const raidTickSection = document.getElementById('raidTickSection');
  const currentDateSpan = document.getElementById('currentDate');
  const prevDateBtn = document.getElementById('prevDate');
  const nextDateBtn = document.getElementById('nextDate');
  const raidTickFilesDiv = document.getElementById('raidTickFiles');
  const raidTickRescanBtn = document.getElementById('raidTickRescan');
  const raidTickFolderInput = document.getElementById('raidTickFolderInput');
  const isFirefox = (typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox'));
  
  let currentSelectedDate = new Date();
  let raidTickFiles = [];
  let availableDates = [];
  // Prevent status auto-refresh from overwriting transient success messages
  let statusLockUntil = 0;
  
  function isTimeWindowActive(startStr, endStr) {
    if (!startStr || !endStr) return false;
    const now = new Date();
    const cur = now.getHours() * 100 + now.getMinutes();
    const start = parseInt(String(startStr).replace(':',''));
    const end = parseInt(String(endStr).replace(':',''));
    if (isNaN(start) || isNaN(end)) return false;
    if (start > end) return cur >= start || cur <= end; // overnight
    return cur >= start && cur <= end;
  }
  
  // Load current settings and update UI - Firefox only
  if (typeof browser !== 'undefined') {
    console.log('Using Firefox browser API');
    browser.storage.sync.get([
      'soundProfile',
      'soundType',
      'volume',
      'voice','voiceSpeed',
      'enableTTS',
      'smartBidding',
      'quietHours',
      'quietStart','quietEnd',
      'announceAuctions','announceStart','announceEnd',
      'browserNotifications',
      'flashScreen',
      'raidTickEnabled',
      'raidTickFolder',
      'raidTickFolderHandle',
      'raidTickFiles',
      'raidTickFileList',
      'darkMode',
      'eqLogEnabled',
      'eqLogFile',
      'eqLogFileHandle',
      'eqLogTag',
      'eqLogLastPosition',
      'eqLogEvents',
      'eqLogMonitoring'
    ]).then(function(settings) {
      // Apply dark mode if enabled
      if (settings.darkMode) {
        document.body.classList.add('dark-mode');
        darkModeIcon.textContent = '🌙';
      }
      
      // Set mode icon based on current sound profile
      if (settings.soundProfile === 'raidleader') {
        modeIcon.textContent = '👑';
      } else {
        modeIcon.textContent = '⚔️';
      }
      
      processSettings(settings);

      // Initialize inline volume UI
      const vol = typeof settings.volume === 'number' ? settings.volume : 70;
      try {
        if (volumeSlider) volumeSlider.value = vol;
        if (volumePct) volumePct.textContent = `${vol}%`;
        if (volumeIcon) {
          volumeIcon.classList.remove('vol-dirty','vol-saved');
        }
      } catch(_) {}
    }).catch(function(error) {
      console.error('Firefox storage error:', error);
      showErrorState();
    });
  } else {
    console.error('Browser API not available');
    showErrorState();
  }
  
  function processSettings(settings) {
    // Update status based on settings
    const profile = settings.soundProfile || 'raidleader';
    const soundType = settings.soundType || 'bell';
    const volume = typeof settings.volume === 'number' ? settings.volume : 70;
    
    // Check if we're on an OpenDKP page
    browser.tabs.query({active: true, currentWindow: true}).then(function(tabs) {
      const currentTab = tabs[0];
      const isOpenDKP = currentTab.url.includes('opendkp.com');
      
      const allowStatusUpdate = Date.now() >= statusLockUntil;
      const extras = [];
      if (settings.enableTTS) {
        const v = String(settings.voice || 'Default');
        let short = v;
        if (/zira/i.test(v)) short = 'Zira';
        else if (/david/i.test(v)) short = 'David';
        else if (/mark/i.test(v)) short = 'Mark';
        else short = (v.split(' ').find(Boolean)) || 'Default';
        extras.push(`TTS: ${escapeHtml(short)}`);
      }
      if (settings.announceAuctions) {
        const active = isTimeWindowActive(settings.announceStart, settings.announceEnd);
        extras.push(`Read Auctions: ${active ? 'active' : 'scheduled'}`);
      }
      if (settings.quietHours && isTimeWindowActive(settings.quietStart, settings.quietEnd)) {
        extras.push('Quiet Hours: active');
      }
      if (settings.eqLogTag) {
        extras.push(`Loot Tag: ${escapeHtml(settings.eqLogTag)}`);
      }
      if (allowStatusUpdate) {
        if (isOpenDKP) {
          const url = new URL(currentTab.url);
          const domain = url.hostname;
          statusDiv.className = 'status active';
          buildStatusTextStructured(statusText, {
            icon: '✅',
            domain: domain,
            profile: profile,
            soundType: soundType,
            volume: String(volume),
            extras: extras
          });
        } else {
          statusDiv.className = 'status inactive';
          buildStatusTextStructured(statusText, {
            icon: '⚠️',
            domain: 'Not on OpenDKP page',
            profile: profile,
            soundType: soundType,
            volume: String(volume),
            extras: extras
          });
        }
      }
    }).catch(function(error) {
      console.error('Tabs API error:', error);
      // Fallback status
      setStatusMessage(statusText, statusDiv, '⚠️ Extension Error', 'inactive');
    });
    
    // Firefox: hide RaidTick list section permanently
    if (isFirefox) {
      if (raidTickSection) raidTickSection.style.display = 'none';
      const infoDiv = document.getElementById('quickInfo');
      if (infoDiv) infoDiv.style.display = 'none';
    } else {
      // Chrome: keep existing RaidTick listing
      if (settings.raidTickEnabled && settings.raidTickFolder) {
        console.log('Showing RaidTick section');
        raidTickSection.style.display = 'block';
        loadRaidTickFiles();
      } else {
        console.log('Hiding RaidTick section');
        raidTickSection.style.display = 'none';
      }
    }
    
    // Show/hide EQ Log section based on profile (auto-enabled for Raid Leader)
    // Section is shown if profile is raidleader AND file is configured
    const isRaidLeader = settings.soundProfile === 'raidleader';
    // Hide header action buttons in Raider mode
    try {
      if (copyFromFileBtn) copyFromFileBtn.style.display = isRaidLeader && isFirefox ? 'inline-flex' : 'none';
      if (openLootMonitorBtn) openLootMonitorBtn.style.display = isRaidLeader && isFirefox ? 'inline-flex' : 'none';
    } catch(_) {}

    if (isRaidLeader) {
      // Initialize parser for Raid Leaders - section will show when events exist
      console.log('Initializing EQ Log parser (Raid Leader profile)');
      const eqSection = document.getElementById('eqLogSection');
      if (eqSection) {
        // Start hidden - will be shown by displayEQLogEvents() if events exist
        eqSection.style.display = 'none';
        eqSection.setAttribute('data-raid-leader', 'true');
        // Shrink body height when section is hidden
        document.body.style.height = 'auto';
      }
      initializeEQLogParser(settings);
    } else {
      console.log('Hiding EQ Log section (not Raid Leader)');
      const eqSection = document.getElementById('eqLogSection');
      if (eqSection) {
        eqSection.style.display = 'none';
        // Shrink body height when section is hidden in Raider mode
        document.body.style.height = 'auto';
      }
    }
    
    // Update quick actions (Chrome only)
    const infoDiv = document.getElementById('quickInfo');
    if (infoDiv && !isFirefox) {
      // Use DOM API instead of innerHTML
      infoDiv.textContent = '';
      const lines = POPUP_QUICK_ACTIONS_TEXT.split('\n');
      lines.forEach((line, index) => {
        if (index > 0) {
          infoDiv.appendChild(document.createElement('br'));
        }
        infoDiv.appendChild(document.createTextNode(line));
      });
    }
  }
  
  function showErrorState() {
    const currentDateSpan = document.getElementById('currentDate');
    if (currentDateSpan) {
      currentDateSpan.textContent = 'Error';
      currentDateSpan.style.color = 'red';
    }
    const raidTickFilesDiv = document.getElementById('raidTickFiles');
    if (raidTickFilesDiv) {
      setEmptyState(raidTickFilesDiv, 'Extension Error');
    }
  }
  
  // Open options page
  openOptionsBtn.addEventListener('click', function() {
    browser.runtime.openOptionsPage();
  });
  
  // Dark mode toggle functionality
  darkModeToggle.addEventListener('click', function() {
    const isDarkMode = document.body.classList.contains('dark-mode');
    
    if (isDarkMode) {
      // Switch to light mode
      document.body.classList.remove('dark-mode');
      darkModeIcon.textContent = '☀️';
      browser.storage.sync.set({ darkMode: false });
      try { browser.runtime.sendMessage({ type: 'darkModeChanged', value: false }); } catch(_) {}
    } else {
      // Switch to dark mode
      document.body.classList.add('dark-mode');
      darkModeIcon.textContent = '🌙';
      browser.storage.sync.set({ darkMode: true });
      try { browser.runtime.sendMessage({ type: 'darkModeChanged', value: true }); } catch(_) {}
    }
  });
  
  // Mode toggle functionality (Raid Leader/Raider)
  modeToggle.addEventListener('click', function() {
    const currentMode = modeIcon.textContent === '👑' ? 'raidleader' : 'raider';
    const newMode = currentMode === 'raidleader' ? 'raider' : 'raidleader';
    
    // Update icon
    modeIcon.textContent = newMode === 'raidleader' ? '👑' : '⚔️';
    
    // Update sound profile in storage
    browser.storage.sync.set({ soundProfile: newMode });
    
    // Update status display
    updateStatusDisplay(newMode);
  });

  // Monitor toggle -> open/close monitor window on Firefox
  const monitorCheckbox = document.getElementById('eqLogMonitoringToggle');
  if (monitorCheckbox && isFirefox) {
    monitorCheckbox.addEventListener('change', async function() {
      if (this.checked) {
        // Open monitor window
        const win = await browser.windows.create({
          url: browser.runtime.getURL('eqlog-monitor.html'),
          type: 'popup', width: 520, height: 360
        });
        await browser.storage.sync.set({ eqLogMonitoring: true, eqLogMonitorWindowId: win.id });
      } else {
        const data = await browser.storage.sync.get(['eqLogMonitorWindowId']);
        if (data.eqLogMonitorWindowId) {
          try { await browser.windows.remove(data.eqLogMonitorWindowId); } catch(e) {}
        }
        await browser.storage.sync.set({ eqLogMonitoring: false, eqLogMonitorWindowId: null });
      }
    });
  }

  // Firefox-only: open tiny copy window for direct file-to-clipboard flow
  if (typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox')) {
    if (copyFromFileBtn) {
      copyFromFileBtn.style.display = 'inline-flex';
      copyFromFileBtn.addEventListener('click', function() {
        browser.windows.create({
          url: browser.runtime.getURL('copy-window.html'),
          type: 'popup',
          width: 420,
          height: 220
        });
      });
    }
    if (openLootMonitorBtn) {
      openLootMonitorBtn.style.display = 'inline-flex';
      openLootMonitorBtn.addEventListener('click', async function(){
        const win = await browser.windows.create({ url: browser.runtime.getURL('eqlog-monitor.html'), type: 'popup', width: 520, height: 360 });
        await browser.storage.sync.set({ eqLogMonitoring: true, eqLogMonitorWindowId: win.id });
      });
    }
  } else {
    // Hide the button on non-Firefox browsers
    if (copyFromFileBtn) copyFromFileBtn.style.display = 'none';
    if (openLootMonitorBtn) openLootMonitorBtn.style.display = 'none';
  }
  
  function updateStatusDisplay(mode) {
    try {
      browser.storage.sync.get([
        'soundProfile','soundType','volume','enableTTS','voice','voiceSpeed','announceAuctions','announceStart','announceEnd','quietHours','quietStart','quietEnd','eqLogTag'
      ]).then((settings) => {
        settings.soundProfile = mode;
        processSettings(settings);
      });
    } catch(_) {}
  }

  // Inline volume behavior (Firefox popup)
  if (volumeSlider && volumeIcon && volumePct) {
    let unsaved = false;
    let lastSaved = null;

    // Load current saved value for comparison
    try {
      browser.storage.sync.get(['volume']).then((s) => {
        lastSaved = (typeof s.volume === 'number') ? s.volume : 70;
      });
    } catch(_) {}

    volumeSlider.addEventListener('input', () => {
      const v = parseInt(volumeSlider.value, 10) || 0;
      volumePct.textContent = `${v}%`;
      unsaved = true;
      volumeIcon.classList.add('vol-dirty');
      volumeIcon.classList.remove('vol-saved');
    });

    volumeIcon.addEventListener('click', () => {
      if (!unsaved) return;
      const v = parseInt(volumeSlider.value, 10) || 0;
      // Immediate user feedback (do not wait for storage promise)
      if (statusDiv && statusText) {
        // Save original state for restore
        const originalText = statusText.textContent || '';
        const wasActive = statusDiv.className;
        setStatusMessage(statusText, statusDiv, '✅ Volume setting saved', 'success', 1500, () => {
          // Restore callback - rebuild original status
          statusText.textContent = '';
          statusText.textContent = originalText;
          statusDiv.className = wasActive;
        });
        statusLockUntil = Date.now() + 1600;
      }
      // Persist setting
      try {
        browser.storage.sync.set({ volume: v }).then(() => {
          lastSaved = v; unsaved = false;
          volumeIcon.classList.remove('vol-dirty');
          volumeIcon.classList.add('vol-saved');
          setTimeout(() => volumeIcon.classList.remove('vol-saved'), 1200);
        }).catch(() => {
          // If save fails, indicate error briefly
          if (statusDiv && statusText) {
            statusDiv.className = 'status error';
            statusText.textContent = '❌ Failed to save volume';
          }
        });
      } catch (e) {
        if (statusDiv && statusText) {
          statusDiv.className = 'status error';
          statusText.textContent = '❌ Failed to save volume';
        }
      }
      // After the success message fades, refresh the status with the NEW volume
      const delay = Math.max(1700, (statusLockUntil - Date.now()) + 30);
      setTimeout(() => {
        try {
          browser.storage.sync.get([
            'soundProfile','soundType','enableTTS','voice','announceAuctions','announceStart','announceEnd','quietHours','quietStart','quietEnd','eqLogTag'
          ]).then((s) => {
            // Use the freshly saved volume value for immediate reflection
            s.volume = v;
            processSettings(s);
          });
        } catch(_) {}
      }, delay);
    });
  }
  
  // Listen for storage changes to refresh popup
  browser.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'sync') {
      console.log('Storage changed, refreshing popup...');
      // Check if RaidTick settings changed
      if (changes.raidTickEnabled || changes.raidTickFolder || changes.raidTickFileList) {
        console.log('RaidTick settings changed, reloading popup data...');
        // Reload the popup to pick up new settings
        setTimeout(() => {
          location.reload();
        }, 500);
      }
      // Refresh loot events immediately when updated by helper window
      if (changes.eqLogEvents) {
        console.log('[EQ Log Storage] eqLogEvents updated, refreshing list', changes.eqLogEvents.newValue?.length || 0, 'events');
        // Reload events from storage before displaying
        if (eqLogSettings && typeof eqLogSettings === 'object') {
          eqLogSettings.events = changes.eqLogEvents.newValue || [];
          console.log('[EQ Log Storage] Updated eqLogSettings.events, now has', eqLogSettings.events.length, 'events');
          // Always call displayEQLogEvents to update UI (it will hide section if not monitoring and no events)
          if (typeof displayEQLogEvents === 'function') {
            displayEQLogEvents();
          } else {
            console.warn('[EQ Log Storage] displayEQLogEvents not available yet, will be called on next popup open');
          }
        } else {
          console.warn('[EQ Log Storage] eqLogSettings not initialized yet, cannot update events. Will be loaded on next popup open.');
        }
      }
      // Update monitoring status when monitor window is opened/closed
      if (changes.eqLogMonitoring) {
        console.log('[EQ Log Storage] Monitoring status changed:', changes.eqLogMonitoring.newValue);
        if (eqLogSettings && typeof eqLogSettings === 'object') {
          eqLogSettings.monitoring = changes.eqLogMonitoring.newValue || false;
          // Refresh display to show/hide section based on monitoring status
          if (typeof displayEQLogEvents === 'function') {
            displayEQLogEvents();
          }
        }
      }

      // Reflect general settings (profile, sound, volume) without reopening popup
      const needsRefresh = (
        changes.soundProfile || changes.soundType || changes.volume ||
        changes.enableTTS || changes.voice || changes.voiceSpeed ||
        changes.announceAuctions || changes.announceStart || changes.announceEnd ||
        changes.quietHours || changes.quietStart || changes.quietEnd ||
        changes.browserNotifications || changes.flashScreen || changes.eqLogTag
      );
      if (needsRefresh) {
        try {
          browser.storage.sync.get([
            'soundProfile','soundType','volume','enableTTS','smartBidding','quietHours','browserNotifications','flashScreen','darkMode','voice','voiceSpeed','announceAuctions','announceStart','announceEnd','quietStart','quietEnd','eqLogTag'
          ]).then((settings) => {
            processSettings(settings);
          });
        } catch (e) { console.warn('Popup refresh failed:', e); }
      }
    }
  });
  
  // RaidTick functionality
  if (raidTickRescanBtn && raidTickFolderInput) {
    raidTickRescanBtn.addEventListener('click', function() {
      // Open file picker – in Chrome can select directory, in Firefox select multiple files
      raidTickFolderInput.value = '';
      raidTickFolderInput.click();
    });
    raidTickFolderInput.addEventListener('change', async function(e) {
      const files = Array.from(e.target.files || []);
      await rescanRaidTickFromFiles(files);
    });
  }
  if (prevDateBtn) {
    prevDateBtn.addEventListener('click', function() {
      navigateToPrevDate();
    });
  }
  
  if (nextDateBtn) {
    nextDateBtn.addEventListener('click', function() {
      navigateToNextDate();
    });
  }
  
  /**
   * Load RaidTick files for the current selected date
   */
  async function loadRaidTickFiles() {
    try {
      browser.storage.sync.get(['raidTickFileList', 'raidTickFolder']).then(function(result) {
        const dbg = document.getElementById('raidTickDebugLog');
        const log = (msg) => {
          if (!dbg) return;
          dbg.style.display = 'block';
          const div = document.createElement('div');
          div.textContent = msg;
          dbg.appendChild(div);
          // keep last 20
          while (dbg.children.length > 20) dbg.removeChild(dbg.firstChild);
          dbg.scrollTop = dbg.scrollHeight;
        };
        
        if (!result.raidTickFileList || result.raidTickFileList.length === 0) {
          console.log('[RaidTick] No files found in storage');
          log('No files found in storage');
          showEmptyState();
          return;
        }
        
        console.log('[RaidTick] Loaded from storage:', result.raidTickFileList.length, 'files');
        log(`Loaded ${result.raidTickFileList.length} files from storage`);
        // Log a preview of dates for debugging
        try {
          const preview = result.raidTickFileList.slice(0, 5).map(f => ({ name: f.name, date: formatDate(f.date) }));
          console.log('[RaidTick] Date preview (first 5):', preview);
          log('Preview: ' + JSON.stringify(preview));
        } catch (_) {}
        
        // Update available dates - prefer precomputed local dateStr when present
        availableDates = [...new Set(result.raidTickFileList.map(file => file.dateStr ? file.dateStr : formatDate(file.date)))].sort();
        
        // Always start with today's date
        const today = formatDate(currentSelectedDate);
        console.log('[RaidTick] Today (local):', today);
        log('Today: ' + today);
        console.log('[RaidTick] Available dates:', availableDates);
        log('Available: ' + JSON.stringify(availableDates));
        
        // Update current date display
        updateDateDisplay();
        
        // Filter files for current date
        const todaysFiles = result.raidTickFileList.filter(file => (file.dateStr ? file.dateStr : formatDate(file.date)) === today);
        console.log('[RaidTick] Files for today:', todaysFiles.length);
        log(`Files for today: ${todaysFiles.length}`);
        
        if (todaysFiles.length > 0) {
          displayRaidTickFiles(todaysFiles);
        } else {
          showEmptyState();
        }
      }).catch(function(error) {
        console.error('Storage error:', error);
        const dbg = document.getElementById('raidTickDebugLog');
        if (dbg) { dbg.style.display = 'block'; dbg.textContent = 'Storage error: ' + error.message; }
        showEmptyState();
      });
    } catch (error) {
      console.error('Error loading RaidTick files:', error);
      const dbg = document.getElementById('raidTickDebugLog');
      if (dbg) { dbg.style.display = 'block'; dbg.textContent = 'Error: ' + error.message; }
      showEmptyState();
    }
  }

  // Rescan helper: build metadata from user-selected files and save to storage
  async function rescanRaidTickFromFiles(files) {
    try {
      const dbg = document.getElementById('raidTickDebugLog');
      const log = (m) => { if (!dbg) return; dbg.style.display='block'; const d=document.createElement('div'); d.textContent=m; dbg.appendChild(d); while(dbg.children.length>20) dbg.removeChild(dbg.firstChild); dbg.scrollTop=dbg.scrollHeight; };
      if (!files || files.length === 0) { log('Rescan: no files selected'); return; }
      const pattern = /^RaidTick-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/;
      const meta = [];
      files.forEach(f => {
        if (pattern.test(f.name)) {
          const ds = extractDateStrFromFilename(f.name);
          meta.push({ name: f.name, size: f.size, dateStr: ds });
        }
      });
      if (meta.length === 0) { log('Rescan: no RaidTick files matched'); return; }
      log(`Rescan: saving ${meta.length} files`);
      await browser.storage.sync.set({ raidTickFileList: meta });
      // reload view
      currentSelectedDate = new Date();
      loadRaidTickFiles();
    } catch (err) {
      console.error('Rescan error:', err);
    }
  }

  function extractDateStrFromFilename(name) {
    const m = name.match(/RaidTick-(\d{4})-(\d{2})-(\d{2})_\d{2}-\d{2}-\d{2}\.txt$/);
    if (!m) return formatDate(new Date());
    const [ , y, mo, d ] = m;
    return `${y}-${mo}-${d}`;
  }
  
  /**
   * Display RaidTick files in the UI
   */
  function displayRaidTickFiles(files) {
    // Use DOM API for safer HTML generation with file names
    raidTickFilesDiv.textContent = ''; // Clear first
    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'file-item';
      
      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = file.name; // Safe: textContent escapes automatically
      
      const btn = document.createElement('button');
      btn.className = 'btn btn-small copy-btn';
      btn.textContent = 'Copy';
      btn.dataset.filename = escapeHtmlAttr(file.name); // Safe: escape attribute value
      
      item.appendChild(name);
      item.appendChild(btn);
      raidTickFilesDiv.appendChild(item);
      
      // Add click listener
      btn.addEventListener('click', function() {
        const filename = this.dataset.filename;
        copyFileToClipboard(filename);
      });
    });
  }
  
  /**
   * Update date display and navigation buttons
   */
  function updateDateDisplay() {
    const today = formatDate(currentSelectedDate);
    currentDateSpan.textContent = today;
    
    // Always enable navigation buttons - allow browsing any date
    if (prevDateBtn) prevDateBtn.disabled = false;
    if (nextDateBtn) nextDateBtn.disabled = false;
  }
  
  /**
   * Format date as YYYY-MM-DD
   */
  function formatDate(date) {
    // Normalize to a Date object
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) {
      console.error('Invalid date format:', date);
      return 'Invalid Date';
    }
    // Build YYYY-MM-DD using LOCAL time components to avoid UTC day shifting
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  
  /**
   * Show empty state when no files are found
   */
  function showEmptyState() {
    setEmptyState(raidTickFilesDiv, 'No RaidTick files for this day.');
  }
  
  /**
   * Navigate to previous date
   */
  function navigateToPrevDate() {
    // Move to previous day
    const prevDate = new Date(currentSelectedDate);
    prevDate.setDate(prevDate.getDate() - 1);
    currentSelectedDate = prevDate;
    updateDateDisplay();
    loadRaidTickFiles();
  }
  
  /**
   * Navigate to next date
   */
  function navigateToNextDate() {
    // Move to next day
    const nextDate = new Date(currentSelectedDate);
    nextDate.setDate(nextDate.getDate() + 1);
    currentSelectedDate = nextDate;
    updateDateDisplay();
    loadRaidTickFiles();
  }
  
  
  /**
   * Copy file content to clipboard
   */
  async function copyFileToClipboard(filename) {
    try {
      browser.storage.sync.get(['raidTickFileList']).then(function(result) {
        if (!result.raidTickFileList) {
          return;
        }
        
        const file = result.raidTickFileList.find(f => f.name === filename);
        if (!file) {
          return;
        }
        
        // Helper function to strip header row
        function stripHeaderRow(text) {
          const lines = text.split('\n');
          if (lines.length === 0) return text;
          
          // Check if first line matches the header pattern (case-insensitive, flexible whitespace/tabs)
          const firstLine = lines[0].trim();
          
          // More robust check: split by whitespace and check if it matches the header words
          const words = firstLine.split(/\s+/).map(w => w.toLowerCase());
          const headerWords = ['player', 'level', 'class', 'timestamp', 'points'];
          
          // Check if first 5 words match the header exactly
          if (words.length >= 5 && 
              words[0] === headerWords[0] &&
              words[1] === headerWords[1] &&
              words[2] === headerWords[2] &&
              words[3] === headerWords[3] &&
              words[4] === headerWords[4]) {
            // Remove the header row and return the rest
            return lines.slice(1).join('\n');
          }
          
          // Fallback: regex pattern check
          const headerPattern = /^player\s+level\s+class\s+timestamp\s+points$/i;
          if (headerPattern.test(firstLine)) {
            return lines.slice(1).join('\n');
          }
          
          return text;
        }
        
        // If content is stored in settings, use it (legacy mode)
        if (file.content) {
          const cleanedContent = stripHeaderRow(file.content);
          navigator.clipboard.writeText(cleanedContent).then(() => {
            // Count lines (excluding header row)
            const lines = cleanedContent.split('\n');
            const dataLines = lines.filter(line => line.trim() && !line.includes('RaidTick') && !line.includes('Date:') && !line.includes('Time:'));
            const lineCount = dataLines.length;
            
            // Show success feedback in status area
            const originalText = statusText.textContent || '';
            const originalClass = statusDiv.className;
            setStatusMessageStructured(statusText, statusDiv, {
              icon: '✅',
              mainText: 'File copied to clipboard!',
              details: `${lineCount} lines copied (excluding header)`,
              type: 'success',
              autoRestoreMs: 3000,
              restoreCallback: () => {
                // Restore original status
                statusText.textContent = '';
                statusText.textContent = originalText;
                statusDiv.className = originalClass.includes('active') ? 'status active' : 'status inactive';
              }
            });
            
            // Show success feedback on button
            const copyBtn = document.querySelector(`[data-filename="${filename}"]`);
            if (copyBtn) {
              const originalBtnText = copyBtn.textContent;
              copyBtn.textContent = 'Copied!';
              copyBtn.style.backgroundColor = '#28a745';
              setTimeout(() => {
                copyBtn.textContent = originalBtnText;
                copyBtn.style.backgroundColor = '';
              }, 1000);
            }
            
          }).catch(err => {
            alert('Failed to copy to clipboard. Please try again.');
          });
        } else {
          // No content stored – prompt user to pick the file on demand (Firefox-friendly)
          const picker = document.createElement('input');
          picker.type = 'file';
          picker.accept = '.txt';
          picker.style.display = 'none';
          document.body.appendChild(picker);
          
          picker.addEventListener('change', () => {
            const selected = picker.files && picker.files[0];
            if (!selected) {
              document.body.removeChild(picker);
              return;
            }
            
            // Verify filename matches the requested one
            if (selected.name !== filename) {
              alert(`Selected file (${selected.name}) does not match ${filename}. Please select the correct file.`);
              document.body.removeChild(picker);
              return;
            }
            
            // Helper function to strip header row
            function stripHeaderRow(text) {
              const lines = text.split('\n');
              if (lines.length === 0) return text;
              
              // Check if first line matches the header pattern (case-insensitive, flexible whitespace/tabs)
              const firstLine = lines[0].trim();
              
              // More robust check: split by whitespace and check if it matches the header words
              const words = firstLine.split(/\s+/).map(w => w.toLowerCase());
              const headerWords = ['player', 'level', 'class', 'timestamp', 'points'];
              
              // Check if first 5 words match the header exactly
              if (words.length >= 5 && 
                  words[0] === headerWords[0] &&
                  words[1] === headerWords[1] &&
                  words[2] === headerWords[2] &&
                  words[3] === headerWords[3] &&
                  words[4] === headerWords[4]) {
                // Remove the header row and return the rest
                return lines.slice(1).join('\n');
              }
              
              // Fallback: regex pattern check
              const headerPattern = /^player\s+level\s+class\s+timestamp\s+points$/i;
              if (headerPattern.test(firstLine)) {
                return lines.slice(1).join('\n');
              }
              
              return text;
            }
            
            // Read and copy
            const reader = new FileReader();
            reader.onload = () => {
              const content = reader.result || '';
              const cleanedContent = stripHeaderRow(content);
              navigator.clipboard.writeText(cleanedContent).then(() => {
                // Success feedback
                const lines = cleanedContent.split('\n');
                const dataLines = lines.filter(line => line.trim() && !line.includes('RaidTick') && !line.includes('Date:') && !line.includes('Time:'));
                const lineCount = dataLines.length;
                const originalText = statusText.textContent || '';
                const originalClass = statusDiv.className;
                setStatusMessageStructured(statusText, statusDiv, {
                  icon: '✅',
                  mainText: 'File copied to clipboard!',
                  details: `${lineCount} lines copied (excluding header)`,
                  type: 'success',
                  autoRestoreMs: 3000,
                  restoreCallback: () => {
                    // Restore original status
                    statusText.textContent = '';
                    statusText.textContent = originalText;
                    statusDiv.className = originalClass.includes('active') ? 'status active' : 'status inactive';
                  }
                });
              }).catch(() => {
                alert('Failed to copy to clipboard. Please try again.');
              }).finally(() => {
                document.body.removeChild(picker);
              });
            };
            reader.onerror = () => {
              alert('Failed to read file.');
              document.body.removeChild(picker);
            };
            reader.readAsText(selected);
          }, { once: true });
          
          // Trigger picker
          picker.click();
        }
      }).catch(function(error) {
        console.error('Storage error:', error);
      });
    } catch (error) {
      console.error('Error copying file to clipboard:', error);
      alert('Error copying file. Please try again.');
    }
  }
  
  /**
   * EverQuest Log Parser Functions
   */
  
  let eqLogMonitoringInterval = null;
  // Initialize eqLogSettings early to avoid "before initialization" errors
  let eqLogSettings = {
    enabled: false,
    fileHandle: null,
    tag: 'FG',
    events: [],
    monitoring: false
  };
  
  /**
   * Debug logging function - shows messages in popup UI
   */
  function debugLog(message, type = 'info') {
    const debugLogDiv = document.getElementById('eqLogDebugLog');
    if (!debugLogDiv) return;
    
    // Show debug log div
    debugLogDiv.style.display = 'block';
    
    const timestamp = new Date().toLocaleTimeString();
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
    const logEntry = document.createElement('div');
    logEntry.style.marginBottom = '2px';
    logEntry.style.padding = '2px 4px';
    logEntry.style.color = type === 'error' ? '#c62828' : type === 'success' ? '#2e7d32' : '#333';
    logEntry.style.backgroundColor = type === 'error' ? '#ffebee' : type === 'success' ? '#e8f5e9' : '#fff';
    logEntry.textContent = `[${timestamp}] ${prefix} ${message}`;
    
    // Find the content area (after the "Debug Log:" header)
    const contentArea = debugLogDiv.querySelector('.debug-content') || (() => {
      const div = document.createElement('div');
      div.className = 'debug-content';
      debugLogDiv.appendChild(div);
      return div;
    })();
    
    contentArea.appendChild(logEntry);
    
    // Keep only last 15 messages
    while (contentArea.children.length > 15) {
      contentArea.removeChild(contentArea.firstChild);
    }
    
    // Auto-scroll to bottom
    debugLogDiv.scrollTop = debugLogDiv.scrollHeight;
    
    // Also log to console
    console.log(`[EQ Log Debug] ${message}`);
  }
  
  /**
   * Initialize EQ Log Parser
   */
  async function initializeEQLogParser(settings) {
    debugLog('Initializing EQ Log Parser...');
    // Auto-enabled for Raid Leader profile
    const isRaidLeader = settings.soundProfile === 'raidleader';
    
    // Load saved events and tag from storage
    const storedData = await browser.storage.sync.get(['eqLogEvents', 'eqLogTag','eqLogFileMeta']);
    
    console.log('[EQ Log Init] Loaded from storage:', {
      eventsCount: storedData.eqLogEvents?.length || 0,
      tag: storedData.eqLogTag || 'not set',
      sampleEvents: storedData.eqLogEvents?.slice(0, 3).map(e => ({ date: e.date, items: e.items?.length || 0, timestamp: e.timestamp })) || []
    });
    
    eqLogSettings = {
      enabled: isRaidLeader, // Always enabled for Raid Leader, disabled for Raider
      fileHandle: null, // Will be set when user selects file in popup
      tag: (storedData.eqLogTag || settings.eqLogTag || 'FG').trim(),
      events: storedData.eqLogEvents || [],
      monitoring: settings.eqLogMonitoring || false
    };
    
    console.log('[EQ Log Init] Initialized eqLogSettings:', {
      enabled: eqLogSettings.enabled,
      tag: eqLogSettings.tag,
      eventsCount: eqLogSettings.events.length,
      monitoring: eqLogSettings.monitoring
    });
    
    // Update UI
    const tagInput = document.getElementById('eqLogTag');
    if (tagInput) {
      tagInput.value = eqLogSettings.tag;
    }
    
    // Update file name display (will be updated again if we recover a file)
    updateFileNameDisplay();
    
    // Check and clear old events (midnight clearing)
    checkAndClearOldEvents();
    
    // Load and display existing events
    console.log('[EQ Log Init] Calling displayEQLogEvents()...');
    displayEQLogEvents();
    
    // File selection is handled by the monitor window - no button needed
    
    // Set up tag input
    if (tagInput) {
      tagInput.addEventListener('change', function() {
        eqLogSettings.tag = this.value.trim() || 'FG';
        browser.storage.sync.set({ eqLogTag: eqLogSettings.tag });
      });
    }
    
    // Set up toggle button
    const toggleBtn = document.getElementById('eqLogMonitoringToggle');
    if (toggleBtn) {
      toggleBtn.checked = eqLogSettings.monitoring;
      toggleBtn.addEventListener('change', function() {
        eqLogSettings.monitoring = this.checked;
        if (this.checked) {
          startEQLogMonitoring();
        } else {
          stopEQLogMonitoring();
        }
        browser.storage.sync.set({ eqLogMonitoring: this.checked });
      });
      
      // If monitoring was active, start it
      if (eqLogSettings.monitoring) {
        startEQLogMonitoring();
      }
    }
    
    // Set up scan button
    const fetchBtn = document.getElementById('fetchLastLoot');
    if (fetchBtn) {
      fetchBtn.addEventListener('click', scanForLastLootLine);
    }
  }
  
  /**
   * Handle file selection in popup
   */
  async function handleEQLogFileSelection(event) {
    debugLog('handleEQLogFileSelection called');
    debugLog(`Event target: ${event.target ? event.target.id : 'null'}`);
    
    // Get file from event - try multiple ways to be defensive
    const fileInput = event.target || document.getElementById('eqLogFileInput');
    debugLog(`File input element: ${fileInput ? 'found' : 'NOT FOUND'}`);
    
    if (fileInput) {
      debugLog(`File input has files: ${fileInput.files ? fileInput.files.length : 'null/undefined'}`);
    }
    
    const file = (fileInput && fileInput.files && fileInput.files.length > 0) ? fileInput.files[0] : null;
    
    if (!file) {
      debugLog('WARNING: Event fired but no file found!', 'error');
      // Try to get it from the input directly as fallback
      const fileInputElement = document.getElementById('eqLogFileInput');
      if (fileInputElement) {
        debugLog(`Fallback: Checking fileInputElement, has files: ${fileInputElement.files ? fileInputElement.files.length : 'none'}`);
        if (fileInputElement.files && fileInputElement.files.length > 0) {
          const recoveredFile = fileInputElement.files[0];
          debugLog(`Fallback recovery successful: ${recoveredFile.name}`, 'success');
          processSelectedFile(recoveredFile);
          return;
        }
      }
      debugLog('No file found in any location', 'error');
      return;
    }
    
    debugLog(`File found in event: ${file.name} (${file.size} bytes)`, 'success');
    processSelectedFile(file);
  }
  
  /**
   * Process and store selected file
   */
  async function processSelectedFile(file) {
    debugLog(`Processing file: ${file.name} (${file.size} bytes)`, 'success');
    
    // Store file handle immediately
    eqLogSettings.fileHandle = file;
    debugLog(`File handle stored in memory: ${eqLogSettings.fileHandle ? eqLogSettings.fileHandle.name : 'FAILED'}`);
    
    updateFileNameDisplay();
    debugLog('File name display updated');
    
    // Store file metadata in browser storage as backup
    try {
      await browser.storage.sync.set({
        eqLogFileMeta: {
          name: file.name,
          lastModified: file.lastModified,
          parity: file.size.toString().substring(0, 10) // Store first 10 digits of size as verification
        }
      });
      debugLog('File metadata saved to storage successfully', 'success');
    } catch (error) {
      debugLog(`ERROR saving metadata: ${error.message}`, 'error');
    }
    
    // Show success feedback
    if (statusDiv && statusText) {
      const originalText = statusText.textContent || '';
      const originalClass = statusDiv.className;
      setStatusMessageStructured(statusText, statusDiv, {
        icon: '✅',
        mainText: 'Log file selected: ' + file.name,
        type: 'success',
        autoRestoreMs: 2000,
        restoreCallback: () => {
          // Restore original status
          statusText.textContent = '';
          statusText.textContent = originalText;
          statusDiv.className = originalClass.includes('active') ? 'status active' : 'status inactive';
        }
      });
    }
    
    debugLog('File selection process complete!', 'success');
  }
  
  /**
   * Update file name display
   */
  function updateFileNameDisplay() {
    const fileNameSpan = document.getElementById('eqLogFileName');
    if (fileNameSpan) {
      if (eqLogSettings.fileHandle) {
        fileNameSpan.textContent = eqLogSettings.fileHandle.name;
        fileNameSpan.style.color = '#4caf50';
      } else if (eqLogSettings && eqLogSettings.fileName) {
        fileNameSpan.textContent = eqLogSettings.fileName;
        fileNameSpan.style.color = '#4caf50';
      } else {
        fileNameSpan.textContent = 'No file selected';
        fileNameSpan.style.color = '#666';
      }
    }
  }
  
  /**
   * Start monitoring EQ log file
   */
  function startEQLogMonitoring() {
    if (eqLogMonitoringInterval) {
      return; // Already monitoring
    }
    
    if (!eqLogSettings.fileHandle || !eqLogSettings.tag) {
      console.error('Cannot start monitoring: file or tag not set');
      if (statusDiv && statusText) {
        const originalText = statusText.textContent || '';
        const originalClass = statusDiv.className;
        setStatusMessage(statusText, statusDiv, '⚠️ Please select a log file first', 'inactive', 3000, () => {
          statusText.textContent = '';
          statusText.textContent = originalText;
          statusDiv.className = originalClass.includes('active') ? 'status active' : 'status inactive';
        });
      }
      return;
    }
    
    console.log('Starting EQ log monitoring');
    eqLogSettings.monitoring = true;
    
    // Monitor every 3 seconds
    eqLogMonitoringInterval = setInterval(() => {
      scanForLastLootLine(true); // true = silent monitoring mode
    }, 3000);
    
    // Also do an immediate check
    scanForLastLootLine(true);
  }
  
  /**
   * Stop monitoring EQ log file
   */
  function stopEQLogMonitoring() {
    if (eqLogMonitoringInterval) {
      clearInterval(eqLogMonitoringInterval);
      eqLogMonitoringInterval = null;
    }
    eqLogSettings.monitoring = false;
    console.log('Stopped EQ log monitoring');
  }
  
  /**
   * Scan file from end backwards for last matching loot line
   * @param {boolean} silent - If true, don't show UI feedback (for monitoring)
   */
  async function scanForLastLootLine(silent = false) {
    if (!eqLogSettings.fileHandle) {
      if (!silent && statusDiv && statusText) {
        const originalText = statusText.textContent || '';
        const originalClass = statusDiv.className;
        setStatusMessage(statusText, statusDiv, '⚠️ Please select a log file first', 'inactive', 3000, () => {
          statusText.textContent = '';
          statusText.textContent = originalText;
          statusDiv.className = originalClass.includes('active') ? 'status active' : 'status inactive';
        });
      }
      return;
    }
    
    if (!eqLogSettings.tag) {
      if (!silent && statusDiv && statusText) {
        const originalText = statusText.textContent || '';
        const originalClass = statusDiv.className;
        setStatusMessage(statusText, statusDiv, '⚠️ Please set a loot tag (e.g., FG)', 'inactive', 3000, () => {
          statusText.textContent = '';
          statusText.textContent = originalText;
          statusDiv.className = originalClass.includes('active') ? 'status active' : 'status inactive';
        });
      }
      return;
    }
    
    try {
      // Show loading state if not silent
      const fetchBtn = document.getElementById('fetchLastLoot');
      const originalBtnText = fetchBtn ? fetchBtn.textContent : '🔍 Scan';
      if (fetchBtn && !silent) {
        fetchBtn.disabled = true;
        fetchBtn.textContent = '⏳ Scanning...';
      }
      
      // Read the file
      const file = eqLogSettings.fileHandle;
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file: ' + (reader.error ? reader.error.message : 'Unknown error')));
        reader.readAsText(file);
      });
      
      console.log('File read, searching backward for loot line with tag:', eqLogSettings.tag);
      
      // Find the last matching line (search from end backwards)
      const lines = content.split('\n');
      let lastMatchingLine = null;
      let linesChecked = 0;
      let lastNonMatchingLine = null; // For debugging
      
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        linesChecked++;
        if (linesChecked <= 10) { // Log first 10 non-empty lines for debugging
          console.log(`[EQ Log Scan] Line ${i}:`, line.substring(0, 100));
        }
        if (detectLootLine(line, eqLogSettings.tag)) {
          console.log(`[EQ Log Scan] ✅ MATCHED line ${i} with tag "${eqLogSettings.tag}":`, line.substring(0, 100));
          lastMatchingLine = line;
          break;
        } else if (line.includes('tells the raid') || line.includes('tell the raid') || line.includes('tell your raid')) {
          // Log potential matches that didn't match for debugging
          if (!lastNonMatchingLine && linesChecked <= 20) {
            lastNonMatchingLine = line;
            console.log(`[EQ Log Scan] ⚠️ Potential loot line (tag mismatch):`, line.substring(0, 100));
          }
        }
      }
      
      console.log(`[EQ Log Scan] Checked ${linesChecked} lines, found:`, lastMatchingLine ? 'YES' : 'NO');
      
      if (!lastMatchingLine) {
        // No matching line found
        if (!silent) {
          const originalText = statusText.textContent || '';
          const originalClass = statusDiv.className;
          const details = lastNonMatchingLine ? 'Found potential line but tag didn\'t match' : '';
          setStatusMessageStructured(statusText, statusDiv, {
            icon: 'ℹ️',
            mainText: `No loot lines found with tag: ${eqLogSettings.tag}`,
            details: details,
            type: 'inactive',
            autoRestoreMs: 3000,
            restoreCallback: () => {
              statusText.textContent = '';
              statusText.textContent = originalText;
              statusDiv.className = originalClass;
            }
          });
        }
        
        if (fetchBtn && !silent) {
          fetchBtn.disabled = false;
          fetchBtn.textContent = originalBtnText;
        }
        return;
      }
      
      console.log('Found matching line:', lastMatchingLine.substring(0, 100) + '...');
      
      // Parse the line
      const items = extractItems(lastMatchingLine, eqLogSettings.tag);
      console.log('[EQ Log Scan] Extracted items:', items);
      console.log('[EQ Log Scan] Tag used:', eqLogSettings.tag);
      console.log('[EQ Log Scan] Items count:', items?.length || 0);
      
      if (!items || items.length === 0) {
        if (!silent) {
          const originalText = statusText.textContent || '';
          const originalClass = statusDiv.className;
          setStatusMessage(statusText, statusDiv, '⚠️ Found line but no items extracted. Check tag and format.', 'inactive', 3000, () => {
            statusText.textContent = '';
            statusText.textContent = originalText;
            statusDiv.className = originalClass;
          });
        }
        
        if (fetchBtn && !silent) {
          fetchBtn.disabled = false;
          fetchBtn.textContent = originalBtnText;
        }
        return;
      }
      
      // Check if this event already exists (by comparing log line)
      const existingEvent = eqLogSettings.events.find(event => event.logLine === lastMatchingLine);
      if (existingEvent) {
        if (!silent) {
          const originalText = statusText.textContent || '';
          const originalClass = statusDiv.className;
          setStatusMessage(statusText, statusDiv, 'ℹ️ This loot line is already captured', 'inactive', 2000, () => {
            statusText.textContent = '';
            statusText.textContent = originalText;
            statusDiv.className = originalClass;
          });
        }
        
        if (fetchBtn && !silent) {
          fetchBtn.disabled = false;
          fetchBtn.textContent = originalBtnText;
        }
        return;
      }
      
      // Create new event
      const timestamp = extractTimestamp(lastMatchingLine);
      const today = formatDate(new Date());
      
      const event = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        timestamp: timestamp,
        date: today,
        items: items,
        logLine: lastMatchingLine
      };
      
      // Add to events
      console.log('[EQ Log Scan] Creating event:', { id: event.id, timestamp: event.timestamp, items: event.items.length, date: event.date });
      eqLogSettings.events.push(event);
      console.log('[EQ Log Scan] Total events in memory:', eqLogSettings.events.length);
      await saveEQLogEvents();
      console.log('[EQ Log Scan] Saved to storage, displaying...');
      displayEQLogEvents();
      console.log('[EQ Log Scan] Display updated');
      
      // Show success feedback
      if (!silent && statusDiv && statusText) {
        const originalText = statusText.textContent || '';
        const originalClass = statusDiv.className;
        setStatusMessageStructured(statusText, statusDiv, {
          icon: '✅',
          mainText: `Found ${items.length} items from last loot line!`,
          type: 'success',
          autoRestoreMs: 2000,
          restoreCallback: () => {
            statusText.textContent = '';
            statusText.textContent = originalText;
            statusDiv.className = originalClass.includes('active') ? 'status active' : 'status inactive';
          }
        });
      }
      
      if (fetchBtn && !silent) {
        fetchBtn.disabled = false;
        fetchBtn.textContent = originalBtnText;
      }
    } catch (error) {
      console.error('Error scanning log file:', error);
      
      if (!silent && statusDiv && statusText) {
        const originalText = statusText.textContent || '';
        const originalClass = statusDiv.className;
        setStatusMessage(statusText, statusDiv, '❌ Error: ' + (error.message || 'Failed to read log file'), 'inactive', 4000, () => {
          statusText.textContent = '';
          statusText.textContent = originalText;
          statusDiv.className = originalClass.includes('active') ? 'status active' : 'status inactive';
        });
      }
      
      const fetchBtn = document.getElementById('fetchLastLoot');
      if (fetchBtn && !silent) {
        fetchBtn.disabled = false;
        fetchBtn.textContent = '🔍 Scan';
      }
    }
  }
  
  
  /**
   * Detect if line contains loot tag
   * Tag must appear before any delimiter (pipe or comma)
   */
  function detectLootLine(line, tag) {
    if (!tag || !line) return false;
    // Try to match the standard EQ log format: [timestamp] name tells the raid, 'message'
    const m = line.match(/^\[[^\]]+\]\s.*?(?:tells the raid|tell the raid|tell your raid|tell your party|tells your party|say),\s*'(.*)'\s*$/i);
    if (!m) return false;
    const quoted = m[1];
    if (!quoted) return false;
    // Check if quoted text starts with the tag (case-insensitive, word boundary)
    const re = new RegExp('^\s*' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    return re.test(quoted);
  }
  
  /**
   * Extract items from loot line
   * Supports both pipe (|) and comma (,) delimiters
   */
  function extractItems(line, tag) {
    if (!line || !tag) return [];
    // Match the standard EQ log format: [timestamp] name tells the raid, 'message'
    const m = line.match(/^\[[^\]]+\]\s.*?(?:tells the raid|tell the raid|tell your raid|tell your party|tells your party|say),\s*'(.*)'\s*$/i);
    if (!m) return [];
    const quoted = m[1];
    if (!quoted) return [];
    // Remove tag from start of quoted text
    const after = quoted.replace(new RegExp('^\n?\r?\t?\uFEFF?\s*' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '').trim();
    if (!after) return [];
    const hasPipe = after.includes('|');
    const hasComma = after.includes(',');
    let items = [];
    if (!hasPipe && !hasComma) {
      items = [after];
    } else {
      items = after.split(hasPipe ? '|' : ',').map(s => s.trim());
    }
    return items.filter(Boolean);
  }
  
  /**
   * Extract timestamp from log line
   */
  function extractTimestamp(line) {
    // EQ log format: [Mon Oct 27 22:57:16 2025] ...
    const match = line.match(/\[([^\]]+)\]/);
    if (match) {
      return match[1]; // Return the timestamp string
    }
    // Fallback to current time
    return new Date().toLocaleString();
  }
  
  /**
   * Check and clear events from previous days
   */
  function checkAndClearOldEvents() {
    const today = formatDate(new Date());
    const initialLength = eqLogSettings.events.length;
    
    eqLogSettings.events = eqLogSettings.events.filter(event => event.date === today);
    
    if (eqLogSettings.events.length !== initialLength) {
      console.log(`Cleared ${initialLength - eqLogSettings.events.length} old events`);
      saveEQLogEvents();
    }
  }
  
  /**
   * Display EQ log events
   */
  function displayEQLogEvents() {
    console.log('[EQ Log Display] ===== displayEQLogEvents() called =====');
    const eventsContainer = document.getElementById('eqLogEvents');
    if (!eventsContainer) {
      console.error('[EQ Log Display] ❌ eventsContainer not found - element #eqLogEvents missing!');
      return;
    }
    console.log('[EQ Log Display] ✅ eventsContainer found');
    
    const eqSection = document.getElementById('eqLogSection');
    if (!eqSection) {
      console.error('[EQ Log Display] ❌ eqSection not found - element #eqLogSection missing!');
      return;
    }
    console.log('[EQ Log Display] ✅ eqSection found, current display:', eqSection.style.display);
    
    // Ensure eqLogSettings.events is always an array
    if (!eqLogSettings || !Array.isArray(eqLogSettings.events)) {
      console.warn('[EQ Log Display] eqLogSettings.events not initialized, initializing to empty array');
      if (!eqLogSettings) {
        eqLogSettings = {};
      }
      eqLogSettings.events = [];
    }
    
    console.log('[EQ Log Display] Total events in memory:', eqLogSettings.events.length);
    if (eqLogSettings.events.length > 0) {
      console.log('[EQ Log Display] Sample events:', eqLogSettings.events.slice(0, 3).map(e => ({
        date: e.date,
        itemsCount: e.items?.length || 0,
        timestamp: e.timestamp,
        hasItems: !!e.items
      })));
    }
    
    // Filter to today's events and sort by timestamp (newest first)
    const today = formatDate(new Date());
    console.log('[EQ Log Display] Today date:', today);
    const todaysEvents = eqLogSettings.events
      .filter(event => {
        const matches = event.date === today;
        if (!matches && eqLogSettings.events.length <= 10) {
          console.log('[EQ Log Display] Event filtered out (not today):', { date: event.date, today, timestamp: event.timestamp });
        }
        return matches;
      })
      .sort((a, b) => {
        // Sort by event ID (which includes timestamp), newest first
        // Since timestamps are strings like "Mon Oct 27 22:57:16 2025", just reverse array
        // Events are added with increasing IDs, so reverse gives newest first
        return 0; // Will reverse the array since we want newest first
      })
      .reverse();
    
    console.log('[EQ Log Display] Today\'s events:', todaysEvents.length);
    if (todaysEvents.length > 0) {
      console.log('[EQ Log Display] First event:', { id: todaysEvents[0].id, items: todaysEvents[0].items?.length || 0, timestamp: todaysEvents[0].timestamp });
    }
    
    if (todaysEvents.length === 0) {
      setEmptyState(eventsContainer, 'No loot events captured yet.');
      // Hide section when there are no events AND not monitoring
      if (eqSection) {
        const isRaidLeader = eqSection.getAttribute('data-raid-leader') === 'true';
        const isMonitoring = eqLogSettings.monitoring || false;
        // Only show section if actively monitoring, otherwise hide it
        if (isRaidLeader && isMonitoring) {
          // Keep section visible but show empty state when monitoring
          eqSection.style.display = 'flex';
          // Set body height to accommodate loot section
          document.body.style.height = '600px';
        } else {
          // Hide section when not monitoring and no events
          eqSection.style.display = 'none';
          // Shrink body height when loot section is hidden
          document.body.style.height = 'auto';
        }
      }
      console.log('[EQ Log Display] No events today, monitoring:', eqLogSettings.monitoring);
      return;
    }
    // Always show section when events exist
    if (eqSection) {
      eqSection.style.display = 'flex';
      // Ensure it's marked as raid leader section if events exist
      if (eqSection.getAttribute('data-raid-leader') !== 'true') {
        eqSection.setAttribute('data-raid-leader', 'true');
      }
      // Set body height to accommodate loot section
      document.body.style.height = '600px';
      // Force layout recalculation for Firefox
      void eqSection.offsetHeight;
    }
    
    // Limit to 50 most recent events
    const displayEvents = todaysEvents.slice(0, 50);
    
    // Clear container and build events using DOM API
    eventsContainer.textContent = '';
    const fragment = document.createDocumentFragment();
    
    displayEvents.forEach(event => {
      const eventElement = createEventGroupElement(event);
      fragment.appendChild(eventElement);
    });
    
    eventsContainer.appendChild(fragment);
    
    // Scroll to top to show newest events (events are sorted newest first)
    eventsContainer.scrollTop = 0;
    
    // Add event listeners for copy and delete buttons
    eventsContainer.querySelectorAll('.eq-log-item-copy').forEach(btn => {
      btn.addEventListener('click', function() {
        const itemText = this.dataset.item;
        copyItemToClipboard(itemText);
      });
    });
    
    eventsContainer.querySelectorAll('.eq-log-event-close').forEach(btn => {
      btn.addEventListener('click', function() {
        const eventId = this.dataset.eventId;
        deleteEventGroup(eventId);
      });
    });
  }
  
  /**
   * Create DOM element for an event group (replaces createEventGroup HTML string)
   * @param {Object} event - Event object with id, timestamp, items
   * @returns {HTMLElement} - DOM element ready to append
   */
  function createEventGroupElement(event) {
    const eventDiv = document.createElement('div');
    eventDiv.className = 'eq-log-event';
    eventDiv.setAttribute('data-event-id', escapeHtmlAttr(String(event.id)));
    
    // Header
    const header = document.createElement('div');
    header.className = 'eq-log-event-header';
    
    const timestamp = document.createElement('span');
    timestamp.className = 'eq-log-event-timestamp';
    timestamp.textContent = event.timestamp || '';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'eq-log-event-close';
    closeBtn.setAttribute('data-event-id', escapeHtmlAttr(String(event.id)));
    closeBtn.setAttribute('title', 'Remove');
    closeBtn.textContent = '×';
    
    header.appendChild(timestamp);
    header.appendChild(closeBtn);
    
    // Items container
    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'eq-log-items';
    
    // Add items
    event.items.forEach((item, index) => {
      const itemElement = createItemButtonElement(item, event.id, index);
      itemsContainer.appendChild(itemElement);
    });
    
    // Assemble
    eventDiv.appendChild(header);
    eventDiv.appendChild(itemsContainer);
    
    return eventDiv;
  }
  
  /**
   * Create DOM element for an item copy button (replaces createItemButton HTML string)
   * @param {string} item - Item name/text
   * @param {string} eventId - Event ID
   * @param {number} itemIndex - Item index
   * @returns {HTMLElement} - DOM element ready to append
   */
  function createItemButtonElement(item, eventId, itemIndex) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'eq-log-item';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'eq-log-item-name';
    nameSpan.textContent = item; // Safe: textContent escapes automatically
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-small eq-log-item-copy';
    copyBtn.setAttribute('data-item', escapeHtmlAttr(item));
    copyBtn.setAttribute('data-event-id', escapeHtmlAttr(String(eventId)));
    copyBtn.setAttribute('data-item-index', escapeHtmlAttr(String(itemIndex)));
    copyBtn.textContent = 'Copy';
    
    itemDiv.appendChild(nameSpan);
    itemDiv.appendChild(copyBtn);
    
    return itemDiv;
  }
  
  /**
   * Copy item to clipboard
   */
  function copyItemToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      console.log('Item copied to clipboard:', text);
      // Show success feedback in status area
      const originalText = statusText.textContent || '';
      const originalClass = statusDiv.className;
      setStatusMessageStructured(statusText, statusDiv, {
        icon: '✅',
        mainText: 'Item copied to clipboard!',
        details: text,
        type: 'success',
        autoRestoreMs: 2000,
        restoreCallback: () => {
          statusText.textContent = '';
          statusText.textContent = originalText;
          statusDiv.className = originalClass.includes('active') ? 'status active' : 'status inactive';
        }
      });
    }).catch(err => {
      console.error('Failed to copy to clipboard:', err);
      alert('Failed to copy to clipboard. Please try again.');
    });
  }
  
  /**
   * Delete an event group
   */
  async function deleteEventGroup(eventId) {
    eqLogSettings.events = eqLogSettings.events.filter(event => event.id !== eventId);
    await saveEQLogEvents();
    displayEQLogEvents();
  }
  
  /**
   * Save EQ log events to storage
   */
  async function saveEQLogEvents() {
    try {
      await browser.storage.sync.set({
        eqLogEvents: eqLogSettings.events
      });
    } catch (error) {
      console.error('Error saving EQ log events:', error);
    }
  }
  
  
  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize when DOM is ready or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePopup);
} else {
  // DOM already loaded, initialize immediately
  initializePopup();
}
