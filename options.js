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
  theme: 'system', // 'system' | 'light' | 'dark' (Issue #5)
  // Auction readout (Issue #2: day-of-week for Read New Auctions)
  announceAuctions: false,
  announceStart: '19:00',
  announceEnd: '23:59',
  announceNewAuctionsDays: [0, 1, 2, 3, 4, 5, 6], // 0=Sun .. 6=Sat
  watchlistAlarmEnabled: false,
  watchlistItems: '',
  autoBidEnabled: false,
  autoBidIncrement: 10,
  autoBidPollIntervalSec: 15,
  autoBidPriority: 1,
  autoBidRules: [],
  itemPriceHistoryEnabled: true,
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
  reminderPrefs: { remindersEnabled: true, flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] }, // All days enabled by default (0=Sunday, 6=Saturday)
  // OpenDKP HTTP API (v2 raid workflow) — never hardcode a guild slug in code
  opendkpClientSlug: '',
  opendkpRaidListCount: 1,
  opendkpBiddingToolRaidLock: true,
  opendkpCurrentRaidId: null,
  opendkpCurrentRaidSummaryJson: '',
  opendkpRaidtickUploadEnabled: false,
  opendkpTickDkpValue: 1,
  opendkpRaidTickDefs: [
    { id: 't-hour1', description: 'Hour #1', value: 25 },
    { id: 't-hour2', description: 'Hour #2', value: 25 },
    { id: 't-hour3', description: 'Hour #3', value: 25 }
  ],
  opendkpAttendance: 1,
  opendkpCognitoUsername: '',
  opendkpPreferredPoolId: '',
  opendkpAuctionPayStrategy: 'exact',
  opendkpAuctionDuration: 2,
  eqLogLootExceptions: ['Spell:', 'A Glowing Orb of Luclinite']
};

/** Cognito app ClientId from OpenDKP Postman collection (Get Access Token). Bundled for API sign-in. */
const OPEN_DKP_COGNITO_CLIENT_ID = '2sq61k8dj39e309tnh5tm70dd4';
const OPEN_DKP_API_HOST = 'api.opendkp.com';
const OPEN_DKP_PASSWORD_STORAGE_KEY = 'opendkpCognitoPassword';
/** Local keys omitted from backup unless user opts in (plain-text secrets). */
const BACKUP_SENSITIVE_LOCAL_KEYS = [
  OPEN_DKP_PASSWORD_STORAGE_KEY,
  'opendkpIdToken',
  'opendkpAccessToken',
  'opendkpRefreshToken',
  'opendkpTokenExpiresAtMs'
];
const OPEN_DKP_ROSTER_CACHE_STORAGE_KEY = 'opendkpRosterCacheBySlug';
const OPEN_DKP_POOLS_CACHE_STORAGE_KEY = 'opendkpPoolsCache';
const AUTO_BID_CHARACTERS_CACHE_KEY = 'autoBidCharactersCache';
/** Local mirror when sync is empty, quota-limited, or lost on reload (Firefox). */
const LOCAL_SETTINGS_MIRROR_KEY = 'opendkpSettingsLocalMirror';
const OPEN_DKP_MAX_RAID_TICK_DEFS = 10;

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

/**
 * Load OpenDKP API scripts via runtime.getURL so they work in Firefox/Chrome even when
 * relative script tags for lib/ paths fail (e.g. certain packaged layouts).
 */
function loadOpenDkpHelperLibs() {
  return new Promise(function (resolve) {
    const ext = typeof browser !== 'undefined' ? browser : chrome;
    function inject(path, hasGlobal, next) {
      if (hasGlobal()) {
        next();
        return;
      }
      const url = ext.runtime.getURL(path);
      const s = document.createElement('script');
      s.src = url;
      s.onload = function () {
        if (!hasGlobal()) {
          console.error('[OpenDKP] Script ran but global missing:', path);
        }
        next();
      };
      s.onerror = function () {
        console.error('[OpenDKP] Failed to load (missing from add-on package?):', url);
        next();
      };
      (document.head || document.documentElement).appendChild(s);
    }
    inject(
      'lib/opendkp-api.js',
      function () {
        return typeof window.OpenDkpApi !== 'undefined';
      },
      function () {
        inject(
          'lib/rank-bid-limits.js',
          function () {
            return typeof window.OpenDkpRankBidLimits !== 'undefined';
          },
          function () {
            inject(
              'lib/auto-bid.js',
              function () {
                return typeof window.AutoBid !== 'undefined';
              },
              function () {
                inject(
                  'lib/raidtick-parse.js',
                  function () {
                    return typeof window.RaidTickParse !== 'undefined';
                  },
                  function () {
                    inject(
                      'lib/raidtick-queue.js',
                      function () {
                        return typeof window.RaidTickQueue !== 'undefined';
                      },
                      function () {
                        resolve();
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });
}

// Initialize the options page
document.addEventListener('DOMContentLoaded', async function() {
  await loadOpenDkpHelperLibs();
  initializePage();
  loadSettings();
  setupEventListeners();
  api.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'sync' || !changes.eqLogLootExceptions) return;
    currentSettings.eqLogLootExceptions = Array.isArray(changes.eqLogLootExceptions.newValue)
      ? changes.eqLogLootExceptions.newValue
      : [];
    const el = document.getElementById('eqLogLootExceptions');
    if (el) el.value = currentSettings.eqLogLootExceptions.join('\n');
    updateEqLogLootExceptionsSummary();
  });
  
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

      // Firefox: Loot monitor button (section lives in Raid Leader region)
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

      // Chrome: Loot monitor button (section lives in Raid Leader region)
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

  // Apply theme (light/dark/system) - Issue #5
  function applyTheme(theme) {
    const isDark = theme === 'dark' || (theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) document.body.classList.add('dark-mode');
    else document.body.classList.remove('dark-mode');
    try { console.log('[Options] applyTheme:', theme, 'resolvedDark=', isDark); } catch(_) {}
    setTimeout(() => { try { renderRemindersUI(); } catch(_) {} }, 0);
  }
  window.applyTheme = applyTheme;
  if (typeof matchMedia !== 'undefined') {
    try {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
        const theme = (document.getElementById('theme') && document.getElementById('theme').value) || currentSettings.theme || 'system';
        if (theme === 'system') applyTheme('system');
      });
    } catch (_) {}
  }

  try {
    if (api && api.storage && api.storage.sync) {
      const getter = api.storage.sync.get(['theme', 'darkMode']);
      if (getter && typeof getter.then === 'function') {
        getter.then(result => {
          const theme = result.theme || (result.darkMode ? 'dark' : 'light');
          applyTheme(theme);
        });
      } else {
        api.storage.sync.get(['theme', 'darkMode'], function(result){
          const theme = result.theme || (result.darkMode ? 'dark' : 'light');
          applyTheme(theme);
        });
      }
    }
  } catch (_) {}

  // Listen for theme/dark mode changes (from popup or other tabs)
  (api && api.storage ? api.storage : chrome.storage).onChanged.addListener(function(changes, namespace) {
    if (namespace === 'sync' && (changes.theme || changes.darkMode)) {
      const theme = changes.theme ? changes.theme.newValue : (changes.darkMode ? (changes.darkMode.newValue ? 'dark' : 'light') : null);
      if (theme != null) applyTheme(theme);
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

  try {
    (api && api.runtime ? api.runtime : chrome.runtime).onMessage.addListener(function(message) {
      if (message && message.type === 'darkModeChanged') {
        applyTheme(message.value ? 'dark' : 'light');
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
  
  // Clear existing options (no default entry) - use DOM API instead of innerHTML
  while (voiceSelect.firstChild) {
    voiceSelect.removeChild(voiceSelect.firstChild);
  }
  
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
    const announceDaysRow = document.getElementById('announceDaysRow');
    if (announceDaysRow) announceDaysRow.style.display = 'none';
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
  // Set extension icon in header
  const extensionIcon = document.getElementById('extensionIcon');
  if (extensionIcon && api.runtime && api.runtime.getURL) {
    extensionIcon.src = api.runtime.getURL('icons/icon-48.png');
  }
  
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
 * Uses api (browser/chrome). Firefox: restores reminders from storage.local if sync lost them.
 */
function loadSettings() {
  const keys = ['theme', 'darkMode', ...Object.keys(DEFAULT_SETTINGS)];
  const getSync = () => new Promise((resolve, reject) => {
    api.storage.sync.get(keys, (result) => {
      if (api.runtime?.lastError) reject(api.runtime.lastError);
      else resolve(result);
    });
  });
  const getLocalFallback = () => new Promise((resolve) => {
    if (!api.storage.local) return resolve(null);
    api.storage.local.get(['reminders', 'reminderPrefs'], (result) => {
      resolve(api.runtime?.lastError ? null : result);
    });
  });

  const getLocalOpenDkp = () => new Promise((resolve) => {
    if (!api.storage.local) return resolve({});
    api.storage.local.get(
      [OPEN_DKP_PASSWORD_STORAGE_KEY, OPEN_DKP_ROSTER_CACHE_STORAGE_KEY, OPEN_DKP_POOLS_CACHE_STORAGE_KEY, LOCAL_SETTINGS_MIRROR_KEY],
      (result) => {
      resolve(api.runtime?.lastError ? {} : result || {});
    });
  });

  Promise.all([getSync(), getLocalFallback(), getLocalOpenDkp()]).then(([settings, local, localOpenDkp]) => {
    // Ensure Chrome defaults to Raid Leader mode if no profile is set
    if (!settings.soundProfile && typeof chrome !== 'undefined' && !navigator.userAgent.includes('Firefox')) {
      settings.soundProfile = 'raidleader';
    }
    // Firefox: if sync lost reminders, use storage.local backup
    if ((!settings.reminders || !Array.isArray(settings.reminders) || settings.reminders.length === 0) && local && Array.isArray(local.reminders) && local.reminders.length > 0) {
      settings.reminders = local.reminders;
      if (local.reminderPrefs && typeof local.reminderPrefs === 'object') {
        settings.reminderPrefs = local.reminderPrefs;
      }
    }
    applyCriticalSettingsMirror(settings, localOpenDkp[LOCAL_SETTINGS_MIRROR_KEY]);
    currentSettings = { ...DEFAULT_SETTINGS, ...settings };
    currentSettings.opendkpRaidListCount = openDkpNormalizeRaidListCountSetting(
      currentSettings.opendkpRaidListCount
    );
    currentSettings.opendkpRaidTickDefs = openDkpNormalizeRaidTickDefs(
      currentSettings.opendkpRaidTickDefs,
      currentSettings.opendkpTickDkpValue
    );
    currentSettings.raidleaderSound =
      currentSettings.raidleaderSound || currentSettings.raidLeaderSounds || 'bell';
    currentSettings.raiderSound =
      currentSettings.raiderSound || currentSettings.raiderSounds || 'chime';
    currentSettings.opendkpTickDkpValue = openDkpResolveTickDkpValueForPersist();
    if (!Array.isArray(currentSettings.eqLogLootExceptions)) {
      currentSettings.eqLogLootExceptions = parseEqLogLootExceptionsFromText(
        currentSettings.eqLogLootExceptions
      );
    }
    __odRosterCacheRoot = localOpenDkp[OPEN_DKP_ROSTER_CACHE_STORAGE_KEY] || {};
    __odPoolsCache = localOpenDkp[OPEN_DKP_POOLS_CACHE_STORAGE_KEY] || { pools: [] };
    __odSavedApiPassword = localOpenDkp[OPEN_DKP_PASSWORD_STORAGE_KEY] || '';
    console.log('[LoadSettings] Loaded from storage:', {
      volume: currentSettings.volume,
      soundType: currentSettings.soundType,
      soundProfile: currentSettings.soundProfile,
      darkMode: settings.darkMode,
      reminderCount: (currentSettings.reminders || []).length
    });
    if (!currentSettings.customSounds || typeof currentSettings.customSounds !== 'object') {
      currentSettings.customSounds = {};
    }
    const theme = settings.theme || (settings.darkMode ? 'dark' : 'light');
    applyTheme(theme);
    applySettingsToUI();
  }).catch((err) => {
    console.error('[LoadSettings] Error loading settings:', err);
    currentSettings = { ...DEFAULT_SETTINGS };
    applySettingsToUI();
  });
}

let persistCriticalSettingsTimer = null;

function isEmptySettingValue(value) {
  if (value == null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Prefer local mirror when sync is missing critical watchlist / OpenDKP fields. */
function applyCriticalSettingsMirror(target, mirror) {
  if (!mirror || typeof mirror !== 'object') return target;
  const keys = [
    'watchlistAlarmEnabled',
    'watchlistItems',
    'opendkpClientSlug',
    'opendkpCognitoUsername',
    'opendkpRaidListCount',
    'opendkpBiddingToolRaidLock',
    'opendkpCurrentRaidId',
    'opendkpCurrentRaidSummaryJson',
    'opendkpRaidtickUploadEnabled',
    'opendkpRaidTickDefs',
    'opendkpTickDkpValue',
    'opendkpAttendance',
    'opendkpPreferredPoolId',
    'opendkpAuctionPayStrategy',
    'opendkpAuctionDuration',
    'autoBidEnabled',
    'autoBidIncrement',
    'autoBidPollIntervalSec',
    'autoBidRules',
    'itemPriceHistoryEnabled'
  ];
  keys.forEach(function(key) {
    if (isEmptySettingValue(target[key]) && !isEmptySettingValue(mirror[key])) {
      target[key] = mirror[key];
    }
  });
  return target;
}

function collectCriticalSettingsFromUI() {
  const getVal = (id, def) => { const el = document.getElementById(id); return el ? el.value : def; };
  const getChecked = (id, def) => { const el = document.getElementById(id); return el ? !!el.checked : def; };
  const rawOpenSlug = String(getVal('opendkpClientSlug', currentSettings.opendkpClientSlug || '') || '').trim();
  const normOpenSlug = normalizeOpenDkpClientSlug(rawOpenSlug);

  return {
    watchlistAlarmEnabled: getChecked('watchlistAlarmEnabled', currentSettings.watchlistAlarmEnabled),
    watchlistItems: getVal('watchlistItems', currentSettings.watchlistItems || ''),
    opendkpClientSlug: rawOpenSlug === '' ? '' : (normOpenSlug || currentSettings.opendkpClientSlug || ''),
    opendkpCognitoUsername: String(getVal('opendkpCognitoUser', currentSettings.opendkpCognitoUsername || '')).trim(),
    opendkpRaidListCount: openDkpGetRaidListCountFromUI(),
    opendkpBiddingToolRaidLock: getChecked(
      'opendkpBiddingToolRaidLock',
      currentSettings.opendkpBiddingToolRaidLock !== false
    ),
    opendkpCurrentRaidId: currentSettings.opendkpCurrentRaidId,
    opendkpCurrentRaidSummaryJson: currentSettings.opendkpCurrentRaidSummaryJson || '',
    opendkpRaidtickUploadEnabled: isOpenDkpRaidtickUploadSunset()
      ? false
      : getChecked('opendkpRaidtickUploadEnabled', currentSettings.opendkpRaidtickUploadEnabled),
    opendkpRaidTickDefs: openDkpNormalizeRaidTickDefs(
      currentSettings.opendkpRaidTickDefs,
      currentSettings.opendkpTickDkpValue
    ).slice(0, OPEN_DKP_MAX_RAID_TICK_DEFS),
    opendkpTickDkpValue: openDkpResolveTickDkpValueForPersist(),
    opendkpAttendance: openDkpParseAttendance(getVal('opendkpAttendance', currentSettings.opendkpAttendance)),
    opendkpPreferredPoolId: (() => {
      const el = document.getElementById('opendkpPoolSelect');
      return el && el.value ? String(el.value) : (currentSettings.opendkpPreferredPoolId || '');
    })(),
    opendkpAuctionPayStrategy: (() => {
      const el = document.getElementById('opendkpAuctionPayStrategy');
      const v = el ? el.value : (currentSettings.opendkpAuctionPayStrategy || 'exact');
      if (v === 'second_plus_one' || v === 'second_plus_one_equal') return v;
      return 'exact';
    })(),
    opendkpAuctionDuration: (() => {
      const el = document.getElementById('opendkpAuctionDuration');
      const raw = el ? el.value : currentSettings.opendkpAuctionDuration;
      const n = parseInt(String(raw != null ? raw : 2), 10);
      return Number.isNaN(n) || n < 1 ? 2 : n;
    })(),
    autoBidEnabled: getChecked('autoBidEnabled', currentSettings.autoBidEnabled),
    autoBidIncrement: (() => {
      const el = document.getElementById('autoBidIncrement');
      const n = parseInt(String(el ? el.value : currentSettings.autoBidIncrement), 10);
      return Number.isNaN(n) || n < 1 ? 10 : n;
    })(),
    autoBidPollIntervalSec: (() => {
      const el = document.getElementById('autoBidPollIntervalSec');
      const n = parseInt(String(el ? el.value : currentSettings.autoBidPollIntervalSec), 10);
      return Number.isNaN(n) || n < 5 ? 15 : n;
    })(),
    autoBidRules: autoBidReadRulesFromUI(),
    itemPriceHistoryEnabled: getChecked('itemPriceHistoryEnabled', currentSettings.itemPriceHistoryEnabled !== false),
    savedAt: Date.now()
  };
}

function persistCriticalSettingsToStorage(options) {
  const opts = options || {};
  const payload = collectCriticalSettingsFromUI();
  Object.assign(currentSettings, payload);

  const syncPayload = Object.assign({}, payload);
  delete syncPayload.savedAt;

  return new Promise(function(resolve, reject) {
    const finishLocalMirror = function() {
      if (!api.storage.local || !api.storage.local.set) {
        if (!opts.silent) showStatus('Watchlist & API settings saved locally', 'success');
        resolve(payload);
        return;
      }
      api.storage.local.set({ [LOCAL_SETTINGS_MIRROR_KEY]: payload }, function() {
        if (!opts.silent) showStatus('Watchlist & API settings saved', 'success');
        resolve(payload);
      });
    };

    api.storage.sync.set(syncPayload, function() {
      const syncErr = api.runtime?.lastError || chrome.runtime?.lastError;
      if (syncErr) {
        console.warn('[Settings] sync.set failed for critical settings (may exceed quota); using local mirror:', syncErr.message || syncErr);
        finishLocalMirror();
        return;
      }
      finishLocalMirror();
    });
  });
}

function schedulePersistCriticalSettings() {
  clearTimeout(persistCriticalSettingsTimer);
  persistCriticalSettingsTimer = setTimeout(function() {
    persistCriticalSettingsToStorage({ silent: true }).catch(function(err) {
      console.warn('[Settings] Auto-save failed:', err);
    });
  }, 800);
}

function countWatchlistLines(raw) {
  return String(raw || '').split('\n').map(function(line) { return line.trim(); }).filter(Boolean).length;
}

function countCachedRankBidLimits(localData) {
  const root = localData && localData.opendkpRankBidLimitsBySlug;
  if (!root || typeof root !== 'object') return 0;
  let total = 0;
  Object.keys(root).forEach(function (slug) {
    const ranks = root[slug] && root[slug].ranks;
    if (ranks && typeof ranks === 'object') {
      total += Object.keys(ranks).length;
    }
  });
  return total;
}

function buildBackupManifest(syncData, localData, eqLogHandleMeta) {
  const mirror = (localData && localData[LOCAL_SETTINGS_MIRROR_KEY]) || {};
  const watchlistRaw = syncData.watchlistItems || mirror.watchlistItems || '';
  const eqMeta = eqLogHandleMeta || {};
  return {
    watchlistItemCount: countWatchlistLines(watchlistRaw),
    watchlistAlarmEnabled: !!(syncData.watchlistAlarmEnabled || mirror.watchlistAlarmEnabled),
    opendkpClientSlug: syncData.opendkpClientSlug || mirror.opendkpClientSlug || '',
    opendkpCognitoUsername: syncData.opendkpCognitoUsername || mirror.opendkpCognitoUsername || '',
    hasApiPassword: !!(localData && localData[OPEN_DKP_PASSWORD_STORAGE_KEY]),
    hasApiTokens: !!(localData && localData.opendkpIdToken),
    opendkpRaidTickDefCount: Array.isArray(syncData.opendkpRaidTickDefs)
      ? syncData.opendkpRaidTickDefs.length
      : (Array.isArray(mirror.opendkpRaidTickDefs) ? mirror.opendkpRaidTickDefs.length : 0),
    autoBidEnabled: !!(syncData.autoBidEnabled || mirror.autoBidEnabled),
    autoBidRuleCount: Array.isArray(syncData.autoBidRules)
      ? syncData.autoBidRules.length
      : (Array.isArray(mirror.autoBidRules) ? mirror.autoBidRules.length : 0),
    rankBidLimitCount: countCachedRankBidLimits(localData),
    eqLogHandlePresent: !!eqMeta.handlePresent,
    eqLogFileName: eqMeta.handleName || (eqMeta.fileMeta && eqMeta.fileMeta.name) || ''
  };
}

function formatBackupRestoreSummary(backup) {
  const sync = backup.sync || {};
  const local = backup.local || {};
  const mirror = local[LOCAL_SETTINGS_MIRROR_KEY] || {};
  const watchlistRaw = sync.watchlistItems || mirror.watchlistItems || '';
  const parts = [countWatchlistLines(watchlistRaw) + ' watchlist item(s)'];
  const slug = sync.opendkpClientSlug || mirror.opendkpClientSlug;
  if (slug) parts.push('guild ' + slug);
  const user = sync.opendkpCognitoUsername || mirror.opendkpCognitoUsername;
  if (user) parts.push('API user ' + user);
  if (local[OPEN_DKP_PASSWORD_STORAGE_KEY]) parts.push('API password');
  if (local.opendkpIdToken) parts.push('API tokens');
  const tickCount = Array.isArray(sync.opendkpRaidTickDefs)
    ? sync.opendkpRaidTickDefs.length
    : (Array.isArray(mirror.opendkpRaidTickDefs) ? mirror.opendkpRaidTickDefs.length : 0);
  if (tickCount) parts.push(tickCount + ' raid tick def(s)');
  const autoBidRules = Array.isArray(sync.autoBidRules)
    ? sync.autoBidRules.length
    : (Array.isArray(mirror.autoBidRules) ? mirror.autoBidRules.length : 0);
  if (autoBidRules) parts.push(autoBidRules + ' auto-bid rule(s)');
  const rankLimitCount = countCachedRankBidLimits(local);
  if (rankLimitCount) parts.push(rankLimitCount + ' rank bid limit(s)');
  const eqMeta = backup.eqLogHandle || {};
  const eqName = eqMeta.handleName
    || (eqMeta.fileMeta && eqMeta.fileMeta.name)
    || (sync.eqLogFileMeta && sync.eqLogFileMeta.name)
    || '';
  if (eqName || eqMeta.handlePresent || sync.eqLogFileMeta) {
    parts.push(eqName ? ('EQ log ' + eqName + ' — re-select in Loot Monitor') : 'EQ log — re-select in Loot Monitor');
  }
  return parts.join(', ');
}

function wireCriticalSettingsAutoSave() {
  ['opendkpClientSlug', 'opendkpCognitoUser', 'opendkpAttendance', 'opendkpAuctionPayStrategy', 'opendkpAuctionDuration', 'opendkpRaidListCount'].forEach(function(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', schedulePersistCriticalSettings);
    el.addEventListener('change', schedulePersistCriticalSettings);
  });

  const passEl = document.getElementById('opendkpCognitoPassword');
  if (passEl) {
    passEl.addEventListener('blur', function() {
      const user = (document.getElementById('opendkpCognitoUser') || {}).value || currentSettings.opendkpCognitoUsername || '';
      const pass = passEl.value || '';
      if (pass) {
        openDkpPersistApiCredentials(user, pass).then(function() {
          return persistCriticalSettingsToStorage({ silent: true });
        }).catch(function(err) {
          console.warn('[Settings] Failed to persist API password:', err);
        });
      } else {
        schedulePersistCriticalSettings();
      }
    });
  }

  ['opendkpRaidtickUploadEnabled'].forEach(function(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', schedulePersistCriticalSettings);
  });

  const poolSel = document.getElementById('opendkpPoolSelect');
  if (poolSel) poolSel.addEventListener('change', schedulePersistCriticalSettings);

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      persistCriticalSettingsToStorage({ silent: true }).catch(function() {});
    }
  });
}

// ---------------------------------------------------------------------------
// OpenDKP API v2 — raid workflow (options page; uses lib/opendkp-api.js)
// ---------------------------------------------------------------------------
let __odRosterNameToId = {};
let __odClientId = '';
/** @type {Record<string, { fileName: string, names: string[] }>} tickId -> staged roster */
let __odRaidtickStageByTickId = {};
let __odRaidtickSelectWired = false;
let __odRosterCacheRoot = {};
let __odPoolsCache = { pools: [] };
let __autoBidCharactersCache = [];
let __autoBidRankLimits = {};
let __odSavedApiPassword = '';
let __autoBidRulesSyncFromUI = false;

function openDkpFormatApiError(e) {
  const parts = [];
  if (e && e.status) parts.push('HTTP ' + e.status);
  const bodyMsg =
    e &&
    e.body &&
    typeof e.body === 'object' &&
    (e.body.ErrorMessage || e.body.message || e.body.Message);
  if (bodyMsg && (!e.message || String(e.message).indexOf(String(bodyMsg)) === -1)) {
    parts.push(String(bodyMsg));
  } else if (e && e.message) {
    parts.push(e.message);
  }
  return parts.join(' — ') || 'Request failed';
}

function isOpenDkpRaidtickUploadSunset() {
  return !!(window.RaidTickQueue && window.RaidTickQueue.RAIDTICK_UPLOAD_SUNSET);
}

function openDkpUpdateRaidtickUploadBlockVisibility() {
  const block = document.getElementById('opendkpRaidtickUploadBlock');
  const toggleRow = document.getElementById('opendkpRaidtickUploadToggleRow');
  const toggle = document.getElementById('opendkpRaidtickUploadEnabled');
  const desc = document.getElementById('opendkpRaidtickUploadToggleDesc');
  const sunset = isOpenDkpRaidtickUploadSunset();

  if (sunset) {
    currentSettings.opendkpRaidtickUploadEnabled = false;
    if (toggle) {
      toggle.checked = false;
      toggle.disabled = true;
    }
    if (toggleRow) toggleRow.classList.add('feature-sunset');
    if (desc) {
      desc.textContent =
        'Temporarily disabled while upload is being fixed (HTTP 500). Code remains for a future release.';
    }
    if (block) block.style.display = 'none';
    try {
      api.storage.sync.set({ opendkpRaidtickUploadEnabled: false });
    } catch (_) {}
    return;
  }

  if (toggleRow) toggleRow.classList.remove('feature-sunset');
  if (toggle) toggle.disabled = false;
  if (desc) {
    desc.textContent = 'When off, tick log upload controls are hidden in the extension popup.';
  }
  const enabled = !!currentSettings.opendkpRaidtickUploadEnabled;
  if (block) block.style.display = enabled ? '' : 'none';
}

function updateProfileRegions(profile) {
  const activeProfile = profile != null ? profile : currentSettings.soundProfile;
  const isLeader = activeProfile === 'raidleader';
  const leaderRegion = document.getElementById('raidLeaderSettingsRegion');
  if (leaderRegion) leaderRegion.style.display = isLeader ? 'block' : 'none';

  // Reminders live inside the leader region; keep them visible whenever the region is shown
  const remSec = document.getElementById('raidTickReminders');
  if (remSec) remSec.style.display = isLeader ? 'block' : 'none';
  const raidLeaderSettings = document.getElementById('raidLeaderOnlySettings');
  if (raidLeaderSettings) raidLeaderSettings.style.display = isLeader ? 'block' : 'none';

  document.querySelectorAll('#settingsToc [data-toc-leader]').forEach(function (el) {
    el.style.display = isLeader ? '' : 'none';
  });

  if (isLeader) {
    try { renderRemindersUI(); } catch (_) {}
  }
  try { updateScrollFab(); } catch (_) {}
}

const SCROLL_FAB_TOP_THRESHOLD = 80;
let _scrollFabRaf = 0;

function isNearPageTop() {
  return (window.scrollY || document.documentElement.scrollTop || 0) < SCROLL_FAB_TOP_THRESHOLD;
}

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) {
    return false;
  }
}

function updateScrollFab() {
  const fab = document.getElementById('scrollFab');
  if (!fab) return;
  if (isNearPageTop()) {
    fab.textContent = '↓';
    fab.setAttribute('aria-label', 'Scroll to bottom');
    fab.title = 'Scroll to bottom';
    fab.dataset.direction = 'bottom';
  } else {
    fab.textContent = '↑';
    fab.setAttribute('aria-label', 'Scroll to top');
    fab.title = 'Scroll to top';
    fab.dataset.direction = 'top';
  }
}

function onScrollFabClick() {
  const fab = document.getElementById('scrollFab');
  const goBottom = !fab || fab.dataset.direction === 'bottom' || isNearPageTop();
  const bottom = Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight
  );
  if (prefersReducedMotion()) {
    window.scrollTo(0, goBottom ? bottom : 0);
  } else {
    window.scrollTo({ top: goBottom ? bottom : 0, behavior: 'smooth' });
  }
}

function wireScrollFab() {
  const fab = document.getElementById('scrollFab');
  if (!fab || fab.dataset.wired === '1') return;
  fab.dataset.wired = '1';
  fab.addEventListener('click', onScrollFabClick);
  window.addEventListener('scroll', function () {
    if (_scrollFabRaf) return;
    _scrollFabRaf = requestAnimationFrame(function () {
      _scrollFabRaf = 0;
      updateScrollFab();
    });
  }, { passive: true });
  updateScrollFab();
}

function updateOpenDkpApiGroupVisibility(profile) {
  const activeProfile = profile != null ? profile : currentSettings.soundProfile;
  // openDkpApiGroup lives inside #raidLeaderSettingsRegion — region toggle is enough
  updateProfileRegions(activeProfile);
  updateAutoBidSectionVisibility();
  updateAutoBidApiBlockVisibility(activeProfile);
}

function updateAutoBidSectionVisibility() {
  const group = document.getElementById('autoBidGroup');
  if (group) group.style.display = 'block';
}

function updateAutoBidDetailsVisibility() {
  const enabled = document.getElementById('autoBidEnabled');
  const details = document.getElementById('autoBidDetails');
  if (details) {
    details.style.display = enabled && enabled.checked ? 'block' : 'none';
  }
}

function updateAutoBidApiBlockVisibility(profile) {
  const activeProfile = profile != null ? profile : currentSettings.soundProfile;
  const raiderBlock = document.getElementById('autoBidRaiderApiBlock');
  const leaderNote = document.getElementById('autoBidLeaderApiNote');
  if (raiderBlock) raiderBlock.style.display = activeProfile === 'raider' ? 'block' : 'none';
  if (leaderNote) leaderNote.style.display = activeProfile === 'raidleader' ? 'block' : 'none';
}

function syncAutoBidCredentialFieldsFromMain() {
  const slug = document.getElementById('opendkpClientSlug');
  const user = document.getElementById('opendkpCognitoUser');
  const pass = document.getElementById('opendkpCognitoPassword');
  const abSlug = document.getElementById('autoBidClientSlug');
  const abUser = document.getElementById('autoBidCognitoUser');
  const abPass = document.getElementById('autoBidCognitoPassword');
  if (abSlug && slug) abSlug.value = slug.value;
  if (abUser && user) abUser.value = user.value;
  if (abPass && pass && pass.value) abPass.value = pass.value;
}

function syncMainCredentialFieldsFromAutoBid() {
  const slug = document.getElementById('opendkpClientSlug');
  const user = document.getElementById('opendkpCognitoUser');
  const pass = document.getElementById('opendkpCognitoPassword');
  const abSlug = document.getElementById('autoBidClientSlug');
  const abUser = document.getElementById('autoBidCognitoUser');
  const abPass = document.getElementById('autoBidCognitoPassword');
  if (slug && abSlug) slug.value = abSlug.value;
  if (user && abUser) user.value = abUser.value;
  if (pass && abPass && abPass.value) pass.value = abPass.value;
}

function normalizeAutoBidRules(raw) {
  if (window.AutoBid && AutoBid.normalizeRules) {
    return AutoBid.normalizeRules(raw);
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(function (r) {
    return r && r.itemPattern && r.maxDkp > 0 && r.characterId > 0;
  });
}

function autoBidNewRuleId() {
  return 'abr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function autoBidReadRulesFromUI() {
  const list = document.getElementById('autoBidRulesList');
  if (!list) {
    return Array.isArray(currentSettings.autoBidRules) ? currentSettings.autoBidRules.slice() : [];
  }
  const cards = list.querySelectorAll('.auto-bid-rule[data-rule-id]');
  if (!cards.length) {
    return Array.isArray(currentSettings.autoBidRules) ? currentSettings.autoBidRules.slice() : [];
  }
  const rules = [];
  cards.forEach(function (card) {
    const id = card.getAttribute('data-rule-id') || autoBidNewRuleId();
    const enabledEl = card.querySelector('.auto-bid-rule-enabled');
    const itemEl = card.querySelector('.auto-bid-rule-item');
    const maxEl = card.querySelector('.auto-bid-rule-max');
    const charEl = card.querySelector('.auto-bid-rule-character');
    const rankEl = card.querySelector('.auto-bid-rule-rank');
    const itemPattern = itemEl ? String(itemEl.value || '').trim() : '';
    const maxDkp = maxEl ? parseInt(String(maxEl.value || ''), 10) : 0;
    const characterIdRaw = charEl ? String(charEl.value || '').trim() : '';
    const characterId = characterIdRaw ? parseInt(characterIdRaw, 10) : 0;
    // Keep in-progress edits (item without character, etc.) — normalizeRules filters at bid time
    if (!itemPattern && (Number.isNaN(characterId) || characterId < 1) && cards.length > 1) {
      return;
    }
    var selectedOpt = charEl && charEl.selectedOptions && charEl.selectedOptions[0];
    var rank = rankEl ? String(rankEl.textContent || '').trim().replace(/^—$/, '') : '';
    if (!rank && characterId > 0) {
      rank = autoBidRankForCharacterId(characterId) || '';
    }
    var maxDkpOut = Number.isNaN(maxDkp) || maxDkp < 1 ? 100 : maxDkp;
    if (window.OpenDkpRankBidLimits && rank && characterId > 0) {
      maxDkpOut = OpenDkpRankBidLimits.clampMaxDkpForRank(maxDkpOut, rank, __autoBidRankLimits).value;
    }
    rules.push({
      id: id,
      enabled: enabledEl ? !!enabledEl.checked : true,
      itemPattern: itemPattern,
      maxDkp: maxDkpOut,
      characterId: characterId > 0 ? characterId : '',
      characterName: selectedOpt
        ? String(selectedOpt.getAttribute('data-name') || selectedOpt.textContent || '')
            .trim()
            .replace(/\s*\([^)]*\)\s*$/, '')
        : '',
      rank: rank,
      priority: currentSettings.autoBidPriority != null ? currentSettings.autoBidPriority : 1
    });
  });
  return rules;
}

function autoBidCharacterSelectOptionsHtml(selectedId) {
  var html = '<option value="">— character —</option>';
  (__autoBidCharactersCache || []).forEach(function (c) {
    if (!c || !c.id) return;
    var label = c.name + (c.rank ? ' (' + c.rank + ')' : '');
    var sel = String(selectedId) === String(c.id) ? ' selected' : '';
    html +=
      '<option value="' +
      String(c.id) +
      '" data-name="' +
      String(c.name || '').replace(/"/g, '&quot;') +
      '" data-rank="' +
      String(c.rank || '').replace(/"/g, '&quot;') +
      '"' +
      sel +
      '>' +
      label +
      '</option>';
  });
  return html;
}

function autoBidRankForCharacterId(characterId) {
  var found = (__autoBidCharactersCache || []).find(function (c) {
    return String(c.id) === String(characterId);
  });
  return found && found.rank ? found.rank : '';
}

async function autoBidLoadRankLimitsCache() {
  if (!window.OpenDkpRankBidLimits) {
    __autoBidRankLimits = {};
    return __autoBidRankLimits;
  }
  var slug = '';
  if (currentSettings.soundProfile === 'raider') {
    var abSlugEl = document.getElementById('autoBidClientSlug');
    slug = abSlugEl ? normalizeOpenDkpClientSlug(abSlugEl.value) : '';
  } else {
    var slugEl = document.getElementById('opendkpClientSlug');
    slug = slugEl ? normalizeOpenDkpClientSlug(slugEl.value) : '';
  }
  if (!slug) {
    slug = normalizeOpenDkpClientSlug(currentSettings.opendkpClientSlug || '');
  }
  if (!slug) {
    __autoBidRankLimits = {};
    return __autoBidRankLimits;
  }
  __autoBidRankLimits = await OpenDkpRankBidLimits.loadForSlug(slug);
  return __autoBidRankLimits;
}

function autoBidRankMaxHintText(rank) {
  if (!window.OpenDkpRankBidLimits || !rank || rank === '—') {
    return 'Select a character to load its OpenDKP rank.';
  }
  var max = OpenDkpRankBidLimits.getRankMax(__autoBidRankLimits, rank);
  if (max == null) {
    return 'Open Bidding Tool and select this rank once to cache its OpenDKP max (kept in backup).';
  }
  return 'OpenDKP max for ' + rank + ': ' + max;
}

function autoBidApplyRankMaxToCard(card) {
  if (!card) return;
  var rankEl = card.querySelector('.auto-bid-rule-rank');
  var maxEl = card.querySelector('.auto-bid-rule-max');
  var hintEl = card.querySelector('.auto-bid-rule-max-hint');
  var rank = rankEl ? String(rankEl.textContent || '').trim().replace(/^—$/, '') : '';
  if (hintEl) {
    hintEl.textContent = autoBidRankMaxHintText(rank);
  }
  if (!maxEl || !window.OpenDkpRankBidLimits || !rank) {
    if (maxEl) maxEl.removeAttribute('max');
    return;
  }
  var result = OpenDkpRankBidLimits.clampMaxDkpForRank(parseInt(String(maxEl.value || ''), 10), rank, __autoBidRankLimits);
  if (result.rankMax != null) {
    maxEl.max = String(result.rankMax);
  } else {
    maxEl.removeAttribute('max');
  }
  if (result.clamped) {
    maxEl.value = String(result.value);
  }
}

function autoBidApplyRankMaxToAllCards() {
  document.querySelectorAll('#autoBidRulesList .auto-bid-rule').forEach(autoBidApplyRankMaxToCard);
}

function autoBidUserIsEditingRules() {
  var active = document.activeElement;
  if (!active) return false;
  var list = document.getElementById('autoBidRulesList');
  return !!(list && list.contains(active));
}

function renderAutoBidRulesTable() {
  const list = document.getElementById('autoBidRulesList');
  if (!list) return;
  const rules = Array.isArray(currentSettings.autoBidRules) ? currentSettings.autoBidRules : [];
  list.innerHTML = '';
  rules.forEach(function (rule) {
    autoBidAppendRuleRow(rule);
  });
  if (!rules.length) {
    autoBidAppendRuleRow({
      id: autoBidNewRuleId(),
      enabled: true,
      itemPattern: '',
      maxDkp: 100,
      characterId: '',
      characterName: '',
      rank: ''
    });
  }
}

function autoBidAppendRuleRow(rule) {
  const list = document.getElementById('autoBidRulesList');
  if (!list) return;
  rule = rule || {};
  const card = document.createElement('div');
  card.className = 'auto-bid-rule';
  card.setAttribute('data-rule-id', rule.id || autoBidNewRuleId());
  card.innerHTML =
    '<div class="auto-bid-rule-header">' +
    '<label class="auto-bid-rule-toggle">' +
    '<input type="checkbox" class="auto-bid-rule-enabled"' +
    (rule.enabled !== false ? ' checked' : '') +
    '> Rule enabled</label>' +
    '<button type="button" class="auto-bid-rule-remove test-button">Remove</button>' +
    '</div>' +
    '<div class="auto-bid-rule-field">' +
    '<label>Item (contains)</label>' +
    '<input type="text" class="auto-bid-rule-item" placeholder="Bracelet of the Shadow Hive" value="' +
    String(rule.itemPattern || '').replace(/"/g, '&quot;') +
    '">' +
    '</div>' +
    '<div class="auto-bid-rule-row">' +
    '<div class="auto-bid-rule-field auto-bid-rule-field--max">' +
    '<label>Max DKP</label>' +
    '<input type="number" class="auto-bid-rule-max" min="1" step="1" value="' +
    String(rule.maxDkp != null ? rule.maxDkp : 100) +
    '">' +
    '<small class="auto-bid-rule-max-hint"></small>' +
    '</div>' +
    '<div class="auto-bid-rule-field auto-bid-rule-field--char">' +
    '<label>Bid as</label>' +
    '<select class="auto-bid-rule-character">' +
    autoBidCharacterSelectOptionsHtml(rule.characterId) +
    '</select></div>' +
    '<div class="auto-bid-rule-field auto-bid-rule-field--rank">' +
    '<label>Rank</label>' +
    '<span class="auto-bid-rule-rank">' +
    (rule.rank || autoBidRankForCharacterId(rule.characterId) || '—') +
    '</span></div></div>';

  const charEl = card.querySelector('.auto-bid-rule-character');
  const rankEl = card.querySelector('.auto-bid-rule-rank');
  const maxEl = card.querySelector('.auto-bid-rule-max');
  if (charEl) {
    charEl.addEventListener('change', function () {
      if (rankEl) rankEl.textContent = autoBidRankForCharacterId(charEl.value) || '—';
      autoBidApplyRankMaxToCard(card);
      schedulePersistAutoBidSettings();
    });
  }
  if (maxEl) {
    maxEl.addEventListener('change', function () {
      autoBidApplyRankMaxToCard(card);
    });
    maxEl.addEventListener('blur', function () {
      autoBidApplyRankMaxToCard(card);
      schedulePersistAutoBidSettings();
    });
  }
  card.querySelectorAll('.auto-bid-rule-item, .auto-bid-rule-max, .auto-bid-rule-enabled').forEach(function (el) {
    el.addEventListener('input', schedulePersistAutoBidSettings);
    el.addEventListener('change', schedulePersistAutoBidSettings);
  });
  const removeBtn = card.querySelector('.auto-bid-rule-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', function () {
      card.remove();
      currentSettings.autoBidRules = autoBidReadRulesFromUI();
      schedulePersistAutoBidSettings();
    });
  }
  list.appendChild(card);
  autoBidApplyRankMaxToCard(card);
}

var __autoBidPersistTimer = null;
function schedulePersistAutoBidSettings() {
  if (__autoBidPersistTimer) clearTimeout(__autoBidPersistTimer);
  __autoBidPersistTimer = setTimeout(function () {
    __autoBidPersistTimer = null;
    currentSettings.autoBidRules = autoBidReadRulesFromUI();
    persistAutoBidSettings({ silent: true });
  }, 800);
}

function collectAutoBidSettingsFromUI() {
  const getChecked = function (id, def) {
    const el = document.getElementById(id);
    return el ? !!el.checked : def;
  };
  const getVal = function (id, def) {
    const el = document.getElementById(id);
    return el ? el.value : def;
  };
  if (currentSettings.soundProfile === 'raider') {
    syncMainCredentialFieldsFromAutoBid();
  }
  const rawSlug =
    currentSettings.soundProfile === 'raider'
      ? String(getVal('autoBidClientSlug', currentSettings.opendkpClientSlug || '') || '').trim()
      : String(getVal('opendkpClientSlug', currentSettings.opendkpClientSlug || '') || '').trim();
  const normSlug = normalizeOpenDkpClientSlug(rawSlug);
  const increment = parseInt(String(getVal('autoBidIncrement', currentSettings.autoBidIncrement)), 10);
  const pollSec = parseInt(String(getVal('autoBidPollIntervalSec', currentSettings.autoBidPollIntervalSec)), 10);
  return {
    autoBidEnabled: getChecked('autoBidEnabled', currentSettings.autoBidEnabled),
    autoBidIncrement: Number.isNaN(increment) || increment < 1 ? 10 : increment,
    autoBidPollIntervalSec: Number.isNaN(pollSec) || pollSec < 5 ? 15 : pollSec,
    autoBidPriority: currentSettings.autoBidPriority != null ? currentSettings.autoBidPriority : 1,
    autoBidRules: autoBidReadRulesFromUI(),
    itemPriceHistoryEnabled: getChecked('itemPriceHistoryEnabled', currentSettings.itemPriceHistoryEnabled !== false),
    opendkpClientSlug: rawSlug === '' ? '' : normSlug || currentSettings.opendkpClientSlug || ''
  };
}

function persistAutoBidSettings(options) {
  options = options || {};
  const payload = collectAutoBidSettingsFromUI();
  Object.assign(currentSettings, payload);
  const syncPayload = Object.assign({}, payload);
  __autoBidRulesSyncFromUI = true;
  return new Promise(function (resolve, reject) {
    api.storage.sync.set(syncPayload, function () {
      setTimeout(function () {
        __autoBidRulesSyncFromUI = false;
      }, 200);
      if (api.runtime && api.runtime.lastError) {
        reject(api.runtime.lastError);
        return;
      }
      if (api.storage.local && api.storage.local.set) {
        api.storage.local.set(
          {
            [LOCAL_SETTINGS_MIRROR_KEY]: Object.assign(
              {},
              collectCriticalSettingsFromUI(),
              payload,
              { savedAt: Date.now() }
            )
          },
          function () {
            if (!options.silent) showStatus('Auto-bid settings saved', 'success');
            resolve();
          }
        );
      } else {
        if (!options.silent) showStatus('Auto-bid settings saved', 'success');
        resolve();
      }
    });
  });
}

async function autoBidLoadCharactersCache() {
  return new Promise(function (resolve) {
    if (!api.storage.local) return resolve([]);
    api.storage.local.get([AUTO_BID_CHARACTERS_CACHE_KEY], function (r) {
      const root = r && r[AUTO_BID_CHARACTERS_CACHE_KEY];
      __autoBidCharactersCache =
        root && Array.isArray(root.characters) ? root.characters : [];
      resolve(__autoBidCharactersCache);
    });
  });
}

async function autoBidUpdateTokenStatusEl() {
  const el = document.getElementById('autoBidTokenStatus');
  if (!el || !window.OpenDkpApi) return;
  try {
    const m = await OpenDkpApi.getTokenMeta();
    if (m.isActive) {
      el.textContent = 'API session active (expires ' + new Date(m.expiresAt).toLocaleString() + ')';
    } else if (m.hasToken) {
      el.textContent = 'Token expired — sign in again.';
    } else {
      el.textContent = 'Not signed in.';
    }
  } catch (_) {
    el.textContent = '';
  }
}

function autoBidCharacterRefreshError(resp, fallback) {
  const lastErr = api.runtime && api.runtime.lastError;
  if (lastErr) {
    return new Error(lastErr.message || String(lastErr) || fallback);
  }
  if (!resp) {
    return new Error(
      fallback + ' (no response from extension — reload the add-on and try again)'
    );
  }
  const detail = resp.error || resp.reason || resp.message;
  if (detail) return new Error(detail);
  if (resp.ok === false) return new Error(fallback);
  return null;
}

async function autoBidRefreshCharactersFromApi() {
  const statusEl = document.getElementById('autoBidCharStatus');
  if (statusEl) statusEl.textContent = 'Loading…';
  try {
    await persistAutoBidSettings({ silent: true });
    const slug = collectAutoBidSettingsFromUI().opendkpClientSlug;
    if (!slug) {
      throw new Error(
        currentSettings.soundProfile === 'raider'
          ? 'Enter your guild subdomain in Auto-Bid settings first.'
          : 'Enter your guild subdomain in OpenDKP API (raids) settings first.'
      );
    }
    if (!window.OpenDkpApi) {
      throw new Error('OpenDKP API module not loaded — reload the options page.');
    }
    const tokenMeta = await OpenDkpApi.getTokenMeta();
    if (!tokenMeta.hasToken) {
      throw new Error('Sign in to the OpenDKP API first.');
    }
    if (!tokenMeta.isActive) {
      throw new Error('API session expired — sign in again.');
    }

    let characters = [];
    if (window.AutoBid && AutoBid.refreshAccountCharacters) {
      characters = await AutoBid.refreshAccountCharacters({
        cognitoClientId: OPEN_DKP_COGNITO_CLIENT_ID,
        clientSlug: slug,
        username: currentSettings.opendkpCognitoUsername || undefined
      });
    } else {
      characters = await new Promise(function (resolve, reject) {
        api.runtime.sendMessage({ type: 'autoBidRefreshCharacters', clientSlug: slug }, function (resp) {
          const err = autoBidCharacterRefreshError(resp, 'Failed to load characters');
          if (err) return reject(err);
          resolve(resp.characters || []);
        });
      });
    }
    __autoBidCharactersCache = characters;
    await autoBidLoadRankLimitsCache();
    renderAutoBidRulesTable();
    if (statusEl) {
      statusEl.textContent = characters.length
        ? characters.length + ' character(s) loaded from OpenDKP.'
        : 'No characters linked to your OpenDKP account — check Profile on opendkp.com matches your sign-in username.';
    }
    return characters;
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Failed: ' + (e.message || e);
    throw e;
  }
}

function wireAutoBidUi() {
  const root = document.getElementById('autoBidEnableRow');
  if (root && root.dataset.autoBidWired === '1') return;
  if (root) root.dataset.autoBidWired = '1';

  try {
    api.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes.opendkpRankBidLimitsBySlug) {
        autoBidLoadRankLimitsCache().then(function () {
          autoBidApplyRankMaxToAllCards();
        });
      }
      if (area === 'sync' && changes.autoBidRules && Array.isArray(changes.autoBidRules.newValue)) {
        currentSettings.autoBidRules = changes.autoBidRules.newValue;
        if (!__autoBidRulesSyncFromUI && !autoBidUserIsEditingRules()) {
          renderAutoBidRulesTable();
        }
      }
    });
  } catch (_) {}

  const enabledChk = document.getElementById('autoBidEnabled');
  if (enabledChk) {
    enabledChk.addEventListener('change', function () {
      currentSettings.autoBidEnabled = this.checked;
      updateAutoBidDetailsVisibility();
      persistAutoBidSettings({ silent: true });
    });
  }

  const priceHistoryChk = document.getElementById('itemPriceHistoryEnabled');
  if (priceHistoryChk) {
    priceHistoryChk.addEventListener('change', function () {
      currentSettings.itemPriceHistoryEnabled = this.checked;
      persistAutoBidSettings({ silent: true });
    });
  }

  ['autoBidIncrement', 'autoBidPollIntervalSec', 'autoBidClientSlug'].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', schedulePersistAutoBidSettings);
    el.addEventListener('change', function () {
      if (id === 'autoBidClientSlug') {
        autoBidLoadRankLimitsCache().then(function () {
          autoBidApplyRankMaxToAllCards();
        });
      }
      schedulePersistAutoBidSettings();
    });
  });

  const mainSlugEl = document.getElementById('opendkpClientSlug');
  if (mainSlugEl) {
    mainSlugEl.addEventListener('change', function () {
      autoBidLoadRankLimitsCache().then(function () {
        autoBidApplyRankMaxToAllCards();
      });
    });
  }

  ['autoBidCognitoUser', 'autoBidCognitoPassword'].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', schedulePersistAutoBidSettings);
    el.addEventListener('blur', schedulePersistAutoBidSettings);
  });

  const addRuleBtn = document.getElementById('autoBidAddRule');
  if (addRuleBtn) {
    addRuleBtn.addEventListener('click', function () {
      autoBidAppendRuleRow({
        id: autoBidNewRuleId(),
        enabled: true,
        itemPattern: '',
        maxDkp: 100,
        characterId: '',
        rank: ''
      });
      schedulePersistAutoBidSettings();
    });
  }

  const refreshBtn = document.getElementById('autoBidRefreshCharacters');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async function () {
      refreshBtn.disabled = true;
      try {
        await autoBidRefreshCharactersFromApi();
        showStatus('Characters refreshed from OpenDKP.', 'success');
      } catch (e) {
        showStatus('Character refresh failed: ' + (e.message || e), 'error');
      } finally {
        refreshBtn.disabled = false;
      }
    });
  }

  const signIn = document.getElementById('autoBidSignIn');
  if (signIn) {
    signIn.addEventListener('click', async function () {
      const statusLine = document.getElementById('autoBidTokenStatus');
      try {
        if (!window.OpenDkpApi) {
          showStatus('API module not loaded.', 'error');
          return;
        }
        syncMainCredentialFieldsFromAutoBid();
        const user = (document.getElementById('autoBidCognitoUser') || {}).value || '';
        const pass = (document.getElementById('autoBidCognitoPassword') || {}).value || '';
        if (!user || !pass) {
          showStatus('Enter OpenDKP username and password.', 'error');
          return;
        }
        signIn.disabled = true;
        if (statusLine) statusLine.textContent = 'Signing in…';
        await OpenDkpApi.cognitoInitiatePasswordAuth({
          clientId: OPEN_DKP_COGNITO_CLIENT_ID,
          username: user,
          password: pass
        });
        await openDkpPersistApiCredentials(user, pass);
        await persistAutoBidSettings({ silent: true });
        await autoBidUpdateTokenStatusEl();
        await openDkpUpdateTokenStatusEl();
        showStatus('Signed in to OpenDKP API.', 'success');
        try {
          await autoBidRefreshCharactersFromApi();
        } catch (refreshErr) {
          showStatus(
            'Signed in, but character load failed: ' + (refreshErr.message || refreshErr),
            'error'
          );
        }
      } catch (e) {
        if (statusLine) statusLine.textContent = 'Sign-in failed';
        showStatus('Sign-in failed: ' + (e.message || e), 'error');
      } finally {
        signIn.disabled = false;
      }
    });
  }

  const signOut = document.getElementById('autoBidSignOut');
  if (signOut) {
    signOut.addEventListener('click', async function () {
      if (!window.OpenDkpApi) return;
      await OpenDkpApi.clearTokens();
      await autoBidUpdateTokenStatusEl();
      await openDkpUpdateTokenStatusEl();
      showStatus('Signed out.', 'success');
    });
  }
}

function openDkpGatherRaidtickApplyInputs() {
  return openDkpGatherRaidtickBatchInputs({ allowPartialExisting: false });
}

function openDkpTickIdToSlotIndex(tickId) {
  const s = openDkpGetCurrentRaidSummary();
  if (!s || !Array.isArray(s.ticks)) return -1;
  for (let i = 0; i < s.ticks.length; i++) {
    if (String(s.ticks[i].id) === String(tickId)) return i;
  }
  return -1;
}

async function openDkpSyncStageFromPopupQueue() {
  const rid = currentSettings.opendkpCurrentRaidId;
  const s = openDkpGetCurrentRaidSummary();
  if (rid == null || rid === '' || !window.RaidTickQueue || !RaidTickQueue.hydrateStageByTickId) {
    return;
  }
  try {
    __odRaidtickStageByTickId = await RaidTickQueue.hydrateStageByTickId(rid, s && s.ticks ? s.ticks : []);
  } catch (_) {
    __odRaidtickStageByTickId = {};
  }
}

function openDkpFormatRaidtickStageOverview() {
  const s = openDkpGetCurrentRaidSummary();
  if (!s || !Array.isArray(s.ticks) || !s.ticks.length) {
    return 'Set a current raid to stage tick files.';
  }
  return s.ticks
    .map(function (t, index) {
      const tickId = String(t.id != null ? t.id : '');
      const staged = tickId ? __odRaidtickStageByTickId[tickId] : null;
      const label = t.description || 'Tick #' + (index + 1);
      if (staged && staged.names && staged.names.length) {
        return '[' + tickId + '] ' + label + ': ' + staged.fileName + ' (' + staged.names.length + ')';
      }
      return '[' + tickId + '] ' + label + ': — not staged —';
    })
    .join('\n');
}

function openDkpRenderRaidtickStageUi() {
  const sel = document.getElementById('opendkpRaidtickTickSelect');
  const prev = document.getElementById('opendkpRaidtickPreview');
  const status = document.getElementById('opendkpRaidtickStageStatus');
  const fileLabel = document.getElementById('opendkpRaidtickFileLabel');
  const tickId = sel && sel.value;
  const overview = openDkpFormatRaidtickStageOverview();

  if (status) status.textContent = overview;

  if (!prev) return;

  if (!tickId) {
    prev.textContent =
      'Select a target tick, then browse that hour\u2019s RaidTick file.\n\n' + overview;
    if (fileLabel) fileLabel.textContent = '';
    return;
  }

  const staged = __odRaidtickStageByTickId[tickId];
  if (fileLabel) {
    fileLabel.textContent = staged
      ? 'Staged: ' + staged.fileName
      : 'No file staged for this tick yet';
  }
  if (staged && staged.names && staged.names.length) {
    prev.textContent =
      staged.names.length +
      ' attendee(s) for tick ' +
      tickId +
      ':\n\n' +
      JSON.stringify(staged.names, null, 2) +
      '\n\n' +
      overview;
  } else {
    prev.textContent =
      'Browse a RaidTick file while this tick is selected.\n\n' + overview;
  }
}

function openDkpGatherRaidtickBatchInputs(opts) {
  opts = opts || {};
  const allowPartialExisting = !!opts.allowPartialExisting;
  const cfg = getOpenDkpApiConfig();
  const rid = currentSettings.opendkpCurrentRaidId;
  if (rid == null || rid === '') {
    return { ok: false, message: 'Set a current raid first.' };
  }
  const s = openDkpGetCurrentRaidSummary();
  if (!s || !Array.isArray(s.ticks) || !s.ticks.length) {
    return { ok: false, message: 'Refresh raid list and set a current raid first.' };
  }

  const namesBySlotIndex = [];
  const missing = [];
  let stagedCount = 0;

  s.ticks.forEach(function (t, index) {
    const tickId = String(t.id != null ? t.id : '');
    const staged = tickId ? __odRaidtickStageByTickId[tickId] : null;
    if (staged && staged.names && staged.names.length) {
      namesBySlotIndex[index] = window.RaidTickParse
        ? RaidTickParse.dedupeCharacterNames(staged.names)
        : staged.names.slice();
      stagedCount++;
    } else if (allowPartialExisting) {
      namesBySlotIndex[index] = null;
    } else {
      missing.push(t.description || 'Tick #' + (index + 1));
    }
  });

  if (missing.length) {
    return {
      ok: false,
      message: 'Stage a log file for every tick. Missing: ' + missing.join(', ')
    };
  }

  const allNames = [];
  namesBySlotIndex.forEach(function (names) {
    if (names && names.length) allNames.push.apply(allNames, names);
  });
  if (!allNames.length) {
    return { ok: false, message: 'Choose at least one RaidTick .txt file first.' };
  }

  // Roster cache is optional — OpenDKP creates missing characters on raid update.
  return {
    ok: true,
    cfg: cfg,
    rid: rid,
    namesBySlotIndex: namesBySlotIndex,
    allStaged: stagedCount === s.ticks.length,
    stagedCount: stagedCount,
    totalTicks: s.ticks.length
  };
}

async function openDkpBuildRaidtickPostBodyBatch(inputs) {
  const full = await OpenDkpApi.getRaid(inputs.cfg, inputs.rid);
  const guildClientId = OpenDkpApi.resolveGuildClientId
    ? OpenDkpApi.resolveGuildClientId(full, __odClientId)
    : full.ClientId || __odClientId || '';
  const postBody = RaidTickParse.buildRaidUpdateBodyForQueuedTickRosters(
    full,
    inputs.namesBySlotIndex,
    __odRosterNameToId,
    guildClientId
  );
  return { full: full, postBody: postBody };
}

function normalizeOpenDkpClientSlug(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s)) return '';
  return s;
}

function getOpenDkpApiConfig() {
  const domSlug = (document.getElementById('opendkpClientSlug') || {}).value;
  const slug = normalizeOpenDkpClientSlug(domSlug != null ? domSlug : currentSettings.opendkpClientSlug);
  return {
    apiHost: OPEN_DKP_API_HOST,
    clientSlug: slug,
    cognitoClientId: OPEN_DKP_COGNITO_CLIENT_ID
  };
}

function openDkpParseAttendance(raw) {
  if (raw === 0 || raw === '0' || raw === false) return 0;
  if (raw === 1 || raw === '1' || raw === true) return 1;
  const n = parseInt(String(raw != null ? raw : '1'), 10);
  return n === 0 ? 0 : 1;
}

function openDkpParseTickDkpValue(raw) {
  const n = parseInt(String(raw != null ? raw : '1'), 10);
  return Number.isNaN(n) || n < 0 ? 1 : n;
}

/** Fallback DKP used when normalizing empty tick-def lists; keep in sync with last def. */
function openDkpResolveTickDkpValueForPersist() {
  const defs = openDkpNormalizeRaidTickDefs(
    currentSettings.opendkpRaidTickDefs,
    currentSettings.opendkpTickDkpValue
  );
  if (defs.length) {
    return openDkpParseTickDkpValue(defs[defs.length - 1].value);
  }
  return openDkpParseTickDkpValue(currentSettings.opendkpTickDkpValue);
}

function openDkpDefaultRaidTickDefs(tickDkpValue) {
  const value = openDkpParseTickDkpValue(tickDkpValue);
  return [
    { id: 't-hour1', description: 'Hour #1', value: value },
    { id: 't-hour2', description: 'Hour #2', value: value },
    { id: 't-hour3', description: 'Hour #3', value: value }
  ];
}

function openDkpNormalizeRaidTickDefs(raw, fallbackDkp) {
  if (!Array.isArray(raw)) {
    return openDkpDefaultRaidTickDefs(fallbackDkp);
  }
  if (!raw.length) return [];
  const out = [];
  raw.forEach(function (t, i) {
    if (!t || typeof t !== 'object') return;
    const description = String(
      t.description != null ? t.description : t.name != null ? t.name : 'Tick ' + (i + 1)
    ).trim();
    if (!description) return;
    out.push({
      id: t.id || 't-' + i + '-' + Date.now().toString(36),
      description: description,
      value: openDkpParseTickDkpValue(t.value != null ? t.value : t.dkp)
    });
  });
  return out.length ? out : openDkpDefaultRaidTickDefs(fallbackDkp);
}

function openDkpBuildCreateRaidTicksFromDefs(defs) {
  return (defs || []).map(function (t) {
    return {
      Characters: [],
      Description: t.description,
      Value: String(openDkpParseTickDkpValue(t.value))
    };
  });
}

function openDkpRaidTickDefRowStyles(row) {
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
}

function renderOpenDkpRaidTickDefsUI() {
  const list = document.getElementById('opendkpRaidTickDefsList');
  const btn = document.getElementById('opendkpAddRaidTickDef');
  if (!list) return;
  currentSettings.opendkpRaidTickDefs = openDkpNormalizeRaidTickDefs(
    currentSettings.opendkpRaidTickDefs,
    currentSettings.opendkpTickDkpValue
  );
  if (btn) btn.disabled = currentSettings.opendkpRaidTickDefs.length >= OPEN_DKP_MAX_RAID_TICK_DEFS;
  list.textContent = '';
  const labelColor = document.body.classList.contains('dark-mode') ? '#e0e0e0' : '#333';
  currentSettings.opendkpRaidTickDefs.forEach(function (t, idx) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '8px';
    row.style.borderRadius = '4px';
    row.style.flexWrap = 'wrap';
    openDkpRaidTickDefRowStyles(row);

    const nameLabel = document.createElement('label');
    nameLabel.style.flex = '1 1 180px';
    nameLabel.style.minWidth = '140px';
    nameLabel.style.color = labelColor;
    nameLabel.appendChild(document.createTextNode('Name: '));
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.setAttribute('data-k', 'description');
    nameInput.value = t.description || '';
    nameInput.style.width = '100%';
    nameInput.style.maxWidth = '220px';
    nameInput.style.padding = '6px';
    nameLabel.appendChild(nameInput);
    row.appendChild(nameLabel);

    const dkpLabel = document.createElement('label');
    dkpLabel.style.flexShrink = '0';
    dkpLabel.style.color = labelColor;
    dkpLabel.appendChild(document.createTextNode('DKP: '));
    const dkpInput = document.createElement('input');
    dkpInput.type = 'number';
    dkpInput.min = '0';
    dkpInput.step = '1';
    dkpInput.setAttribute('data-k', 'value');
    dkpInput.value = String(openDkpParseTickDkpValue(t.value));
    dkpInput.style.width = '72px';
    dkpInput.style.padding = '6px';
    dkpLabel.appendChild(dkpInput);
    row.appendChild(dkpLabel);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-secondary';
    deleteBtn.setAttribute('data-action', 'delete');
    deleteBtn.style.flexShrink = '0';
    deleteBtn.style.minWidth = '36px';
    deleteBtn.style.padding = '6px 8px';
    deleteBtn.title = 'Remove tick';
    deleteBtn.textContent = '🗑️';
    row.appendChild(deleteBtn);

    row.querySelectorAll('[data-k]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        const key = this.getAttribute('data-k');
        let val = this.value;
        if (key === 'value') val = openDkpParseTickDkpValue(val);
        if (key === 'description') val = String(val || '').trim();
        currentSettings.opendkpRaidTickDefs[idx] = Object.assign({}, currentSettings.opendkpRaidTickDefs[idx], { [key]: val });
        saveOpenDkpRaidTickDefsPartial();
      });
    });
    deleteBtn.addEventListener('click', function () {
      currentSettings.opendkpRaidTickDefs.splice(idx, 1);
      renderOpenDkpRaidTickDefsUI();
      saveOpenDkpRaidTickDefsPartial();
    });
    list.appendChild(row);
  });
}

function addOpenDkpRaidTickDef() {
  currentSettings.opendkpRaidTickDefs = openDkpNormalizeRaidTickDefs(
    currentSettings.opendkpRaidTickDefs,
    currentSettings.opendkpTickDkpValue
  );
  if (currentSettings.opendkpRaidTickDefs.length >= OPEN_DKP_MAX_RAID_TICK_DEFS) return;
  const defs = currentSettings.opendkpRaidTickDefs;
  const lastVal = defs.length
    ? openDkpParseTickDkpValue(defs[defs.length - 1].value)
    : openDkpParseTickDkpValue(currentSettings.opendkpTickDkpValue);
  defs.push({
    id: 't-' + Date.now().toString(36),
    description: 'Hour #' + (defs.length + 1),
    value: lastVal
  });
  renderOpenDkpRaidTickDefsUI();
  saveOpenDkpRaidTickDefsPartial();
}

let _openDkpRaidTickDefsSaveTimer = null;
function saveOpenDkpRaidTickDefsPartial() {
  currentSettings.opendkpRaidTickDefs = openDkpNormalizeRaidTickDefs(
    currentSettings.opendkpRaidTickDefs,
    currentSettings.opendkpTickDkpValue
  );
  currentSettings.opendkpTickDkpValue = openDkpResolveTickDkpValueForPersist();
  try {
    if (_openDkpRaidTickDefsSaveTimer) clearTimeout(_openDkpRaidTickDefsSaveTimer);
    _openDkpRaidTickDefsSaveTimer = setTimeout(function () {
      const payload = {
        opendkpRaidTickDefs: (currentSettings.opendkpRaidTickDefs || []).slice(0, OPEN_DKP_MAX_RAID_TICK_DEFS),
        opendkpTickDkpValue: currentSettings.opendkpTickDkpValue
      };
      api.storage.sync.set(payload, function () {
        const err = (api.runtime && api.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError);
        if (err) console.error('[Options] Error saving raid tick defs:', err.message);
        persistCriticalSettingsToStorage({ silent: true }).catch(function(e) {
          console.warn('[Options] Failed to mirror raid tick defs locally:', e);
        });
      });
    }, 250);
  } catch (e) {
    console.error('[Options] Exception saving raid tick defs:', e);
  }
}

function openDkpCoerceArray(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.Models)) return body.Models;
  if (Array.isArray(body.Raids)) return body.Raids;
  if (Array.isArray(body.Items)) return body.Items;
  if (Array.isArray(body.Characters)) return body.Characters;
  return [];
}

async function openDkpUpdateTokenStatusEl() {
  const el = document.getElementById('opendkpTokenStatus');
  if (!el || !window.OpenDkpApi) return;
  try {
    const m = await OpenDkpApi.getTokenMeta();
    el.textContent = m.hasToken ? ('Token OK' + (m.expiresAt ? ' (expires ' + new Date(m.expiresAt).toLocaleString() + ')' : '')) : 'Not signed in';
  } catch (_) {
    el.textContent = 'Token status unknown';
  }
}

function openDkpPersistCurrentRaid(id, summaryObj) {
  currentSettings.opendkpCurrentRaidId = id == null ? null : Number(id);
  currentSettings.opendkpCurrentRaidSummaryJson = summaryObj ? JSON.stringify(summaryObj) : '';
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const payload = {
    opendkpCurrentRaidId: currentSettings.opendkpCurrentRaidId,
    opendkpCurrentRaidSummaryJson: currentSettings.opendkpCurrentRaidSummaryJson
  };
  api.storage.sync.set(payload, () => {
    if (window.LootQueue && LootQueue.mirrorRaidContextToLocal) {
      LootQueue.mirrorRaidContextToLocal(
        Object.assign({ opendkpClientSlug: currentSettings.opendkpClientSlug || '' }, payload)
      );
    } else if (api.storage && api.storage.local) {
      api.storage.local.set(payload);
    }
    if (window.LootQueue && LootQueue.invalidateValidatedContextCache) {
      LootQueue.invalidateValidatedContextCache();
    }
    try { openDkpRenderCurrentRaid(); openDkpPopulateTickSelect(); } catch (_) {}
  });
}

function openDkpGetCurrentRaidSummary() {
  try {
    return currentSettings.opendkpCurrentRaidSummaryJson
      ? JSON.parse(currentSettings.opendkpCurrentRaidSummaryJson)
      : null;
  } catch (_) {
    return null;
  }
}

function openDkpRenderCurrentRaid() {
  const el = document.getElementById('opendkpCurrentRaid');
  if (!el) return;
  const id = currentSettings.opendkpCurrentRaidId;
  const s = openDkpGetCurrentRaidSummary();
  if (id == null || id === '' || Number.isNaN(Number(id))) {
    el.textContent = 'No current raid selected.';
    return;
  }
  let ticks = '';
  if (s && Array.isArray(s.ticks)) {
    ticks = '\nTicks:\n' + s.ticks.map((t) => '- [' + (t.id != null ? t.id : '?') + '] ' + (t.description || '') + '').join('\n');
  }
  el.textContent = 'Current raid ID: ' + id + (s && s.name ? '\nName: ' + s.name : '') + ticks;
}

function openDkpPopulateTickSelect() {
  const sel = document.getElementById('opendkpRaidtickTickSelect');
  if (!sel) return;
  const s = openDkpGetCurrentRaidSummary();
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = s && Array.isArray(s.ticks) && s.ticks.length ? '— Select tick —' : '— Load current raid —';
  sel.appendChild(opt0);
  if (s && Array.isArray(s.ticks)) {
    s.ticks.forEach((t) => {
      const o = document.createElement('option');
      o.value = String(t.id != null ? t.id : '');
      o.textContent = '[' + o.value + '] ' + (t.description || 'tick');
      sel.appendChild(o);
    });
  }
  if (!__odRaidtickSelectWired) {
    __odRaidtickSelectWired = true;
    sel.addEventListener('change', openDkpRenderRaidtickStageUi);
  }
  openDkpSyncStageFromPopupQueue().then(function () {
    openDkpRenderRaidtickStageUi();
  });
}

function openDkpHydrateRosterFromCache(slug) {
  slug = normalizeOpenDkpClientSlug(slug);
  if (!slug || !__odRosterCacheRoot || !__odRosterCacheRoot[slug]) return false;
  const entry = __odRosterCacheRoot[slug];
  __odRosterNameToId = Object.assign({}, entry.map || {});
  __odClientId = entry.clientId || '';
  return Object.keys(__odRosterNameToId).length > 0;
}

function openDkpRosterCacheWrite(slug, map, clientId) {
  slug = normalizeOpenDkpClientSlug(slug);
  if (!slug) return Promise.resolve();
  const entry = {
    map: Object.assign({}, map),
    clientId: clientId || '',
    updatedAt: new Date().toISOString()
  };
  __odRosterCacheRoot = Object.assign({}, __odRosterCacheRoot || {}, { [slug]: entry });
  if (!api.storage.local || !api.storage.local.set) return Promise.resolve();
  return new Promise((resolve) => {
    api.storage.local.set({ [OPEN_DKP_ROSTER_CACHE_STORAGE_KEY]: __odRosterCacheRoot }, () => resolve());
  });
}

function openDkpBuildRosterMapFromCharacters(chars) {
  const map = {};
  let clientId = '';
  (chars || []).forEach((c) => {
    const n = (c.Name || '').trim().toLowerCase();
    const id = c.Id != null ? c.Id : c.CharacterId;
    const numId = window.RaidTickParse
      ? RaidTickParse.coerceCharacterId(id)
      : parseInt(String(id), 10);
    if (n && numId > 0) map[n] = { id: numId, name: (c.Name || '').trim() };
    if (!clientId && c.ClientId) clientId = String(c.ClientId);
  });
  return { map, clientId };
}

function openDkpMergeRosterMaps(base, incoming) {
  return Object.assign({}, base || {}, incoming || {});
}

function openDkpRosterEntryId(entry) {
  if (entry == null) return 0;
  if (typeof entry === 'object') {
    const raw = entry.id != null ? entry.id : entry.CharacterId;
    return window.RaidTickParse
      ? RaidTickParse.coerceCharacterId(raw)
      : parseInt(String(raw), 10) || 0;
  }
  return window.RaidTickParse
    ? RaidTickParse.coerceCharacterId(entry)
    : parseInt(String(entry), 10) || 0;
}

function openDkpRosterEntryName(entry) {
  if (entry && typeof entry === 'object') {
    const name = entry.name != null ? entry.name : entry.Name;
    if (name != null && String(name).trim()) return String(name).trim();
  }
  return '';
}

function openDkpRosterEntryChanged(before, after) {
  if (before === undefined || after === undefined) return false;
  if (openDkpRosterEntryId(before) !== openDkpRosterEntryId(after)) return true;
  const beforeName = openDkpRosterEntryName(before).toLowerCase();
  const afterName = openDkpRosterEntryName(after).toLowerCase();
  return beforeName !== afterName;
}

async function openDkpPersistApiCredentials(username, password) {
  const trimmedUser = String(username || '').trim();
  currentSettings.opendkpCognitoUsername = trimmedUser;
  __odSavedApiPassword = password || __odSavedApiPassword || '';
  const syncPayload = { opendkpCognitoUsername: trimmedUser };
  await new Promise((resolve) => {
    api.storage.sync.set(syncPayload, () => {
      if (api.storage.local && password) {
        api.storage.local.set({ [OPEN_DKP_PASSWORD_STORAGE_KEY]: password }, () => resolve());
      } else {
        resolve();
      }
    });
  });
  await persistCriticalSettingsToStorage({ silent: true }).catch(function() {});
  const userEl = document.getElementById('opendkpCognitoUser');
  const passEl = document.getElementById('opendkpCognitoPassword');
  if (userEl) userEl.value = trimmedUser;
  if (passEl && password) passEl.value = password;
}

function openDkpNormalizePoolRecord(pool) {
  const idPool = pool.IdPool != null ? pool.IdPool : pool.PoolId != null ? pool.PoolId : pool.Id;
  return {
    id: String(idPool),
    name: pool.Name || '',
    desc: pool.Description || '',
    order: pool.Order != null ? pool.Order : 0
  };
}

function openDkpGetPreferredPoolId() {
  return currentSettings.opendkpPreferredPoolId || '';
}

function openDkpFindPoolSelectIndex(pools, preferredPoolId) {
  if (preferredPoolId) {
    const pref = String(preferredPoolId);
    for (let i = 0; i < pools.length; i++) {
      if (String(pools[i].id) === pref) return i;
    }
  }
  for (let i = 0; i < pools.length; i++) {
    if (String(pools[i].name || '').trim().toLowerCase() === 'classic') return i;
  }
  return 0;
}

function openDkpRenderPoolsToSelect(pools, preferredPoolId) {
  const sel = document.getElementById('opendkpPoolSelect');
  if (!sel) return 0;
  sel.innerHTML = '';
  if (!pools || !pools.length) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '— Load pools first —';
    sel.appendChild(empty);
    return 0;
  }
  pools.forEach((p) => {
    const o = document.createElement('option');
    o.value = String(p.id);
    o.textContent = (p.name || 'Pool') + (p.desc ? ' — ' + p.desc : '');
    o.dataset.name = p.name || '';
    o.dataset.desc = p.desc || '';
    o.dataset.order = String(p.order != null ? p.order : 0);
    sel.appendChild(o);
  });
  sel.selectedIndex = openDkpFindPoolSelectIndex(pools, preferredPoolId);
  return pools.length;
}

function openDkpHydratePoolsFromCache() {
  const pools = (__odPoolsCache && __odPoolsCache.pools) || [];
  if (!pools.length) return false;
  openDkpRenderPoolsToSelect(pools, openDkpGetPreferredPoolId());
  return true;
}

function openDkpPoolsCacheWrite(pools) {
  const normalized = (pools || []).filter((p) => p && p.id);
  __odPoolsCache = {
    pools: normalized.slice(),
    updatedAt: new Date().toISOString()
  };
  if (!api.storage.local || !api.storage.local.set) return Promise.resolve();
  return new Promise((resolve) => {
    api.storage.local.set({ [OPEN_DKP_POOLS_CACHE_STORAGE_KEY]: __odPoolsCache }, () => resolve());
  });
}

async function openDkpFetchAndRenderPools(cfg, options) {
  options = options || {};
  if (!options.forceRefresh && openDkpHydratePoolsFromCache()) {
    return __odPoolsCache.pools.length;
  }
  const body = await OpenDkpApi.getPools(cfg);
  const raw = openDkpCoerceArray(body);
  const filtered = raw.map(openDkpNormalizePoolRecord).filter((p) => p.id);
  await openDkpPoolsCacheWrite(filtered);
  openDkpRenderPoolsToSelect(filtered, openDkpGetPreferredPoolId());
  return filtered.length;
}

async function openDkpFetchAndRenderRaids(cfg) {
  const count = window.OpenDkpApi
    ? await OpenDkpApi.readRaidListCount()
    : 1;
  const body = await OpenDkpApi.getRaids(cfg, { count: count });
  const raids = openDkpCoerceArray(body).slice(0, count);
  const ul = document.getElementById('opendkpRaidList');
  if (ul) {
    ul.textContent = '';
    raids.forEach((r) => {
      const id = r.Id != null ? r.Id : r.RaidId;
      const li = document.createElement('li');
      li.style.marginBottom = '6px';
      const name = r.Name || ('Raid ' + id);
      li.textContent = name + ' (id ' + id + ') ';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Set current';
      btn.style.marginLeft = '8px';
      btn.addEventListener('click', async () => {
        if (!window.confirm('Set raid ' + id + ' (' + name + ') as current working raid?')) return;
        try {
          const full = await OpenDkpApi.getRaid(cfg, id);
          const ticks = (full.Ticks || []).map((t) => ({
            id: t.Id != null ? t.Id : t.TickId,
            description: t.Description,
            value: t.Value
          }));
          openDkpPersistCurrentRaid(id, { name: full.Name, ticks });
          showStatus('Current raid set.', 'success');
        } catch (e) {
          showStatus('Could not load raid: ' + (e.message || e), 'error');
        }
      });
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }
  return raids.length;
}

function openDkpNormalizeRaidListCountSetting(raw) {
  if (window.OpenDkpApi && OpenDkpApi.normalizeRaidListCount) {
    return OpenDkpApi.normalizeRaidListCount(raw);
  }
  const n = parseInt(String(raw != null ? raw : 1), 10);
  if (Number.isNaN(n) || n < 1) return 1;
  if (n > 5) return 5;
  return n;
}

function openDkpGetRaidListCountFromUI() {
  const el = document.getElementById('opendkpRaidListCount');
  const raw = el ? el.value : currentSettings.opendkpRaidListCount;
  return openDkpNormalizeRaidListCountSetting(raw);
}

function openDkpUpdateFetchRaidsButtonLabel() {
  const btn = document.getElementById('opendkpFetchRaids');
  if (!btn) return;
  const count = openDkpGetRaidListCountFromUI();
  btn.textContent = 'Refresh raid list (last ' + count + ')';
}

async function openDkpRefreshRosterFromApi(cfg, options) {
  options = options || {};
  const slug = cfg.clientSlug;
  if (!slug) throw new Error('Guild subdomain required');

  const body = await OpenDkpApi.getCharacters(cfg, { includeInactives: true });
  const chars = openDkpCoerceArray(body);
  const built = openDkpBuildRosterMapFromCharacters(chars);

  let base = {};
  if (options.merge !== false) {
    base = Object.assign({}, __odRosterNameToId || {});
    if (!Object.keys(base).length) {
      openDkpHydrateRosterFromCache(slug);
      base = Object.assign({}, __odRosterNameToId || {});
    }
  }

  const merged = openDkpMergeRosterMaps(base, built.map);
  __odRosterNameToId = merged;
  __odClientId = built.clientId || __odClientId || '';
  await openDkpRosterCacheWrite(slug, merged, __odClientId);

  const added = Object.keys(built.map).filter(function(k) { return base[k] === undefined; }).length;
  const updated = Object.keys(built.map).filter(function(k) {
    return openDkpRosterEntryChanged(base[k], built.map[k]);
  }).length;
  const total = Object.keys(merged).length;

  if (!options.silent) {
    let msg;
    if (!added && !updated) {
      msg = 'Roster unchanged (' + total + ' names).';
    } else {
      msg = 'Roster updated (' + total + ' names';
      if (added) msg += ', ' + added + ' new';
      if (updated) msg += ', ' + updated + ' changed';
      msg += ').';
    }
    showStatus(msg, 'success');
  }
  return { total, added, updated };
}

async function openDkpPostSignInBootstrap(cfg) {
  const loaded = [];
  const errors = [];

  try {
    const raidCount = await openDkpFetchAndRenderRaids(cfg);
    loaded.push('raids (' + raidCount + ')');
  } catch (e) {
    errors.push('raids: ' + (e.message || e));
  }

  try {
    const poolCount = await openDkpFetchAndRenderPools(cfg);
    loaded.push('pools (' + poolCount + ')');
  } catch (e) {
    errors.push('pools: ' + (e.message || e));
  }

  // Roster is not loaded on sign-in — OpenDKP creates new characters on tick upload.
  // Use Settings → "Load roster" only when you need a local name → ID cache.

  if (loaded.length && !errors.length) {
    return 'Signed in — loaded ' + loaded.join(', ') + '.';
  }
  if (loaded.length && errors.length) {
    return 'Signed in — loaded ' + loaded.join(', ') + '. Failed: ' + errors.join('; ');
  }
  if (errors.length) {
    throw new Error(errors.join('; '));
  }
  return 'Signed in.';
}

function openDkpWireRaidWorkflowUi() {
  const odRoot = document.getElementById('openDkpApiGroup');
  if (odRoot && odRoot.dataset.odkpWired === '1') {
    return;
  }

  const signIn = document.getElementById('opendkpSignIn');
  if (signIn) {
    signIn.addEventListener('click', async () => {
      const statusLine = document.getElementById('opendkpTokenStatus');
      const setLine = (text) => {
        if (statusLine) statusLine.textContent = text;
      };
      try {
        if (!window.OpenDkpApi) {
          const msg = 'API module not loaded. Reload the extension; ensure lib/opendkp-api.js is in the package.';
          setLine(msg);
          showStatus(msg, 'error');
          console.error('[OpenDKP]', msg);
          return;
        }
        const user = (document.getElementById('opendkpCognitoUser') || {}).value || '';
        const pass = (document.getElementById('opendkpCognitoPassword') || {}).value || '';
        if (!user || !pass) {
          const msg = 'Enter your OpenDKP username and password (API sign-in; same account as the OpenDKP site).';
          setLine(msg);
          showStatus(msg, 'error');
          return;
        }
        signIn.disabled = true;
        setLine('Signing in…');
        await OpenDkpApi.cognitoInitiatePasswordAuth({
          clientId: OPEN_DKP_COGNITO_CLIENT_ID,
          username: user,
          password: pass
        });
        await openDkpPersistApiCredentials(user, pass);
        await openDkpUpdateTokenStatusEl();
        const cfg = getOpenDkpApiConfig();
        if (!cfg.clientSlug) {
          showStatus('Signed in (credentials saved). Enter guild subdomain to load raids and pools.', 'success');
          return;
        }
        try {
          const summary = await openDkpPostSignInBootstrap(cfg);
          showStatus(summary, 'success');
        } catch (bootstrapErr) {
          console.error('[OpenDKP] Post sign-in bootstrap failed', bootstrapErr);
          showStatus('Signed in, but auto-load failed: ' + (bootstrapErr.message || bootstrapErr), 'warning');
        }
      } catch (e) {
        const detail = (e && e.message) ? e.message : String(e);
        console.error('[OpenDKP] Sign-in failed', e);
        setLine('Sign-in failed: ' + detail);
        showStatus('Sign-in failed: ' + detail, 'error');
      } finally {
        signIn.disabled = false;
      }
    });
  }
  const signOut = document.getElementById('opendkpSignOut');
  if (signOut) {
    signOut.addEventListener('click', async () => {
      if (!window.OpenDkpApi) return;
      await OpenDkpApi.clearTokens();
      showStatus('Signed out.', 'success');
      await openDkpUpdateTokenStatusEl();
    });
  }
  const refBtn = document.getElementById('opendkpRefreshToken');
  if (refBtn) {
    refBtn.addEventListener('click', async () => {
      if (!window.OpenDkpApi) return;
      const api = typeof browser !== 'undefined' ? browser : chrome;
      const local = await new Promise((res) => api.storage.local.get([OpenDkpApi.STORAGE_KEYS.refreshToken], res));
      const rt = local[OpenDkpApi.STORAGE_KEYS.refreshToken];
      if (!rt) return showStatus('No refresh token; sign in again.', 'error');
      try {
        await OpenDkpApi.cognitoRefresh({ clientId: OPEN_DKP_COGNITO_CLIENT_ID, refreshToken: rt });
        showStatus('Session refreshed.', 'success');
        await openDkpUpdateTokenStatusEl();
      } catch (e) {
        showStatus('Refresh failed: ' + (e.message || e), 'error');
      }
    });
  }
  const fetchPoolsBtn = document.getElementById('opendkpFetchPools');
  if (fetchPoolsBtn) {
    fetchPoolsBtn.addEventListener('click', async () => {
      if (!window.OpenDkpApi) return;
      const cfg = getOpenDkpApiConfig();
      if (!cfg.clientSlug) return showStatus('Enter guild subdomain.', 'error');
      try {
        const count = await openDkpFetchAndRenderPools(cfg, { forceRefresh: true });
        showStatus('Pools refreshed (' + count + '; Classic selected when no saved preference).', 'success');
      } catch (e) {
        showStatus('Pools failed: ' + (e.message || e), 'error');
      }
    });
  }

  const fetchRaidsBtn = document.getElementById('opendkpFetchRaids');
  if (fetchRaidsBtn) {
    fetchRaidsBtn.addEventListener('click', async () => {
      if (!window.OpenDkpApi) return;
      const cfg = getOpenDkpApiConfig();
      if (!cfg.clientSlug) return showStatus('Enter guild subdomain.', 'error');
      try {
        await openDkpFetchAndRenderRaids(cfg);
        showStatus('Raid list updated.', 'success');
      } catch (e) {
        showStatus('Raids failed: ' + (e.message || e), 'error');
      }
    });
  }

  const raidListCountInput = document.getElementById('opendkpRaidListCount');
  if (raidListCountInput) {
    raidListCountInput.addEventListener('input', openDkpUpdateFetchRaidsButtonLabel);
    raidListCountInput.addEventListener('change', function () {
      const normalized = openDkpNormalizeRaidListCountSetting(raidListCountInput.value);
      raidListCountInput.value = String(normalized);
      currentSettings.opendkpRaidListCount = normalized;
      openDkpUpdateFetchRaidsButtonLabel();
    });
  }
  openDkpUpdateFetchRaidsButtonLabel();

  const createBtn = document.getElementById('opendkpCreateRaid');
  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      if (!window.OpenDkpApi || !window.confirm('Create a new raid on OpenDKP?')) return;
      const cfg = getOpenDkpApiConfig();
      if (!cfg.clientSlug) return showStatus('Enter guild subdomain.', 'error');
      const nameEl = document.getElementById('opendkpCreateRaidName');
      const nm = nameEl && nameEl.value ? nameEl.value.trim() : '';
      if (!nm) return showStatus('Raid name is required.', 'error');
      const poolSel = document.getElementById('opendkpPoolSelect');
      const opt = poolSel && poolSel.selectedOptions && poolSel.selectedOptions[0];
      if (!opt || !opt.value) return showStatus('Select a pool (load pools first).', 'error');
      const attendance = openDkpParseAttendance(
        (document.getElementById('opendkpAttendance') || {}).value
      );
      const ticks = openDkpBuildCreateRaidTicksFromDefs(currentSettings.opendkpRaidTickDefs);
      const body = {
        Name: nm,
        Timestamp: new Date().toISOString(),
        Attendance: attendance,
        Pool: {
          Name: opt.dataset.name || opt.textContent,
          Description: opt.dataset.desc || '',
          Order: parseInt(opt.dataset.order || '0', 10),
          PoolId: parseInt(opt.value, 10)
        },
        Items: [],
        Ticks: ticks
      };
      try {
        const created = await OpenDkpApi.putRaid(cfg, body);
        const rid = created && (created.Id != null ? created.Id : created.RaidId);
        if (rid == null) {
          showStatus('Raid created but response had no id; refresh list.', 'success');
        } else {
          const ticksOut = (created.Ticks || []).map((t) => ({
            id: t.Id != null ? t.Id : t.TickId,
            description: t.Description,
            value: t.Value
          }));
          openDkpPersistCurrentRaid(rid, { name: created.Name || nm, ticks: ticksOut });
          showStatus('Raid created.', 'success');
          await openDkpFetchAndRenderRaids(cfg);
        }
      } catch (e) {
        showStatus('Create failed: ' + (e.message || e), 'error');
      }
    });
  }

  const raidtickFile = document.getElementById('opendkpRaidtickFile');
  if (raidtickFile) {
    raidtickFile.addEventListener('change', () => {
      const sel = document.getElementById('opendkpRaidtickTickSelect');
      const tickId = sel && sel.value;
      if (!tickId) {
        showStatus('Select a target tick before choosing a file.', 'error');
        raidtickFile.value = '';
        return;
      }
      const f = raidtickFile.files && raidtickFile.files[0];
      if (!f || !window.RaidTickParse) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const parsed = RaidTickParse.parseRaidTickFileContent(reader.result);
        const names = RaidTickParse.dedupeCharacterNames
          ? RaidTickParse.dedupeCharacterNames(parsed.characterNames)
          : parsed.characterNames;
        if (!names.length) {
          showStatus('No player names found in that file.', 'error');
          return;
        }
        const slotIndex = openDkpTickIdToSlotIndex(tickId);
        if (slotIndex < 0) {
          showStatus('Target tick not found on current raid summary.', 'error');
          return;
        }
        const s = openDkpGetCurrentRaidSummary();
        const tickMeta = s && s.ticks ? s.ticks[slotIndex] : null;
        const rid = currentSettings.opendkpCurrentRaidId;
        __odRaidtickStageByTickId[tickId] = {
          fileName: f.name,
          names: names
        };
        if (window.RaidTickQueue && RaidTickQueue.stageNamesForSlot && rid != null) {
          try {
            await RaidTickQueue.stageNamesForSlot(
              rid,
              slotIndex,
              tickId,
              tickMeta && tickMeta.description ? tickMeta.description : '',
              names,
              f.name
            );
          } catch (e) {
            showStatus('Staged locally but popup queue sync failed: ' + (e.message || e), 'warning');
            openDkpRenderRaidtickStageUi();
            return;
          }
        }
        openDkpRenderRaidtickStageUi();
        showStatus('Staged ' + names.length + ' name(s) for tick ' + tickId + '.', 'success');
      };
      reader.readAsText(f);
      raidtickFile.value = '';
    });
  }

  const clearStageBtn = document.getElementById('opendkpRaidtickClearStage');
  if (clearStageBtn) {
    clearStageBtn.addEventListener('click', async () => {
      __odRaidtickStageByTickId = {};
      const rid = currentSettings.opendkpCurrentRaidId;
      if (window.RaidTickQueue && RaidTickQueue.clearQueueForRaid && rid != null) {
        try {
          await RaidTickQueue.clearQueueForRaid(rid);
        } catch (_) {}
      }
      openDkpRenderRaidtickStageUi();
      showStatus('Cleared staged tick files (Settings and popup queue).', 'info');
    });
  }

  const rosterMapBtn = document.getElementById('opendkpRaidtickLoadRosterMap');
  if (rosterMapBtn) {
    rosterMapBtn.addEventListener('click', async () => {
      if (!window.OpenDkpApi) return;
      const cfg = getOpenDkpApiConfig();
      if (!cfg.clientSlug) return showStatus('Enter guild subdomain.', 'error');
      try {
        await openDkpRefreshRosterFromApi(cfg, { merge: true, silent: false });
      } catch (e) {
        showStatus('Characters failed: ' + (e.message || e), 'error');
      }
    });
  }

  const applyTick = document.getElementById('opendkpRaidtickApply');
  if (applyTick) {
    applyTick.addEventListener('click', async () => {
      if (!window.OpenDkpApi || !window.RaidTickParse) return;
      const inputs = openDkpGatherRaidtickBatchInputs({ allowPartialExisting: true });
      if (!inputs.ok) return showStatus(inputs.message, 'error');
      if (
        !window.confirm(
          'POST staged tick rosters to the current raid on OpenDKP?\n\n' +
            inputs.stagedCount +
            ' tick file(s) staged for ' +
            inputs.totalTicks +
            ' raid tick(s). Unstaged ticks stay empty or keep their current roster.'
        )
      ) {
        return;
      }
      const cfg = inputs.cfg;
      const rid = inputs.rid;

      try {
        const built = await openDkpBuildRaidtickPostBodyBatch(inputs);
        const full = built.full;
        const postBody = built.postBody;
        if (!postBody.RaidId) {
          return showStatus('Raid is missing RaidId; refresh the current raid and try again.', 'error');
        }
        const guildClientId = OpenDkpApi.resolveGuildClientId
          ? OpenDkpApi.resolveGuildClientId(full, __odClientId)
          : full.ClientId || __odClientId || '';
        if (!guildClientId) {
          return showStatus(
            'Guild ClientId is missing from the raid response. Refresh the current raid and try again.',
            'error'
          );
        }
        if (__odClientId && full.ClientId && String(__odClientId) !== String(full.ClientId)) {
          console.warn(
            '[OpenDKP] Roster cache ClientId differed from raid ClientId; using raid value for POST.',
            { cached: __odClientId, raid: full.ClientId }
          );
        }
        console.log('[OpenDKP] POST raid update', JSON.stringify(postBody));
        await OpenDkpApi.postRaidUpdate(cfg, rid, postBody, { clientId: guildClientId });
        const refreshed = await OpenDkpApi.getRaid(cfg, rid);
        const ticks = (refreshed.Ticks || []).map((t) => ({
          id: t.Id != null ? t.Id : t.TickId,
          description: t.Description,
          value: t.Value
        }));
        openDkpPersistCurrentRaid(rid, { name: refreshed.Name, ticks });
        __odRaidtickStageByTickId = {};
        if (window.RaidTickQueue && RaidTickQueue.clearQueueForRaid) {
          await RaidTickQueue.clearQueueForRaid(rid);
        }
        openDkpRenderRaidtickStageUi();
        showStatus('Raid ticks updated.', 'success');
      } catch (e) {
        const prev = document.getElementById('opendkpRaidtickPreview');
        const msg = openDkpFormatApiError(e);
        if (prev) {
          prev.textContent =
            'Upload failed:\n\n' +
            msg +
            '\n\nCheck ClientId, TickIds, and that the API session is still valid.';
        }
        showStatus('Apply failed: ' + msg, 'error');
      }
    });
  }

  const uploadToggle = document.getElementById('opendkpRaidtickUploadEnabled');
  if (uploadToggle && !isOpenDkpRaidtickUploadSunset()) {
    uploadToggle.addEventListener('change', function () {
      currentSettings.opendkpRaidtickUploadEnabled = uploadToggle.checked;
      openDkpUpdateRaidtickUploadBlockVisibility();
    });
  }

  openDkpUpdateTokenStatusEl();
  openDkpRenderCurrentRaid();
  openDkpPopulateTickSelect();

  if (odRoot) {
    odRoot.dataset.odkpWired = '1';
  }
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
  const themeEl = document.getElementById('theme');
  if (themeEl) themeEl.value = (currentSettings.theme === 'light' || currentSettings.theme === 'dark' || currentSettings.theme === 'system') ? currentSettings.theme : 'system';
  document.getElementById('raidLeaderNotification').checked = currentSettings.raidLeaderNotification;
  document.getElementById('smartBidding').checked = currentSettings.smartBidding;
  
  // Handle Smart Bidding Mode visibility based on profile
  const smartBiddingCheckbox = document.getElementById('smartBidding');
  const smartBiddingRow = document.getElementById('smartBiddingRow')
    || (smartBiddingCheckbox && smartBiddingCheckbox.closest('.setting-row'));
  const smartBiddingDescription = document.getElementById('smartBiddingDescription')
    || (smartBiddingRow && smartBiddingRow.nextElementSibling);

  if (currentSettings.soundProfile === 'raidleader') {
    // Hide Smart Bidding Mode entirely for Raid Leader
    if (smartBiddingRow) smartBiddingRow.style.display = 'none';
    if (smartBiddingDescription) smartBiddingDescription.style.display = 'none';
  } else {
    // Show Smart Bidding Mode for other profiles
    if (smartBiddingRow) smartBiddingRow.style.display = 'flex';
    if (smartBiddingDescription) smartBiddingDescription.style.display = 'block';
  }
  
  document.getElementById('quietHours').checked = currentSettings.quietHours;
  document.getElementById('quietStart').value = currentSettings.quietStart;
  document.getElementById('quietEnd').value = currentSettings.quietEnd;
  // Auction readout (Issue #2: day-of-week)
  const annChk = document.getElementById('announceAuctions'); if (annChk) annChk.checked = !!currentSettings.announceAuctions;
  const annStart = document.getElementById('announceStart'); if (annStart) annStart.value = currentSettings.announceStart || '19:00';
  const annEnd = document.getElementById('announceEnd'); if (annEnd) annEnd.value = currentSettings.announceEnd || '23:59';
  const annDays = Array.isArray(currentSettings.announceNewAuctionsDays) ? currentSettings.announceNewAuctionsDays : [0,1,2,3,4,5,6];
  for (let d = 0; d < 7; d++) {
    const cb = document.getElementById('announceDay' + d);
    if (cb) cb.checked = annDays.includes(d);
  }
  const watchlistEnabledEl = document.getElementById('watchlistAlarmEnabled');
  if (watchlistEnabledEl) watchlistEnabledEl.checked = !!currentSettings.watchlistAlarmEnabled;
  const watchlistItemsEl = document.getElementById('watchlistItems');
  if (watchlistItemsEl) watchlistItemsEl.value = currentSettings.watchlistItems || '';
  updateWatchlistSettings();
  const autoBidEnabledEl = document.getElementById('autoBidEnabled');
  if (autoBidEnabledEl) autoBidEnabledEl.checked = !!currentSettings.autoBidEnabled;
  const itemPriceHistoryEl = document.getElementById('itemPriceHistoryEnabled');
  if (itemPriceHistoryEl) {
    itemPriceHistoryEl.checked = currentSettings.itemPriceHistoryEnabled !== false;
  }
  const autoBidIncrementEl = document.getElementById('autoBidIncrement');
  if (autoBidIncrementEl) {
    autoBidIncrementEl.value = String(currentSettings.autoBidIncrement != null ? currentSettings.autoBidIncrement : 10);
  }
  const autoBidPollEl = document.getElementById('autoBidPollIntervalSec');
  if (autoBidPollEl) {
    autoBidPollEl.value = String(currentSettings.autoBidPollIntervalSec != null ? currentSettings.autoBidPollIntervalSec : 15);
  }
  const abSlugEl = document.getElementById('autoBidClientSlug');
  if (abSlugEl) abSlugEl.value = currentSettings.opendkpClientSlug || '';
  const abUserEl = document.getElementById('autoBidCognitoUser');
  if (abUserEl) abUserEl.value = currentSettings.opendkpCognitoUsername || '';
  const abPassEl = document.getElementById('autoBidCognitoPassword');
  if (abPassEl && __odSavedApiPassword) abPassEl.value = __odSavedApiPassword;
  updateAutoBidDetailsVisibility();
  updateAutoBidApiBlockVisibility(currentSettings.soundProfile);
  autoBidLoadRankLimitsCache()
    .then(function () {
      return autoBidLoadCharactersCache();
    })
    .then(function () {
      renderAutoBidRulesTable();
    })
    .catch(function () {
      renderAutoBidRulesTable();
    });
  try { autoBidUpdateTokenStatusEl(); } catch (_) {}
  const flashEl = document.getElementById('flashScreen'); if (flashEl) flashEl.checked = currentSettings.flashScreen;
  document.getElementById('browserNotifications').checked = currentSettings.browserNotifications;
  // checkInterval is fixed at 100ms (no Settings UI)
  // Profile regions (Raid Leader tools shown/hidden; Raider region always visible)
  if (currentSettings.soundProfile === 'raidleader') {
    const rtEnabled = document.getElementById('raidTickEnabled');
    const rtFolder = document.getElementById('raidTickFolder');
    const rtClearBtn = document.getElementById('clearFolder');
    if (rtEnabled) rtEnabled.checked = !!currentSettings.raidTickEnabled;
    if (rtFolder) rtFolder.value = currentSettings.raidTickFolder || '';
    if (rtClearBtn) rtClearBtn.style.display = currentSettings.raidTickFolder ? 'inline-block' : 'none';
  }
  updateOpenDkpApiGroupVisibility(currentSettings.soundProfile);
  const odSlug = document.getElementById('opendkpClientSlug');
  if (odSlug) odSlug.value = currentSettings.opendkpClientSlug || '';
  const odUpload = document.getElementById('opendkpRaidtickUploadEnabled');
  if (odUpload) odUpload.checked = !!currentSettings.opendkpRaidtickUploadEnabled;
  openDkpUpdateRaidtickUploadBlockVisibility();
  const odAtt = document.getElementById('opendkpAttendance');
  if (odAtt) {
    odAtt.value = String(openDkpParseAttendance(currentSettings.opendkpAttendance));
  }
  const odRaidListCount = document.getElementById('opendkpRaidListCount');
  if (odRaidListCount) {
    odRaidListCount.value = String(
      openDkpNormalizeRaidListCountSetting(currentSettings.opendkpRaidListCount)
    );
  }
  const odBiddingToolRaidLock = document.getElementById('opendkpBiddingToolRaidLock');
  if (odBiddingToolRaidLock) {
    odBiddingToolRaidLock.checked = currentSettings.opendkpBiddingToolRaidLock !== false;
  }
  openDkpUpdateFetchRaidsButtonLabel();
  const odPayStrategy = document.getElementById('opendkpAuctionPayStrategy');
  if (odPayStrategy) {
    const ps = currentSettings.opendkpAuctionPayStrategy || 'exact';
    odPayStrategy.value =
      ps === 'second_plus_one' || ps === 'second_plus_one_equal' ? ps : 'exact';
  }
  const odAuctionDuration = document.getElementById('opendkpAuctionDuration');
  if (odAuctionDuration) {
    const dur = parseInt(String(currentSettings.opendkpAuctionDuration != null ? currentSettings.opendkpAuctionDuration : 2), 10);
    odAuctionDuration.value = String(Number.isNaN(dur) || dur < 1 ? 2 : dur);
  }
  const eqLogExceptionsEl = document.getElementById('eqLogLootExceptions');
  if (eqLogExceptionsEl) {
    const rules = Array.isArray(currentSettings.eqLogLootExceptions)
      ? currentSettings.eqLogLootExceptions
      : DEFAULT_SETTINGS.eqLogLootExceptions;
    eqLogExceptionsEl.value = rules.join('\n');
  }
  updateEqLogLootExceptionsSummary();
  const odUser = document.getElementById('opendkpCognitoUser');
  if (odUser) odUser.value = currentSettings.opendkpCognitoUsername || '';
  const odPass = document.getElementById('opendkpCognitoPassword');
  if (odPass && __odSavedApiPassword) odPass.value = __odSavedApiPassword;
  if (currentSettings.opendkpClientSlug) {
    openDkpHydrateRosterFromCache(currentSettings.opendkpClientSlug);
  }
  openDkpHydratePoolsFromCache();
  try { renderOpenDkpRaidTickDefsUI(); } catch (_) {}
  try { openDkpRenderCurrentRaid(); } catch (_) {}
  try { openDkpPopulateTickSelect(); } catch (_) {}
  try { openDkpUpdateTokenStatusEl(); } catch (_) {}

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


function parseEqLogLootExceptionsFromText(raw) {
  if (window.EqLogParse && EqLogParse.normalizeExceptionRules) {
    return EqLogParse.normalizeExceptionRules(raw);
  }
  return String(raw || '')
    .split(/\r?\n/)
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

function updateEqLogLootExceptionsSummary() {
  const el = document.getElementById('eqLogLootExceptionsSummary');
  if (!el) return;
  const rules = Array.isArray(currentSettings.eqLogLootExceptions)
    ? currentSettings.eqLogLootExceptions
    : [];
  if (!rules.length) {
    el.textContent = 'No exception rules active.';
    return;
  }
  const preview = rules.slice(0, 3).join(', ');
  el.textContent =
    rules.length +
    ' rule(s): ' +
    preview +
    (rules.length > 3 ? '…' : '');
}

function restoreEqLogLootExceptionsDefaults() {
  const defaults = Array.isArray(DEFAULT_SETTINGS.eqLogLootExceptions)
    ? DEFAULT_SETTINGS.eqLogLootExceptions.slice()
    : [];
  const el = document.getElementById('eqLogLootExceptions');
  if (el) el.value = defaults.join('\n');
  currentSettings.eqLogLootExceptions = defaults;
  updateEqLogLootExceptionsSummary();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  wireCriticalSettingsAutoSave();
  wireScrollFab();
  wireAutoBidUi();
  // OpenDKP API: wire first so a failure later in this function cannot skip these handlers
  openDkpWireRaidWorkflowUi();

  const addRaidTickDefBtn = document.getElementById('opendkpAddRaidTickDef');
  if (addRaidTickDefBtn) {
    addRaidTickDefBtn.addEventListener('click', function () {
      addOpenDkpRaidTickDef();
    });
  }

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
  for (let d = 0; d < 7; d++) {
    const cb = document.getElementById('announceDay' + d);
    if (cb) cb.addEventListener('change', function() {
      currentSettings.announceNewAuctionsDays = currentSettings.announceNewAuctionsDays || [0,1,2,3,4,5,6];
      const dayNum = parseInt(this.value, 10);
      if (this.checked) {
        if (!currentSettings.announceNewAuctionsDays.includes(dayNum)) currentSettings.announceNewAuctionsDays.push(dayNum);
      } else {
        currentSettings.announceNewAuctionsDays = currentSettings.announceNewAuctionsDays.filter(x => x !== dayNum);
      }
      if (currentSettings.announceNewAuctionsDays.length === 0) currentSettings.announceNewAuctionsDays = [0,1,2,3,4,5,6];
    });
  }

  const watchlistEnabledChk = document.getElementById('watchlistAlarmEnabled');
  if (watchlistEnabledChk) watchlistEnabledChk.addEventListener('change', function() {
    currentSettings.watchlistAlarmEnabled = this.checked;
    updateWatchlistSettings();
    persistCriticalSettingsToStorage({ silent: true });
  });
  const watchlistItemsInput = document.getElementById('watchlistItems');
  if (watchlistItemsInput) watchlistItemsInput.addEventListener('input', function() {
    currentSettings.watchlistItems = this.value;
    schedulePersistCriticalSettings();
  });
  const testWatchlistAlarmEl = document.getElementById('testWatchlistAlarm');
  if (testWatchlistAlarmEl) testWatchlistAlarmEl.addEventListener('click', testWatchlistAlarm);
  
  const testTplEl = document.getElementById('testCustomTemplate');
  if (testTplEl) testTplEl.addEventListener('click', testCustomTemplate);
  const resetTplEl = document.getElementById('resetTemplate');
  if (resetTplEl) resetTplEl.addEventListener('click', resetTemplate);
  
  // Sound profile change
  const soundProfileEl = document.getElementById('soundProfile');
  if (soundProfileEl) soundProfileEl.addEventListener('change', function(e) {
    e.preventDefault();
    const prevProfile = currentSettings.soundProfile;
    const soundTypeSelect = document.getElementById('soundType');
    if (prevProfile && soundTypeSelect && soundTypeSelect.value) {
      currentSettings[prevProfile + 'Sound'] = soundTypeSelect.value;
    }
    updateSoundProfile();
    // Ensure custom sounds are added after profile changes
    updateCustomSoundOptions();
  });

  // Theme (Appearance) - Issue #5
  const themeEl = document.getElementById('theme');
  if (themeEl) themeEl.addEventListener('change', function() {
    const theme = this.value;
    currentSettings.theme = theme;
    const isDark = theme === 'dark' || (theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(theme);
    api.storage.sync.set({ theme: theme, darkMode: theme === 'dark' });
    try { api.runtime.sendMessage({ type: 'darkModeChanged', value: isDark }); } catch(_) {}
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
      const profile = currentSettings.soundProfile || 'raidleader';
      currentSettings[profile + 'Sound'] = this.value;
      console.log('[SoundType] Selection changed to:', this.value, 'for profile:', profile);
    });
  }
  
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
  const remindersEnabledEl = document.getElementById('remindersEnabled');
  if (remindersEnabledEl) {
    remindersEnabledEl.addEventListener('change', function() {
      currentSettings.reminderPrefs = currentSettings.reminderPrefs || {
        remindersEnabled: true,
        flash: true,
        notifications: true,
        enabledDays: [0, 1, 2, 3, 4, 5, 6]
      };
      currentSettings.reminderPrefs.remindersEnabled = !!this.checked;
      saveRemindersPartial();
    });
  }

  // Save button
  const saveSettingsEl = document.getElementById('saveSettings'); if (saveSettingsEl) saveSettingsEl.addEventListener('click', function(e) {
    e.preventDefault();
    preserveScrollPosition(() => {
      saveSettings();
    });
  });

  // Backup & Restore
  const exportBackupEl = document.getElementById('exportBackup');
  if (exportBackupEl) exportBackupEl.addEventListener('click', exportBackup);
  const importBackupFileEl = document.getElementById('importBackupFile');
  if (importBackupFileEl) importBackupFileEl.addEventListener('change', function() {
    const file = this.files && this.files[0];
    if (file) importBackup(file);
    this.value = '';
  });
  const backupIncludeCredentialsEl = document.getElementById('backupIncludeCredentials');
  if (backupIncludeCredentialsEl) {
    backupIncludeCredentialsEl.addEventListener('change', updateBackupCredentialsWarning);
    updateBackupCredentialsWarning();
  }

  const restoreEqLogExceptionsBtn = document.getElementById('restoreEqLogExceptionsDefaults');
  if (restoreEqLogExceptionsBtn) {
    restoreEqLogExceptionsBtn.addEventListener('click', function (e) {
      e.preventDefault();
      restoreEqLogLootExceptionsDefaults();
    });
  }
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
  const remindersEnabledEl = document.getElementById('remindersEnabled');
  if (remindersEnabledEl) {
    remindersEnabledEl.checked = currentSettings.reminderPrefs.remindersEnabled !== false;
  }
  // Load day checkboxes
  for (let day = 0; day < 7; day++) {
    const dayCheckbox = document.getElementById('reminderDay' + day);
    if (dayCheckbox) {
      dayCheckbox.checked = currentSettings.reminderPrefs.enabledDays.includes(day);
    }
  }
  if (btn) btn.disabled = currentSettings.reminders.length >= 5;
  if (!list) return;
  list.textContent = ''; // Clear using textContent instead of innerHTML
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
    
    // Build reminder row using DOM API (replaces innerHTML)
    // Enabled checkbox label
    const enabledLabel = document.createElement('label');
    enabledLabel.style.display = 'flex';
    enabledLabel.style.alignItems = 'center';
    enabledLabel.style.gap = '6px';
    enabledLabel.style.flexShrink = '0';
    enabledLabel.style.color = labelColor;
    
    const enabledCheckbox = document.createElement('input');
    enabledCheckbox.type = 'checkbox';
    enabledCheckbox.setAttribute('data-k', 'enabled');
    if (r.enabled) enabledCheckbox.checked = true;
    
    enabledLabel.appendChild(enabledCheckbox);
    enabledLabel.appendChild(document.createTextNode(' Enabled'));
    row.appendChild(enabledLabel);
    
    // Start time label
    const startLabel = document.createElement('label');
    startLabel.style.flexShrink = '0';
    startLabel.style.color = labelColor;
    startLabel.appendChild(document.createTextNode('Start: '));
    
    const startInput = document.createElement('input');
    startInput.type = 'time';
    startInput.step = '300';
    startInput.setAttribute('data-k', 'start');
    startInput.value = r.start || '19:00';
    startInput.style.width = '100px';
    
    startLabel.appendChild(startInput);
    row.appendChild(startLabel);
    
    // End time label
    const endLabel = document.createElement('label');
    endLabel.style.flexShrink = '0';
    endLabel.style.color = labelColor;
    endLabel.appendChild(document.createTextNode('End: '));
    
    const endInput = document.createElement('input');
    endInput.type = 'time';
    endInput.step = '300';
    endInput.setAttribute('data-k', 'end');
    endInput.value = r.end || '23:00';
    endInput.style.width = '100px';
    
    endLabel.appendChild(endInput);
    row.appendChild(endLabel);
    
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-secondary';
    deleteBtn.setAttribute('data-action', 'delete');
    deleteBtn.style.flexShrink = '0';
    deleteBtn.style.minWidth = '36px';
    deleteBtn.style.padding = '6px 8px';
    deleteBtn.setAttribute('title', 'Delete reminder');
    deleteBtn.textContent = '🗑️';
    
    row.appendChild(deleteBtn);
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
  // Sync master switch from UI so it is always persisted
  const remindersEnabledEl = document.getElementById('remindersEnabled');
  if (remindersEnabledEl) {
    currentSettings.reminderPrefs.remindersEnabled = !!remindersEnabledEl.checked;
  } else if (currentSettings.reminderPrefs.remindersEnabled === undefined) {
    currentSettings.reminderPrefs.remindersEnabled = true;
  }
  try {
    if (_reminderSaveTimer) clearTimeout(_reminderSaveTimer);
    _reminderSaveTimer = setTimeout(() => {
      const payload = {
        reminders: (currentSettings.reminders || []).slice(0,5),
        reminderPrefs: currentSettings.reminderPrefs || { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] }
      };
      console.log('[Options] 📝 saveRemindersPartial called - saving to storage:', {
        reminderCount: payload.reminders.length,
        enabledReminderCount: payload.reminders.filter(r => r && r.enabled).length,
        reminderDetails: payload.reminders.map(r => ({
          id: r?.id,
          enabled: r?.enabled,
          start: r?.start,
          end: r?.end,
          message: r?.message
        })),
        reminderPrefs: payload.reminderPrefs,
        timestamp: new Date().toISOString()
      });
      try {
        const storage = api && api.storage ? api.storage : chrome.storage;
        storage.sync.set(payload, function(){
          if (chrome && chrome.runtime && chrome.runtime.lastError) {
            console.error('[Options] ❌ Error saving reminders to storage:', chrome.runtime.lastError.message);
          } else {
            console.log('[Options] ✅ Reminders saved to storage successfully');
            // Mirror to local so Firefox keeps reminders if sync is evicted
            if (storage.local && storage.local.set) {
              storage.local.set(payload, function() {});
            }
          }
        });
      } catch(e) {
        console.error('[Options] ❌ Exception saving reminders:', e);
      }
    }, 150);
  } catch (e) {
    console.error('[Options] ❌ Exception in saveRemindersPartial:', e);
  }
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
  const soundProfileEl = document.getElementById('soundProfile');
  const soundTypeSelect = document.getElementById('soundType');
  if (!soundProfileEl || !soundTypeSelect) return;

  const profile = PROFILE_SOUNDS[soundProfileEl.value] ? soundProfileEl.value : 'raidleader';
  const raidLeaderSettings = document.getElementById('raidLeaderOnlySettings');
  
  // Clear existing options - use DOM API instead of innerHTML
  while (soundTypeSelect.firstChild) {
    soundTypeSelect.removeChild(soundTypeSelect.firstChild);
  }
  
  // Add profile-specific sounds
  const profileSounds = PROFILE_SOUNDS[profile] || PROFILE_SOUNDS.raidleader;
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
  
  // Show/hide raid leader only settings (region toggle also covers this)
  if (raidLeaderSettings) {
    raidLeaderSettings.style.display = profile === 'raidleader' ? 'block' : 'none';
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
  if (smartBiddingCheckbox) {
  const smartBiddingRow = document.getElementById('smartBiddingRow')
    || smartBiddingCheckbox.closest('.setting-row');
  const smartBiddingDescription = document.getElementById('smartBiddingDescription')
    || (smartBiddingRow && smartBiddingRow.nextElementSibling);
  
  if (profile === 'raider') {
    // Show Smart Bidding Mode for Raider and auto-enable it
    if (smartBiddingRow) smartBiddingRow.style.display = 'flex';
    if (smartBiddingDescription) smartBiddingDescription.style.display = 'block';
    currentSettings.smartBidding = true;
    smartBiddingCheckbox.checked = true;
    console.log('Smart bidding automatically enabled for raider profile');
  } else if (profile === 'raidleader') {
    // Hide Smart Bidding Mode entirely for Raid Leader
    if (smartBiddingRow) smartBiddingRow.style.display = 'none';
    if (smartBiddingDescription) smartBiddingDescription.style.display = 'none';
    console.log('Raid leader profile - smart bidding mode hidden');
  }
  }

  updateOpenDkpApiGroupVisibility(profile);
  }); // Close preserveScrollPosition wrapper
}

function getSavedSoundForProfile(profile) {
  // Check if there's a saved sound for this profile (canonical + legacy plural keys)
  const profileKey = profile + 'Sound';
  if (currentSettings[profileKey]) {
    return currentSettings[profileKey];
  }
  if (profile === 'raidleader' && currentSettings.raidLeaderSounds) {
    return currentSettings.raidLeaderSounds;
  }
  if (profile === 'raider' && currentSettings.raiderSounds) {
    return currentSettings.raiderSounds;
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
  listEl.textContent = ''; // Clear using textContent instead of innerHTML
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
      const nameAttr = escapeHtmlAttr(rec.name || '');
      const sizeKB = String(Math.round(size/1024));
      
      // Build sound record row using DOM API (replaces innerHTML)
      // Name and size container
      const nameContainer = document.createElement('div');
      nameContainer.style.flex = '1';
      nameContainer.style.overflow = 'hidden';
      nameContainer.style.textOverflow = 'ellipsis';
      nameContainer.style.whiteSpace = 'nowrap';
      
      const nameStrong = document.createElement('strong');
      nameStrong.textContent = displayName; // Safe: textContent escapes automatically
      
      const sizeSpan = document.createElement('span');
      sizeSpan.style.color = '#666';
      sizeSpan.textContent = ` (${sizeKB} KB)`;
      
      nameContainer.appendChild(nameStrong);
      nameContainer.appendChild(sizeSpan);
      row.appendChild(nameContainer);
      
      // Buttons container
      const buttonsContainer = document.createElement('div');
      buttonsContainer.style.display = 'flex';
      buttonsContainer.style.gap = '6px';
      
      // Rename button
      const renameBtn = document.createElement('button');
      renameBtn.className = 'btn btn-secondary';
      renameBtn.setAttribute('data-action', 'rename');
      renameBtn.setAttribute('data-name', nameAttr);
      renameBtn.textContent = 'Rename';
      buttonsContainer.appendChild(renameBtn);
      
      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn';
      deleteBtn.style.background = '#dc3545';
      deleteBtn.style.borderColor = '#dc3545';
      deleteBtn.setAttribute('data-action', 'delete');
      deleteBtn.setAttribute('data-name', nameAttr);
      deleteBtn.textContent = 'Delete';
      buttonsContainer.appendChild(deleteBtn);
      
      row.appendChild(buttonsContainer);
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
  const daysRow = document.getElementById('announceDaysRow');
  const enabled = document.getElementById('announceAuctions')?.checked;
  if (row) row.style.display = enabled ? 'flex' : 'none';
  if (daysRow) daysRow.style.display = enabled ? 'flex' : 'none';
}

function updateWatchlistSettings() {
  const itemsRow = document.getElementById('watchlistItemsRow');
  const enabled = document.getElementById('watchlistAlarmEnabled')?.checked;
  if (itemsRow) itemsRow.style.display = enabled ? 'flex' : 'none';
}

function testWatchlistAlarm() {
  const enabled = document.getElementById('watchlistAlarmEnabled')?.checked;
  if (!enabled) {
    showStatus('Enable Item Watchlist Alarm first', 'error');
    return;
  }
  const rawItems = document.getElementById('watchlistItems')?.value || '';
  const firstItem = rawItems.split('\n').map(function(line) { return line.trim(); }).filter(Boolean)[0] || 'Test Item';
  const tabsApi = api.tabs || chrome.tabs;

  if (tabsApi && tabsApi.query) {
    tabsApi.query({ url: ['https://opendkp.com/*', 'https://*.opendkp.com/*'] }, function(tabs) {
      const tab = tabs && tabs.length > 0 ? tabs[0] : null;
      if (tab && tab.id != null) {
        tabsApi.sendMessage(tab.id, { action: 'testWatchlistAlarm', itemName: firstItem }, function() {
          const err = (api.runtime && api.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError);
          if (err) {
            runWatchlistAlarmPreview(firstItem, 'Could not reach OpenDKP tab — running audio/TTS preview here.');
            return;
          }
          showStatus('Watchlist alarm running on OpenDKP for "' + firstItem + '" (5s)', 'success');
        });
        return;
      }
      runWatchlistAlarmPreview(firstItem, 'No OpenDKP tab open — audio/TTS preview here. Open opendkp.com and test again for the red flash.');
    });
    return;
  }
  runWatchlistAlarmPreview(firstItem, 'Audio/TTS preview only. Open opendkp.com for the full alarm.');
}

function runWatchlistAlarmPreview(itemName, statusNote) {
  const alarmMs = 5000;
  try {
    const url = (api && api.runtime ? api.runtime : chrome.runtime).getURL('alarm.mp3');
    const audio = new Audio(url);
    const volumePct = parseInt(document.getElementById('volume')?.value || currentSettings.volume || 70, 10);
    audio.volume = Math.max(0, Math.min(1, volumePct / 100));
    audio.loop = true;
    audio.play().catch(function() {
      showStatus('Could not play alarm — click the page first to unlock audio', 'error');
    });
    setTimeout(function() {
      audio.pause();
      audio.currentTime = 0;
    }, alarmMs);

    if (typeof speechSynthesis !== 'undefined') {
      try { speechSynthesis.cancel(); } catch (_) {}
      const voiceName = document.getElementById('voice')?.value || currentSettings.voice || '';
      const voiceSpeed = parseFloat(document.getElementById('voiceSpeed')?.value || currentSettings.voiceSpeed || 1);
      for (let i = 0; i < 5; i++) {
        setTimeout(function() {
          const utterance = new SpeechSynthesisUtterance(itemName);
          if (voiceName) {
            const selected = speechSynthesis.getVoices().find(function(v) {
              return v.name.toLowerCase() === voiceName.toLowerCase();
            });
            if (selected) utterance.voice = selected;
          }
          utterance.rate = Math.min(voiceSpeed, 2.0);
          utterance.volume = Math.max(0, Math.min(1, volumePct / 100));
          speechSynthesis.speak(utterance);
        }, i * 1000);
      }
    }

    showStatus(statusNote + ' Item: "' + itemName + '"', 'success');
  } catch (e) {
    showStatus('Alarm test failed: ' + (e.message || e), 'error');
  }
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

  const rawOpenSlug = (document.getElementById('opendkpClientSlug') && document.getElementById('opendkpClientSlug').value)
    ? String(document.getElementById('opendkpClientSlug').value).trim() : '';
  const normOpenSlug = normalizeOpenDkpClientSlug(rawOpenSlug);
  if (rawOpenSlug && !normOpenSlug) {
    showStatus('Guild subdomain invalid (lowercase letters, numbers, hyphens only).', 'error');
    return;
  }
  const profileForSave = getVal('soundProfile', currentSettings.soundProfile);
  const soundTypeForSave = getVal('soundType', currentSettings.soundType);
  const raidleaderSoundForSave = profileForSave === 'raidleader'
    ? soundTypeForSave
    : (currentSettings.raidleaderSound || currentSettings.raidLeaderSounds || 'bell');
  const raiderSoundForSave = profileForSave === 'raider'
    ? soundTypeForSave
    : (currentSettings.raiderSound || currentSettings.raiderSounds || 'chime');
  const tickDkpForSave = openDkpResolveTickDkpValueForPersist();
  const newSettings = {
    enableTTS: getChecked('enableTTS', currentSettings.enableTTS),
    voice: getVal('voice', currentSettings.voice),
    voiceSpeed: parseFloat(getVal('voiceSpeed', currentSettings.voiceSpeed)),
    enableAdvancedTTS: getChecked('enableAdvancedTTS', currentSettings.enableAdvancedTTS),
    ttsTemplate: getVal('ttsTemplate', currentSettings.ttsTemplate),
    volume: parseInt(getVal('volume', currentSettings.volume)),
    soundProfile: profileForSave,
    soundType: soundTypeForSave,
    // Persist both profiles so mode toggles keep the right sound
    raidleaderSound: raidleaderSoundForSave,
    raiderSound: raiderSoundForSave,
    // Legacy aliases (older content.js / backups)
    raidLeaderSounds: raidleaderSoundForSave,
    raiderSounds: raiderSoundForSave,
    customSounds: currentSettings.customSounds || {},
    smartBidding: getChecked('smartBidding', currentSettings.smartBidding),
    quietHours: getChecked('quietHours', currentSettings.quietHours),
    quietStart: getVal('quietStart', currentSettings.quietStart),
    quietEnd: getVal('quietEnd', currentSettings.quietEnd),
    // Auction readout
    announceAuctions: getChecked('announceAuctions', currentSettings.announceAuctions),
    announceStart: getVal('announceStart', currentSettings.announceStart),
    announceEnd: getVal('announceEnd', currentSettings.announceEnd),
    announceNewAuctionsDays: (() => {
      const days = [];
      for (let d = 0; d < 7; d++) {
        const el = document.getElementById('announceDay' + d);
        if (el && el.checked) days.push(d);
      }
      return days.length ? days : [0,1,2,3,4,5,6];
    })(),
    watchlistAlarmEnabled: getChecked('watchlistAlarmEnabled', currentSettings.watchlistAlarmEnabled),
    watchlistItems: getVal('watchlistItems', currentSettings.watchlistItems || ''),
    autoBidEnabled: getChecked('autoBidEnabled', currentSettings.autoBidEnabled),
    autoBidIncrement: (() => {
      const n = parseInt(String(getVal('autoBidIncrement', currentSettings.autoBidIncrement)), 10);
      return Number.isNaN(n) || n < 1 ? 10 : n;
    })(),
    autoBidPollIntervalSec: (() => {
      const n = parseInt(String(getVal('autoBidPollIntervalSec', currentSettings.autoBidPollIntervalSec)), 10);
      return Number.isNaN(n) || n < 5 ? 15 : n;
    })(),
    autoBidPriority: currentSettings.autoBidPriority != null ? currentSettings.autoBidPriority : 1,
    itemPriceHistoryEnabled: getChecked('itemPriceHistoryEnabled', currentSettings.itemPriceHistoryEnabled !== false),
    autoBidRules: autoBidReadRulesFromUI(),
    disableVisuals: getChecked('disableVisuals', currentSettings.disableVisuals),
    raidLeaderNotification: getChecked('raidLeaderNotification', currentSettings.raidLeaderNotification),
    flashScreen: getChecked('flashScreen', currentSettings.flashScreen),
    browserNotifications: getChecked('browserNotifications', currentSettings.browserNotifications),
    checkInterval: 100,
    theme: (() => { const el = document.getElementById('theme'); return (el && (el.value === 'light' || el.value === 'dark' || el.value === 'system')) ? el.value : (currentSettings.theme || 'system'); })(),
    darkMode: (() => { const el = document.getElementById('theme'); const t = el ? el.value : (currentSettings.theme || 'system'); return t === 'dark' || (t === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches); })(),
    opendkpClientSlug: normOpenSlug,
    opendkpRaidListCount: openDkpGetRaidListCountFromUI(),
    opendkpBiddingToolRaidLock: getChecked(
      'opendkpBiddingToolRaidLock',
      currentSettings.opendkpBiddingToolRaidLock !== false
    ),
    opendkpCurrentRaidId: currentSettings.opendkpCurrentRaidId,
    opendkpCurrentRaidSummaryJson: currentSettings.opendkpCurrentRaidSummaryJson || '',
    opendkpRaidtickUploadEnabled: isOpenDkpRaidtickUploadSunset()
      ? false
      : getChecked(
          'opendkpRaidtickUploadEnabled',
          currentSettings.opendkpRaidtickUploadEnabled
        ),
    opendkpRaidTickDefs: openDkpNormalizeRaidTickDefs(
      currentSettings.opendkpRaidTickDefs,
      tickDkpForSave
    ).slice(0, OPEN_DKP_MAX_RAID_TICK_DEFS),
    opendkpTickDkpValue: tickDkpForSave,
    opendkpAttendance: openDkpParseAttendance(getVal('opendkpAttendance', currentSettings.opendkpAttendance)),
    opendkpPreferredPoolId: (() => {
      const el = document.getElementById('opendkpPoolSelect');
      return el && el.value ? String(el.value) : (currentSettings.opendkpPreferredPoolId || '');
    })(),
    opendkpAuctionPayStrategy: (() => {
      const el = document.getElementById('opendkpAuctionPayStrategy');
      const v = el ? el.value : (currentSettings.opendkpAuctionPayStrategy || 'exact');
      if (v === 'second_plus_one' || v === 'second_plus_one_equal') return v;
      return 'exact';
    })(),
    opendkpAuctionDuration: (() => {
      const el = document.getElementById('opendkpAuctionDuration');
      const raw = el ? el.value : currentSettings.opendkpAuctionDuration;
      const n = parseInt(String(raw != null ? raw : 2), 10);
      return Number.isNaN(n) || n < 1 ? 2 : n;
    })(),
    eqLogLootExceptions: (() => {
      const el = document.getElementById('eqLogLootExceptions');
      return parseEqLogLootExceptionsFromText(el ? el.value : currentSettings.eqLogLootExceptions);
    })(),
    opendkpCognitoUsername: String(getVal('opendkpCognitoUser', currentSettings.opendkpCognitoUsername || '')).trim(),
    // RaidTick Integration settings
    raidTickEnabled: getChecked('raidTickEnabled', currentSettings.raidTickEnabled),
    raidTickFolder: currentSettings.raidTickFolder,
    raidTickFolderHandle: currentSettings.raidTickFolderHandle,
    // Reminders
    reminders: (currentSettings.reminders || []).slice(0,5),
    reminderPrefs: currentSettings.reminderPrefs || { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] }
  };
  
  console.log('[Options] 📝 saveSettings called - saving to storage:', {
    soundProfile: newSettings.soundProfile,
    reminderCount: (newSettings.reminders || []).length,
    enabledReminderCount: (newSettings.reminders || []).filter(r => r && r.enabled).length,
    reminderDetails: (newSettings.reminders || []).map(r => ({
      id: r?.id,
      enabled: r?.enabled,
      start: r?.start,
      end: r?.end,
      message: r?.message
    })),
    reminderPrefs: newSettings.reminderPrefs,
    timestamp: new Date().toISOString()
  });
  
  api.storage.sync.set(newSettings, function() {
    const err = (api.runtime && api.runtime.lastError) || (chrome.runtime && chrome.runtime.lastError);
    if (err) {
      console.error('[Options] ❌ Error saving settings:', err.message);
      showStatus('Error saving settings: ' + err.message, 'error');
    } else {
      console.log('[Options] ✅ Settings saved successfully to storage:', {
        reminderCount: (newSettings.reminders || []).length,
        enabledReminderCount: (newSettings.reminders || []).filter(r => r && r.enabled).length,
        soundProfile: newSettings.soundProfile
      });
      // Mirror reminders to local (Firefox persistence)
      const reminderPayload = {
        reminders: (newSettings.reminders || []).slice(0, 5),
        reminderPrefs: newSettings.reminderPrefs || { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] }
      };
      if (api.storage.local && api.storage.local.set) {
        api.storage.local.set(reminderPayload, function() {});
      }
      const cognitoPass = getVal('opendkpCognitoPassword', '');
      if (cognitoPass && api.storage.local && api.storage.local.set) {
        __odSavedApiPassword = cognitoPass;
        api.storage.local.set({ [OPEN_DKP_PASSWORD_STORAGE_KEY]: cognitoPass }, function() {});
      }
      showStatus('Settings saved successfully!', 'success');
      currentSettings = newSettings;
      persistCriticalSettingsToStorage({ silent: true }).catch(function(e) {
        console.warn('[Options] Failed to update local settings mirror:', e);
      });
      try { applySettingsToUI(); } catch(_) {}
      
      // Notify content scripts of settings change
      const tabsApi = api.tabs || chrome.tabs;
      if (tabsApi && tabsApi.query) {
        tabsApi.query({url: ['https://opendkp.com/*', 'https://*.opendkp.com/*']}, function(tabs) {
          (tabs || []).forEach(tab => {
            (api.tabs || chrome.tabs).sendMessage(tab.id, {
              action: 'settingsUpdated',
              settings: newSettings
            }).catch(() => {});
          });
        });
      }
    }
  });
}

/**
 * Show status message
 */
function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  if (!statusDiv) {
    console.warn('[Options] showStatus: #status missing —', message);
    try {
      alert(message);
    } catch (_) {}
    return;
  }
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + type;
  statusDiv.style.display = 'block';

  const ms = type === 'error' ? 12000 : 5000;
  setTimeout(() => {
    statusDiv.style.display = 'none';
  }, ms);
}

/** Backup format version for future migrations */
const BACKUP_VERSION = 5;

/** Same IndexedDB as eqlog-monitor.js — FileSystemHandles cannot go in JSON backups. */
const EQLOG_HANDLE_DB_NAME = 'opendkp-eqlog';
const EQLOG_HANDLE_DB_VERSION = 1;
const EQLOG_HANDLE_STORE = 'handles';
const EQLOG_HANDLE_KEY = 'eqLogFile';

function openEqLogHandleDb() {
  return new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(EQLOG_HANDLE_DB_NAME, EQLOG_HANDLE_DB_VERSION);
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains(EQLOG_HANDLE_STORE)) {
        db.createObjectStore(EQLOG_HANDLE_STORE);
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
  });
}

/** Probe whether a live EQ log file handle is stored (not serializable to JSON). */
async function collectEqLogHandleMetaForBackup(syncData) {
  const fileMeta = syncData && syncData.eqLogFileMeta && typeof syncData.eqLogFileMeta === 'object'
    ? syncData.eqLogFileMeta
    : null;
  let handlePresent = false;
  let handleName = '';
  try {
    const db = await openEqLogHandleDb();
    const handle = await new Promise(function (resolve, reject) {
      const tx = db.transaction(EQLOG_HANDLE_STORE, 'readonly');
      const req = tx.objectStore(EQLOG_HANDLE_STORE).get(EQLOG_HANDLE_KEY);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
    db.close();
    if (handle) {
      handlePresent = true;
      handleName = handle.name || '';
    }
  } catch (e) {
    try { console.warn('[Backup] Could not probe EQ log handle IndexedDB:', e); } catch (_) {}
  }
  return {
    handlePresent: handlePresent,
    handleName: handleName || (fileMeta && fileMeta.name) || '',
    fileMeta: fileMeta,
    note: 'Browser file handles cannot be restored from JSON. Re-select the EQ log in Loot Monitor after restore on a new profile/machine.'
  };
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(String(base64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function blobToBase64(blob) {
  if (!(blob instanceof Blob)) return '';
  return arrayBufferToBase64(await blob.arrayBuffer());
}

/** Collect custom notification sounds from IndexedDB (+ storage.local mirror keys). */
async function collectCustomSoundsForBackup(localData) {
  const byName = new Map();
  try {
    const records = await listSoundRecordsFromDB();
    for (const rec of records || []) {
      if (!rec || !rec.name) continue;
      const data = await blobToBase64(rec.data);
      if (!data) continue;
      byName.set(rec.name, { name: rec.name, data: data, type: rec.type || 'application/octet-stream' });
    }
  } catch (e) {
    try { console.warn('[Backup] Could not read sounds from IndexedDB:', e); } catch (_) {}
  }
  Object.keys(localData || {}).forEach(function (key) {
    if (!key.startsWith('customSound_')) return;
    const stored = localData[key];
    if (!stored || !stored.data) return;
    const name = stored.name || key.replace(/^customSound_/, '');
    if (!name || byName.has(name)) return;
    byName.set(name, { name: name, data: stored.data, type: stored.type || 'application/octet-stream' });
  });
  return Array.from(byName.values());
}

/** Restore custom sounds into IndexedDB and storage.local after import. */
async function restoreCustomSoundsFromBackup(backup, localData) {
  const sounds = [];
  if (Array.isArray(backup.customSounds) && backup.customSounds.length) {
    backup.customSounds.forEach(function (s) {
      if (s && s.name && s.data) sounds.push(s);
    });
  } else {
    Object.keys(localData || {}).forEach(function (key) {
      if (!key.startsWith('customSound_')) return;
      const stored = localData[key];
      if (!stored || !stored.data) return;
      sounds.push({
        name: stored.name || key.replace(/^customSound_/, ''),
        data: stored.data,
        type: stored.type || 'application/octet-stream'
      });
    });
  }
  if (!sounds.length) return 0;
  for (const sound of sounds) {
    const arrayBuffer = base64ToArrayBuffer(sound.data);
    await saveSoundToDB(sound.name, arrayBuffer, sound.type || 'application/octet-stream');
    if (api.storage && api.storage.local && api.storage.local.set) {
      await new Promise(function (resolve) {
        api.storage.local.set({
          ['customSound_' + sound.name]: {
            data: sound.data,
            type: sound.type || 'application/octet-stream',
            name: sound.name
          }
        }, function () { resolve(); });
      });
    }
  }
  return sounds.length;
}

const BACKUP_CREDENTIALS_WARNING =
  'Password and JWT tokens are stored in plain text in the backup file. Store the file somewhere safe—anyone with the file can sign in as you.';

function isBackupIncludeCredentialsChecked() {
  const el = document.getElementById('backupIncludeCredentials');
  return !!(el && el.checked);
}

function updateBackupCredentialsWarning() {
  const warning = document.getElementById('backupCredentialsWarning');
  if (!warning) return;
  warning.style.display = isBackupIncludeCredentialsChecked() ? 'block' : 'none';
}

function stripSensitiveBackupLocalData(localData) {
  const out = Object.assign({}, localData || {});
  BACKUP_SENSITIVE_LOCAL_KEYS.forEach(function(key) {
    delete out[key];
  });
  return out;
}

/**
 * Export all settings to a JSON file (sync + local storage + custom sounds)
 */
function exportBackup() {
  const storage = api && api.storage ? api.storage : chrome.storage;
  const runExport = function() {
    const getSync = () => new Promise((resolve) => {
      storage.sync.get(null, (data) => resolve(api.runtime?.lastError || chrome.runtime?.lastError ? {} : data || {}));
    });
    const getLocal = () => new Promise((resolve) => {
      if (!storage.local || !storage.local.get) return resolve({});
      storage.local.get(null, (data) => resolve(api.runtime?.lastError || chrome.runtime?.lastError ? {} : data || {}));
    });
    return Promise.all([getSync(), getLocal()])
      .then(function ([syncData, localData]) {
        return Promise.all([
          collectCustomSoundsForBackup(localData),
          collectEqLogHandleMetaForBackup(syncData)
        ]).then(function (results) {
          return {
            syncData: syncData,
            localData: localData,
            customSounds: results[0],
            eqLogHandle: results[1]
          };
        });
      })
      .then(function ({ syncData, localData, customSounds, eqLogHandle }) {
        const includeCredentials = isBackupIncludeCredentialsChecked();
        const exportLocalData = includeCredentials ? localData : stripSensitiveBackupLocalData(localData);
        const manifest = Object.assign({}, buildBackupManifest(syncData, exportLocalData, eqLogHandle), {
          includesSensitiveCredentials: includeCredentials
        });
        const backup = {
          version: BACKUP_VERSION,
          exportedAt: new Date().toISOString(),
          manifest: manifest,
          sync: syncData,
          local: exportLocalData,
          customSounds: customSounds,
          eqLogHandle: eqLogHandle
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'opendkp-helper-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        let statusMsg =
          'Backup downloaded (' + manifest.watchlistItemCount + ' watchlist item(s)' +
          (manifest.opendkpClientSlug ? ', guild ' + manifest.opendkpClientSlug : '') +
          (manifest.opendkpCognitoUsername ? ', API user saved' : '') +
          (manifest.rankBidLimitCount ? ', ' + manifest.rankBidLimitCount + ' rank bid limit(s)' : '') +
          (manifest.eqLogFileName ? ', EQ log ' + manifest.eqLogFileName : '') +
          (includeCredentials ? ', password & tokens included' : ', password & tokens excluded') + ').';
        if (manifest.eqLogHandlePresent || manifest.eqLogFileName) {
          statusMsg += ' Note: re-select the EQ log in Loot Monitor after restore on a new browser profile.';
        }
        if (includeCredentials) {
          showStatus(BACKUP_CREDENTIALS_WARNING, 'warning');
          setTimeout(function() {
            showStatus(statusMsg, 'success');
          }, 5200);
        } else {
          showStatus(statusMsg, 'success');
        }
        try {
          console.log('[Backup] Exported', Object.keys(syncData).length, 'sync keys', Object.keys(localData || {}).length, 'local keys', (customSounds || []).length, 'custom sounds', manifest);
        } catch (_) {}
      });
  };

  persistCriticalSettingsToStorage({ silent: true })
    .catch(function(e) {
      console.warn('[Backup] Pre-export persist failed:', e);
    })
    .then(runExport)
    .catch(function(e) {
      console.error('Export backup error:', e);
      showStatus('Export failed: ' + (e.message || e), 'error');
    });
}

/**
 * Restore settings from a backup JSON file
 */
function importBackup(file) {
  if (!file || !file.size) return;
  const reader = new FileReader();
  reader.onload = function() {
    let backup;
    try {
      backup = JSON.parse(reader.result);
    } catch (e) {
      showStatus('Invalid backup file (not valid JSON).', 'error');
      return;
    }
    if (backup.version === undefined || !backup.sync || typeof backup.sync !== 'object') {
      showStatus('Invalid backup format. Use a file exported by this extension.', 'error');
      return;
    }
    const storage = api && api.storage ? api.storage : chrome.storage;
    const setSync = (data) => new Promise((resolve, reject) => {
      storage.sync.set(data, () => (api.runtime?.lastError || chrome.runtime?.lastError) ? reject(api.runtime?.lastError || chrome.runtime?.lastError) : resolve());
    });
    const setLocal = (data) => new Promise((resolve) => {
      if (!storage.local || !storage.local.set) return resolve();
      storage.local.set(data, () => resolve());
    });
    const localPayload = backup.local || {};
    if (!localPayload[LOCAL_SETTINGS_MIRROR_KEY] && backup.sync && typeof backup.sync === 'object') {
      localPayload[LOCAL_SETTINGS_MIRROR_KEY] = Object.assign({}, backup.sync, { savedAt: Date.now() });
    }
    const restoreSummary = formatBackupRestoreSummary(backup);
    Promise.all([setSync(backup.sync), setLocal(localPayload)])
      .then(function () {
        return restoreCustomSoundsFromBackup(backup, localPayload);
      })
      .then(function (soundCount) {
      showStatus('Restored: ' + restoreSummary + (soundCount ? ' (' + soundCount + ' custom sound(s))' : '') + '. Reloading…', 'success');
      try {
        console.log('[Backup] Restored', Object.keys(backup.sync || {}).length, 'sync keys', Object.keys(localPayload).length, 'local keys', soundCount || 0, 'custom sounds');
      } catch (_) {}
      currentSettings = { ...DEFAULT_SETTINGS };
      setTimeout(() => loadSettings(), 500);
    }).catch((e) => {
      showStatus('Restore failed: ' + (e?.message || e), 'error');
    });
  };
  reader.onerror = () => showStatus('Could not read file.', 'error');
  reader.readAsText(file);
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
        
        // Strip header row if present
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
        
        const cleanedContent = stripHeaderRow(content);
        
        // Count data lines (excluding header)
        const lines = cleanedContent.split('\n');
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
          await navigator.clipboard.writeText(cleanedContent);
        } catch (clipError) {
          // Fallback: Use legacy execCommand (works better with file picker)
          console.log('Clipboard API failed, using execCommand fallback:', clipError.message);
          const textArea = document.createElement('textarea');
          textArea.value = cleanedContent;
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
