// Popup script for OpenDKP Helper

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

// Customizable popup text - modify this before production
const POPUP_QUICK_ACTIONS_TEXT = `Quick Actions:
• Click "Open Settings" to configure RaidTick integration
• Use date navigation to browse RaidTick files
• Click "Copy" to copy file contents to clipboard`;

// Initialize function - can be called on DOMContentLoaded or directly if DOM already loaded
function initializePopup() {
  console.log('Popup loaded');
  
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
  const refreshPopupBtn = document.getElementById('refreshPopup'); // Optional button
  const eqLogSection = document.getElementById('eqLogSection');
  const eqLogEvents = document.getElementById('eqLogEvents');
  const eqLogFileInput = document.getElementById('eqLogFileInput');
  const selectEQLogFile = document.getElementById('selectEQLogFile');
  const eqLogFilePath = document.getElementById('eqLogFilePath');
  const eqLogTag = document.getElementById('eqLogTag');
  
  
  // Force immediate visual update
  console.log('Popup script loaded - Firefox debug');
  
  // Add a visible indicator that the popup loaded
  setTimeout(() => {
    const currentDateSpan = document.getElementById('currentDate');
    if (currentDateSpan && currentDateSpan.textContent === 'Today') {
      currentDateSpan.textContent = 'Loading...';
      currentDateSpan.style.color = 'orange';
    }
  }, 100);
  
  // Safety timeout to prevent stuck loading state
  setTimeout(() => {
    const currentDateSpan = document.getElementById('currentDate');
    if (currentDateSpan && currentDateSpan.textContent === 'Loading...') {
      console.log('Loading timeout - forcing fallback');
      currentDateSpan.textContent = 'Error';
      currentDateSpan.style.color = 'red';
    }
  }, 5000);
  
  /**
   * Helper function to build status text with all details
   */
  function buildStatusText(settings, isOpenDKP) {
    const profile = settings.soundProfile || 'raidleader';
    const soundType = settings.soundType || 'bell';
    const volume = settings.volume || 50;
    
    // Helper to check if current time is within a time window
    function isTimeWindowActive(startTime, endTime) {
      if (!startTime || !endTime) return false;
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const currentTime = currentHour * 60 + currentMinute;
      
      // Parse start and end times (format: "HH:MM")
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);
      const startTimeMinutes = startHour * 60 + startMin;
      const endTimeMinutes = endHour * 60 + endMin;
      
      if (startTimeMinutes <= endTimeMinutes) {
        // Same day window (e.g., 09:00 to 17:00)
        return currentTime >= startTimeMinutes && currentTime < endTimeMinutes;
      } else {
        // Overnight window (e.g., 22:00 to 06:00)
        return currentTime >= startTimeMinutes || currentTime < endTimeMinutes;
      }
    }
    
    // Build extras (TTS voice, time-based features, etc.)
    const extras = [];
    if (settings.enableTTS) {
      const v = String(settings.voice || 'Default');
      let short = v;
      if (/zira/i.test(v)) short = 'Zira';
      else if (/david/i.test(v)) short = 'David';
      else if (/mark/i.test(v)) short = 'Mark';
      else short = (v.split(' ').find(Boolean)) || 'Default';
      extras.push(`TTS: ${short}`);
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
    
    const extrasHtml = extras.length ? `<br><small>${extras.join(' • ')}</small>` : '';
    
    if (isOpenDKP) {
      return `
        ✅ Active on OpenDKP<br>
        <small>Profile: ${escapeHtml(profile)} | Sound: ${escapeHtml(soundType)} | Volume: ${escapeHtml(String(volume))}%</small>${extrasHtml}
      `;
    } else {
      if (settings.raidTickEnabled && settings.raidTickFolder) {
        return `
          📁 RaidTick Mode<br>
          <small>Profile: ${escapeHtml(profile)} | Sound: ${escapeHtml(soundType)} | Volume: ${escapeHtml(String(volume))}%</small>${extrasHtml}
        `;
      } else {
        return `
          ⚠️ Not on OpenDKP page<br>
          <small>Profile: ${escapeHtml(profile)} | Sound: ${escapeHtml(soundType)} | Volume: ${escapeHtml(String(volume))}%</small>${extrasHtml}
        `;
      }
    }
  }
  
  // Load current settings and update UI
  // Chrome/Firefox compatibility - use browser API directly
  const api = typeof browser !== 'undefined' ? browser : chrome;
  
  api.storage.sync.get([
    'soundProfile',
    'soundType',
    'volume',
    'enableTTS',
    'voice',
    'announceAuctions',
    'announceStart',
    'announceEnd',
    'quietHours',
    'quietStart',
    'quietEnd',
    'smartBidding',
    'browserNotifications',
    'flashScreen',
    'darkMode',
    'raidTickEnabled',
    'raidTickFolder',
    'raidTickFolderHandle',
    'raidTickFiles',
    'raidTickFileList',
    'eqLogEnabled',
    'eqLogFile',
    'eqLogTag',
    'eqLogEvents'
  ], function(settings) {
    // Handle storage API errors gracefully
    if (api.runtime.lastError) {
      console.warn('Storage API error:', api.runtime.lastError.message);
      console.log('Using default settings for popup display');
      settings = {
        soundProfile: 'raidleader',
        soundType: 'bell',
        volume: 50,
        raidTickEnabled: false
      };
    }
    
    // Apply dark mode if enabled
    if (settings.darkMode) {
      document.body.classList.add('dark-mode');
      if (darkModeIcon) darkModeIcon.textContent = '🌙';
    }
    
    // Set mode icon based on current sound profile
    if (settings.soundProfile === 'raidleader') {
      if (modeIcon) modeIcon.textContent = '👑';
    } else {
      if (modeIcon) modeIcon.textContent = '⚔️';
    }
    
    // Initialize inline volume UI
    const vol = typeof settings.volume === 'number' ? settings.volume : 70;
    try {
      if (volumeSlider) volumeSlider.value = vol;
      if (volumePct) volumePct.textContent = `${vol}%`;
      if (volumeIcon) {
        volumeIcon.classList.remove('vol-dirty','vol-saved');
      }
    } catch(_) {}
    
    // Check if we're on an OpenDKP page - with timeout fallback
    let statusUpdated = false;
    const updateStatus = function(isOpenDKP) {
      if (statusUpdated) return; // Prevent multiple updates
      statusUpdated = true;
      
      if (statusDiv) {
        statusDiv.className = isOpenDKP ? 'status active' : 'status inactive';
      }
      if (statusText) {
        try {
          const statusHtml = buildStatusText(settings, isOpenDKP);
          statusText.innerHTML = statusHtml || '⚠️ Status unavailable';
        } catch (error) {
          console.error('Error building status text:', error);
          statusText.innerHTML = '⚠️ Status unavailable';
        }
      }
    };
    
    // Fallback: if tabs API doesn't respond in 2 seconds, default to inactive
    setTimeout(function() {
      if (!statusUpdated) {
        console.warn('Tabs API timeout - defaulting to inactive status');
        updateStatus(false);
      }
    }, 2000);
    
    api.tabs.query({active: true, currentWindow: true}, function(tabs) {
      // Handle errors or missing tabs gracefully
      if (api.runtime.lastError) {
        console.warn('Tabs API error:', api.runtime.lastError.message);
        updateStatus(false);
        return;
      }
      
      const currentTab = tabs && tabs[0];
      const isOpenDKP = currentTab && currentTab.url && currentTab.url.includes('opendkp.com');
      updateStatus(isOpenDKP);
    });
    
    // Initialize EQ Log parser for raid leaders (Chrome: displays inline in popup)
    const isRaidLeader = settings.soundProfile === 'raidleader';
    
    // Show/hide Loot Monitor button based on profile
    // Chrome: Show button to open monitor window (loot also displays inline in popup)
    if (openLootMonitorBtn) {
      if (isRaidLeader) {
        openLootMonitorBtn.style.display = 'inline-flex';
        openLootMonitorBtn.addEventListener('click', async function(){
          try {
            const win = await api.windows.create({ 
              url: api.runtime.getURL('eqlog-monitor.html'), 
              type: 'popup', 
              width: 520, 
              height: 360 
            });
            await api.storage.sync.set({ 
              eqLogMonitoring: true, 
              eqLogMonitorWindowId: win.id 
            });
          } catch (error) {
            console.error('Error opening loot monitor:', error);
            showStatus('Error opening loot monitor: ' + error.message, 'error');
          }
        });
      } else {
        openLootMonitorBtn.style.display = 'none';
      }
    }
    
    // Show/hide RaidTick button based on profile
    // Chrome: Show button only for Raid Leaders
    if (copyFromFileBtn) {
      if (isRaidLeader) {
        copyFromFileBtn.style.display = 'inline-flex';
      } else {
        copyFromFileBtn.style.display = 'none';
      }
    }
    
    if (isRaidLeader) {
      if (eqLogSection) {
        eqLogSection.style.display = 'none'; // Will be shown when events exist
      }
      // Will initialize after settings are processed
      setTimeout(() => {
        initializeEQLogParser(settings);
      }, 100);
    } else {
      if (eqLogSection) {
        eqLogSection.style.display = 'none';
      }
    }
    
    // Update quick actions text
    const infoDiv = document.querySelector('.info');
    if (infoDiv) {
      infoDiv.innerHTML = POPUP_QUICK_ACTIONS_TEXT.replace(/\n/g, '<br>');
    }
  });
  
  // Open options page
  if (openOptionsBtn) {
    openOptionsBtn.addEventListener('click', function() {
      api.runtime.openOptionsPage();
    });
  }
  
  // Dark mode toggle functionality
  if (darkModeToggle && darkModeIcon) {
    darkModeToggle.addEventListener('click', function() {
      const isDarkMode = document.body.classList.contains('dark-mode');
      
      if (isDarkMode) {
        // Switch to light mode
        document.body.classList.remove('dark-mode');
        darkModeIcon.textContent = '☀️';
        api.storage.sync.set({ darkMode: false });
        try { api.runtime.sendMessage({ type: 'darkModeChanged', value: false }); } catch(_) {}
      } else {
        // Switch to dark mode
        document.body.classList.add('dark-mode');
        darkModeIcon.textContent = '🌙';
        api.storage.sync.set({ darkMode: true });
        try { api.runtime.sendMessage({ type: 'darkModeChanged', value: true }); } catch(_) {}
      }
    });
  }
  
  // Mode toggle functionality (Raid Leader/Raider)
  if (modeToggle && modeIcon) {
    modeToggle.addEventListener('click', function() {
      const currentMode = modeIcon.textContent === '👑' ? 'raidleader' : 'raider';
      const newMode = currentMode === 'raidleader' ? 'raider' : 'raidleader';
      
      // Update icon
      modeIcon.textContent = newMode === 'raidleader' ? '👑' : '⚔️';
      
      // Update sound profile in storage
      api.storage.sync.set({ soundProfile: newMode }, function() {
        // Reload popup to reflect changes
        setTimeout(() => {
          location.reload();
        }, 100);
      });
    });
  }
  
  // Loot Monitor button - Chrome: Show/hide based on profile (loot also displays inline)
  // Button visibility is handled above in the profile check section
  
  // Copy From File button - Chrome: Open file picker to copy RaidTick file
  if (copyFromFileBtn) {
    copyFromFileBtn.title = 'Copy RaidTick file to clipboard';
    
    copyFromFileBtn.addEventListener('click', function() {
      // Ensure we have access to api and buildStatusText
      const browserApi = typeof browser !== 'undefined' ? browser : chrome;
      
      // Create file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.txt';
      input.style.display = 'none';
      document.body.appendChild(input);
      
      input.addEventListener('change', async function() {
        const file = input.files && input.files[0];
        if (!file) {
          document.body.removeChild(input);
          return;
        }
        
        try {
          // Read file content
          const content = await file.text();
          
          // Count data lines (excluding header)
          const lines = content.split('\n');
          const dataLines = lines.filter(line => 
            line.trim() && 
            !line.includes('RaidTick') && 
            !line.includes('Date:') && 
            !line.includes('Time:')
          );
          const lineCount = dataLines.length;
          
          // Copy to clipboard - use execCommand as fallback for better focus handling
          // Chrome requires user gesture or focused window for clipboard access
          try {
            // Try modern clipboard API first
            await navigator.clipboard.writeText(content);
          } catch (clipError) {
            // Fallback: Use legacy execCommand (works better with file picker)
            console.log('Clipboard API failed, using execCommand fallback:', clipError.message);
            const textArea = document.createElement('textarea');
            textArea.value = content;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
              const successful = document.execCommand('copy');
              if (!successful) {
                throw new Error('execCommand copy failed');
              }
            } finally {
              document.body.removeChild(textArea);
            }
          }
          
          // Show success message in notification area
          if (statusText && statusDiv) {
            const originalStatus = statusText.innerHTML;
            statusDiv.className = 'status success';
            statusText.innerHTML = `✅ File copied to clipboard!<br><small>${escapeHtml(String(lineCount))} lines copied (excluding header)</small>`;
            
            // Restore original status after 3 seconds
            setTimeout(() => {
              if (statusText && statusDiv) {
                browserApi.tabs.query({active: true, currentWindow: true}, function(tabs) {
                  if (tabs && tabs[0]) {
                    const url = tabs[0].url || '';
                    const isOpenDKP = url.includes('opendkp.com');
                    if (isOpenDKP) {
                      statusDiv.className = 'status active';
                    } else {
                      statusDiv.className = 'status inactive';
                    }
                    browserApi.storage.sync.get([
                      'soundProfile', 'soundType', 'volume', 'enableTTS', 'voice',
                      'announceAuctions', 'announceStart', 'announceEnd',
                      'quietHours', 'quietStart', 'quietEnd', 'eqLogTag'
                    ], function(settings) {
                      statusText.innerHTML = buildStatusText(settings, isOpenDKP);
                    });
                  }
                });
              }
            }, 3000);
          }
        } catch (error) {
          console.error('Error reading or copying file:', error);
          if (statusText && statusDiv) {
            statusDiv.className = 'status error';
            statusText.innerHTML = '❌ Failed to copy file: ' + escapeHtml(error.message);
            setTimeout(() => {
              if (statusText && statusDiv) {
                browserApi.tabs.query({active: true, currentWindow: true}, function(tabs) {
                  if (tabs && tabs[0]) {
                    const url = tabs[0].url || '';
                    const isOpenDKP = url.includes('opendkp.com');
                    if (isOpenDKP) {
                      statusDiv.className = 'status active';
                    } else {
                      statusDiv.className = 'status inactive';
                    }
                    browserApi.storage.sync.get([
                      'soundProfile', 'soundType', 'volume', 'enableTTS', 'voice',
                      'announceAuctions', 'announceStart', 'announceEnd',
                      'quietHours', 'quietStart', 'quietEnd', 'eqLogTag'
                    ], function(settings) {
                      statusText.innerHTML = buildStatusText(settings, isOpenDKP);
                    });
                  }
                });
              }
            }, 3000);
          }
          document.body.removeChild(input);
        }
      }, { once: true });
      
      // Trigger file picker
      input.click();
    });
  }
  
  // Refresh popup (if button exists)
  if (refreshPopupBtn) {
    refreshPopupBtn.addEventListener('click', function() {
      console.log('Manual refresh requested');
      location.reload();
    });
  }
  
  // Inline volume behavior
  if (volumeSlider && volumeIcon && volumePct) {
    let unsaved = false;
    let lastSaved = null;
    
    // Load current saved value for comparison
    try {
      api.storage.sync.get(['volume'], function(s) {
        lastSaved = (typeof s.volume === 'number') ? s.volume : 70;
      });
    } catch(_) {}
    
    volumeSlider.addEventListener('input', function() {
      const v = parseInt(volumeSlider.value, 10) || 0;
      volumePct.textContent = `${v}%`;
      unsaved = true;
      volumeIcon.classList.add('vol-dirty');
      volumeIcon.classList.remove('vol-saved');
    });
    
    volumeIcon.addEventListener('click', function() {
      if (!unsaved) return;
      const v = parseInt(volumeSlider.value, 10) || 0;
      
      // Save the current status so we can restore it properly
      const originalStatus = statusText ? statusText.innerHTML : '';
      const originalStatusClass = statusDiv ? statusDiv.className : '';
      
      // Immediate user feedback
      if (statusDiv && statusText) {
        statusDiv.className = 'status success';
        statusText.innerHTML = '✅ Volume setting saved';
      }
      
      // Persist setting
      api.storage.sync.set({ volume: v }, function() {
        if (api.runtime.lastError) {
          console.error('Failed to save volume:', api.runtime.lastError);
          if (statusDiv && statusText) {
            statusDiv.className = 'status error';
            statusText.textContent = '❌ Failed to save volume';
          }
        } else {
          lastSaved = v;
          unsaved = false;
          volumeIcon.classList.remove('vol-dirty');
          volumeIcon.classList.add('vol-saved');
          setTimeout(() => volumeIcon.classList.remove('vol-saved'), 1200);
          
          // After showing success message, update status with new volume (don't reload)
          setTimeout(() => {
            // Refresh status with updated volume, but use the saved value we just set
            api.storage.sync.get(['soundProfile', 'soundType', 'enableTTS', 'voice', 'announceAuctions', 'announceStart', 'announceEnd', 'quietHours', 'quietStart', 'quietEnd', 'eqLogTag'], function(settings) {
              // Use the volume we just saved
              settings.volume = v;
              
              // Check if we're on OpenDKP page
              api.tabs.query({active: true, currentWindow: true}, function(tabs) {
                const currentTab = tabs && tabs[0];
                const isOpenDKP = currentTab && currentTab.url && currentTab.url.includes('opendkp.com');
                
                // Update status display with new volume
                if (statusDiv) {
                  statusDiv.className = isOpenDKP ? 'status active' : 'status inactive';
                }
                if (statusText) {
                  try {
                    const statusHtml = buildStatusText(settings, isOpenDKP);
                    statusText.innerHTML = statusHtml || '⚠️ Status unavailable';
                  } catch (error) {
                    console.error('Error building status text:', error);
                    statusText.innerHTML = '⚠️ Status unavailable';
                  }
                }
              });
            });
          }, 1500);
        }
      });
    });
  }
  
  // Listen for storage changes to refresh popup
  api.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'sync') {
      console.log('Storage changed, refreshing popup...');
      
      // Handle dark mode changes
      if (changes.darkMode) {
        if (changes.darkMode.newValue) {
          document.body.classList.add('dark-mode');
          if (darkModeIcon) darkModeIcon.textContent = '🌙';
        } else {
          document.body.classList.remove('dark-mode');
          if (darkModeIcon) darkModeIcon.textContent = '☀️';
        }
      }
      
      // Handle sound profile changes (mode toggle)
      if (changes.soundProfile) {
        const newProfile = changes.soundProfile.newValue;
        const isRaidLeader = newProfile === 'raidleader';
        
        if (modeIcon) {
          modeIcon.textContent = isRaidLeader ? '👑' : '⚔️';
        }
        
        // Show/hide RaidTick button based on profile
        if (copyFromFileBtn) {
          copyFromFileBtn.style.display = isRaidLeader ? 'inline-flex' : 'none';
        }
        
        // Show/hide Loot Monitor button based on profile
        if (openLootMonitorBtn) {
          openLootMonitorBtn.style.display = isRaidLeader ? 'inline-flex' : 'none';
        }
        
        // Reload to show updated status
        setTimeout(() => {
          location.reload();
        }, 100);
      }
      
      // Handle volume changes
      if (changes.volume) {
        const newVolume = changes.volume.newValue;
        if (volumeSlider) volumeSlider.value = newVolume;
        if (volumePct) volumePct.textContent = `${newVolume}%`;
        if (volumeIcon) {
          volumeIcon.classList.remove('vol-dirty', 'vol-saved');
        }
        // Update status with new volume without reloading (to avoid flicker)
        // Only update if status isn't currently showing a save message
        setTimeout(() => {
          const statusTextEl = document.getElementById('statusText');
          if (statusTextEl && !statusTextEl.innerHTML.includes('Volume setting saved')) {
            api.storage.sync.get(['soundProfile', 'soundType', 'enableTTS', 'voice', 'announceAuctions', 'announceStart', 'announceEnd', 'quietHours', 'quietStart', 'quietEnd', 'eqLogTag'], function(settings) {
              settings.volume = newVolume;
              
              // Check if we're on OpenDKP page
              api.tabs.query({active: true, currentWindow: true}, function(tabs) {
                const currentTab = tabs && tabs[0];
                const isOpenDKP = currentTab && currentTab.url && currentTab.url.includes('opendkp.com');
                
                // Update status display with new volume
                const statusDivEl = document.getElementById('status');
                const statusTextEl = document.getElementById('statusText');
                if (statusDivEl) {
                  statusDivEl.className = isOpenDKP ? 'status active' : 'status inactive';
                }
                if (statusTextEl) {
                  try {
                    const statusHtml = buildStatusText(settings, isOpenDKP);
                    statusTextEl.innerHTML = statusHtml || '⚠️ Status unavailable';
                  } catch (error) {
                    console.error('Error building status text:', error);
                    statusTextEl.innerHTML = '⚠️ Status unavailable';
                  }
                }
              });
            });
          }
        }, 100);
      }
      
      // Handle other general settings changes
      if (changes.soundType || changes.enableTTS || changes.smartBidding) {
        setTimeout(() => {
          location.reload();
        }, 100);
      }
    }
  });
  
  /**
   * EQ Log Parser variables
   * Initialize early to avoid "before initialization" errors
   */
  let eqLogSettings = {
    enabled: false,
    fileHandle: null,
    tag: 'FG',
    events: [],
    monitoring: false
  };
  
  /**
   * Initialize EQ Log Parser (Chrome: displays inline in popup)
   */
  async function initializeEQLogParser(settings) {
    console.log('[EQ Log Init] Initializing EQ Log Parser (Chrome inline)...');
    
    // Load saved events and tag from storage
    api.storage.sync.get(['eqLogEvents', 'eqLogTag', 'eqLogMonitoring'], function(storedData) {
      console.log('[EQ Log Init] Loaded from storage:', {
        eventsCount: storedData.eqLogEvents?.length || 0,
        tag: storedData.eqLogTag || 'not set',
        monitoring: storedData.eqLogMonitoring || false,
        sampleEvents: storedData.eqLogEvents?.slice(0, 3).map(e => ({ date: e.date, items: e.items?.length || 0, timestamp: e.timestamp })) || []
      });
      
      eqLogSettings = {
        enabled: settings.soundProfile === 'raidleader',
        fileHandle: null,
        tag: (storedData.eqLogTag || settings.eqLogTag || 'FG').trim(),
        events: storedData.eqLogEvents || [],
        monitoring: storedData.eqLogMonitoring || false
      };
      
      console.log('[EQ Log Init] Initialized eqLogSettings:', {
        enabled: eqLogSettings.enabled,
        tag: eqLogSettings.tag,
        eventsCount: eqLogSettings.events.length,
        monitoring: eqLogSettings.monitoring
      });
      
      // Update tag input if exists
      if (eqLogTag) {
        eqLogTag.value = eqLogSettings.tag;
        eqLogTag.addEventListener('change', function() {
          eqLogSettings.tag = this.value.trim() || 'FG';
          api.storage.sync.set({ eqLogTag: eqLogSettings.tag });
        });
      }
      
      // Check and clear old events
      checkAndClearOldEvents();
      
      // Load and display existing events
      console.log('[EQ Log Init] Calling displayEQLogEvents()...');
      displayEQLogEvents();
      
      // Listen for storage changes (background script updates and monitor window status)
      api.storage.onChanged.addListener(function(changes, namespace) {
        if (namespace === 'sync') {
          if (changes.eqLogEvents) {
            console.log('[EQ Log Storage] eqLogEvents updated, refreshing list', changes.eqLogEvents.newValue?.length || 0, 'events');
            eqLogSettings.events = changes.eqLogEvents.newValue || [];
            // Always call displayEQLogEvents to update UI (it will hide section if not monitoring and no events)
            displayEQLogEvents();
          }
          // Update monitoring status when monitor window is opened/closed
          if (changes.eqLogMonitoring) {
            console.log('[EQ Log Storage] Monitoring status changed:', changes.eqLogMonitoring.newValue);
            eqLogSettings.monitoring = changes.eqLogMonitoring.newValue || false;
            // Refresh display to show/hide section based on monitoring status
            displayEQLogEvents();
          }
        }
      });
    });
  }
  
  /**
   * Display EQ Log events (Chrome: inline in popup)
   */
  function displayEQLogEvents() {
    console.log('[EQ Log Display] ===== displayEQLogEvents() called =====');
    
    if (!eqLogEvents) {
      console.error('[EQ Log Display] ❌ eventsContainer not found - element #eqLogEvents missing!');
      return;
    }
    console.log('[EQ Log Display] ✅ eventsContainer found');
    
    if (!eqLogSection) {
      console.error('[EQ Log Display] ❌ eqSection not found - element #eqLogSection missing!');
      return;
    }
    console.log('[EQ Log Display] ✅ eqSection found, current display:', eqLogSection.style.display);
    
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
    
    // Filter to today's events
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
      .reverse(); // Newest first
    
    console.log('[EQ Log Display] Today\'s events:', todaysEvents.length);
    if (todaysEvents.length > 0) {
      console.log('[EQ Log Display] First event:', { id: todaysEvents[0].id, items: todaysEvents[0].items?.length || 0, timestamp: todaysEvents[0].timestamp });
    }
    
    if (todaysEvents.length === 0) {
      eqLogEvents.innerHTML = '<div class="empty-state">No loot events captured yet.</div>';
      // Hide section when there are no events AND not monitoring
      const isRaidLeader = eqLogSection.getAttribute('data-raid-leader') === 'true';
      const isMonitoring = eqLogSettings.monitoring || false;
      // Only show section if actively monitoring, otherwise hide it
      if (isRaidLeader && isMonitoring) {
        // Keep section visible but show empty state when monitoring
        eqLogSection.style.display = 'block';
      } else {
        // Hide section when not monitoring and no events
        eqLogSection.style.display = 'none';
      }
      console.log('[EQ Log Display] No events today, monitoring:', eqLogSettings.monitoring);
      return;
    }
    
    // Always show section when events exist
    eqLogSection.style.display = 'block';
    // Ensure it's marked as raid leader section if events exist
    if (eqLogSection.getAttribute('data-raid-leader') !== 'true') {
      eqLogSection.setAttribute('data-raid-leader', 'true');
    }
    
    // Limit to 50 most recent events
    const displayEvents = todaysEvents.slice(0, 50);
    
    const eventsHtml = displayEvents.map(event => createEventGroup(event)).join('');
    eqLogEvents.innerHTML = eventsHtml;
    
    // Add event listeners for copy and delete buttons
    eqLogEvents.querySelectorAll('.eq-log-item-copy').forEach(btn => {
      btn.addEventListener('click', function() {
        const itemText = this.dataset.item;
        copyItemToClipboard(itemText);
      });
    });
    
    eqLogEvents.querySelectorAll('.eq-log-event-close').forEach(btn => {
      btn.addEventListener('click', function() {
        const eventId = this.dataset.eventId;
        deleteEventGroup(eventId);
      });
    });
  }
  
  /**
   * Create HTML for an event group
   */
  function createEventGroup(event) {
    const itemsHtml = event.items.map((item, index) => 
      createItemButton(item, event.id, index)
    ).join('');
    
    const eventId = escapeHtmlAttr(String(event.id));
    const timestamp = escapeHtml(event.timestamp || '');
    
    return `
      <div class="eq-log-event" data-event-id="${eventId}">
        <div class="eq-log-event-header">
          <span class="eq-log-event-timestamp">${timestamp}</span>
          <button class="eq-log-event-close" data-event-id="${eventId}" title="Remove">×</button>
        </div>
        <div class="eq-log-items">
          ${itemsHtml}
        </div>
      </div>
    `;
  }
  
  /**
   * Create HTML for an item copy button
   */
  function createItemButton(item, eventId, itemIndex) {
    const escapedItem = escapeHtml(item);
    const escapedItemAttr = escapeHtmlAttr(item);
    const escapedEventId = escapeHtmlAttr(String(eventId));
    
    return `
      <div class="eq-log-item">
        <span class="eq-log-item-name">${escapedItem}</span>
        <button class="btn btn-small eq-log-item-copy" data-item="${escapedItemAttr}" data-event-id="${escapedEventId}">Copy</button>
      </div>
    `;
  }
  
  /**
   * Copy item to clipboard
   */
  function copyItemToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      console.log('Item copied to clipboard:', text);
      if (statusDiv && statusText) {
        const originalStatus = statusText.innerHTML;
        statusDiv.className = 'status success';
        statusText.innerHTML = `
          ✅ Item copied to clipboard!<br>
          <small>${escapeHtml(text)}</small>
        `;
        setTimeout(() => {
          statusDiv.className = originalStatus.includes('OpenDKP') ? 'status active' : 'status inactive';
          statusText.innerHTML = originalStatus;
        }, 2000);
      }
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
      await new Promise((resolve, reject) => {
        api.storage.sync.set({ eqLogEvents: eqLogSettings.events }, function() {
          if (api.runtime.lastError) {
            reject(new Error(api.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Error saving EQ log events:', error);
    }
  }
  
  /**
   * Format date as YYYY-MM-DD (using local time to avoid UTC day shifting)
   * Used by EQ Log parser for date filtering
   */
  function formatDate(date) {
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) {
      console.error('Invalid date format:', date);
      return 'Invalid Date';
    }
    // Build YYYY-MM-DD using LOCAL time components
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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
}

// Initialize when DOM is ready or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePopup);
} else {
  // DOM already loaded, initialize immediately
  initializePopup();
}
