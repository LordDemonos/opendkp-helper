/**
 * OpenDKP Helper - Options Page Script
 * 
 * Handles settings management, sound testing, and configuration
 */

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

// Default settings
const api = typeof browser !== 'undefined' ? browser : chrome;

// Local helper for audio element creation (works even if downstream helper is unavailable)
function createWarcraftAudio(filename) {
  try {
    const url = api && api.runtime && api.runtime.getURL ? api.runtime.getURL(filename) : filename;
    const audio = new Audio(url);
    return Promise.resolve(audio);
  } catch (e) {
    return Promise.reject(e);
  }
}
// IndexedDB (cross-browser) for persisting custom sounds
let __soundsDBPromise = null;
function openSoundsDB() {
  if (__soundsDBPromise) return __soundsDBPromise;
  __soundsDBPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('opendkp-sounds', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sounds')) {
        db.createObjectStore('sounds', { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return __soundsDBPromise;
}
async function saveSoundToDB(name, arrayBuffer, mimeType) {
  const db = await openSoundsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sounds', 'readwrite');
    // Store as Blob to avoid structured-clone issues across browsers
    let blob;
    try {
      const ab = arrayBuffer && arrayBuffer.slice ? arrayBuffer.slice(0) : arrayBuffer; // defensive copy
      blob = (ab instanceof Blob) ? ab : new Blob([ab], { type: mimeType || 'application/octet-stream' });
    } catch (_) {
      try { blob = new Blob([arrayBuffer]); } catch { blob = null; }
    }
    tx.objectStore('sounds').put({ name, data: blob, type: mimeType || 'application/octet-stream' });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function listSoundsFromDB() {
  const db = await openSoundsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sounds', 'readonly');
    const req = tx.objectStore('sounds').getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function getSoundFromDB(name) {
  const db = await openSoundsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sounds', 'readonly');
    const req = tx.objectStore('sounds').get(name);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function deleteSoundFromDB(name) {
  const db = await openSoundsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sounds', 'readwrite');
    const req = tx.objectStore('sounds').delete(name);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
async function listSoundRecordsFromDB() {
  const db = await openSoundsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sounds', 'readonly');
    const req = tx.objectStore('sounds').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
const DEFAULT_SETTINGS = {
  enableTTS: false,
  voice: 'Zira', // Default to Zira voice
  voiceSpeed: 1.0,
  enableAdvancedTTS: false,
  ttsTemplate: 'Auction Finished. {winner} for {bidAmount} DKP on {itemName}',
  volume: 70,
  soundType: 'bell', // Default to bell for raid leader
  soundProfile: 'raidleader', // Default to raid leader profile
  raidleaderSound: 'bell', // Default sound for raid leader profile
  raiderSound: 'chime', // Default sound for raider profile
  raidLeaderNotification: true, // New setting for browser notification
  smartBidding: false, // Will be enabled automatically for raider profile
  customSounds: {}, // Custom uploaded sounds
  quietHours: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  // Auction readout defaults
  announceAuctions: false,
  announceStart: '19:00',
  announceEnd: '23:59',
  disableVisuals: false,
  flashScreen: true,
  browserNotifications: true,
  checkInterval: 100,
  // RaidTick Integration settings
  raidTickEnabled: false,
  raidTickFolder: '',
  raidTickFolderHandle: null,
  raidTickFiles: [],
  raidTickFileList: [],
  // RaidTick Reminders
  reminders: [],
  reminderPrefs: { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] } // All days enabled by default (0=Sunday, 6=Saturday)
};

// Sound options with their implementations
const SOUND_OPTIONS = {
  chime: {
    name: 'Chime',
    generate: () => (typeof generateRealWarcraftSound === 'function' ? generateRealWarcraftSound('hotel.mp3') : createWarcraftAudio('hotel.mp3')),
    description: 'Hotel bell chime'
  },
  bell: {
    name: 'Bell',
    generate: () => (typeof generateRealWarcraftSound === 'function' ? generateRealWarcraftSound('bell.mp3') : createWarcraftAudio('bell.mp3')),
    description: 'Clear bell sound'
  },
  ding: {
    name: 'Ding',
    generate: () => (typeof generateRealWarcraftSound === 'function' ? generateRealWarcraftSound('ding1.mp3') : createWarcraftAudio('ding1.mp3')),
    description: 'Classic ding sound'
  },
  ding2: {
    name: 'Ding 2',
    generate: () => (typeof generateRealWarcraftSound === 'function' ? generateRealWarcraftSound('ding2.mp3') : createWarcraftAudio('ding2.mp3')),
    description: 'Alternative ding sound'
  },
  ding3: {
    name: 'Ding 3',
    generate: () => (typeof generateRealWarcraftSound === 'function' ? generateRealWarcraftSound('ding3.mp3') : createWarcraftAudio('ding3.mp3')),
    description: 'Third ding variation'
  },
  ding4: {
    name: 'Ding 4',
    generate: () => (typeof generateRealWarcraftSound === 'function' ? generateRealWarcraftSound('ding4.mp3') : createWarcraftAudio('ding4.mp3')),
    description: 'Fourth ding variation'
  },
  jobsDone: {
    name: 'Job\'s Done!',
    generate: () => (typeof generateRealWarcraftSound === 'function' ? generateRealWarcraftSound('jobsdone.mp3') : createWarcraftAudio('jobsdone.mp3')),
    description: 'Warcraft'
  },
  workComplete: {
    name: 'Work Complete!',
    generate: () => (typeof generateRealWarcraftSound === 'function' ? generateRealWarcraftSound('workcomplete.mp3') : createWarcraftAudio('workcomplete.mp3')),
    description: 'Warcraft'
  },
  custom: {
    name: 'Custom',
    generate: () => generateCustomSound(),
    description: 'Your uploaded sound'
  }
};

// Profile-specific sound mappings
const PROFILE_SOUNDS = {
  raider: {
    default: 'chime',
    sounds: ['chime', 'ding', 'ding2', 'ding3', 'ding4', 'bell', 'jobsDone', 'workComplete'],
    description: 'Gentle sounds for regular raiders'
  },
  raidleader: {
    default: 'bell',
    sounds: ['bell', 'chime', 'ding', 'ding2', 'ding3', 'ding4', 'jobsDone', 'workComplete'],
    description: 'Authoritative sounds for raid leaders'
  }
};

let currentSettings = { ...DEFAULT_SETTINGS };
let audioContext = null;
let customSoundBuffer = null;
let customSoundName = '';
let lastUploadedArrayBuffer = null;
let lastUploadedBlob = null;
let lastUploadedType = 'application/octet-stream';
let lastUploadedOriginalName = '';

// Listen for popup debug messages
if (typeof browser !== 'undefined') {
  browser.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.type === 'popup-debug') {
      console.log('Popup debug message:', message.data);
      console.log('RaidTick files count:', message.data.raidTickFileList ? message.data.raidTickFileList.length : 0);
      if (message.data.raidTickFileList && message.data.raidTickFileList.length > 0) {
        console.log('First file:', message.data.raidTickFileList[0]);
        console.log('File date:', message.data.raidTickFileList[0].date);
        console.log('Formatted date:', new Date(message.data.raidTickFileList[0].date).toISOString().split('T')[0]);
      }
    } else if (message.type === 'popup-error') {
      console.error('Popup error message:', message.data);
    }
  });
}

// Initialize the options page
document.addEventListener('DOMContentLoaded', function() {
  initializePage();
  loadSettings();
  setupEventListeners();
  
  // Firefox-specific adjustments: use direct file copy tool instead of folder scanning
  try {
    const isFirefox = (typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox'));
    if (isFirefox) {
      // Firefox: Show pop-out window UI
      const ffAlt = document.getElementById('ffRaidTickAlt');
      const ffWindow = document.getElementById('ffRaidTickWindow');
      if (ffAlt) ffAlt.style.display = 'none';
      if (ffWindow) ffWindow.style.display = 'block';

      // Firefox: Set up "Copy RaidTick from file" button (opens pop-out window)
      const ffCopyBtnWindow = document.getElementById('ffCopyFromFileWindow');
      if (ffCopyBtnWindow) {
        ffCopyBtnWindow.addEventListener('click', function() {
          try {
            if (typeof browser !== 'undefined' && browser.windows && browser.runtime) {
              browser.windows.create({
                url: browser.runtime.getURL('copy-window.html'),
                type: 'popup', width: 420, height: 220
              });
            } else {
              // Fallback: use inline picker
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.txt';
              input.style.display = 'none';
              document.body.appendChild(input);
              input.click();
              input.onchange = function(e) {
                const file = e.target.files[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = function(e) {
                    navigator.clipboard.writeText(e.target.result).then(() => {
                      showStatus('Copied to clipboard!', 'success');
                    });
                  };
                  reader.readAsText(file);
                }
                document.body.removeChild(input);
              };
            }
          } catch (error) {
            console.error('Error opening copy window:', error);
            showStatus('Error opening file picker: ' + error.message, 'error');
          }
        });
      }

      // Firefox: Loot monitor description + button
      const ffLoot = document.getElementById('ffLootExplain');
      if (ffLoot) ffLoot.style.display = 'block';
      const ffOpenLootBtn = document.getElementById('ffOpenLootMonitor');
      if (ffOpenLootBtn) {
        ffOpenLootBtn.addEventListener('click', async function(){
          try {
            if (typeof browser !== 'undefined' && browser.windows && browser.runtime) {
              const win = await browser.windows.create({ 
                url: browser.runtime.getURL('eqlog-monitor.html'), 
                type: 'popup', 
                width: 520, 
                height: 360 
              });
              await browser.storage.sync.set({ 
                eqLogMonitoring: true, 
                eqLogMonitorWindowId: win.id 
              });
            } else {
              showStatus('Error: Firefox API not available', 'error');
            }
          } catch (error) {
            console.error('Error opening loot monitor:', error);
            showStatus('Error opening loot monitor: ' + error.message, 'error');
          }
        });
      }
    } else {
      // Chrome/Edge: Show file copy button (same UI as Firefox, but different implementation)
      const ffAlt = document.getElementById('ffRaidTickAlt');
      const ffWindow = document.getElementById('ffRaidTickWindow');
      if (ffAlt) ffAlt.style.display = 'block';
      if (ffWindow) ffWindow.style.display = 'none';

      const ffCopyBtn = document.getElementById('ffCopyFromFile');
      if (ffCopyBtn) {
        ffCopyBtn.addEventListener('click', function() {
          // Chrome: Use direct file picker (same function as popup button)
          copyRaidTickFileFromPicker();
        });
      }

      // Chrome: Loot monitor description + button (can use same monitor window as Firefox)
      const ffLoot = document.getElementById('ffLootExplain');
      if (ffLoot) ffLoot.style.display = 'block';
      const ffOpenLootBtn = document.getElementById('ffOpenLootMonitor');
      if (ffOpenLootBtn) {
        ffOpenLootBtn.addEventListener('click', async function(){
          try {
            // Chrome: Use chrome API (should work for both Chrome and Firefox, but we're in Chrome branch)
            if (typeof chrome !== 'undefined' && chrome.windows && chrome.runtime) {
              const win = await chrome.windows.create({ 
                url: chrome.runtime.getURL('eqlog-monitor.html'), 
                type: 'popup', 
                width: 520, 
                height: 360 
              });
              await chrome.storage.sync.set({ 
                eqLogMonitoring: true, 
                eqLogMonitorWindowId: win.id 
              });
            } else {
              showStatus('Error: Chrome API not available', 'error');
            }
          } catch (error) {
            console.error('Error opening loot monitor:', error);
            showStatus('Error opening loot monitor: ' + error.message, 'error');
          }
        });
      }
    }
  } catch (e) { /* ignore */ }

  // Check for dark mode setting and apply it (robust across browsers)
  try {
    if (api && api.storage && api.storage.sync) {
      // Support both Promise (Firefox) and callback (Chrome)
      const getter = api.storage.sync.get(['darkMode']);
      if (getter && typeof getter.then === 'function') {
        getter.then(result => { 
          if (result.darkMode) document.body.classList.add('dark-mode');
          // Re-render reminders after dark mode is applied
          setTimeout(() => { try { renderRemindersUI(); } catch(_) {} }, 0);
        });
      } else {
        api.storage.sync.get(['darkMode'], function(result){ 
          if (result.darkMode) document.body.classList.add('dark-mode');
          // Re-render reminders after dark mode is applied
          setTimeout(() => { try { renderRemindersUI(); } catch(_) {} }, 0);
        });
      }
    }
  } catch (_) {}

  // Listen for dark mode changes from popup
  (api && api.storage ? api.storage : chrome.storage).onChanged.addListener(function(changes, namespace) {
    if (namespace === 'sync' && changes.darkMode) {
      if (changes.darkMode.newValue) {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
      // Re-render reminders to update colors
      try { renderRemindersUI(); } catch(_) {}
    }
    
    // Listen for sound profile changes from popup
    if (namespace === 'sync' && changes.soundProfile) {
      const newProfile = changes.soundProfile.newValue;
      const soundProfileSelect = document.getElementById('soundProfile');
      if (soundProfileSelect && soundProfileSelect.value !== newProfile) {
        soundProfileSelect.value = newProfile;
        updateSoundProfile(); // Update the sound options
        // Ensure custom sounds are added after profile changes
        updateCustomSoundOptions();
      }
    }
  });

  // Also listen for runtime messages (immediate UI sync from popup)
  try {
    (api && api.runtime ? api.runtime : chrome.runtime).onMessage.addListener(function(message) {
      if (message && message.type === 'darkModeChanged') {
        if (message.value) {
          document.body.classList.add('dark-mode');
        } else {
          document.body.classList.remove('dark-mode');
        }
        // Re-render reminders to update colors
        try { renderRemindersUI(); } catch(_) {}
      }
    });
  } catch (_) {}
  
  // Load voices when page loads
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadVoices;
  } else {
    loadVoices(); // Fallback for browsers that don't support onvoiceschanged
  }
});

/**
 * Load available voices for TTS
 */
function loadVoices() {
  const voiceSelect = document.getElementById('voice');
  const voices = speechSynthesis.getVoices();
  
  // Clear existing options (no default entry)
  voiceSelect.innerHTML = '';
  
  // Filter to only show the most useful voices
  const usefulVoices = voices.filter(voice => {
    // Only English voices
    if (!voice.lang.startsWith('en')) return false;
    
    // Skip duplicates and variations
    const name = voice.name.toLowerCase();
    // Skip desktop, mobile, and enhanced versions (prefer standard versions)
    if (name.includes('desktop')) return false;
    if (name.includes('mobile')) return false;
    if (name.includes('enhanced')) return false;
    
    // Only keep the main voices
    return name.includes('zira') || name.includes('david') || name.includes('mark') || 
           name.includes('hazel') || name.includes('susan') || name.includes('richard');
  });
  
  // Remove duplicates by base name (e.g., "Microsoft Zira" and "Microsoft Zira Desktop" become just "Microsoft Zira")
  const uniqueVoices = [];
  const seenBaseNames = new Set();
  
  // First, collect non-desktop versions
  usefulVoices.forEach(voice => {
    const baseName = voice.name.replace(/\s*-\s*English.*$/i, '').replace(/\s*Desktop.*$/i, '').trim();
    if (!seenBaseNames.has(baseName)) {
      seenBaseNames.add(baseName);
      uniqueVoices.push(voice);
    }
  });
  
  // If Zira wasn't found (only desktop version exists), add it
  const hasZira = uniqueVoices.some(v => v.name.toLowerCase().includes('zira'));
  if (!hasZira) {
    const desktopZira = voices.find(v => v.name.toLowerCase().includes('zira') && v.lang.startsWith('en'));
    if (desktopZira) {
      uniqueVoices.push(desktopZira);
    }
  }
  
  // Add filtered voices
  uniqueVoices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.name;
    option.textContent = voice.name; // Just show the name, not the language code
    voiceSelect.appendChild(option);
  });
  
  console.log('Loaded voices:', uniqueVoices.length, 'out of', voices.length);

  // Restore saved selection if available, or default to Zira if not found
  try {
    if (currentSettings && typeof currentSettings.voice !== 'undefined') {
      const savedVoice = currentSettings.voice || 'Zira';
      // Try to find the saved voice or fallback to Zira
      const foundVoice = Array.from(voiceSelect.options).find(o => o.value === savedVoice || o.value.toLowerCase().includes('zira'));
      if (foundVoice) {
        voiceSelect.value = foundVoice.value;
      } else {
        // If saved voice not found, try to find Zira
        const ziraVoice = Array.from(voiceSelect.options).find(o => o.value.toLowerCase().includes('zira'));
        if (ziraVoice) {
          voiceSelect.value = ziraVoice.value;
          currentSettings.voice = ziraVoice.value;
        } else if (voiceSelect.options.length > 0) {
          // Fallback to first available voice
          voiceSelect.value = voiceSelect.options[0].value;
          currentSettings.voice = voiceSelect.options[0].value;
        }
      }
    } else {
      // No saved voice, default to Zira
      const ziraVoice = Array.from(voiceSelect.options).find(o => o.value.toLowerCase().includes('zira'));
      if (ziraVoice) {
        voiceSelect.value = ziraVoice.value;
        currentSettings.voice = ziraVoice.value;
      } else if (voiceSelect.options.length > 0) {
        voiceSelect.value = voiceSelect.options[0].value;
        currentSettings.voice = voiceSelect.options[0].value;
      }
    }
  } catch (_) {}
}

/**
 * Update TTS settings visibility
 */
function updateTTSSettings() {
  preserveScrollPosition(() => {
  const enableTTS = document.getElementById('enableTTS').checked;
  const ttsSettings = document.getElementById('ttsSettings');
  const ttsSpeedSettings = document.getElementById('ttsSpeedSettings');
  const ttsAdvancedSettings = document.getElementById('ttsAdvancedSettings');
  const ttsTemplateSettings = document.getElementById('ttsTemplateSettings');
  const announceRow = document.getElementById('announceRow');
  const announceHeading = document.getElementById('announceHeading');
  const announceDesc = document.getElementById('announceDesc');
  
  if (enableTTS) {
    ttsSettings.style.display = 'block';
    ttsSpeedSettings.style.display = 'block';
    ttsAdvancedSettings.style.display = 'block';
    loadVoices(); // Load voices when TTS is enabled
    
    // Show/hide template settings based on advanced TTS
    updateAdvancedTTSSettings();
    // Show announce controls when TTS enabled
    updateAnnounceSettings();
    if (announceRow) announceRow.style.display = 'flex';
    if (announceHeading) announceHeading.style.display = 'block';
    if (announceDesc) announceDesc.style.display = 'block';
  } else {
    ttsSettings.style.display = 'none';
    ttsSpeedSettings.style.display = 'none';
    ttsAdvancedSettings.style.display = 'none';
    ttsTemplateSettings.style.display = 'none';
    // Hide announce controls when TTS disabled
    const row = document.getElementById('announceWindow');
    const chk = document.getElementById('announceAuctions');
    if (row) row.style.display = 'none';
    if (announceRow) announceRow.style.display = 'none';
    if (announceHeading) announceHeading.style.display = 'none';
    if (announceDesc) announceDesc.style.display = 'none';
    if (chk) chk.checked = false;
  }
  }); // Close preserveScrollPosition wrapper
}

/**
 * Update advanced TTS settings visibility
 */
function updateAdvancedTTSSettings() {
  const enableAdvancedTTS = document.getElementById('enableAdvancedTTS').checked;
  const ttsTemplateSettings = document.getElementById('ttsTemplateSettings');
  
  if (enableAdvancedTTS) {
    ttsTemplateSettings.style.display = 'block';
  } else {
    ttsTemplateSettings.style.display = 'none';
  }
}

/**
 * Test TTS voice
 */
function testTTSVoice() {
  const enableTTS = document.getElementById('enableTTS').checked;
  if (!enableTTS) {
    showStatus('Please enable Text-to-Speech first', 'error');
    return;
  }
  
  const voiceName = document.getElementById('voice').value;
  const voiceSpeed = parseFloat(document.getElementById('voiceSpeed').value);
  
  // Generate message using custom template if advanced TTS is enabled
  let message = 'Auction Finished. TestPlayer for 1000 DKP on Epic Sword';
  
  if (document.getElementById('enableAdvancedTTS').checked) {
    const template = document.getElementById('ttsTemplate').value;
    if (template.trim()) {
      const testContext = {
        winner: 'TestPlayer',
        bidAmount: 1000,
        itemName: 'Epic Sword',
        winners: 'TestPlayer',
        isRollOff: false,
        multipleWinners: false
      };
      message = generateTTSMessage(template, testContext);
    }
  }
  
  const utterance = new SpeechSynthesisUtterance(message);
  
  if (voiceName) {
    const voices = speechSynthesis.getVoices();
    const selectedVoice = voices.find(voice => voice.name === voiceName);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
  }
  
  // Chrome's Speech Synthesis API caps rate at 2.0x, Firefox supports higher
  const isFirefox = (typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox'));
  const maxRate = isFirefox ? 2.5 : 2.0;
  utterance.rate = Math.min(voiceSpeed, maxRate);
  utterance.volume = 0.8;
  
  speechSynthesis.speak(utterance);
  showStatus('Testing TTS voice...', 'info');
}

/**
 * Initialize the page
 */
function initializePage() {
  // Initialize audio context
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    console.log('Audio context initialized:', audioContext.state);
  } catch (error) {
    console.error('Failed to initialize audio context:', error);
    showStatus('Error: Failed to initialize audio context', 'error');
  }
  
  // Update volume display
  updateVolumeDisplay();
}

/**
 * Load settings from storage
 */
function loadSettings() {
  chrome.storage.sync.get(['darkMode', ...Object.keys(DEFAULT_SETTINGS)], function(settings) {
    // Ensure Chrome defaults to Raid Leader mode if no profile is set
    if (!settings.soundProfile && typeof chrome !== 'undefined' && !navigator.userAgent.includes('Firefox')) {
      settings.soundProfile = 'raidleader';
    }
    currentSettings = { ...DEFAULT_SETTINGS, ...settings };
    console.log('[LoadSettings] Loaded from storage:', {
      volume: currentSettings.volume,
      soundType: currentSettings.soundType,
      soundProfile: currentSettings.soundProfile,
      darkMode: settings.darkMode
    });
    // Ensure customSounds is always an object, never null or undefined
    if (!currentSettings.customSounds || typeof currentSettings.customSounds !== 'object') {
      currentSettings.customSounds = {};
    }
    // Apply dark mode before rendering UI (so reminders get correct colors)
    if (settings.darkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    applySettingsToUI();
  });
}

/**
 * Preserve scroll position during DOM updates
 */
function preserveScrollPosition(callback) {
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  callback();
  // Use double requestAnimationFrame to ensure DOM updates are complete before restoring scroll
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo(scrollX, scrollY);
    });
  });
}

/**
 * Apply settings to UI elements
 */
function applySettingsToUI() {
  preserveScrollPosition(() => {
  // Ensure customSounds is always an object, never null or undefined
  if (!currentSettings.customSounds || typeof currentSettings.customSounds !== 'object') {
    currentSettings.customSounds = {};
  }
  
  document.getElementById('enableTTS').checked = currentSettings.enableTTS;
  document.getElementById('voice').value = currentSettings.voice;
  document.getElementById('voiceSpeed').value = currentSettings.voiceSpeed;
  // Reflect the saved speed next to the slider
  const speedDisplayEl = document.getElementById('speedDisplay');
  if (speedDisplayEl) {
    const speed = parseFloat(currentSettings.voiceSpeed || 1.0);
    speedDisplayEl.textContent = (Math.round(speed * 10) / 10) + 'x';
  }
  document.getElementById('enableAdvancedTTS').checked = currentSettings.enableAdvancedTTS;
  document.getElementById('ttsTemplate').value = currentSettings.ttsTemplate;
  document.getElementById('volume').value = currentSettings.volume;
  document.getElementById('soundProfile').value = currentSettings.soundProfile;
  document.getElementById('soundType').value = currentSettings.soundType;
  document.getElementById('raidLeaderNotification').checked = currentSettings.raidLeaderNotification;
  document.getElementById('smartBidding').checked = currentSettings.smartBidding;
  
  // Handle Smart Bidding Mode visibility based on profile
  const smartBiddingCheckbox = document.getElementById('smartBidding');
  const smartBiddingRow = smartBiddingCheckbox.closest('.setting-row');
  const smartBiddingDescription = smartBiddingRow.nextElementSibling;
  
  if (currentSettings.soundProfile === 'raidleader') {
    // Hide Smart Bidding Mode entirely for Raid Leader
    smartBiddingRow.style.display = 'none';
    smartBiddingDescription.style.display = 'none';
  } else {
    // Show Smart Bidding Mode for other profiles
    smartBiddingRow.style.display = 'flex';
    smartBiddingDescription.style.display = 'block';
  }
  
  document.getElementById('quietHours').checked = currentSettings.quietHours;
  document.getElementById('quietStart').value = currentSettings.quietStart;
  document.getElementById('quietEnd').value = currentSettings.quietEnd;
  // Auction readout
  const annChk = document.getElementById('announceAuctions'); if (annChk) annChk.checked = !!currentSettings.announceAuctions;
  const annStart = document.getElementById('announceStart'); if (annStart) annStart.value = currentSettings.announceStart || '19:00';
  const annEnd = document.getElementById('announceEnd'); if (annEnd) annEnd.value = currentSettings.announceEnd || '23:59';
  const flashEl = document.getElementById('flashScreen'); if (flashEl) flashEl.checked = currentSettings.flashScreen;
  document.getElementById('browserNotifications').checked = currentSettings.browserNotifications;
  document.getElementById('checkInterval').value = currentSettings.checkInterval;
  // RaidTick Integration settings - only show for Raid Leader profile
  const raidTickGroup = Array.from(document.querySelectorAll('.setting-group')).find(group => 
    group.querySelector('h3')?.textContent.includes('RaidTick Integration')
  );
  const lootGroup = document.getElementById('ffLootExplain');
  if (currentSettings.soundProfile === 'raidleader') {
    if (raidTickGroup) {
      raidTickGroup.style.display = 'block';
      const rtEnabled = document.getElementById('raidTickEnabled');
      const rtFolder = document.getElementById('raidTickFolder');
      const rtClearBtn = document.getElementById('clearFolder');
      if (rtEnabled) rtEnabled.checked = !!currentSettings.raidTickEnabled;
      if (rtFolder) rtFolder.value = currentSettings.raidTickFolder || '';
      if (rtClearBtn) rtClearBtn.style.display = currentSettings.raidTickFolder ? 'inline-block' : 'none';
    }
    if (lootGroup) lootGroup.style.display = 'block';
    // Show reminders section
    try {
      const remSec = document.getElementById('raidTickReminders');
      if (remSec) remSec.style.display = 'block';
      renderRemindersUI();
    } catch(_) {}
  } else {
    if (raidTickGroup) {
      raidTickGroup.style.display = 'none';
    }
    if (lootGroup) lootGroup.style.display = 'none';
    try { const remSec = document.getElementById('raidTickReminders'); if (remSec) remSec.style.display = 'none'; } catch(_) {}
  }
  
  updateVolumeDisplay();
  updateSoundProfile();
  updateCustomSoundOptions();
  updateQuietHoursSettings();
  updateAnnounceSettings();
  updateTTSSettings(); // Update TTS settings visibility based on enableTTS checkbox
  // Initialize reminders UI state
  try { renderRemindersUI(); } catch(_) {}
  }); // Close preserveScrollPosition wrapper
}


/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Volume slider
  const volumeEl = document.getElementById('volume');
  if (volumeEl) volumeEl.addEventListener('input', function() {
    updateVolumeDisplay();
  });
  
  // TTS settings
  const enableTTSEl = document.getElementById('enableTTS');
  if (enableTTSEl) enableTTSEl.addEventListener('change', function(e) {
    e.preventDefault();
    currentSettings.enableTTS = this.checked;
    updateTTSSettings();
  });
  
  const voiceEl = document.getElementById('voice');
  if (voiceEl) voiceEl.addEventListener('change', function() {
    currentSettings.voice = this.value;
  });
  
  const voiceSpeedEl = document.getElementById('voiceSpeed');
  if (voiceSpeedEl) {
    // Chrome's Speech Synthesis API caps rate at 2.0x, Firefox supports up to 2.5x
    const isFirefox = (typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox'));
    const maxSpeed = isFirefox ? 2.5 : 2.0;
    voiceSpeedEl.max = maxSpeed;
    
    voiceSpeedEl.addEventListener('input', function() {
      const value = parseFloat(this.value);
      // Cap at browser's maximum supported rate
      const cappedValue = Math.min(value, maxSpeed);
      if (value !== cappedValue) {
        this.value = cappedValue;
      }
      currentSettings.voiceSpeed = cappedValue;
      document.getElementById('speedDisplay').textContent = cappedValue + 'x';
    });
  }
  
  const testVoiceEl = document.getElementById('testVoice');
  if (testVoiceEl) testVoiceEl.addEventListener('click', testTTSVoice);
  
  // Advanced TTS settings
  const advTTSEl = document.getElementById('enableAdvancedTTS');
  if (advTTSEl) advTTSEl.addEventListener('change', function() {
    currentSettings.enableAdvancedTTS = this.checked;
    updateAdvancedTTSSettings();
  });
  
  const ttsTemplateEl = document.getElementById('ttsTemplate');
  if (ttsTemplateEl) ttsTemplateEl.addEventListener('input', function() {
    currentSettings.ttsTemplate = this.value;
  });

  // Auction readout
  const announceChk = document.getElementById('announceAuctions');
  if (announceChk) announceChk.addEventListener('change', function() {
    currentSettings.announceAuctions = this.checked;
    updateAnnounceSettings();
  });
  const announceStartEl = document.getElementById('announceStart');
  if (announceStartEl) announceStartEl.addEventListener('change', function() {
    currentSettings.announceStart = this.value;
  });
  const announceEndEl = document.getElementById('announceEnd');
  if (announceEndEl) announceEndEl.addEventListener('change', function() {
    currentSettings.announceEnd = this.value;
  });
  
  const testTplEl = document.getElementById('testCustomTemplate');
  if (testTplEl) testTplEl.addEventListener('click', testCustomTemplate);
  const resetTplEl = document.getElementById('resetTemplate');
  if (resetTplEl) resetTplEl.addEventListener('click', resetTemplate);
  
  // Sound profile change
  const soundProfileEl = document.getElementById('soundProfile');
  if (soundProfileEl) soundProfileEl.addEventListener('change', function(e) {
    e.preventDefault();
    updateSoundProfile();
    // Ensure custom sounds are added after profile changes
    updateCustomSoundOptions();
  });
  
  // Custom sound file upload
  const customSoundFileEl = document.getElementById('customSoundFile');
  if (customSoundFileEl) customSoundFileEl.addEventListener('change', handleCustomSoundUpload);
  
       // RaidTick folder input (for Firefox fallback - not used in Chrome)
       const folderInputEl = document.getElementById('folderInput'); if (folderInputEl) folderInputEl.addEventListener('change', handleFolderInputChange);
  
  // Custom sound name
  const customSoundNameEl = document.getElementById('customSoundName');
  if (customSoundNameEl) customSoundNameEl.addEventListener('input', function() {
    customSoundName = this.value;
    updateCustomSoundButtons();
  });
  
  // Smart notification settings
  const smartBiddingEl = document.getElementById('smartBidding');
  if (smartBiddingEl) smartBiddingEl.addEventListener('change', function() {
    currentSettings.smartBidding = this.checked;
  });
  
  const quietHoursEl = document.getElementById('quietHours');
  if (quietHoursEl) quietHoursEl.addEventListener('change', function() {
    currentSettings.quietHours = this.checked;
    updateQuietHoursSettings();
  });
  
  const quietStartEl = document.getElementById('quietStart');
  if (quietStartEl) quietStartEl.addEventListener('change', function() {
    currentSettings.quietStart = this.value;
  });
  
  const quietEndEl = document.getElementById('quietEnd');
  if (quietEndEl) quietEndEl.addEventListener('change', function() {
    currentSettings.quietEnd = this.value;
  });
  
  const disableVisualsEl = document.getElementById('disableVisuals');
  if (disableVisualsEl) disableVisualsEl.addEventListener('change', function() {
    currentSettings.disableVisuals = this.checked;
    updateVisualSettings();
  });
  
  // Test buttons
  const testSoundEl = document.getElementById('testSound'); if (testSoundEl) testSoundEl.addEventListener('click', testCurrentSound);
  const testCustomSoundEl = document.getElementById('testCustomSound'); if (testCustomSoundEl) testCustomSoundEl.addEventListener('click', testCustomSound);
  const saveCustomSoundEl = document.getElementById('saveCustomSound'); if (saveCustomSoundEl) saveCustomSoundEl.addEventListener('click', saveCustomSound);
  
  // Sound type change listener - update currentSettings when user changes selection
  const soundTypeSelectEl = document.getElementById('soundType');
  if (soundTypeSelectEl) {
    soundTypeSelectEl.addEventListener('change', function() {
      currentSettings.soundType = this.value;
      console.log('[SoundType] Selection changed to:', this.value);
    });
  }
  
  // Test notification buttons
  const testSingleEl = document.getElementById('testSingleWinner'); if (testSingleEl) testSingleEl.addEventListener('click', () => testNotification('single'));
  const testRollEl = document.getElementById('testRollOff'); if (testRollEl) testRollEl.addEventListener('click', () => testNotification('rolloff'));
  const testMultiEl = document.getElementById('testMultiWinner'); if (testMultiEl) testMultiEl.addEventListener('click', () => testNotification('multi'));
  
  // Smart notification permission check/request
  // Uses the single button that intelligently requests permission if needed, or just checks status
  const notificationButtonEl = document.getElementById('notificationPermission'); 
  if (notificationButtonEl) {
    notificationButtonEl.addEventListener('click', checkOrRequestNotificationPermission);
  }
  
  // Keep legacy function names for backwards compatibility if needed elsewhere
  const requestPermEl = document.getElementById('requestPermission'); 
  if (requestPermEl) requestPermEl.addEventListener('click', requestNotificationPermission);
  
  const checkStatusEl = document.getElementById('checkStatus'); 
  if (checkStatusEl) checkStatusEl.addEventListener('click', checkNotificationStatus);
  
  // Raid leader settings
  const raidLeaderNotifEl = document.getElementById('raidLeaderNotification');
  if (raidLeaderNotifEl) raidLeaderNotifEl.addEventListener('change', function() {
    currentSettings.raidLeaderNotification = this.checked;
  });

  // Reminders section
  const addReminderBtn = document.getElementById('addReminder');
  if (addReminderBtn) addReminderBtn.addEventListener('click', () => addReminder());
  const remFlash = document.getElementById('reminderFlash'); if (remFlash) remFlash.addEventListener('change', function(){
    currentSettings.reminderPrefs = currentSettings.reminderPrefs || { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] };
    if (!Array.isArray(currentSettings.reminderPrefs.enabledDays)) {
      currentSettings.reminderPrefs.enabledDays = [0,1,2,3,4,5,6];
    }
    currentSettings.reminderPrefs.flash = !!this.checked;
    saveRemindersPartial();
  });
  const remNotif = document.getElementById('reminderNotifications'); if (remNotif) remNotif.addEventListener('change', function(){
    currentSettings.reminderPrefs = currentSettings.reminderPrefs || { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] };
    currentSettings.reminderPrefs.notifications = !!this.checked;
    saveRemindersPartial();
  });
  // Day-of-week checkboxes
  for (let day = 0; day < 7; day++) {
    const dayCheckbox = document.getElementById('reminderDay' + day);
    if (dayCheckbox) {
      dayCheckbox.addEventListener('change', function() {
        currentSettings.reminderPrefs = currentSettings.reminderPrefs || { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] };
        if (!Array.isArray(currentSettings.reminderPrefs.enabledDays)) {
          currentSettings.reminderPrefs.enabledDays = [0,1,2,3,4,5,6];
        }
        const dayNum = parseInt(this.value, 10);
        if (this.checked) {
          // Add day if not already in array
          if (!currentSettings.reminderPrefs.enabledDays.includes(dayNum)) {
            currentSettings.reminderPrefs.enabledDays.push(dayNum);
          }
        } else {
          // Remove day from array
          currentSettings.reminderPrefs.enabledDays = currentSettings.reminderPrefs.enabledDays.filter(d => d !== dayNum);
        }
        saveRemindersPartial();
      });
    }
  }
  
  // Save button
  const saveSettingsEl = document.getElementById('saveSettings'); if (saveSettingsEl) saveSettingsEl.addEventListener('click', function(e) {
    e.preventDefault();
    preserveScrollPosition(() => {
      saveSettings();
    });
  });
}

// ==========================
// RaidTick Reminders (UI)
// ==========================
function renderRemindersUI() {
  if (!document.getElementById('raidTickReminders')) return;
  currentSettings.reminders = Array.isArray(currentSettings.reminders) ? currentSettings.reminders : [];
  currentSettings.reminderPrefs = currentSettings.reminderPrefs || { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] };
  // Ensure enabledDays is an array with valid values
  if (!Array.isArray(currentSettings.reminderPrefs.enabledDays)) {
    currentSettings.reminderPrefs.enabledDays = [0,1,2,3,4,5,6]; // Default to all days
  }
  const list = document.getElementById('remindersList');
  const btn = document.getElementById('addReminder');
  const flash = document.getElementById('reminderFlash');
  const notif = document.getElementById('reminderNotifications');
  if (flash) flash.checked = !!currentSettings.reminderPrefs.flash;
  if (notif) notif.checked = !!currentSettings.reminderPrefs.notifications;
  // Load day checkboxes
  for (let day = 0; day < 7; day++) {
    const dayCheckbox = document.getElementById('reminderDay' + day);
    if (dayCheckbox) {
      dayCheckbox.checked = currentSettings.reminderPrefs.enabledDays.includes(day);
    }
  }
  if (btn) btn.disabled = currentSettings.reminders.length >= 5;
  if (!list) return;
  list.innerHTML = '';
  currentSettings.reminders.forEach((r, idx) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '8px';
    row.style.borderRadius = '4px';
    row.style.overflow = 'hidden';
    row.style.minWidth = '0';
    
    // Check for dark mode and apply appropriate styles
    const isDarkMode = document.body.classList.contains('dark-mode');
    if (isDarkMode) {
      row.style.background = '#2a2a2a';
      row.style.border = '1px solid #444';
      row.style.color = '#e0e0e0';
    } else {
      row.style.background = '#f8f9fa';
      row.style.border = '1px solid #e0e0e0';
      row.style.color = '#333';
    }
    
    const labelColor = isDarkMode ? '#e0e0e0' : '#333';
    row.innerHTML = `
      <label style="display:flex; align-items:center; gap:6px; flex-shrink:0; color:${labelColor};">
        <input type="checkbox" data-k="enabled" ${r.enabled ? 'checked' : ''}> Enabled
      </label>
      <label style="flex-shrink:0; color:${labelColor};">Start:
        <input type="time" step="300" data-k="start" value="${escapeHtmlAttr(r.start||'19:00')}" style="width:100px;">
      </label>
      <label style="flex-shrink:0; color:${labelColor};">End:
        <input type="time" step="300" data-k="end" value="${escapeHtmlAttr(r.end||'23:00')}" style="width:100px;">
      </label>
      <button class="btn btn-secondary" data-action="delete" style="flex-shrink:0; min-width:36px; padding:6px 8px;" title="Delete reminder">🗑️</button>
    `;
    // Wire inputs
    row.querySelectorAll('[data-k]').forEach(inp => {
      inp.addEventListener('change', function(){
        const key = this.getAttribute('data-k');
        const val = (this.type === 'checkbox') ? this.checked : this.value;
        currentSettings.reminders[idx] = { ...currentSettings.reminders[idx], [key]: val };
        saveRemindersPartial();
      });
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', () => {
      currentSettings.reminders.splice(idx,1);
      renderRemindersUI();
      saveRemindersPartial();
    });
    list.appendChild(row);
  });
}

function addReminder() {
  currentSettings.reminders = Array.isArray(currentSettings.reminders) ? currentSettings.reminders : [];
  if (currentSettings.reminders.length >= 5) return;
  const id = 'r-' + Date.now().toString(36);
  currentSettings.reminders.push({ id, enabled: true, start: '19:00', end: '23:00', message: 'Run /outputfile raidlist' });
  renderRemindersUI();
  saveRemindersPartial();
}

// Small helper: escape for attribute/HTML
function escapeHtmlAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Save only reminders and preferences quickly so background picks changes up
let _reminderSaveTimer = null;
function saveRemindersPartial() {
  // Ensure enabledDays is properly initialized before saving
  if (!currentSettings.reminderPrefs) {
    currentSettings.reminderPrefs = { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] };
  }
  if (!Array.isArray(currentSettings.reminderPrefs.enabledDays)) {
    currentSettings.reminderPrefs.enabledDays = [0,1,2,3,4,5,6];
  }
  try {
    if (_reminderSaveTimer) clearTimeout(_reminderSaveTimer);
    _reminderSaveTimer = setTimeout(() => {
      const payload = {
        reminders: (currentSettings.reminders || []).slice(0,5),
        reminderPrefs: currentSettings.reminderPrefs || { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] }
      };
      try {
        (api && api.storage ? api.storage.sync : chrome.storage.sync).set(payload, function(){});
      } catch(_) {}
    }, 150);
  } catch (_) {}
}

/**
 * Update volume display
 */
function updateVolumeDisplay() {
  const volume = document.getElementById('volume').value;
  document.getElementById('volumeDisplay').textContent = volume + '%';
}

/**
 * Update sound profile options
 */
function updateSoundProfile() {
  preserveScrollPosition(() => {
  const profile = document.getElementById('soundProfile').value;
  const soundTypeSelect = document.getElementById('soundType');
  const raidLeaderSettings = document.getElementById('raidLeaderOnlySettings');
  
  // Clear existing options
  soundTypeSelect.innerHTML = '';
  
  // Add profile-specific sounds
  const profileSounds = PROFILE_SOUNDS[profile];
  profileSounds.sounds.forEach(soundType => {
    const option = document.createElement('option');
    option.value = soundType;
    option.textContent = SOUND_OPTIONS[soundType].name + ' (' + SOUND_OPTIONS[soundType].description + ')';
    soundTypeSelect.appendChild(option);
  });
  
  // Custom sounds will be added by updateCustomSoundOptions() which runs after this
  // This prevents duplicate additions from async race conditions
  
  // Prefer explicit current setting if available and present in list
  const explicit = currentSettings.soundType;
  const hasExplicit = !!Array.from(soundTypeSelect.options).find(o => o.value === explicit);
  
  if (hasExplicit) {
    soundTypeSelect.value = explicit;
  } else {
    // If explicit value is not in list, check if it might be a custom sound
    // First try profile-specific saved sound, then default
    const savedSound = getSavedSoundForProfile(profile);
    if (savedSound && Array.from(soundTypeSelect.options).find(o => o.value === savedSound)) {
      soundTypeSelect.value = savedSound;
    } else {
      soundTypeSelect.value = profileSounds.default;
    }
    // IMPORTANT: Preserve explicit value if it wasn't in list - it's likely a custom sound being loaded
    // updateCustomSoundOptions() will restore it later
    if (explicit && explicit !== soundTypeSelect.value) {
      console.log('[UpdateSoundProfile] Preserving custom sound value:', explicit, 'will be restored when loaded from IndexedDB');
      // Don't update currentSettings.soundType - keep the explicit value for now
      // updateCustomSoundOptions() will restore it once custom sounds are loaded
    }
  }
  
  // Show/hide raid leader only settings
  if (profile === 'raidleader') {
    raidLeaderSettings.style.display = 'block';
  } else {
    raidLeaderSettings.style.display = 'none';
  }
  
  // Update current settings
  currentSettings.soundProfile = profile;
  // Only update soundType if we found a valid option that matches what we selected
  // Otherwise, preserve the explicit value (custom sound will be restored by updateCustomSoundOptions)
  const selectedValue = soundTypeSelect.value;
  const selectedOption = Array.from(soundTypeSelect.options).find(o => o.value === selectedValue);
  if (selectedOption && (selectedValue === explicit || !explicit)) {
    currentSettings.soundType = selectedValue;
  }
  // Otherwise, keep the explicit value (it's a custom sound that will be restored)
  
  // Handle Smart Bidding Mode visibility and settings
  const smartBiddingCheckbox = document.getElementById('smartBidding');
  const smartBiddingRow = smartBiddingCheckbox.closest('.setting-row');
  const smartBiddingDescription = smartBiddingRow.nextElementSibling;
  
  if (profile === 'raider') {
    // Show Smart Bidding Mode for Raider and auto-enable it
    smartBiddingRow.style.display = 'flex';
    smartBiddingDescription.style.display = 'block';
    currentSettings.smartBidding = true;
    smartBiddingCheckbox.checked = true;
    console.log('Smart bidding automatically enabled for raider profile');
  } else if (profile === 'raidleader') {
    // Hide Smart Bidding Mode entirely for Raid Leader
    smartBiddingRow.style.display = 'none';
    smartBiddingDescription.style.display = 'none';
    console.log('Raid leader profile - smart bidding mode hidden');
  }
  
  // Handle RaidTick Integration visibility
  const raidTickGroup = Array.from(document.querySelectorAll('.setting-group')).find(group => 
    group.querySelector('h3')?.textContent.includes('RaidTick Integration')
  );
  if (profile === 'raidleader') {
    if (raidTickGroup) {
      raidTickGroup.style.display = 'block';
      console.log('Raid leader profile - RaidTick integration shown');
    }
  } else {
    if (raidTickGroup) {
      raidTickGroup.style.display = 'none';
      console.log('Non-raid leader profile - RaidTick integration hidden');
    }
  }
  
  // Handle Loot Parser visibility (only show for Raid Leader)
  const lootGroup = document.getElementById('ffLootExplain');
  if (lootGroup) {
    lootGroup.style.display = profile === 'raidleader' ? 'block' : 'none';
    console.log('Loot Parser visibility set for profile:', profile);
  }
  }); // Close preserveScrollPosition wrapper
}

function getSavedSoundForProfile(profile) {
  // Check if there's a saved sound for this profile
  const profileKey = profile + 'Sound';
  if (currentSettings[profileKey]) {
    return currentSettings[profileKey];
  }
  
  // Fallback to default for the profile
  const profileSounds = PROFILE_SOUNDS[profile];
  return profileSounds.default;
}

/**
 * Update custom sound options
 */
function updateCustomSoundOptions() {
  const soundTypeSelect = document.getElementById('soundType');
  if (!soundTypeSelect) return;
  
  // Save the saved/preferred selection from currentSettings, not the dropdown value
  // This ensures we restore custom sounds that were just saved but haven't been loaded yet
  const preferredSelection = currentSettings.soundType;
  const currentDropdownValue = soundTypeSelect.value;
  
  // Remove existing custom entries to avoid duplicates (keep built-ins already inserted elsewhere)
  Array.from(soundTypeSelect.options).forEach(opt => {
    if (opt.textContent && opt.textContent.endsWith(' (Custom)')) {
      soundTypeSelect.removeChild(opt);
    }
  });
  
  // Add custom sounds from IndexedDB
  try {
    listSoundsFromDB().then(names => {
      names.forEach(soundName => {
        if (!soundName) return; // skip unnamed records in dropdown
        
        // Check if already added to avoid duplicates (handles race conditions when function called multiple times)
        const exists = Array.from(soundTypeSelect.options).find(o => o.value === soundName);
        if (exists) {
          console.log('[UpdateCustomSoundOptions] Skipping duplicate:', soundName);
          return;
        }
        
        const option = document.createElement('option');
        option.value = soundName;
        option.textContent = soundName + ' (Custom)';
        soundTypeSelect.appendChild(option);
      });
      // After custom sounds are added, restore the preferred selection if it's a custom sound
      // Prefer the saved value from currentSettings over the current dropdown value
      const selectionToRestore = preferredSelection || currentDropdownValue;
      if (selectionToRestore) {
        const optionExists = Array.from(soundTypeSelect.options).find(o => o.value === selectionToRestore);
        if (optionExists) {
          soundTypeSelect.value = selectionToRestore;
          // Update currentSettings to match the restored value
          currentSettings.soundType = selectionToRestore;
          console.log('[UpdateCustomSoundOptions] Restored custom sound selection:', selectionToRestore);
        } else {
          console.log('[UpdateCustomSoundOptions] Selection not found in options:', selectionToRestore);
        }
      }
    });
    // Refresh manager list UI
    refreshCustomSoundManager();
  } catch (_) {}
}

// Render custom sound manager list
function refreshCustomSoundManager() {
  const listEl = document.getElementById('customSoundList');
  const mgrCard = document.getElementById('customSoundManager');
  const mgrGroup = mgrCard ? mgrCard.closest('.setting-group') : null;
  const hintEl = document.getElementById('customSoundHint');
  if (!listEl) return;
  listEl.innerHTML = '';
  listSoundRecordsFromDB().then(records => {
    // Sort by name
    records.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    // Limit display and show count
    const count = records.length;
    // Keep the manager visible so upload controls remain accessible
    if (mgrGroup) mgrGroup.style.display = 'block';
    if (count === 0) {
      // Hide list and hint when empty
      listEl.style.display = 'none';
      if (hintEl) hintEl.style.display = 'none';
      return;
    } else {
      listEl.style.display = 'flex';
      if (hintEl) hintEl.style.display = 'block';
    }
    console.log('[SoundMgr] Records loaded:', count, records.map(r=>({name:r.name, size:(r.data?.size||r.data?.byteLength||0)})));
    records.forEach(rec => {
      const size = rec && rec.data ? (rec.data.size || (rec.data.byteLength || 0)) : 0;
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.gap = '8px';
      const displayName = (rec.name && rec.name.length) ? rec.name : '(unnamed)';
      // Escape user-controlled data for safe HTML
      const escapedName = escapeHtml(displayName);
      const escapedNameAttr = escapeHtmlAttr(rec.name || '');
      const escapedSize = escapeHtml(String(Math.round(size/1024)));
      
      row.innerHTML = `
        <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          <strong>${escapedName}</strong> <span style="color:#666;">(${escapedSize} KB)</span>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-secondary" data-action="rename" data-name="${escapedNameAttr}">Rename</button>
          <button class="btn" style="background:#dc3545; border-color:#dc3545;" data-action="delete" data-name="${escapedNameAttr}">Delete</button>
        </div>`;
      listEl.appendChild(row);
    });
    // Wire actions
    listEl.querySelectorAll('button[data-action]')?.forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.getAttribute('data-action');
        const name = btn.getAttribute('data-name');
        if (name === null) return; // allow empty string key
        if (action === 'delete') {
          await deleteSoundFromDB(name);
          updateCustomSoundOptions();
          showStatus('Deleted custom sound: ' + name, 'success');
        } else if (action === 'rename') {
          const newName = prompt('Rename sound', name);
          if (!newName || newName === name) return;
          // Check conflict
          const existing = await getSoundFromDB(newName);
          if (existing) { showStatus('Name already exists', 'error'); return; }
          const rec = await getSoundFromDB(name);
          if (!rec) return;
          await saveSoundToDB(newName, rec.data, rec.type);
          await deleteSoundFromDB(name);
          updateCustomSoundOptions();
          showStatus('Renamed to: ' + newName, 'success');
        }
      });
    });
  });
}

/**
 * Handle custom sound file upload
 */
function handleCustomSoundUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  console.log('Custom sound file selected:', file.name, 'size:', file.size, 'type:', file.type);
  
  // Validate file size (1MB limit)
  if (file.size > 1024 * 1024) {
    showStatus('File too large. Maximum size is 1MB.', 'error');
    return;
  }
  
  // Validate file type
  if (!file.type.startsWith('audio/')) {
    showStatus('Please select an audio file (MP3, WAV, OGG).', 'error');
    return;
  }
  
  showStatus('Loading custom sound...', 'info');
  
  // Read file as ArrayBuffer
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      lastUploadedArrayBuffer = e.target.result;
      try { lastUploadedType = file.type || 'application/octet-stream'; lastUploadedBlob = file; lastUploadedOriginalName = file.name || ''; } catch(_) {}
      console.log('[SoundUpload] Selected file:', {
        name: lastUploadedOriginalName,
        type: lastUploadedType,
        size: file.size
      });
      console.log('File read successfully, decoding audio data...');
      // Decode audio data
      audioContext.decodeAudioData(e.target.result).then(buffer => {
        customSoundBuffer = buffer;
        customSoundName = file.name.replace(/\.[^/.]+$/, ""); // Remove extension
        document.getElementById('customSoundName').value = customSoundName;
        updateCustomSoundButtons();
        showStatus('Custom sound loaded successfully! Ready to test and save.', 'success');
        console.log('Custom sound decoded successfully:', customSoundName, 'duration:', buffer.duration);
      }).catch(error => {
        console.error('Error decoding audio file:', error);
        showStatus('Error decoding audio file: ' + error.message, 'error');
      });
    } catch (error) {
      console.error('Error reading audio file:', error);
      showStatus('Error reading audio file: ' + error.message, 'error');
    }
  };
  
  reader.onerror = function() {
    console.error('Error reading file');
    showStatus('Error reading file', 'error');
  };
  
  reader.readAsArrayBuffer(file);
}

/**
 * Update custom sound buttons state
 */
function updateCustomSoundButtons() {
  const testBtn = document.getElementById('testCustomSound');
  const saveBtn = document.getElementById('saveCustomSound');
  const canTest = customSoundBuffer && customSoundName;
  
  testBtn.disabled = !canTest;
  saveBtn.disabled = !canTest;
}

/**
 * Test custom sound
 */
function testCustomSound() {
  if (!customSoundBuffer) {
    showStatus('No custom sound loaded. Please upload a sound file first.', 'error');
    return;
  }
  
  const volume = document.getElementById('volume').value / 100;
  
  try {
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    
    source.buffer = customSoundBuffer;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Set volume using gainNode
    gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
    
    console.log('Playing custom sound:', customSoundName, 'volume:', volume);
    source.start();
    
    showStatus('Playing custom sound...', 'success');
  } catch (error) {
    console.error('Error playing custom sound:', error);
    showStatus('Error playing custom sound: ' + error.message, 'error');
  }
}

/**
 * Save custom sound
 */
function saveCustomSound() {
  if (!customSoundBuffer || !customSoundName) return;
  if (!lastUploadedArrayBuffer && !lastUploadedBlob) {
    showStatus('Please upload the file again before saving.', 'error');
    return;
  }
  // Finalize name from input, fallback to original filename
  let nameToSave = '';
  try {
    const inputEl = document.getElementById('customSoundName');
    const inputVal = (inputEl && inputEl.value ? inputEl.value : '').trim();
    let finalName = inputVal || (lastUploadedOriginalName ? lastUploadedOriginalName.replace(/\.[^/.]+$/, '') : 'custom');
    finalName = finalName.replace(/\s+/g, ' ').slice(0, 40);
    if (!finalName) finalName = 'custom-' + Date.now();
    customSoundName = finalName;
    nameToSave = finalName;
    console.log('[SoundSave] Name resolution:', {
      inputVal,
      original: lastUploadedOriginalName,
      finalName
    });
  } catch (_) { if (!customSoundName) { customSoundName = 'custom-' + Date.now(); } }
  // Enforce limits
  const MAX_SOUNDS = 3;
  const MAX_BYTES = 100 * 1024;
  const fileSize = lastUploadedBlob ? lastUploadedBlob.size : (lastUploadedArrayBuffer?.byteLength || 0);
  if (fileSize > MAX_BYTES) {
    showStatus('File too large. Limit is 100 KB for notification sounds.', 'error');
    return;
  }
  listSoundsFromDB().then(names => {
    if (names && names.length >= MAX_SOUNDS && !names.includes(customSoundName)) {
      showStatus('Limit reached (3 sounds). Delete one before saving.', 'error');
      return;
    }
    // Prefer original Blob if available for best codec compatibility
    const bytesForStorage = lastUploadedBlob || lastUploadedArrayBuffer;
    console.log('[SoundSave] About to save:', {
      key: nameToSave,
      size: lastUploadedBlob ? lastUploadedBlob.size : (lastUploadedArrayBuffer?.byteLength || 0),
      type: lastUploadedType
    });
    // Save to IndexedDB (works in both Chrome and Firefox)
    saveSoundToDB(nameToSave, bytesForStorage, lastUploadedType)
    .then(() => {
      console.log('[SoundSave] Saved to IndexedDB:', nameToSave);
      
      // ALSO save to chrome.storage.local for Chrome (allows direct content script access)
      const isChrome = typeof chrome !== 'undefined' && typeof browser === 'undefined';
      if (isChrome && chrome.storage && chrome.storage.local) {
        // Convert to ArrayBuffer if needed, then to base64 for storage
        const toArrayBuffer = (data) => {
          if (data instanceof ArrayBuffer) return Promise.resolve(data);
          if (data instanceof Blob) return data.arrayBuffer();
          return Promise.reject(new Error('Unsupported format'));
        };
        
        toArrayBuffer(bytesForStorage)
        .then(arrayBuffer => {
          // Convert ArrayBuffer to base64 for storage
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          
          // Store in chrome.storage.local with key pattern: customSound_{name}
          const storageKey = `customSound_${nameToSave}`;
          chrome.storage.local.set({
            [storageKey]: {
              data: base64,
              type: lastUploadedType || 'audio/mpeg',
              name: nameToSave
            }
          }, () => {
            if (chrome.runtime.lastError) {
              console.warn('[SoundSave] Error saving to chrome.storage.local:', chrome.runtime.lastError);
            } else {
              console.log('[SoundSave] Saved to chrome.storage.local:', nameToSave);
            }
          });
        })
        .catch(err => {
          console.warn('[SoundSave] Error converting for chrome.storage.local:', err);
        });
      }
      
      updateCustomSoundOptions();
      // If Notification Sound dropdown currently has a built-in selected, auto-select the new custom by name
      try {
        const sel = document.getElementById('soundType');
        if (sel) sel.value = nameToSave;
      } catch (_) {}
      showStatus('Custom sound saved successfully!', 'success');
    })
    .catch((err) => {
      console.error('Error saving sound to IndexedDB:', err);
      showStatus('Failed to save custom sound', 'error');
    });
  });
  
  // Clear form
  document.getElementById('customSoundFile').value = '';
  document.getElementById('customSoundName').value = '';
  customSoundBuffer = null;
  customSoundName = '';
  updateCustomSoundButtons();
}

/**
 * Update quiet hours settings visibility
 */
function updateQuietHoursSettings() {
  const quietHoursSettings = document.getElementById('quietHoursSettings');
  const quietHours = document.getElementById('quietHours').checked;
  
  quietHoursSettings.style.display = quietHours ? 'block' : 'none';
}

function updateAnnounceSettings() {
  const row = document.getElementById('announceWindow');
  const enabled = document.getElementById('announceAuctions')?.checked;
  if (row) row.style.display = enabled ? 'flex' : 'none';
}

/**
 * Update visual settings based on disable visuals checkbox
 */
function updateVisualSettings() {
  const disableVisuals = document.getElementById('disableVisuals').checked;
  const flashScreen = document.getElementById('flashScreen');
  const browserNotifications = document.getElementById('browserNotifications');
  // Disable/enable visual settings
  flashScreen.disabled = disableVisuals;
  browserNotifications.disabled = disableVisuals;
  
  // Update labels to show disabled state
  const labels = document.querySelectorAll('label[for="flashScreen"], label[for="browserNotifications"]');
  labels.forEach(label => {
    if (disableVisuals) {
      label.style.color = '#999';
      label.style.textDecoration = 'line-through';
    } else {
      label.style.color = '#555';
      label.style.textDecoration = 'none';
    }
  });
}

/**
 * Check if current time is within quiet hours
 */
function isQuietHours() {
  if (!currentSettings.quietHours) return false;
  
  const now = new Date();
  const currentTime = now.getHours() * 100 + now.getMinutes();
  
  const startTime = parseInt(currentSettings.quietStart.replace(':', ''));
  const endTime = parseInt(currentSettings.quietEnd.replace(':', ''));
  
  // Handle overnight quiet hours (e.g., 22:00 to 08:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime <= endTime;
  } else {
    return currentTime >= startTime && currentTime <= endTime;
  }
}

/**
 * Request notification permission
 */
function requestNotificationPermission() {
  if ('Notification' in window) {
    Notification.requestPermission().then(permission => {
      showStatus('Notification permission: ' + permission, permission === 'granted' ? 'success' : 'warning');
      checkNotificationStatus();
    });
  } else {
    showStatus('Browser does not support notifications', 'error');
  }
}

/**
 * Check and request notification permission if needed, then display status
 * This is a smart function that requests permission only if it's not yet requested,
 * otherwise just checks and displays the current status.
 */
function checkOrRequestNotificationPermission() {
  if ('Notification' in window) {
    const currentPermission = Notification.permission;
    
    // Only request permission if it hasn't been requested yet (is "default")
    if (currentPermission === 'default') {
      Notification.requestPermission().then(permission => {
        showStatus('Notification permission: ' + permission, permission === 'granted' ? 'success' : 'warning');
        checkNotificationStatus();
      });
    } else {
      // Permission already requested - just check and display status
      checkNotificationStatus();
    }
  } else {
    showStatus('Browser does not support notifications', 'error');
  }
}

/**
 * Check notification status and display
 */
function checkNotificationStatus() {
  const statusDiv = document.getElementById('notificationStatus');
  const contentDiv = document.getElementById('statusContent');
  
  let status = {
    supported: 'Notification' in window,
    permission: Notification.permission,
    browserNotifications: currentSettings.browserNotifications
  };
  
  // Test if we can actually create a notification
  let testResult = null;
  if (status.supported && status.permission === 'granted') {
    try {
      const api = typeof browser !== 'undefined' ? browser : chrome;
      const iconUrl = api.runtime.getURL('icons/icon-48.png');
      const testNotification = new Notification('Test Notification', {
        body: 'If you see this, notifications are working!',
        icon: iconUrl,
        tag: 'opendkp-status-test',
        silent: false
      });
      
      let notificationShown = false;
      let notificationError = null;
      
      testNotification.onshow = () => {
        notificationShown = true;
        console.log('[StatusCheck] ✅ Test notification shown event fired');
      };
      
      testNotification.onerror = (e) => {
        notificationError = e;
        console.error('[StatusCheck] ❌ Test notification error event:', e);
      };
      
      // Wait a moment to see if events fire, then update the display
      setTimeout(() => {
        testNotification.close();
        testResult = {
          created: true,
          shown: notificationShown,
          error: notificationError
        };
        console.log('[StatusCheck] Test notification result:', testResult);
        
        // Update the status display with the test result
        updateStatusWithTestResult(statusDiv, contentDiv, status, testResult);
      }, 1500);
    } catch (e) {
      testResult = {
        created: false,
        error: e.message
      };
      console.error('[StatusCheck] Failed to create test notification:', e);
    }
  }
  
  // Helper function to update status display with test result
  function updateStatusWithTestResult(statusDiv, contentDiv, status, testResult) {
    let message = '=== Notification Status ===\n\n';
    message += `Browser Support: ${status.supported ? '✅ Yes' : '❌ No'}\n`;
    
    if (status.supported) {
      message += `Permission: ${status.permission}\n`;
      message += `Permission Status: ${status.permission === 'granted' ? '✅ Granted' : status.permission === 'denied' ? '❌ Denied' : '⚠️ Not Requested'}\n`;
      
      // Check if Chrome notifications might be blocked
      const isChrome = typeof chrome !== 'undefined' && !navigator.userAgent.includes('Firefox');
      if (isChrome && status.permission === 'granted') {
        message += '\n=== Chrome-Specific Checks ===\n\n';
        message += '⚠️ If notifications aren\'t appearing:\n';
        message += '1. Check Chrome\'s notification center (bell icon 🔔 in address bar)\n';
        message += '   → Notifications might be going there instead of banners\n';
        message += '2. Chrome Settings → Privacy and security → Site Settings → Notifications\n';
        message += '   → Ensure "Sites can ask to send notifications" is enabled\n';
        message += '   → Check that your extension URL is in "Allow" list\n';
        message += '3. Try: chrome://settings/content/notifications\n';
        message += '4. Check Windows Settings → System → Notifications → Chrome\n';
        message += '   → Ensure "Banners" and "Sounds" are enabled\n';
        message += '5. Check if Focus Assist (Windows) or Do Not Disturb is active\n';
        message += '6. Try clicking the bell icon 🔔 in Chrome\'s address bar\n';
        message += '   → Notifications might be there but not showing as banners\n';
      }
      
      message += '\n=== Notification Settings ===\n\n';
      message += `Browser Notifications: ${status.browserNotifications ? '✅ Enabled' : '❌ Disabled'}\n`;
      
      message += '\n=== Test Notification Result ===\n\n';
      if (testResult) {
        if (testResult.created && !testResult.error) {
          message += `✅ Test notification created successfully\n`;
          if (testResult.shown) {
            message += `✅ Notification "shown" event fired (notification appeared)\n`;
          } else {
            message += `❌ Notification created but "shown" event did NOT fire\n`;
            message += `   → This means notifications are being BLOCKED\n`;
            message += `   → Check Chrome Settings → Site Settings → Notifications\n`;
            message += `   → Check Windows Settings → Notifications → Chrome\n`;
            message += `   → Disable Focus Assist / Do Not Disturb\n`;
          }
          if (testResult.error) {
            message += `❌ Notification error event: ${testResult.error}\n`;
          }
        } else {
          message += `❌ Failed to create test notification\n`;
          if (testResult.error) {
            message += `   Error: ${testResult.error}\n`;
          }
        }
      } else {
        message += `⚠️ Test notification running... (should update shortly)\n`;
      }
      
      message += '\n=== Expected Behavior ===\n\n';
      
      if (status.permission === 'granted' && status.browserNotifications) {
        message += '✅ Desktop notifications should appear\n';
        if (testResult && testResult.created && !testResult.shown) {
          message += '❌ BUT: Notification created but not appearing\n';
          message += '   → DEFINITELY blocked by Chrome or Windows settings\n';
        }
      } else if (status.permission !== 'granted') {
        message += '⚠️ Desktop notifications NOT configured\n';
        message += '   → Click "Request Notification Permission" button\n';
      } else if (!status.browserNotifications) {
        message += '⚠️ Desktop notifications disabled in settings\n';
        message += '   → Enable "Browser Notifications" checkbox\n';
      }
      
      message += '\n=== Quick Fix ===\n\n';
      if (status.permission !== 'granted') {
        message += '1. Click "Request Notification Permission"\n';
      }
      if (!status.browserNotifications) {
        message += '2. Check "Browser Notifications" checkbox\n';
      }
      if (status.permission === 'granted' && status.browserNotifications && testResult && !testResult.shown) {
        message += '3. ⚠️ CRITICAL: Permission granted but notifications blocked:\n';
        message += '   → Chrome: chrome://settings/content/notifications\n';
        message += '   → Windows: Settings → System → Notifications → Chrome\n';
        message += '   → Disable Focus Assist / Do Not Disturb\n';
        message += '   → Check Chrome\'s notification center (bell icon)\n';
      }
      if (status.permission === 'granted' && status.browserNotifications && (!testResult || testResult.shown)) {
        message += '✅ All notification settings are correct!\n';
      }
    } else {
      message += '\n❌ Your browser does not support notifications\n';
      message += 'Please use a modern browser (Chrome, Firefox, Edge)\n';
    }
    
    contentDiv.textContent = message;
  }
  
  // Initial display (will be updated after test completes if permission is granted)
  if (status.permission === 'granted' && status.supported) {
    // Show initial message, will be updated by test result
    updateStatusWithTestResult(statusDiv, contentDiv, status, null);
  } else {
    // Show immediate result if no test needed
    updateStatusWithTestResult(statusDiv, contentDiv, status, testResult);
  }
  statusDiv.style.display = 'block';
}

/**
 * Test the currently selected sound
 */
function testCurrentSound() {
  const soundType = document.getElementById('soundType').value;
  const volume = document.getElementById('volume').value / 100;
  
  console.log('Testing sound:', soundType, 'at volume:', volume);
  
  // Ensure audio context is running (required for user interaction)
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().then(() => {
      console.log('Audio context resumed');
      playTestSound(soundType, volume);
    }).catch(error => {
      console.error('Failed to resume audio context:', error);
      showStatus('Error: Audio context failed to resume', 'error');
    });
  } else {
    playTestSound(soundType, volume);
  }
}

function playTestSound(soundType, volume) {
  // Check if it's a legacy custom sound first (base64 path)
  if (currentSettings.customSounds && currentSettings.customSounds[soundType]) {
    try {
      const customSoundData = currentSettings.customSounds[soundType];
      console.log('Custom sound data:', customSoundData);
      
      // Convert base64 back to AudioBuffer
      const binaryString = atob(customSoundData.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Convert bytes back to Float32Array
      const float32Array = new Float32Array(bytes.buffer);
      console.log('Float32Array length:', float32Array.length, 'Expected:', customSoundData.length);
      
      // Create AudioBuffer with correct parameters
      const audioBuffer = audioContext.createBuffer(1, customSoundData.length, customSoundData.sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      
      // Copy the float data
      for (let i = 0; i < Math.min(float32Array.length, channelData.length); i++) {
        channelData[i] = float32Array[i];
      }
      
      // Create and play the custom sound
      const source = audioContext.createBufferSource();
      const gainNode = audioContext.createGain();
      
      source.buffer = audioBuffer;
      gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
      
      source.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      source.start();
      console.log('Playing custom sound:', soundType, 'volume:', volume);
      
    } catch (error) {
      console.error('Error playing custom sound:', error);
      showStatus('Error playing custom sound: ' + error.message, 'error');
    }
    return;
  }
  
  // Try built-in mapped sounds
  if (SOUND_OPTIONS[soundType]) {
    try {
      // Check if audio context is suspended and try to resume
      if (audioContext && audioContext.state === 'suspended') {
        console.log('Audio context is suspended, attempting to resume...');
        audioContext.resume().then(() => {
          console.log('Audio context resumed, retrying sound generation');
          playTestSound(soundType, volume);
        }).catch(error => {
          console.error('Failed to resume audio context:', error);
          showStatus('Error: Audio context failed to resume', 'error');
        });
        return;
      }
      
      const soundPromise = SOUND_OPTIONS[soundType].generate();
      
      // Handle Promise-based sounds (like Warcraft sounds)
      if (soundPromise instanceof Promise) {
        soundPromise.then(sound => {
          if (sound) {
            console.log('Playing sound:', soundType, 'volume:', volume);
            
            // Handle HTML Audio Element (Warcraft sounds)
            if (sound instanceof HTMLAudioElement) {
              console.log('Playing HTML Audio Element:', sound.src);
              sound.volume = volume;
              sound.currentTime = 0;
              
              // Try to play the sound
              const playPromise = sound.play();
              if (playPromise !== undefined) {
                playPromise.then(() => {
                  console.log('Warcraft sound played successfully');
                }).catch(error => {
                  console.error('Error playing Warcraft sound:', error);
                  console.error('Audio element state:', {
                    src: sound.src,
                    readyState: sound.readyState,
                    networkState: sound.networkState,
                    error: sound.error
                  });
                  showStatus('Error playing sound: ' + error.message, 'error');
                });
              }
              return;
            }
            
            // Set volume using gainNode if available
            if (sound.gainNode) {
              sound.gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
              console.log('Volume set via gainNode:', volume);
            } else if (typeof sound.volume !== 'undefined') {
              sound.volume = volume;
              console.log('Volume set via volume property:', volume);
            } else {
              console.log('No volume control available for this sound type');
            }
            
            // Use .start() for AudioBufferSourceNode, .play() for HTMLAudioElement
            if (typeof sound.start === 'function') {
              // Web Audio API AudioBufferSourceNode
              sound.start();
              console.log('Sound started using Web Audio API');
            } else if (typeof sound.play === 'function') {
              // HTML Audio Element
              sound.play().catch(error => {
                console.error('Error playing test sound:', error);
                showStatus('Error playing sound: ' + error.message, 'error');
              });
              console.log('Sound played using HTML Audio API');
            } else {
              console.error('Sound object has neither start() nor play() method:', sound);
              showStatus('Error: Sound object is invalid', 'error');
            }
          } else {
            console.error('Failed to generate sound:', soundType);
            showStatus('Error: Failed to generate sound', 'error');
          }
        }).catch(error => {
          console.error('Error loading sound:', error);
          showStatus('Error loading sound: ' + error.message, 'error');
        });
        return;
      }
      
      // Handle synchronous sounds
      const sound = soundPromise;
      if (sound) {
        console.log('Playing sound:', soundType, 'volume:', volume);
        
        // Set volume using gainNode if available
        if (sound.gainNode) {
          sound.gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
          console.log('Volume set via gainNode:', volume);
        } else if (typeof sound.volume !== 'undefined') {
          sound.volume = volume;
          console.log('Volume set via volume property:', volume);
        } else {
          console.log('No volume control available for this sound type');
        }
        
        // Use .start() for AudioBufferSourceNode, .play() for HTMLAudioElement
        if (typeof sound.start === 'function') {
          // Web Audio API AudioBufferSourceNode
          sound.start();
          console.log('Sound started using Web Audio API');
        } else if (typeof sound.play === 'function') {
          // HTML Audio Element
          sound.play().catch(error => {
            console.error('Error playing test sound:', error);
            showStatus('Error playing sound: ' + error.message, 'error');
          });
          console.log('Sound played using HTML Audio API');
        } else {
          console.error('Sound object has neither start() nor play() method:', sound);
          showStatus('Error: Sound object is invalid', 'error');
        }
      } else {
        console.error('Failed to generate sound:', soundType);
        showStatus('Error: Failed to generate sound', 'error');
      }
    } catch (error) {
      console.error('Error generating test sound:', error);
      showStatus('Error generating sound: ' + error.message, 'error');
    }
  }

  // If not built-in, try IndexedDB custom by name
  try {
    getSoundFromDB(soundType).then(record => {
      if (!record || !record.data) {
        console.error('Unknown sound type:', soundType);
        showStatus('Error: Unknown sound type', 'error');
        return;
      }
      const toArrayBuffer = (obj) => {
        if (obj instanceof ArrayBuffer) return Promise.resolve(obj);
        if (obj instanceof Blob) return obj.arrayBuffer();
        if (obj && obj.buffer instanceof ArrayBuffer) return Promise.resolve(obj.buffer);
        return Promise.reject(new Error('Unsupported stored sound format'));
      };
      // Prefer HTMLAudioElement for broader codec support (esp. MP3 on Firefox)
      let blob = (record.data instanceof Blob)
        ? record.data
        : new Blob([record.data instanceof ArrayBuffer ? record.data : (record.data && record.data.buffer ? record.data.buffer : new ArrayBuffer(0))], { type: record.type || 'audio/mpeg' });
      if (!blob || blob.size === 0) {
        console.error('Empty blob from DB for sound', soundType);
        showStatus('Error playing sound: empty audio data', 'error');
        return;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = volume;
      audio.preload = 'auto';
      audio.play().then(() => {
        console.log('Playing custom sound from DB (HTMLAudio):', soundType);
      }).catch(err => {
        console.error('Error playing DB sound via HTMLAudio:', err);
        showStatus('Error playing sound: ' + err.message, 'error');
      }).finally(() => {
        audio.onended = () => URL.revokeObjectURL(url);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    }).catch(() => {
      console.error('Unknown sound type:', soundType);
      showStatus('Error: Unknown sound type', 'error');
    });
  } catch (_) {
    console.error('Unknown sound type:', soundType);
    showStatus('Error: Unknown sound type', 'error');
  }
}

/**
 * Test custom TTS template
 */
function testCustomTemplate() {
  const template = document.getElementById('ttsTemplate').value;
  if (!template.trim()) {
    showStatus('Please enter a custom template', 'error');
    return;
  }
  
  // Test with sample data
  const testContext = {
    winner: 'TestPlayer',
    bidAmount: 1000,
    itemName: 'Epic Sword',
    winners: 'TestPlayer',
    isRollOff: false,
    multipleWinners: false
  };
  
  const message = generateTTSMessage(template, testContext);
  
  const utterance = new SpeechSynthesisUtterance(message);
  
  // Set voice if specified
  const voiceName = document.getElementById('voice').value;
  if (voiceName) {
    const voices = speechSynthesis.getVoices();
    const selectedVoice = voices.find(voice => voice.name === voiceName);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
  }
  
  // Chrome's Speech Synthesis API caps rate at 2.0x, Firefox supports higher
  const isFirefox = (typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox'));
  const maxRate = isFirefox ? 2.5 : 2.0;
  const voiceSpeed = parseFloat(document.getElementById('voiceSpeed').value);
  utterance.rate = Math.min(voiceSpeed, maxRate);
  utterance.volume = 0.8;
  
  speechSynthesis.speak(utterance);
  showStatus('Testing custom template...', 'info');
  console.log('Custom template test:', message);
}

/**
 * Reset template to default
 */
function resetTemplate() {
  document.getElementById('ttsTemplate').value = 'Auction Finished. {winner} for {bidAmount} DKP on {itemName}';
  currentSettings.ttsTemplate = 'Auction Finished. {winner} for {bidAmount} DKP on {itemName}';
  showStatus('Template reset to default', 'success');
}

/**
 * Generate TTS message from template
 */
function generateTTSMessage(template, context) {
  let message = template;
  
  // Replace variables
  message = message.replace(/\{winner\}/g, context.winner || 'Unknown');
  message = message.replace(/\{bidAmount\}/g, context.bidAmount || '0');
  message = message.replace(/\{itemName\}/g, context.itemName || 'Unknown Item');
  message = message.replace(/\{winners\}/g, context.winners || 'Unknown');
  message = message.replace(/\{isRollOff\}/g, context.isRollOff ? 'true' : 'false');
  message = message.replace(/\{multipleWinners\}/g, context.multipleWinners ? 'true' : 'false');
  
  return message;
}
function testTTSForNotification(context) {
  console.log('TTS Test: Checking if TTS is enabled...');
  
  if (!document.getElementById('enableTTS').checked) {
    console.log('TTS Test: TTS is disabled, skipping');
    return;
  }
  
  console.log('TTS Test: TTS is enabled, generating message...');
  
  let message = '';
  
  // Check if advanced TTS is enabled and use custom template
  if (document.getElementById('enableAdvancedTTS').checked) {
    const template = document.getElementById('ttsTemplate').value;
    if (template.trim()) {
      message = generateTTSMessage(template, context);
      console.log('TTS Test: Using custom template:', message);
    } else {
      console.log('TTS Test: Custom template is empty, using default');
      // Fall back to default logic
      if (context.isRollOff) {
        message = `Roll-off for ${context.itemName}. Participants: ${context.winners.join(', ')}`;
      } else if (context.multipleWinners) {
        message = `Multiple winners for ${context.itemName}. Winners: ${context.winners.join(', ')}`;
      } else if (context.winner && context.bidAmount) {
        message = `Auction Finished. ${context.winner} for ${context.bidAmount} DKP on ${context.itemName}`;
      } else {
        message = `Auction Finished for ${context.itemName}`;
      }
    }
  } else {
    // Use default logic
    if (context.isRollOff) {
      message = `Roll-off for ${context.itemName}. Participants: ${context.winners.join(', ')}`;
    } else if (context.multipleWinners) {
      message = `Multiple winners for ${context.itemName}. Winners: ${context.winners.join(', ')}`;
    } else if (context.winner && context.bidAmount) {
      message = `Auction Finished. ${context.winner} for ${context.bidAmount} DKP on ${context.itemName}`;
    } else {
      message = `Auction Finished for ${context.itemName}`;
    }
  }
  
  console.log('TTS Test: Message generated:', message);
  
  const utterance = new SpeechSynthesisUtterance(message);
  
  // Set voice if specified
  const voiceName = document.getElementById('voice').value;
  console.log('TTS Test: Selected voice:', voiceName);
  
  if (voiceName) {
    const voices = speechSynthesis.getVoices();
    console.log('TTS Test: Available voices:', voices.length);
    const selectedVoice = voices.find(voice => voice.name === voiceName);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      console.log('TTS Test: Voice set to:', selectedVoice.name);
    } else {
      console.log('TTS Test: Voice not found, using default');
    }
  }
  
  // Chrome's Speech Synthesis API caps rate at 2.0x, Firefox supports higher
  const isFirefox = (typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox'));
  const maxRate = isFirefox ? 2.5 : 2.0;
  const voiceSpeed = parseFloat(document.getElementById('voiceSpeed').value);
  utterance.rate = Math.min(voiceSpeed, maxRate);
  utterance.volume = 0.8;
  
  console.log('TTS Test: Speaking with rate:', utterance.rate, 'volume:', utterance.volume);
  
  speechSynthesis.speak(utterance);
  console.log('TTS Test: Speech synthesis started');
}

/**
 * Test different notification types
 */
function testNotification(type) {
  const volume = document.getElementById('volume').value / 100;
  const quietEnabled = document.getElementById('quietHours').checked;
  const inQuiet = quietEnabled && isQuietHours();
  if (inQuiet) {
    console.log('[TestNotification] Quiet Hours active → suppressing sound and TTS');
  }

  // 0) Always run flash first (before notifications)
  try { 
    if (document.getElementById('flashScreen').checked) { 
      flashScreen(); 
    } 
  } catch (e) { 
    console.error('[TestNotification] Flash screen error:', e);
  }

  // 1) Always run visuals first (flash + desktop notification) regardless of Quiet Hours
  const browserNotificationsChecked = document.getElementById('browserNotifications').checked;
  console.log('[TestNotification] Browser notifications enabled:', browserNotificationsChecked);
  
  if (browserNotificationsChecked) {
    let message, details;
    switch (type) {
      case 'single':
        message = 'Auction Timer Complete!';
        details = ['Item: Epic Sword', 'Winner: TestPlayer', 'Bid: 1000'];
        break;
      case 'rolloff':
        message = 'Roll-off Required!';
        details = ['Item: Rare Potion', 'Bid Amount: 500', 'Roll-off Participants: Player1, Player2, Player3'];
        break;
      case 'multi':
        message = 'Multiple Winners!';
        details = ['Item: Common Item x 2', 'Quantity: 2', 'Winners: Player1, Player2', 'Bid Amount: 100'];
        break;
    }
    
    console.log('[TestNotification] Notification type:', type);
    console.log('[TestNotification] Message:', message);
    console.log('[TestNotification] Details:', details);
    
    // Get proper icon URL for extension context
    const api = typeof browser !== 'undefined' ? browser : chrome;
    const iconUrl = api.runtime.getURL('icons/icon-48.png');
    console.log('[TestNotification] Icon URL:', iconUrl);
    console.log('[TestNotification] Notification API available:', typeof Notification !== 'undefined');
    console.log('[TestNotification] Current permission:', Notification.permission);
    
    // Check if we're on an extension page (Chrome blocks web Notification API from extension pages)
    const isExtensionPage = window.location.protocol === 'chrome-extension:' || 
                           window.location.protocol === 'moz-extension:' ||
                           window.location.href.includes('chrome-extension://') ||
                           window.location.href.includes('moz-extension://');
    
    console.log('[TestNotification] Is extension page:', isExtensionPage, 'Protocol:', window.location.protocol);
    
    // Try Chrome's notifications API first for extension pages
    if (isExtensionPage && typeof chrome !== 'undefined' && chrome.notifications) {
      console.log('[TestNotification] Using chrome.notifications API (extension page)');
      try {
        chrome.notifications.create('opendkp-test-' + Date.now(), {
          type: 'basic',
          iconUrl: iconUrl,
          title: message,
          message: details.join('\n')
        }, (notificationId) => {
          if (chrome.runtime.lastError) {
            console.error('[TestNotification] ❌ chrome.notifications error:', chrome.runtime.lastError.message);
            showStatus('Error creating notification: ' + chrome.runtime.lastError.message, 'error');
          } else {
            console.log('[TestNotification] ✅ Chrome notification created:', notificationId);
            showStatus('✅ Test notification sent! (Using Chrome notifications API)', 'success');
            
            // Auto-close after 5 seconds
            setTimeout(() => {
              chrome.notifications.clear(notificationId, (wasCleared) => {
                console.log('[TestNotification] Notification cleared:', wasCleared);
              });
            }, 5000);
          }
        });
        // Continue to sound/TTS code below, don't return early
      } catch (e) {
        console.error('[TestNotification] ❌ chrome.notifications creation error:', e);
        // Fall through to web Notification API
      }
    }
    
    // Use web Notification API (works on regular pages, blocked on extension pages)
    try {
      if (Notification.permission === 'granted') {
        console.log('[TestNotification] ✅ Permission granted, creating notification...');
        const notification = new Notification(message, {
          body: details.join('\n'),
          icon: iconUrl,
          tag: 'opendkp-test'
        });
        console.log('[TestNotification] ✅ Notification created:', notification);
        
        notification.onerror = (e) => {
          console.error('[TestNotification] ❌ Notification error event:', e);
        };
        notification.onclick = () => {
          console.log('[TestNotification] 📌 Notification clicked');
          notification.close();
        };
        notification.onshow = () => {
          console.log('[TestNotification] 👁️ Notification shown');
          // If shown event fires but user doesn't see it, might be in notification center
          const isChrome = typeof chrome !== 'undefined' && !navigator.userAgent.includes('Firefox');
          if (isChrome) {
            console.log('[TestNotification] 💡 Chrome notification shown - check notification center (bell icon) if you don\'t see a banner');
            showStatus('Notification created! If you don\'t see a banner, check Chrome\'s notification center (bell icon 🔔)', 'info');
          }
        };
        notification.onclose = () => {
          console.log('[TestNotification] 🔒 Notification closed');
        };
      } else if (Notification.permission === 'denied') {
        console.warn('[TestNotification] ❌ Notification permission denied');
        showStatus('Notification permission denied. Please enable in browser settings.', 'error');
      } else {
        console.log('[TestNotification] ⚠️ Permission not yet requested, requesting...');
        Notification.requestPermission().then(permission => {
          console.log('[TestNotification] Permission request result:', permission);
          if (permission === 'granted') {
            console.log('[TestNotification] ✅ Permission granted after request, creating notification...');
            const notification = new Notification(message, {
              body: details.join('\n'),
              icon: iconUrl,
              tag: 'opendkp-test'
            });
            console.log('[TestNotification] ✅ Notification created:', notification);
            
            notification.onerror = (e) => {
              console.error('[TestNotification] ❌ Notification error event:', e);
            };
            notification.onclick = () => {
              console.log('[TestNotification] 📌 Notification clicked');
            };
            notification.onshow = () => {
              console.log('[TestNotification] 👁️ Notification shown');
            };
            notification.onclose = () => {
              console.log('[TestNotification] 🔒 Notification closed');
            };
          } else {
            console.warn('[TestNotification] ❌ Permission denied after request:', permission);
            showStatus('Notification permission denied: ' + permission, 'warning');
          }
        }).catch(err => {
          console.error('[TestNotification] ❌ Notification permission request error:', err);
          showStatus('Error requesting notification permission: ' + err.message, 'error');
        });
      }
    } catch (e) {
      console.error('[TestNotification] ❌ Notification creation error:', e);
      console.error('[TestNotification] Error stack:', e.stack);
      if (isExtensionPage) {
        showStatus('❌ Chrome blocks web notifications from extension pages. Notifications work on opendkp.com!', 'error');
      } else {
        showStatus('Error creating notification: ' + e.message, 'error');
      }
    }
  } else {
    console.log('[TestNotification] ⚠️ Browser notifications disabled in settings (sound and TTS will still work)');
    // Don't show warning - tests should work even if notifications are disabled
    // showStatus('Browser notifications are disabled. Enable them in settings first.', 'warning');
  }

  // If quiet hours are active, stop here (visuals already shown)
  if (inQuiet) {
    console.log('[TestNotification] Quiet hours active, skipping sound and TTS');
    return;
  }

  // 2) Sound + TTS always run (not blocked by visual settings) - only quiet hours block them
  const soundType = document.getElementById('soundType').value;
  let sound = null;
  
  // Check if it's a custom sound first
  if (currentSettings.customSounds && currentSettings.customSounds[soundType]) {
    try {
      const customSoundData = currentSettings.customSounds[soundType];
      console.log('Test notification - Custom sound data:', customSoundData);
      
      // Convert base64 back to AudioBuffer
      const binaryString = atob(customSoundData.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Convert bytes back to Float32Array
      const float32Array = new Float32Array(bytes.buffer);
      console.log('Test notification - Float32Array length:', float32Array.length, 'Expected:', customSoundData.length);
      
      // Create AudioBuffer with correct parameters
      const audioBuffer = audioContext.createBuffer(1, customSoundData.length, customSoundData.sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      
      // Copy the float data
      for (let i = 0; i < Math.min(float32Array.length, channelData.length); i++) {
        channelData[i] = float32Array[i];
      }
      
      // Create the custom sound
      const source = audioContext.createBufferSource();
      const gainNode = audioContext.createGain();
      
      source.buffer = audioBuffer;
      gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
      
      source.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      sound = source;
      console.log('Using custom sound for test notification:', soundType);
      
    } catch (error) {
      console.error('Error loading custom sound for test:', error);
    }
  } else if (!inQuiet && SOUND_OPTIONS[soundType]) {
    sound = SOUND_OPTIONS[soundType].generate();
    if (sound && typeof sound.then === 'function') {
      sound.then((audio) => {
        if (!audio) return;
        if (audio instanceof HTMLAudioElement) {
          audio.volume = volume;
          audio.currentTime = 0;
          audio.play().catch(() => {});
        } else if (typeof audio.start === 'function') {
          try { if (audio.gainNode) audio.gainNode.gain.setValueAtTime(volume, audioContext.currentTime); } catch(_) {}
          audio.start();
        }
      }).catch(() => {});
      // leave 'sound' as promise; duration calc below handles only non-promise
      sound = null;
    } else if (sound) {
      if (typeof sound.volume !== 'undefined') sound.volume = volume;
      if (typeof sound.play === 'function') { try { sound.currentTime = 0; sound.play(); } catch(_) {} }
      else if (typeof sound.start === 'function') { try { sound.start(); } catch(_) {} }
    }
  } else if (!inQuiet) {
    // Try DB custom
    try {
      const recPromise = getSoundFromDB(soundType);
      // Return early; we'll play async below
      recPromise.then(rec => {
        if (!rec || !rec.data) return;
        const blob = (rec.data instanceof Blob)
          ? rec.data
          : new Blob([rec.data instanceof ArrayBuffer ? rec.data : (rec.data && rec.data.buffer ? rec.data.buffer : new ArrayBuffer(0))], { type: rec.type || 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = volume;
        audio.play().finally(() => {
          audio.onended = () => URL.revokeObjectURL(url);
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        });
      }).catch(() => {});
    } catch (_) {}
  }
  
  // (visuals already executed at start)
  
  // Play sound and calculate duration for TTS timing
  let soundDuration = 0;
  if (!inQuiet && sound) {
    try {
      // Use .start() for Web Audio API AudioBufferSourceNode, .play() for HTMLAudioElement
      if (typeof sound.start === 'function') {
        // Web Audio API AudioBufferSourceNode
        sound.start();
        console.log('Sound started using Web Audio API');
        
        // Calculate duration from buffer
        if (sound.buffer) {
          soundDuration = sound.buffer.duration * 1000; // Convert to milliseconds
          console.log('Sound duration:', soundDuration + 'ms');
        }
      } else if (typeof sound.play === 'function') {
        // HTML Audio Element
        sound.play().then(() => {
          console.log('Sound played using HTML Audio API');
          
          // Calculate duration from audio element
          if (sound.duration && !isNaN(sound.duration)) {
            soundDuration = sound.duration * 1000; // Convert to milliseconds
            console.log('Sound duration:', soundDuration + 'ms');
          }
        }).catch(error => {
          console.error('Error playing notification sound:', error);
        });
      } else {
        console.error('Sound object has neither start() nor play() method:', sound);
      }
    } catch (error) {
      console.error('Error playing notification sound:', error);
    }
  }
  
  // Test TTS if enabled - wait for sound to finish plus a small buffer
  if (!inQuiet) {
    const ttsDelay = Math.max(soundDuration + 200, 500); // At least 500ms, or sound duration + 200ms buffer
    console.log('TTS will start after:', ttsDelay + 'ms');
    setTimeout(() => {
      let context = {};
      switch (type) {
        case 'single':
          context = { winner: 'TestPlayer', bidAmount: 1000, itemName: 'Epic Sword' };
          break;
        case 'rolloff':
          context = { isRollOff: true, itemName: 'Rare Potion', winners: ['Player1', 'Player2', 'Player3'] };
          break;
        case 'multi':
          context = { multipleWinners: true, itemName: 'Common Item x2', winners: ['Player1', 'Player2'] };
          break;
      }
      testTTSForNotification(context);
    }, ttsDelay);
  }
  
  // Flash screen if enabled
  try { if (document.getElementById('flashScreen').checked) { flashScreen(); } } catch (_) {}
}

/**
 * Check if two time windows overlap
 * @param {string} start1 - Start time in HH:MM format
 * @param {string} end1 - End time in HH:MM format
 * @param {string} start2 - Start time in HH:MM format
 * @param {string} end2 - End time in HH:MM format
 * @returns {boolean} - True if the windows overlap
 */
function timeWindowsOverlap(start1, end1, start2, end2) {
  const timeToMinutes = (timeStr) => {
    const [h, m] = timeStr.split(':').map(x => parseInt(x) || 0);
    return h * 60 + m;
  };
  
  const start1Min = timeToMinutes(start1);
  const end1Min = timeToMinutes(end1);
  const start2Min = timeToMinutes(start2);
  const end2Min = timeToMinutes(end2);
  
  // Handle overnight windows (e.g., 22:00 to 08:00)
  const wrap1 = end1Min < start1Min; // Window 1 crosses midnight
  const wrap2 = end2Min < start2Min; // Window 2 crosses midnight
  
  if (wrap1 && wrap2) {
    // Both windows cross midnight - they always overlap
    return true;
  } else if (wrap1) {
    // Window 1 crosses midnight, window 2 doesn't
    // Check if window 2 overlaps with either part of window 1
    return (start2Min >= start1Min || start2Min <= end1Min) ||
           (end2Min >= start1Min || end2Min <= end1Min) ||
           (start2Min <= start1Min && end2Min >= end1Min);
  } else if (wrap2) {
    // Window 2 crosses midnight, window 1 doesn't
    return (start1Min >= start2Min || start1Min <= end2Min) ||
           (end1Min >= start2Min || end1Min <= end2Min) ||
           (start1Min <= start2Min && end1Min >= end2Min);
  } else {
    // Neither window crosses midnight
    return (start1Min <= end2Min && start2Min <= end1Min);
  }
}

/**
 * Save settings to storage
 */
function saveSettings() {
  const getVal = (id, def) => { const el = document.getElementById(id); return el ? el.value : def; };
  const getChecked = (id, def) => { const el = document.getElementById(id); return el ? !!el.checked : def; };
  
  // Check for conflict between Quiet Hours and TTS Auction Announcements
  const quietHoursEnabled = getChecked('quietHours', currentSettings.quietHours);
  const announceAuctionsEnabled = getChecked('announceAuctions', currentSettings.announceAuctions);
  const enableTTS = getChecked('enableTTS', currentSettings.enableTTS);
  
  if (quietHoursEnabled && announceAuctionsEnabled && enableTTS) {
    const quietStart = getVal('quietStart', currentSettings.quietStart);
    const quietEnd = getVal('quietEnd', currentSettings.quietEnd);
    const announceStart = getVal('announceStart', currentSettings.announceStart);
    const announceEnd = getVal('announceEnd', currentSettings.announceEnd);
    
    if (timeWindowsOverlap(quietStart, quietEnd, announceStart, announceEnd)) {
      showStatus('⚠️ Conflict: Quiet Hours cannot overlap with TTS Auction Announcements. Please adjust the time windows.', 'error');
      return; // Prevent saving
    }
  }

  const newSettings = {
    enableTTS: getChecked('enableTTS', currentSettings.enableTTS),
    voice: getVal('voice', currentSettings.voice),
    voiceSpeed: parseFloat(getVal('voiceSpeed', currentSettings.voiceSpeed)),
    enableAdvancedTTS: getChecked('enableAdvancedTTS', currentSettings.enableAdvancedTTS),
    ttsTemplate: getVal('ttsTemplate', currentSettings.ttsTemplate),
    volume: parseInt(getVal('volume', currentSettings.volume)),
    soundProfile: getVal('soundProfile', currentSettings.soundProfile),
    soundType: getVal('soundType', currentSettings.soundType),
    // Save the current sound for the current profile
    [getVal('soundProfile', currentSettings.soundProfile) + 'Sound']: getVal('soundType', currentSettings.soundType),
    customSounds: currentSettings.customSounds || {},
    smartBidding: getChecked('smartBidding', currentSettings.smartBidding),
    quietHours: getChecked('quietHours', currentSettings.quietHours),
    quietStart: getVal('quietStart', currentSettings.quietStart),
    quietEnd: getVal('quietEnd', currentSettings.quietEnd),
    // Auction readout
    announceAuctions: getChecked('announceAuctions', currentSettings.announceAuctions),
    announceStart: getVal('announceStart', currentSettings.announceStart),
    announceEnd: getVal('announceEnd', currentSettings.announceEnd),
    disableVisuals: getChecked('disableVisuals', currentSettings.disableVisuals),
    raidLeaderNotification: getChecked('raidLeaderNotification', currentSettings.raidLeaderNotification),
    flashScreen: getChecked('flashScreen', currentSettings.flashScreen),
    browserNotifications: getChecked('browserNotifications', currentSettings.browserNotifications),
    checkInterval: parseInt(getVal('checkInterval', currentSettings.checkInterval)),
    // RaidTick Integration settings
    raidTickEnabled: getChecked('raidTickEnabled', currentSettings.raidTickEnabled),
    raidTickFolder: currentSettings.raidTickFolder,
    raidTickFolderHandle: currentSettings.raidTickFolderHandle,
    // Reminders
    reminders: (currentSettings.reminders || []).slice(0,5),
    reminderPrefs: currentSettings.reminderPrefs || { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] }
  };
  
  chrome.storage.sync.set(newSettings, function() {
    if (chrome.runtime.lastError) {
      console.error('[SaveSettings] Error:', chrome.runtime.lastError.message);
      showStatus('Error saving settings: ' + chrome.runtime.lastError.message, 'error');
    } else {
      console.log('[SaveSettings] Saved:', newSettings);
      showStatus('Settings saved successfully!', 'success');
      currentSettings = newSettings;
      // Immediately reflect profile-dependent UI without full refresh
      // Preserve scroll position when re-applying settings
      try { applySettingsToUI(); } catch(_) {}
      
      // Notify content scripts of settings change
      chrome.tabs.query({url: ['https://opendkp.com/*', 'https://*.opendkp.com/*']}, function(tabs) {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'settingsUpdated',
            settings: newSettings
          }).catch(() => {
            // Ignore errors for tabs that don't have the content script
          });
        });
      });
    }
  });
}

/**
 * Show status message
 */
function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + type;
  statusDiv.style.display = 'block';
  
  setTimeout(() => {
    statusDiv.style.display = 'none';
  }, 3000);
}

/**
 * Flash screen effect
 */
function flashScreen() {
  // Use an overlay that fades out, then remove it. This avoids mutating page background styles.
  try {
    const overlay = document.createElement('div');
    overlay.setAttribute('data-opendkp-flash', '');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483647';
    overlay.style.background = '#ff6b6b';
    overlay.style.opacity = '0.9';
    overlay.style.pointerEvents = 'none';
    overlay.style.transition = 'opacity 200ms ease';
    document.body.appendChild(overlay);
    // fade out
    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }, 220);
    }, 20);
  } catch (_) {}
}

// ===========================================================================
// SOUND GENERATION FUNCTIONS
// ===========================================================================

/**
 * Generate chime sound (default)
 */
function generateChimeSound() {
  if (!audioContext) {
    console.error('Audio context not available for chime');
    return null;
  }
  
  console.log('Generating chime sound, audio context state:', audioContext.state);
  
  try {
    const duration = 1.5;
    const frequency = 800;
    const sampleRate = audioContext.sampleRate;
    const frameCount = sampleRate * duration;
    
    console.log('Chime parameters:', { duration, frequency, sampleRate, frameCount });
    
    const buffer = audioContext.createBuffer(1, frameCount, sampleRate);
    const channelData = buffer.getChannelData(0);
    
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      channelData[i] = (
        Math.sin(2 * Math.PI * frequency * t) +
        0.6 * Math.sin(2 * Math.PI * frequency * 2 * t) +
        0.4 * Math.sin(2 * Math.PI * frequency * 3 * t) +
        0.2 * Math.sin(2 * Math.PI * frequency * 4 * t)
      ) * Math.exp(-t * 2.5);
    }
    
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    
    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Store the gain node for volume control
    source.gainNode = gainNode;
    
    console.log('Chime sound generated successfully, source:', source);
    return source;
  } catch (error) {
    console.error('Error generating chime sound:', error);
    return null;
  }
}


/**
 * Generate bell sound
 */
function generateBellSound() {
  if (!audioContext) {
    console.error('Audio context not available for bell');
    return null;
  }
  
  console.log('Generating bell sound, audio context state:', audioContext.state);
  
  try {
    const duration = 2.0;
    const frequency = 600;
    const sampleRate = audioContext.sampleRate;
    const frameCount = sampleRate * duration;
    
    console.log('Bell parameters:', { duration, frequency, sampleRate, frameCount });
    
    const buffer = audioContext.createBuffer(1, frameCount, sampleRate);
    const channelData = buffer.getChannelData(0);
    
    for (let i = 0; i < frameCount; i++) {
      const t = i / sampleRate;
      channelData[i] = (
        Math.sin(2 * Math.PI * frequency * t) +
        0.5 * Math.sin(2 * Math.PI * frequency * 2.76 * t) +
        0.25 * Math.sin(2 * Math.PI * frequency * 5.4 * t) +
        0.125 * Math.sin(2 * Math.PI * frequency * 8.93 * t)
      ) * Math.exp(-t * 1.5);
    }
    
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    
    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Store the gain node for volume control
    source.gainNode = gainNode;
    
    console.log('Bell sound generated successfully, source:', source);
    return source;
  } catch (error) {
    console.error('Error generating bell sound:', error);
    return null;
  }
}

/**
 * Generate ding sound
 */
function generateDingSound() {
  if (!audioContext) return null;
  
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.setValueAtTime(1000, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(2000, audioContext.currentTime + 0.3);
  oscillator.type = 'sine';
  
  gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
  
  // Store the gain node for volume control
  oscillator.gainNode = gainNode;
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.3);
  
  return oscillator;
}

/**
 * Generate "Job's Done!" sound (Warcraft peasant)
 */
function generateJobsDoneSound() {
  if (!audioContext) return null;
  
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  // Create a cheerful, ascending sound pattern
  oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.1);
  oscillator.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.2);
  oscillator.frequency.exponentialRampToValueAtTime(1000, audioContext.currentTime + 0.3);
  oscillator.type = 'sine';
  
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
  
  // Store the gain node for volume control
  oscillator.gainNode = gainNode;
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.4);
  
  return oscillator;
}

/**
 * Generate "Work Complete!" sound (Warcraft peasant)
 */
function generateWorkCompleteSound() {
  if (!audioContext) return null;
  
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  // Create a more triumphant, bell-like sound
  oscillator.frequency.setValueAtTime(300, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(500, audioContext.currentTime + 0.15);
  oscillator.frequency.exponentialRampToValueAtTime(700, audioContext.currentTime + 0.3);
  oscillator.frequency.exponentialRampToValueAtTime(900, audioContext.currentTime + 0.45);
  oscillator.type = 'triangle';
  
  gainNode.gain.setValueAtTime(0.25, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
  
  // Store the gain node for volume control
  oscillator.gainNode = gainNode;
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.5);
  
  return oscillator;
}

/**
 * Generate custom sound (placeholder)
 */
function generateCustomSound() {
  // For now, fallback to chime
  // In a full implementation, this would load a user-uploaded audio file
  return generateChimeSound();
}

/**
 * Generate real Warcraft sound from MP3 file
 */
function generateRealWarcraftSound(filename) {
  try {
    // Create audio element to load the MP3 file
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    
    // For extension files, we need to use chrome.runtime.getURL
    const fileUrl = chrome.runtime.getURL(filename);
    audio.src = fileUrl;
    
    // Create a promise-based loader
    return new Promise((resolve, reject) => {
      audio.addEventListener('canplaythrough', () => {
        console.log('Warcraft sound loaded successfully:', filename);
        console.log('Audio element ready:', {
          src: audio.src,
          readyState: audio.readyState,
          duration: audio.duration
        });
        // Return the audio element directly for HTML Audio API playback
        resolve(audio);
      });
      
      audio.addEventListener('error', (e) => {
        console.error('Error loading Warcraft sound:', e);
        console.error('Audio error details:', {
          error: audio.error,
          src: audio.src,
          networkState: audio.networkState,
          readyState: audio.readyState
        });
        reject(e);
      });
      
      audio.addEventListener('loadstart', () => {
        console.log('Started loading Warcraft sound:', filename);
      });
      
      // Start loading
      audio.load();
    });
  } catch (error) {
    console.error('Error creating Warcraft sound:', error);
    return null;
  }
}

/**
 * RaidTick Integration Functions
 */

/**
 * Select RaidTick folder using File System Access API
 */
async function selectRaidTickFolder() {
  try {
    console.log('Attempting to copy RaidTick file...');
    
    // Check if File System Access API is supported (Chrome/Edge)
    if ('showDirectoryPicker' in window) {
      // Chrome: Open file picker to copy file content
      console.log('Using file picker (Chrome/Edge)');
      await copyRaidTickFileFromPicker();
    } else {
      // Firefox: Use existing file copy tool
      console.log('Using file copy tool (Firefox/Safari)');
      await selectFolderWithFileInput();
    }
    
  } catch (error) {
    console.error('Error copying file:', error);
    showStatus('Error copying file: ' + error.message, 'error');
  }
}

/**
 * Copy RaidTick file from file picker (Chrome/Edge)
 */
async function copyRaidTickFileFromPicker() {
  try {
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
        showStatus(`✅ File copied to clipboard! ${lineCount} lines copied (excluding header)`, 'success');
      } catch (error) {
        console.error('Error copying file:', error);
        showStatus('❌ Failed to copy file: ' + escapeHtml(error.message), 'error');
      } finally {
        document.body.removeChild(input);
      }
    }, { once: true });
    
    // Trigger file picker
    input.click();
  } catch (error) {
    console.error('Error opening file picker:', error);
    showStatus('Error opening file picker: ' + escapeHtml(error.message), 'error');
  }
}

/**
 * Select folder using File System Access API (Chrome/Edge)
 */
async function selectFolderWithFileSystemAPI() {
  try {
    const folderHandle = await window.showDirectoryPicker({
      mode: 'read'
    });
    
    console.log('Folder selected:', folderHandle.name);
    
    // Store the folder handle and path
    currentSettings.raidTickFolderHandle = folderHandle;
    currentSettings.raidTickFolder = folderHandle.name;
    
    // Update UI
    document.getElementById('raidTickFolder').value = folderHandle.name;
    document.getElementById('clearFolder').style.display = 'inline-block';
    
    // Enable RaidTick monitoring automatically when folder is selected
    currentSettings.raidTickEnabled = true;
    if (document.getElementById('raidTickEnabled')) {
      document.getElementById('raidTickEnabled').checked = true;
    }
    
    // Save folder selection and enabled status
    chrome.storage.sync.set({
      raidTickFolder: currentSettings.raidTickFolder,
      raidTickEnabled: true
    });
    
    showStatus('RaidTick folder selected successfully!', 'success');
    
    // Test folder access by scanning for RaidTick files
    await scanRaidTickFiles(folderHandle);
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('User cancelled folder selection');
      return;
    }
    throw error;
  }
}

/**
 * Select folder using file input (Firefox/Safari)
 */
async function selectFolderWithFileInput() {
  // Trigger the hidden file input
  document.getElementById('folderInput').click();
}

/**
 * Handle file input change (Firefox/Safari)
 */
async function handleFolderInputChange(event) {
  try {
    const files = event.target.files;
    if (!files || files.length === 0) {
      console.log('No files selected');
      return;
    }
    
    console.log('Files selected:', files.length);
    console.log('🔒 SECURITY NOTE: Files are accessed locally only - no data is uploaded or shared');
    
    // Get the folder name from the first file's path
    const firstFile = files[0];
    const folderName = firstFile.webkitRelativePath.split('/')[0];
    
    console.log('Folder name:', folderName);
    
    // Store the files and folder info
    currentSettings.raidTickFiles = Array.from(files);
    currentSettings.raidTickFolder = folderName;
    currentSettings.raidTickFolderHandle = null; // Not available in Firefox
    
    // Update UI
    document.getElementById('raidTickFolder').value = folderName;
    document.getElementById('clearFolder').style.display = 'inline-block';
    
    showStatus('✅ Folder selected! (' + files.length + ' files) - All processing is LOCAL ONLY', 'success');
    
    // Scan for RaidTick files
    await scanRaidTickFilesFromFileList(files);
    
  } catch (error) {
    console.error('Error handling folder input:', error);
    showStatus('Error selecting folder: ' + error.message, 'error');
  }
}

/**
 * Scan RaidTick files from FileList (Firefox/Safari)
 */
async function scanRaidTickFilesFromFileList(files) {
  try {
    console.log('Scanning RaidTick files from file list...');
    
    const raidTickFiles = [];
    // Match RaidTick files with flexible time format (accepts both single and double digit seconds)
    const raidTickRegex = /^RaidTick-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{1,2}\.txt$/;
    
    for (const file of files) {
      if (raidTickRegex.test(file.name)) {
        // Store lightweight metadata only (Firefox storage.sync quota friendly)
        raidTickFiles.push({
          name: file.name,
          date: extractDateFromFilename(file.name),
          size: file.size
        });
      }
    }
    
    console.log('Found RaidTick files:', raidTickFiles.length);
    
    if (raidTickFiles.length > 0) {
      showStatus(`Found ${raidTickFiles.length} RaidTick files!`, 'success');
    } else {
      showStatus('No RaidTick files found in selected folder', 'warning');
    }
    
    // Store the files for later use
    currentSettings.raidTickFileList = raidTickFiles;
    
    // Debug: Show the corrected dates
    console.log('Corrected file dates:');
    raidTickFiles.forEach(file => {
      console.log(`${file.name} -> ${file.date.toISOString()}`);
    });
    
    // Save to storage for popup access (metadata only to avoid sync quota)
    try {
      chrome.storage.sync.set({
        raidTickFileList: raidTickFiles
      }, function() {
        if (chrome.runtime.lastError) {
          console.warn('Storage API error (Firefox development mode):', chrome.runtime.lastError.message);
          console.log('RaidTick files will work in current session but may not persist');
        } else {
          console.log('RaidTick files saved to storage successfully');
        }
      });
    } catch (error) {
      console.warn('Storage API not available (Firefox development mode):', error.message);
      console.log('RaidTick files will work in current session but may not persist');
    }
    
  } catch (error) {
    console.error('Error scanning files:', error);
    showStatus('Error scanning files: ' + error.message, 'error');
  }
}

/**
 * Clear RaidTick folder selection
 */
function clearRaidTickFolder() {
  currentSettings.raidTickFolderHandle = null;
  currentSettings.raidTickFolder = '';
  currentSettings.raidTickFiles = [];
  currentSettings.raidTickFileList = [];
  
  // Update UI
  document.getElementById('raidTickFolder').value = '';
  document.getElementById('clearFolder').style.display = 'none';
  document.getElementById('folderInput').value = ''; // Clear file input
  
  // Clear from storage
  try {
    chrome.storage.sync.remove(['raidTickFileList'], function() {
      if (chrome.runtime.lastError) {
        console.warn('Storage API error (Firefox development mode):', chrome.runtime.lastError.message);
      } else {
        console.log('RaidTick files cleared from storage');
      }
    });
  } catch (error) {
    console.warn('Storage API not available (Firefox development mode):', error.message);
  }
  
  showStatus('RaidTick folder cleared', 'info');
}

/**
 * Scan folder for RaidTick files
 */
async function scanRaidTickFiles(folderHandle) {
  try {
    const raidTickFiles = [];
    // Match RaidTick files with flexible time format (accepts both single and double digit seconds)
    // Examples: RaidTick-2025-10-31_23-43-30.txt OR RaidTick-2025-10-31_21-23-3.txt
    const raidTickPattern = /^RaidTick-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{1,2}\.txt$/;
    
    // Get all files in the folder and read their content for popup access
    console.log('Scanning folder for RaidTick files...');
    let fileCount = 0;
    for await (const [name, handle] of folderHandle.entries()) {
      if (handle.kind === 'file') {
        fileCount++;
        if (raidTickPattern.test(name)) {
          console.log(`Found RaidTick file: ${name}`);
          try {
            const file = await handle.getFile();
            // Read file content as text (RaidTick files are small text files)
            const fileContent = await file.text();
            const date = extractDateFromFilename(name);
            const dateStr = formatDateForStorage(date);
            raidTickFiles.push({
              name: name,
              date: date,
              size: file.size,
              dateStr: dateStr,
              content: fileContent // Store file content for popup copy buttons
            });
            console.log(`  - Processed: ${name}, date: ${dateStr}, size: ${file.size}, content length: ${fileContent.length}`);
          } catch (error) {
            console.error(`Error reading file ${name}:`, error);
          }
        }
      }
    }
    console.log(`Scanned ${fileCount} total files, found ${raidTickFiles.length} RaidTick files`);
    
    console.log(`Found ${raidTickFiles.length} RaidTick files:`, raidTickFiles);
    showStatus(`Found ${raidTickFiles.length} RaidTick files in folder`, 'success');
    
    // Store file metadata for popup access
    currentSettings.raidTickFileList = raidTickFiles;
    
    // Save to storage so popup can display files with copy buttons
    if (raidTickFiles.length === 0) {
      console.warn('No RaidTick files found - nothing to save');
      showStatus('No RaidTick files found in selected folder', 'warning');
      return raidTickFiles;
    }
    
    // Prepare files for storage
    // Note: Chrome storage.sync has a 102KB quota limit, so we store file content
    // but might need to limit if there are too many large files
    const filesForStorage = raidTickFiles.map(f => {
      const fileData = {
        name: f.name,
        size: f.size,
        dateStr: f.dateStr || formatDateForStorage(f.date),
        date: f.date ? f.date.toISOString() : new Date().toISOString(),
        content: f.content || '' // Store file content for copy buttons
      };
      console.log('Preparing file for storage:', fileData.name, 'size:', fileData.size, 'content length:', fileData.content.length);
      return fileData;
    });
    
    // Calculate total size
    const totalSize = filesForStorage.reduce((sum, f) => sum + (f.content ? f.content.length : 0), 0);
    console.log(`Total file content size: ${totalSize} bytes (${(totalSize / 1024).toFixed(2)} KB)`);
    
    // Chrome storage.sync has 102KB limit per item, but we can store multiple items
    // However, each file is part of raidTickFileList, so we need to keep total under quota
    // Strategy: Store content for smaller files first, skip content only if truly necessary
    let finalFilesForStorage = filesForStorage;
    const QUOTA_LIMIT = 100000; // 100KB safety limit (102KB is actual limit)
    
    if (totalSize > QUOTA_LIMIT) {
      console.warn(`Warning: Total content size (${(totalSize / 1024).toFixed(2)} KB) exceeds safety limit`);
      // Try to store content for as many files as possible, prioritizing smaller files
      // Sort files by size (smallest first) and include content until we hit the limit
      const sortedFiles = [...filesForStorage].sort((a, b) => (a.content ? a.content.length : 0) - (b.content ? b.content.length : 0));
      let accumulatedSize = 0;
      
      finalFilesForStorage = filesForStorage.map(f => {
        const contentSize = f.content ? f.content.length : 0;
        // Include content if it won't push us over the limit
        if (accumulatedSize + contentSize <= QUOTA_LIMIT && contentSize > 0) {
          accumulatedSize += contentSize;
          return f; // Keep content
        } else {
          // Skip content for this file
          return {
            name: f.name,
            size: f.size,
            dateStr: f.dateStr,
            date: f.date,
            content: '' // Content too large or quota exceeded
          };
        }
      });
      
      console.log(`Storing ${finalFilesForStorage.filter(f => f.content).length} files with content, ${finalFilesForStorage.filter(f => !f.content).length} without content`);
    }
    
    console.log(`Saving ${finalFilesForStorage.length} files to storage...`);
    
    // Save to storage (with or without content depending on size)
    try {
      chrome.storage.sync.set({
        raidTickFileList: finalFilesForStorage,
        raidTickEnabled: true,
        raidTickFolder: currentSettings.raidTickFolder
      }, function() {
        if (chrome.runtime.lastError) {
          console.error('❌ Storage API error:', chrome.runtime.lastError.message);
          console.error('Error details:', chrome.runtime.lastError);
          showStatus('❌ Error saving files: ' + chrome.runtime.lastError.message, 'error');
          
          // Try saving without content as fallback if we haven't already
          if (finalFilesForStorage[0] && finalFilesForStorage[0].content) {
            console.log('Attempting to save files without content as fallback...');
            const filesMinimal = finalFilesForStorage.map(f => ({
              name: f.name,
              size: f.size,
              dateStr: f.dateStr,
              date: f.date
              // No content
            }));
            chrome.storage.sync.set({
              raidTickFileList: filesMinimal,
              raidTickEnabled: true,
              raidTickFolder: currentSettings.raidTickFolder
            }, function() {
              if (chrome.runtime.lastError) {
                console.error('❌ Fallback save also failed:', chrome.runtime.lastError.message);
                showStatus('❌ Failed to save files - storage quota exceeded?', 'error');
              } else {
                console.log('✅ Saved files without content (content will be loaded on-demand)');
                showStatus('✅ Saved ' + filesMinimal.length + ' files (content on-demand)', 'success');
              }
            });
          }
        } else {
          console.log(`✅ Successfully saved ${finalFilesForStorage.length} RaidTick files to storage`);
          console.log('Sample file:', {
            name: finalFilesForStorage[0].name,
            size: finalFilesForStorage[0].size,
            hasContent: !!finalFilesForStorage[0].content,
            contentLength: finalFilesForStorage[0].content ? finalFilesForStorage[0].content.length : 0
          });
          showStatus(`✅ Saved ${finalFilesForStorage.length} files - ready for popup!`, 'success');
          
          // Verify save by reading back
          chrome.storage.sync.get(['raidTickFileList'], function(result) {
            if (chrome.runtime.lastError) {
              console.error('❌ Verification read error:', chrome.runtime.lastError.message);
            } else if (result.raidTickFileList) {
              console.log(`✅ Verification: Found ${result.raidTickFileList.length} files in storage`);
              console.log('First file in storage:', result.raidTickFileList[0]);
            } else {
              console.error('❌ Verification failed: No files in storage');
            }
          });
        }
      });
    } catch (error) {
      console.error('❌ Storage API exception:', error);
      showStatus('❌ Error saving files: ' + error.message, 'error');
    }
    
    return raidTickFiles;
    
  } catch (error) {
    console.error('Error scanning folder:', error);
    showStatus('Error scanning folder: ' + error.message, 'error');
    return [];
  }
}

/**
 * Format date for storage (YYYY-MM-DD)
 */
function formatDateForStorage(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) {
    return new Date().toISOString().split('T')[0];
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Extract date from RaidTick filename
 */
function extractDateFromFilename(filename) {
  // Match RaidTick files with flexible time format (accepts both single and double digit seconds)
  const match = filename.match(/RaidTick-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{1,2})\.txt$/);
  if (match) {
    const [, year, month, day] = match;
    // Create date in local timezone (not UTC) to match popup's formatDate() which uses local time
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }
  // Fallback to today if pattern doesn't match
  return new Date();
}

/**
 * Get RaidTick files for a specific date
 */
async function getRaidTickFilesForDate(folderHandle, targetDate) {
  const allFiles = await scanRaidTickFiles(folderHandle);
  const targetDateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD format
  
  return allFiles.filter(file => {
    if (!file.date) return false;
    const fileDateStr = file.date.toISOString().split('T')[0];
    return fileDateStr === targetDateStr;
  });
}

/**
 * EverQuest Log Parser Functions
 */
