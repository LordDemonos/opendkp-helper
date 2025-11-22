/**
 * OpenDKP Helper - Content Script
 * 
 * Monitors all auction timer progress bars on opendkp.com
 * Plays a notification chime when any timer reaches width: 0%
 * Uses MutationObserver to detect dynamically added timer bars
 */

(function() {
  'use strict';

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================
  
  const CONFIG = {
    // Target selector for timer progress bars
    TIMER_SELECTOR: '.p-progressbar-value.p-progressbar-value-animate',
    
    // Default settings (will be overridden by storage)
    CHECK_INTERVAL: 100,
    FLASH_SCREEN: true,
    VOLUME: 0.5,
    SOUND_TYPE: 'bell', // Default to bell for raid leader
    SOUND_PROFILE: 'raidleader', // Default to raid leader profile
    BROWSER_NOTIFICATIONS: true,
    SMART_BIDDING: false, // Will be enabled automatically for raider profile
    QUIET_HOURS: false,
    QUIET_START: '22:00',
    QUIET_END: '08:00',
    DISABLE_VISUALS: false,
    ENABLE_TTS: false,
    VOICE: '',
    VOICE_SPEED: 1.0,
    ENABLE_ADVANCED_TTS: false,
    TTS_TEMPLATE: 'Auction Finished. {winner} for {bidAmount} DKP on {itemName}',
    RAID_LEADER_NOTIFICATION: true,
    // Auction readout defaults
    ANNOUNCE_NEW_AUCTIONS: false,
    ANNOUNCE_START: '19:00',
    ANNOUNCE_END: '23:59'
  };
  
  // Settings loaded from storage
  let settings = { ...CONFIG };
  
  // Browser API compatibility
  const api = typeof browser !== 'undefined' ? browser : chrome;

  // ===========================================================================
  // STATE MANAGEMENT
  // ===========================================================================
  
  // Track which timer bars have already triggered an alert
  // Uses WeakSet to allow garbage collection when elements are removed from DOM
  const alertedTimers = new WeakSet();
  // Track timers that we have seen with any progress (> 1%) so we only alert
  // for auctions we actually observed in progress
  const timersWithProgress = new WeakSet();
  
  // Storage for all currently monitored timer elements
  // Will be updated by MutationObserver and polling loop
  let allTimers = new Set();
  
  // Polling interval ID for cleanup
  let checkIntervalId = null;
  
  // Audio element for playing chime
  let audioElement = null;
  // Flag: have settings been loaded from storage at least once?
  let settingsLoaded = false;
  // Reusable AudioContext for beep fallback (prevents rapid beeps)
  let beepAudioContext = null;

  // Helper: announce a newly discovered auction if feature is enabled
  function maybeAnnounceNewAuction(timerElement) {
    try {
      // Avoid duplicate announcements for the same timer - check FIRST (before any other processing)
      // This must be checked BEFORE any async operations to prevent race conditions
      if (typeof announcedNewAuctions !== 'undefined' && announcedNewAuctions.has(timerElement)) {
        log('ReadAuctions: already announced this timer, skipping');
        return;
      }
      
      // Mark as announced IMMEDIATELY (before any other processing) to prevent race conditions
      // This prevents the function from being called twice simultaneously for the same timer
      try { 
        announcedNewAuctions.add(timerElement); 
        log('ReadAuctions: marked timer as announced to prevent duplicates');
      } catch (_) {}
      
      // Check if timer is reasonably fresh (new auctions start at high widths)
      // Skip old auctions that are already at 0% or very low width
      const initialWidth = getWidthPercent(timerElement);
      if (initialWidth !== null && initialWidth < 50) {
        log('ReadAuctions: timer too old (width <50%), skipping', initialWidth);
        return;
      }
      
      // If width is 0%, skip (this is an old completed auction, not a new one)
      if (initialWidth !== null && initialWidth <= 0) {
        log('ReadAuctions: timer already completed (width <= 0%), skipping', initialWidth);
        return;
      }
      
      const windowOk = isWithinAnnounceWindow();
      const quiet = isQuietHours();
      {
        const ctxPeek = extractTableContext(timerElement) || extractTimerContext(timerElement) || {};
        log('ReadAuctions: maybeAnnounce called', {
          settingsLoaded,
          ENABLE_TTS: settings.ENABLE_TTS,
          ANNOUNCE_NEW_AUCTIONS: settings.ANNOUNCE_NEW_AUCTIONS,
          windowOk,
          quiet,
          peekItem: ctxPeek.itemName || null
        });
      }
      {
        log('ReadAuctions check (observer):', {
          ttsEnabled: settings.ENABLE_TTS,
          featureEnabled: settings.ANNOUNCE_NEW_AUCTIONS,
          windowOk: windowOk,
          quietHours: quiet
        });
      }
      const featureEnabled = (settings.ANNOUNCE_NEW_AUCTIONS === true) ||
                             (settings.ANNOUNCE_NEW_AUCTIONS === undefined && settings.ENABLE_TTS);
      if (settingsLoaded && settings.ENABLE_TTS && featureEnabled && !quiet && windowOk) {
        // Timer already marked as announced above (before conditions check)
        const trySpeak = (attemptsLeft) => {
          const ctx = extractTableContext(timerElement) || extractTimerContext(timerElement);
          const name = ctx?.itemName && String(ctx.itemName).trim();
          if (name) {
            log('ReadAuctions: speaking item', name);
            speakAuctionItem(name);
          } else if (attemptsLeft > 0) {
            log('ReadAuctions: item not found yet, retrying...', attemptsLeft);
            setTimeout(() => trySpeak(attemptsLeft - 1), 200);
          } else {
            // Final fallback: announce without an item name so users still get feedback
            log('ReadAuctions: giving up on item name, speaking generic');
            speakAuctionItem('a new item');
          }
        };
        trySpeak(15); // retry for up to ~3s to allow DOM to populate
      } else {
        log('ReadAuctions: conditions not met', {
          settingsLoaded,
          ENABLE_TTS: settings.ENABLE_TTS,
          ANNOUNCE_NEW_AUCTIONS: settings.ANNOUNCE_NEW_AUCTIONS,
          resolvedFeatureEnabled: featureEnabled,
          windowOk,
          quiet
        });
      }
    } catch (_) {}
  }
  
  // Flag to prevent alerts during initialization
  let initializationComplete = false;
  
  // Track if we've already initialized on this page
  let pageInitialized = false;
  
  // During initial startup we suppress alerts for any timers that are
  // already completed (navigation protection). We'll only pre-mark in this
  // short window to avoid suppressing legitimate newly-completed timers.
  let navigationProtectionActive = false;
  // Track which timers were already announced as new to avoid duplicates
  const announcedNewAuctions = new WeakSet();
  // Across-DOM duplicate suppression for completed auctions
  const recentCompletedMap = new Map(); // signature -> timestamp
  const COMPLETED_SUPPRESS_MS = 2 * 60 * 1000; // Reduced to 2 minutes (was 10 minutes)

  function buildCompletionSignature(ctx) {
    const item = (ctx?.itemName || '').toLowerCase().trim();
    const winner = (ctx?.winner || '').toLowerCase().trim();
    const bid = ctx?.bidAmount || 0;
    return `${item}|${winner}|${bid}`;
  }

  function isRecentlyCompleted(signature) {
    const ts = recentCompletedMap.get(signature);
    if (!ts) return false;
    const age = Date.now() - ts;
    const isRecent = age < COMPLETED_SUPPRESS_MS;
    if (isRecent) {
      log('Signature recently completed:', signature, 'age:', Math.round(age / 1000), 'seconds ago');
    }
    return isRecent;
  }

  function recordCompleted(signature) {
    recentCompletedMap.set(signature, Date.now());
    // prune occasionally
    if (recentCompletedMap.size > 200) {
      const now = Date.now();
      for (const [sig, t] of Array.from(recentCompletedMap.entries())) {
        if (now - t > COMPLETED_SUPPRESS_MS) recentCompletedMap.delete(sig);
      }
    }
  }
  
  // User's character names for smart bidding mode
  let userCharacterNames = [];

  // ===========================================================================
  // AUDIO NOTIFICATION SYSTEM
  // ===========================================================================
  
  /**
   * Load settings from storage
   */
  function loadSettings() {
    api.storage.sync.get({
      volume: 70,
      soundProfile: 'raidleader', // Default to raid leader
      soundType: 'bell', // Default to bell for raid leader
      raidLeaderSounds: 'bell',
      raiderSounds: 'chime',
      profileVolume: false,
      raidLeaderNotification: true, // New setting for browser notification
      customSounds: {},
      smartBidding: false, // Will be enabled automatically for raider profile
      quietHours: false,
      quietStart: '22:00',
      quietEnd: '08:00',
      // Read new auctions feature defaults
      announceAuctions: false,
      announceStart: '19:00',
      announceEnd: '23:59',
      enableTTS: false,
      voice: '',
      voiceSpeed: 1.0,
      enableAdvancedTTS: false,
      ttsTemplate: 'Auction Finished. {winner} for {bidAmount} DKP on {itemName}',
      disableVisuals: false,
      flashScreen: true,
      browserNotifications: true,
      consoleLogs: true,
      checkInterval: 100
    }).then(function(storedSettings) {
      // Handle case where storedSettings might be undefined due to storage API issues
      if (!storedSettings) {
        log('Warning: No settings loaded from storage, using defaults');
        storedSettings = {
          volume: 70,
          soundProfile: 'raidleader',
          soundType: 'bell',
          checkInterval: 100,
          flashScreen: true,
          browserNotifications: true,
          smartBidding: false,
          quietHours: false,
          enableTTS: false,
          disableVisuals: false
        };
      }
      
      settings = {
        ...CONFIG,
        CHECK_INTERVAL: storedSettings.checkInterval || CONFIG.CHECK_INTERVAL,
        FLASH_SCREEN: storedSettings.flashScreen !== undefined ? storedSettings.flashScreen : CONFIG.FLASH_SCREEN,
        VOLUME: (storedSettings.volume !== undefined && storedSettings.volume !== null ? storedSettings.volume : 70) / 100,
        SOUND_TYPE: storedSettings.soundType || CONFIG.SOUND_TYPE,
        SOUND_PROFILE: storedSettings.soundProfile || CONFIG.SOUND_PROFILE,
        RAID_LEADER_SOUNDS: storedSettings.raidLeaderSounds || 'bell',
        RAIDER_SOUNDS: storedSettings.raiderSounds || 'chime',
        PROFILE_VOLUME: storedSettings.profileVolume || false,
        RAID_LEADER_NOTIFICATION: storedSettings.raidLeaderNotification !== undefined ? storedSettings.raidLeaderNotification : CONFIG.RAID_LEADER_NOTIFICATION,
        CUSTOM_SOUNDS: storedSettings.customSounds || {},
        SMART_BIDDING: storedSettings.smartBidding !== undefined ? storedSettings.smartBidding : CONFIG.SMART_BIDDING,
        QUIET_HOURS: storedSettings.quietHours !== undefined ? storedSettings.quietHours : CONFIG.QUIET_HOURS,
        QUIET_START: storedSettings.quietStart || CONFIG.QUIET_START,
        QUIET_END: storedSettings.quietEnd || CONFIG.QUIET_END,
        ENABLE_TTS: storedSettings.enableTTS !== undefined ? storedSettings.enableTTS : CONFIG.ENABLE_TTS,
        VOICE: storedSettings.voice || CONFIG.VOICE,
        VOICE_SPEED: storedSettings.voiceSpeed || CONFIG.VOICE_SPEED,
        ENABLE_ADVANCED_TTS: storedSettings.enableAdvancedTTS !== undefined ? storedSettings.enableAdvancedTTS : CONFIG.ENABLE_ADVANCED_TTS,
        TTS_TEMPLATE: storedSettings.ttsTemplate || CONFIG.TTS_TEMPLATE,
        DISABLE_VISUALS: storedSettings.disableVisuals !== undefined ? storedSettings.disableVisuals : CONFIG.DISABLE_VISUALS,
        BROWSER_NOTIFICATIONS: storedSettings.browserNotifications !== undefined ? storedSettings.browserNotifications : CONFIG.BROWSER_NOTIFICATIONS
      };
      // Auction readout
      settings.ANNOUNCE_NEW_AUCTIONS = storedSettings.announceAuctions !== undefined ? storedSettings.announceAuctions : CONFIG.ANNOUNCE_NEW_AUCTIONS;
      settings.ANNOUNCE_START = storedSettings.announceStart || CONFIG.ANNOUNCE_START;
      settings.ANNOUNCE_END = storedSettings.announceEnd || CONFIG.ANNOUNCE_END;
      
      // Automatically enable smart bidding for raider profile
      if (settings.SOUND_PROFILE === 'raider') {
        settings.SMART_BIDDING = true;
        log('Smart bidding automatically enabled for raider profile');
      }
      
      log('Settings loaded:', settings);
      
      // Update audio volume if element exists
      if (audioElement) {
        audioElement.volume = settings.VOLUME;
      }
      settingsLoaded = true;
    }).catch(function(error) {
      log('Error loading settings:', error);
      // Use default settings if storage fails
      settings = { ...CONFIG };
    });
  }
  
  /**
   * Initialize the audio notification system
   * Note: Legacy function kept for backwards compatibility.
   * Modern sound system uses playCustomSound() directly with MP3 files.
   * No initialization needed - sounds are loaded on-demand.
   */
  function initializeAudio() {
    // Modern sound system uses playCustomSound() directly
    // Note: The "chime" sound key maps to hotel.mp3, not the obsolete chime.wav/chime.mp3 files
    log('Audio system ready (using modern MP3-based sound system)');
  }
  
  /**
   * Play the notification chime based on current profile and settings
   */
  function playChime() {
    // Check quiet hours first
    if (isQuietHours()) {
      log('Quiet hours active, skipping sound notification');
      return 0;
    }
    
    const soundType = getCurrentSoundType();
    
    // Safety check for undefined soundType
    if (!soundType) {
      log('Sound type is undefined, using fallback beep');
      playBeepFallback();
      return 0;
    }
    
    // Use the new MP3-based sound system
    if (soundType.startsWith('custom_')) {
      return playCustomSound(soundType);
    } else {
      // All sounds now use MP3 files or Web Audio API
      return playCustomSound(soundType);
    }
  }
  
  /**
   * Get the current sound type based on profile
   */
  function getCurrentSoundType() {
    log('Getting current sound type:', {
      profile: settings.SOUND_PROFILE,
      raidLeaderSounds: settings.RAID_LEADER_SOUNDS,
      raiderSounds: settings.RAIDER_SOUNDS,
      soundType: settings.SOUND_TYPE
    });
    
    // If a specific sound type was selected, always prefer it
    if (settings.SOUND_TYPE) {
      log('Using explicitly selected sound type:', settings.SOUND_TYPE);
      return settings.SOUND_TYPE;
    }
    
    if (settings.SOUND_PROFILE === 'raidleader') {
      const sound = settings.RAID_LEADER_SOUNDS || CONFIG.SOUND_TYPE;
      log('Using raid leader profile sound:', sound);
      return sound;
    }
    
    if (settings.SOUND_PROFILE === 'raider') {
      const sound = settings.RAIDER_SOUNDS || CONFIG.SOUND_TYPE;
      log('Using raider profile sound:', sound);
      return sound;
    }
    
    const fallback = CONFIG.SOUND_TYPE;
    log('Using fallback sound:', fallback);
    return fallback;
  }
  
  /**
   * Play custom sound from storage or real Warcraft sounds
   */
  function playCustomSound(soundKey) {
    // Handle real MP3 sounds
    if (soundKey === 'jobsDone') {
      return playRealWarcraftSound('jobsdone.mp3');
    } else if (soundKey === 'workComplete') {
      return playRealWarcraftSound('workcomplete.mp3');
    } else if (soundKey === 'chime') {
      return playRealWarcraftSound('hotel.mp3');
    } else if (soundKey === 'bell') {
      return playRealWarcraftSound('bell.mp3');
    } else if (soundKey === 'ding') {
      return playRealWarcraftSound('ding1.mp3');
    } else if (soundKey === 'ding2') {
      return playRealWarcraftSound('ding2.mp3');
    } else if (soundKey === 'ding3') {
      return playRealWarcraftSound('ding3.mp3');
    } else if (soundKey === 'ding4') {
      return playRealWarcraftSound('ding4.mp3');
    }
    
    // Handle custom uploaded sounds via IndexedDB
    // Remove 'custom_' prefix if present, otherwise use the key as-is (handles both formats)
    const soundName = soundKey.startsWith('custom_') ? soundKey.replace('custom_', '') : soundKey;

    // IndexedDB helpers (read-only)
    function openSoundsDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('opendkp-sounds', 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('sounds', { keyPath: 'name' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    function getSoundFromDB(db, name) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('sounds', 'readonly');
        const r = tx.objectStore('sounds').get(name);
        r.onsuccess = () => resolve(r.result ? r.result.data : null);
        r.onerror = () => reject(r.error);
      });
    }

    // First, log what we're searching for
    log('Looking up custom sound:', soundName);
    
    // Chrome content scripts can't access extension IndexedDB - use chrome.storage.local instead
    // Firefox content scripts can access extension IndexedDB directly
    const isChrome = typeof chrome !== 'undefined' && typeof browser === 'undefined';
    
    if (isChrome) {
      // Chrome: Use chrome.storage.local for direct access (no background script needed)
      log('Chrome detected - using chrome.storage.local for custom sound access');
      const storageKey = `customSound_${soundName}`;
      
      chrome.storage.local.get([storageKey], (items) => {
        if (chrome.runtime.lastError) {
          log('Error getting custom sound from chrome.storage.local:', chrome.runtime.lastError.message);
          // Fallback to background proxy if storage.local fails
          tryBackgroundProxy(soundName);
          return;
        }
        
        const stored = items[storageKey];
        if (stored && stored.data) {
          log('Custom sound found in chrome.storage.local:', soundName);
          // Convert base64 to ArrayBuffer to Blob
          try {
            const binary = atob(stored.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: stored.type || 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            // Ensure volume is set correctly (0.0 to 1.0)
            const volume = settings.VOLUME !== undefined ? settings.VOLUME : 0.7;
            audio.volume = Math.max(0, Math.min(1, volume)); // Clamp between 0 and 1
            log('Setting audio volume to:', audio.volume, '(from settings.VOLUME:', settings.VOLUME, ')');
            audio.preload = 'auto';
            audio.play().then(() => {
              log('Playing custom sound (chrome.storage.local):', soundName, 'at volume:', audio.volume);
            }).catch(err => {
              log('Error playing custom sound:', err);
              playBeepFallback();
            }).finally(() => {
              audio.onended = () => URL.revokeObjectURL(url);
              setTimeout(() => URL.revokeObjectURL(url), 10000);
            });
          } catch (err) {
            log('Error decoding custom sound from storage:', err);
            playBeepFallback();
          }
        } else {
          log('Custom sound not found in chrome.storage.local:', soundName);
          // Try case-insensitive search
          chrome.storage.local.get(null, (allItems) => {
            if (chrome.runtime.lastError) {
              log('Error getting all sounds from storage:', chrome.runtime.lastError.message);
              tryBackgroundProxy(soundName);
              return;
            }
            
            const matchKey = Object.keys(allItems).find(key => {
              if (!key.startsWith('customSound_')) return false;
              const storedName = key.replace('customSound_', '');
              return storedName.toLowerCase().trim() === soundName.toLowerCase().trim();
            });
            
            if (matchKey && allItems[matchKey]) {
              log('Custom sound found (case-insensitive):', matchKey);
              const stored = allItems[matchKey];
              try {
                const binary = atob(stored.data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                  bytes[i] = binary.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: stored.type || 'audio/mpeg' });
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                // Ensure volume is set correctly (0.0 to 1.0)
                const volume = settings.VOLUME !== undefined ? settings.VOLUME : 0.7;
                audio.volume = Math.max(0, Math.min(1, volume)); // Clamp between 0 and 1
                log('Setting audio volume to:', audio.volume, '(from settings.VOLUME:', settings.VOLUME, ')');
                audio.preload = 'auto';
                audio.play().then(() => {
                  log('Playing custom sound (case-insensitive match):', soundName, 'at volume:', audio.volume);
                }).catch(err => {
                  log('Error playing custom sound:', err);
                  playBeepFallback();
                }).finally(() => {
                  audio.onended = () => URL.revokeObjectURL(url);
                  setTimeout(() => URL.revokeObjectURL(url), 10000);
                });
              } catch (err) {
                log('Error decoding custom sound:', err);
                tryBackgroundProxy(soundName);
              }
            } else {
              log('Custom sound not found (case-insensitive search). Trying background proxy...');
              tryBackgroundProxy(soundName);
            }
          });
        }
      });
      
      // Helper function to fallback to background proxy
      function tryBackgroundProxy(soundName) {
        log('Trying background script proxy as fallback...');
        api.runtime.sendMessage({ type: 'getCustomSound', soundName: soundName }, (response) => {
          if (chrome.runtime.lastError) {
            log('Error getting custom sound from background:', chrome.runtime.lastError.message);
            playBeepFallback();
            return;
          }
          
          if (response && response.success && response.data) {
            log('Custom sound found via background script (fallback):', soundName);
            // Convert ArrayBuffer to Blob and play
            const blob = new Blob([response.data], { type: response.type || 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            // Ensure volume is set correctly (0.0 to 1.0)
            const volume = settings.VOLUME !== undefined ? settings.VOLUME : 0.7;
            audio.volume = Math.max(0, Math.min(1, volume)); // Clamp between 0 and 1
            log('Setting audio volume to:', audio.volume, '(from settings.VOLUME:', settings.VOLUME, ')');
            audio.preload = 'auto';
            audio.play().then(() => {
              log('Playing custom sound (background proxy fallback):', soundName, 'at volume:', audio.volume);
            }).catch(err => {
              log('Error playing custom sound:', err);
              playBeepFallback();
            }).finally(() => {
              audio.onended = () => URL.revokeObjectURL(url);
              setTimeout(() => URL.revokeObjectURL(url), 10000);
            });
          } else {
            log('Custom sound not found via background script:', response?.error || 'Unknown error');
            playBeepFallback();
          }
        });
      }
      
      return 0; // Duration unknown synchronously
    }
    
    // Firefox: Access IndexedDB directly
    openSoundsDB().then(db => {
      log('Opened sounds DB successfully');
      // Try exact match first
      return getSoundFromDB(db, soundName).then(stored => {
        if (stored) {
          log('Custom sound found (exact match):', soundName);
          return stored;
        }
        
        log('Exact match not found, trying case-insensitive lookup...');
        // If not found, try case-insensitive lookup by listing all sounds
        return new Promise((resolve, reject) => {
          const tx = db.transaction('sounds', 'readonly');
          const req = tx.objectStore('sounds').getAll();
          req.onsuccess = () => {
            const sounds = req.result || [];
            log('All custom sounds in DB:', sounds.map(s => ({ name: s.name || 'unnamed', hasData: !!s.data })));
            // Find case-insensitive match
            const match = sounds.find(s => 
              s.name && s.name.toLowerCase().trim() === soundName.toLowerCase().trim()
            );
            if (match) {
              log('Custom sound found (case-insensitive match):', match.name, 'for search:', soundName);
              resolve(match.data);
            } else {
              log('Custom sound not found. Searched for:', soundName, 'Available sound names:', sounds.map(s => s.name || 'unnamed'));
              // If no match found, check if sound name might have been saved differently
              // Log all available names for debugging
              if (sounds.length === 0) {
                log('⚠️ IndexedDB sounds table is empty. Custom sounds need to be saved in the Options page first.');
              }
              resolve(null);
            }
          };
          req.onerror = () => {
            log('Error getting all sounds from DB:', req.error);
            reject(req.error);
          };
        });
      }).catch(err => {
        log('Error looking up custom sound in DB:', err);
        return null;
      });
    }).catch(err => {
      log('Error opening sounds DB:', err);
      log('DB error details:', err.message || err);
      return null;
    }).then(stored => {
      if (!stored) {
        log('Custom sound not found in DB:', soundName, '- searched with case-insensitive matching. Using beep fallback.');
        playBeepFallback();
        return;
      }
      const toArrayBuffer = (obj) => {
        if (obj instanceof ArrayBuffer) return Promise.resolve(obj);
        if (obj instanceof Blob) return obj.arrayBuffer();
        if (obj && obj.buffer instanceof ArrayBuffer) return Promise.resolve(obj.buffer);
        return Promise.reject(new Error('Unsupported stored sound format'));
      };
      // Prefer HTMLAudioElement playback for MP3 compatibility
      const useBlob = (obj) => {
        if (obj instanceof Blob) return obj;
        if (obj instanceof ArrayBuffer) return new Blob([obj], { type: 'audio/mpeg' });
        if (obj && obj.buffer instanceof ArrayBuffer) return new Blob([obj.buffer], { type: 'audio/mpeg' });
        return null;
      };
      const blob = useBlob(stored);
      if (!blob) { log('Unsupported stored sound format'); playBeepFallback(); return; }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      // Ensure volume is set correctly (0.0 to 1.0)
      const volume = settings.VOLUME !== undefined ? settings.VOLUME : 0.7;
      audio.volume = Math.max(0, Math.min(1, volume)); // Clamp between 0 and 1
      log('Setting audio volume to:', audio.volume, '(from settings.VOLUME:', settings.VOLUME, ')');
      audio.preload = 'auto';
      audio.play().then(() => {
        log('Playing custom sound (DB HTMLAudio):', soundName, 'at volume:', audio.volume);
      }).catch(err => { log('HTMLAudio play error:', err); playBeepFallback(); })
      .finally(() => {
        audio.onended = () => URL.revokeObjectURL(url);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    }).catch(err => { log('IndexedDB error:', err); playBeepFallback(); });

    // Duration unknown synchronously; return 0 and rely on default TTS delay
    return 0;
  }
  
  /**
   * Play real Warcraft sound from MP3 file
   */
  function playRealWarcraftSound(filename) {
    try {
      let audioUrl;
      try {
        audioUrl = api.runtime.getURL(filename);
      } catch (e) {
        log('Extension context invalidated, cannot play sound:', e);
        return; // Can't play sound if extension context is invalid
      }
      const audio = new Audio(audioUrl);
      // Ensure volume is set correctly (0.0 to 1.0)
      const volume = settings.VOLUME !== undefined ? settings.VOLUME : 0.7;
      audio.volume = Math.max(0, Math.min(1, volume)); // Clamp between 0 and 1
      audio.currentTime = 0;
      log('Setting audio volume to:', audio.volume, '(from settings.VOLUME:', settings.VOLUME, ')');
      
      audio.play().then(() => {
        log('Playing Warcraft sound:', filename, 'at volume:', audio.volume);
      }).catch(error => {
        log('Error playing Warcraft sound:', error);
        playBeepFallback();
      });
      
      // Return duration in milliseconds
      return audio.duration ? audio.duration * 1000 : 0;
    } catch (error) {
      log('Error loading Warcraft sound:', error);
      playBeepFallback();
      return 0;
    }
  }
  
  /**
   * Fallback beep sound using Web Audio API
   * Creates a simple beep if the audio file fails
   * Respects the volume setting from settings
   * Reuses AudioContext to prevent rapid beeps
   */
  function playBeepFallback() {
    try {
      // Reuse existing AudioContext or create one if needed
      if (!beepAudioContext || beepAudioContext.state === 'closed') {
        beepAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // Resume AudioContext if suspended (required after user interaction)
      if (beepAudioContext.state === 'suspended') {
        beepAudioContext.resume().catch(() => {
          // If resume fails, create new context
          beepAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        });
      }
      
      const oscillator = beepAudioContext.createOscillator();
      const gainNode = beepAudioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(beepAudioContext.destination);
      
      oscillator.frequency.setValueAtTime(800, beepAudioContext.currentTime);
      oscillator.type = 'sine';
      
      // Use volume from settings (0.0 to 1.0), default to 0.3 if not set
      const volume = settings.VOLUME || 0.3;
      gainNode.gain.setValueAtTime(volume, beepAudioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, beepAudioContext.currentTime + 0.5);
      
      oscillator.start(beepAudioContext.currentTime);
      oscillator.stop(beepAudioContext.currentTime + 0.5);
      
      log('Played beep fallback at volume:', volume);
    } catch (error) {
      log('Beep fallback failed:', error);
      // Reset AudioContext on error to allow retry
      beepAudioContext = null;
    }
  }

  // ===========================================================================
  // SMART BIDDING MODE - CHARACTER DETECTION
  // ===========================================================================
  
  /**
   * Extract user's character names from the header
   * Looks for the character links in the topbar
   */
  function extractUserCharacterNames() {
    try {
      // Look for character links in the header
      const characterLinks = document.querySelectorAll('div.layout-topbar-menu div.layout-topbar-chars a');
      
      const characterNames = [];
      characterLinks.forEach(link => {
        const text = link.textContent.trim();
        // Extract just the character name (before the brackets with DKP)
        const match = text.match(/^([^[]+)\s*\[/);
        if (match) {
          const characterName = match[1].trim();
          characterNames.push(characterName);
          log('Found user character:', characterName);
        }
      });
      
      userCharacterNames = characterNames;
      log('Extracted user character names:', userCharacterNames);
      return characterNames;
    } catch (error) {
      log('Error extracting character names:', error);
      return [];
    }
  }
  
  /**
   * Check if a winner name matches any of the user's characters
   */
  function isUserCharacter(winnerName) {
    if (!winnerName || userCharacterNames.length === 0) {
      return false;
    }
    
    // Check if winner name matches any of the user's characters
    const isMatch = userCharacterNames.some(characterName => 
      characterName.toLowerCase() === winnerName.toLowerCase()
    );
    
    log('Checking if winner is user character:', {
      winnerName: winnerName,
      userCharacters: userCharacterNames,
      isMatch: isMatch
    });
    
    return isMatch;
  }

  // ===========================================================================
  // UTILITY FUNCTIONS
  // ===========================================================================
  
  /**
   * Logging helper - always logs (debug mode removed)
   */
  function log(...args) {
    console.log('[OpenDKP Helper]', ...args);
  }

  // ===========================================================================
  // DOM CAPTURE FOR DEBUGGING ROLL-OFF DETECTION
  // ===========================================================================
  // Set to false to disable DOM snapshot capture (for production)
  // TODO: Remove this entire section once roll-off detection is confirmed working
  const ENABLE_DOM_CAPTURE = false; // Disabled - enough data collected for roll-off detection debugging
  
  /**
   * Capture DOM snapshot for debugging roll-off detection
   * Exports directly to JSON file (no localStorage)
   * Files are saved to browser's default download location
   */
  function captureDOMSnapshot(context, timerElement, reason) {
    // Early return if capture is disabled
    if (!ENABLE_DOM_CAPTURE) return null;
    
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Find the specific auction's tab panel to scope table searches
      const auctionContainer = timerElement?.closest('[id*="header_action"]');
      let auctionTabPanel = null;
      if (auctionContainer && auctionContainer.id) {
        const tabId = auctionContainer.id.replace('_header_action', '');
        auctionTabPanel = document.querySelector(`[data-pc-section="content"] .p-tabview-panel[id*="${tabId}"]`) ||
                         document.querySelector(`.p-tabview-panel[aria-labelledby="${auctionContainer.id}"]`) ||
                         document.querySelector('.p-tabview-panel.p-tabview-panel-active');
      }
      
      const snapshot = {
        timestamp: new Date().toISOString(),
        reason: reason || 'roll-off-detection',
        context: JSON.parse(JSON.stringify(context)), // Deep clone
        // Capture specific elements that matter for roll-off detection
        auctionContainer: auctionContainer?.outerHTML || null,
        auctionContainerId: auctionContainer?.id || null,
        tabPanel: auctionTabPanel ? auctionTabPanel.outerHTML : null,
        // Only capture tables within THIS auction's tab panel (not all tables on page)
        auctionTables: auctionTabPanel ? Array.from(auctionTabPanel.querySelectorAll('table')).map((table, idx) => ({
          index: idx,
          html: table.outerHTML,
          hasCharacterLinks: table.querySelectorAll('a[href*="/characters/"]').length,
          rowCount: table.querySelectorAll('tbody tr, tr').length
        })) : [],
        // Also capture all tables for comparison (but mark which ones belong to this auction)
        allTables: Array.from(document.querySelectorAll('table')).map((table, idx) => {
          const isInAuctionPanel = auctionTabPanel && auctionTabPanel.contains(table);
          return {
            index: idx,
            html: table.outerHTML,
            hasCharacterLinks: table.querySelectorAll('a[href*="/characters/"]').length,
            rowCount: table.querySelectorAll('tbody tr, tr').length,
            belongsToThisAuction: isInAuctionPanel
          };
        }),
        // Capture winner text from various sources
        winnerTextSources: {
          tabOffset: (() => {
            if (auctionContainer) {
              const tabOffset = auctionContainer.querySelector('.tab-offset');
              return tabOffset ? tabOffset.textContent.trim() : null;
            }
            return null;
          })(),
          timerParent: timerElement?.parentElement?.textContent?.trim() || null,
          auctionHeader: auctionContainer ? auctionContainer.textContent.trim().substring(0, 500) : null
        },
        // Capture info about other auctions on the page (for context)
        otherAuctions: (() => {
          const allContainers = document.querySelectorAll('[id*="_header_action"]');
          return Array.from(allContainers)
            .filter(container => container !== auctionContainer)
            .map(container => ({
              id: container.id,
              itemName: container.textContent.trim().substring(0, 100),
              hasWinner: container.querySelector('.tab-offset') !== null
            }));
        })()
      };
      
      // Export directly to JSON file (no localStorage)
      const snapshotJson = JSON.stringify(snapshot, null, 2);
      const snapshotSize = new Blob([snapshotJson]).size;
      const filename = `opendkp-snapshot-${timestamp}.json`;
      
      // Create and trigger download
      try {
        const blob = new Blob([snapshotJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
        
        log('DOM snapshot exported to file:', { 
          filename, 
          size: `${(snapshotSize / 1024).toFixed(1)}KB`, 
          reason, 
          itemName: context.itemName,
          auctionId: auctionContainer?.id,
          otherAuctionsOnPage: snapshot.otherAuctions?.length || 0
        });
        console.log('%c📥 DOM Snapshot Exported', 'color: blue; font-weight: bold; font-size: 14px;');
        console.log('Item:', context.itemName || 'Unknown');
        console.log('Auction ID:', auctionContainer?.id || 'Unknown');
        console.log('Other auctions on page:', snapshot.otherAuctions?.length || 0);
        console.log('File saved to your Downloads folder:', filename);
        console.log('File size:', `${(snapshotSize / 1024).toFixed(1)}KB`);
        console.log('Check your browser\'s default download location (usually Downloads folder)');
        
        return { filename, snapshot, size: snapshotSize };
      } catch (downloadError) {
        log('Error exporting snapshot:', downloadError);
        console.error('Could not export snapshot:', downloadError);
        return null;
      }
    } catch (error) {
      log('Error capturing DOM snapshot:', error);
      return null;
    }
  }
  
  // Expose capture function globally for manual triggering
  window.opendkpCaptureDOM = captureDOMSnapshot;
  
  /**
   * Get the numeric width value from a progress bar's style attribute
   * Returns null if width cannot be parsed
   */
  function getWidthPercent(element) {
    if (!element || !element.style || !element.style.width) {
      return null;
    }
    
    const widthStr = element.style.width;
    const match = widthStr.match(/^(\d+(?:\.\d+)?)%$/);
    
    if (match) {
      return parseFloat(match[1]);
    }
    
    return null;
  }

  // ===========================================================================
  // TIMER MONITORING SYSTEM
  // ===========================================================================
  
  /**
   * Scan the DOM for all timer progress bars
   * Returns a Set of elements that match the timer selector
   */
  function scanForTimers() {
    const timers = document.querySelectorAll(CONFIG.TIMER_SELECTOR);
    return new Set(Array.from(timers));
  }
  
  /**
   * Monitor a single timer element for completion (width: 0%)
   * Returns true if alert was triggered, false otherwise
   */
  function checkTimer(timerElement) {
    // Skip if initialization not complete
    if (!initializationComplete) {
      log('Timer check skipped - initialization not complete');
      return false;
    }
    // Suppress alerts during navigation protection windows (e.g., page switches)
    if (navigationProtectionActive) {
      log('Timer check suppressed due to navigation protection');
      return false;
    }
    
    // Skip if already alerted
    if (alertedTimers.has(timerElement)) {
      // Only log occasionally to avoid spam
      if (Math.random() < 0.001) { // Log only 0.1% of the time
        log('Timer already alerted, skipping (reducing log spam)');
      }
      return false;
    }
    
    const width = getWidthPercent(timerElement);
    // If we've seen this timer with progress > 1%, remember it
    if (width !== null && width > 1) {
      try { timersWithProgress.add(timerElement); } catch (_) {}
    }
    
    // Check if timer has reached 0%
    if (width !== null && width <= 0) {
      log('Timer completed detected candidate:', { width, protected: navigationProtectionActive, hasProgress: timersWithProgress.has(timerElement) });
      log('Timer completed! Width:', width, timerElement);
      
      // Only alert if we previously observed progress > 1%
      // BUT: If this is the first time we're checking this timer (page just loaded),
      // we might not have seen progress yet, so be lenient
      const hasSeenProgress = timersWithProgress.has(timerElement);
      const firstCheck = !hasSeenProgress && !alertedTimers.has(timerElement);
      
      if (!hasSeenProgress && !firstCheck) {
        log('Suppressing completion: never observed progress > 1% and not first check');
        alertedTimers.add(timerElement);
        return false;
      }
      
      // Try table context first, fallback to tab context
      let context = extractTableContext(timerElement);
      if (!context) {
        context = extractTimerContext(timerElement);
      }
      
      if (!context || !context.itemName) {
        log('No context extracted, suppressing alert');
        alertedTimers.add(timerElement);
        return false;
      }
      
      // Suppress duplicates across DOM reloads using a completion signature
      // BUT: Only if we've already alerted for this exact timer element
      // If this is a fresh timer (we haven't seen it before), allow it
      const sig = buildCompletionSignature(context);
      const wasRecentlyCompleted = isRecentlyCompleted(sig);
      const hasBeenAlertedForThisTimer = alertedTimers.has(timerElement);
      
      // Only suppress if BOTH conditions are true:
      // 1. This signature was recently completed
      // 2. We've already alerted for this specific timer element
      if (wasRecentlyCompleted && hasBeenAlertedForThisTimer) {
        log('Completion duplicate suppressed (signature + timer both seen):', sig);
        return false;
      }
      
      // Mark as alerted IMMEDIATELY to prevent rapid duplicate calls
      alertedTimers.add(timerElement);
      
      // Apply bidding rules
      if (shouldAlert(context)) {
        log('🚨 ALERTING! Playing chime and showing notification');
        log('Alert context:', { item: context.itemName, winner: context.winner, bid: context.bidAmount, sig });
        
        // Show enhanced notification with context (this will play sound and speak TTS)
        showNotification(context);
        // Remember this completion to avoid re-alerts on page switches
        recordCompleted(sig);
      } else {
        log('No alert needed based on bidding rules:', context);
      }
      
      return true;
    }
    
    return false;
  }
  
  /**
   * Determine if an alert should be shown based on bidding rules
   */
  function shouldAlert(context) {
    if (!context) {
      log('No context available, skipping alert');
      return false;
    }
    
    // Rule 1: No alert if nobody bid
    if (context.noBid) {
      log('No bid detected, skipping alert');
      return false;
    }
    
    // Rule 2: Smart bidding mode - only alert if user is bidding
    if (settings.SMART_BIDDING && settings.SOUND_PROFILE === 'raider') {
      if (!isUserBidding(context)) {
        log('Smart bidding mode: User not bidding, skipping alert');
        return false;
      }
    }
    
    // Rule 3: Quiet hours - disable sound notifications
    if (isQuietHours()) {
      log('Quiet hours active, skipping sound notification');
      // Still show visual notifications if not disabled
      return !settings.DISABLE_VISUALS;
    }
    
    // Rule 4: Always alert for single winners
    if (context.winner && !context.rollOffWinners) {
      log('Single winner detected, showing alert');
      return true;
    }
    
    // Rule 5: Alert for multiple winners (x 2, x 3, etc.)
    if (context.quantity > 1 && context.rollOffWinners && context.rollOffWinners.length >= context.quantity) {
      log('Multiple winners for multi-item auction, showing alert');
      return true;
    }
    
    // Rule 6: Alert for roll-offs (multiple people with same bid AND more people than items)
    // Roll-off only happens when participants > quantity (e.g., 2 people bid 1000 on 1 item)
    // If quantity >= participants, they all win (e.g., 2 people bid 1000 on 2 items = both win, no roll-off)
    if (context.isRollOff && context.rollOffWinners && context.rollOffWinners.length > (context.quantity || 1)) {
      log('Roll-off detected (participants > quantity), showing alert');
      return true;
    }
    
    // Rule 7: Only alert if we have a valid bid amount (not 0 or null)
    if (context.bidAmount && context.bidAmount > 0) {
      log('Valid bid amount detected, showing alert');
      return true;
    }
    
    log('No valid bidding scenario detected, skipping alert');
    return false; // Default to NOT showing alert for safety
  }
  
  /**
   * Check if user is bidding on this auction (smart bidding mode)
   * Now uses real character detection from the header
   */
  function isUserBidding(context) {
    // If we don't have character names yet, try to extract them
    if (userCharacterNames.length === 0) {
      extractUserCharacterNames();
    }
    
    // If still no character names, fall back to old method
    if (userCharacterNames.length === 0) {
      log('No character names found, using fallback detection');
      
      // Check if the current page contains bid input fields
      const bidInputs = document.querySelectorAll('input[type="number"], input[name*="bid"], input[id*="bid"]');
      const bidButtons = document.querySelectorAll('button[class*="bid"], button[id*="bid"]');
      
      // If there are bid inputs/buttons on the page, assume user might be bidding
      if (bidInputs.length > 0 || bidButtons.length > 0) {
        log('Bid elements found, assuming user might be bidding');
        return true;
      }
      
      // Check if user has recently interacted with bid-related elements
      const recentBidActivity = sessionStorage.getItem('opendkp_bid_activity');
      if (recentBidActivity) {
        const activityTime = parseInt(recentBidActivity);
        const now = Date.now();
        // If user bid within last 5 minutes, consider them active
        if (now - activityTime < 5 * 60 * 1000) {
          log('Recent bid activity detected');
          return true;
        }
      }
      
      log('No bid activity detected, user not bidding');
      return false;
    }
    
    // Real smart bidding: Check if the winner is one of the user's characters
    if (context.winner) {
      const isUserWinner = isUserCharacter(context.winner);
      log('Smart bidding check:', {
        winner: context.winner,
        isUserWinner: isUserWinner,
        userCharacters: userCharacterNames
      });
      return isUserWinner;
    }
    
    // For roll-offs, check if any of the participants are user characters
    if (context.rollOffWinners && context.rollOffWinners.length > 0) {
      const hasUserCharacter = context.rollOffWinners.some(participant => 
        isUserCharacter(participant.winner)
      );
      log('Roll-off smart bidding check:', {
        participants: context.rollOffWinners.map(p => p.winner),
        hasUserCharacter: hasUserCharacter,
        userCharacters: userCharacterNames
      });
      return hasUserCharacter;
    }
    
    log('No winner or roll-off participants found, user not bidding');
    return false;
  }
  
  /**
   * Check if current time is within quiet hours
   */
  function isQuietHours() {
    if (!settings.QUIET_HOURS) return false;
    
    const now = new Date();
    const currentTime = now.getHours() * 100 + now.getMinutes();
    
    const startTime = parseInt(settings.QUIET_START.replace(':', ''));
    const endTime = parseInt(settings.QUIET_END.replace(':', ''));
    
    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime <= endTime;
    } else {
      return currentTime >= startTime && currentTime <= endTime;
    }
  }

  // Check if current time is within the announce window
  function isWithinAnnounceWindow() {
    const now = new Date();
    const current = now.getHours() * 100 + now.getMinutes();
    const startStr = (settings.ANNOUNCE_START || '00:00').toString().trim();
    const endStr = (settings.ANNOUNCE_END || '23:59').toString().trim();
    // Robust parser: supports 24h (HH:MM) and 12h with AM/PM
    const parseTime = (s) => {
      const m = s.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
      if (!m) return NaN;
      let hh = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      const ap = m[3];
      if (ap) {
        const isPM = /pm/i.test(ap);
        if (hh === 12) hh = isPM ? 12 : 0; else hh = isPM ? hh + 12 : hh;
      }
      return hh * 100 + mm;
    };
    const start = parseTime(startStr);
    const end = parseTime(endStr);
    if (isNaN(start) || isNaN(end)) return true;
    {
      log('ReadAuctions window check:', { current, start, end, startStr, endStr });
    }
    if (start === end) return true; // treat equal times as always-on
    if (start > end) return current >= start || current <= end; // overnight
    return current >= start && current <= end;
  }

  function speakAuctionItem(itemName) {
    if (!itemName) return;
    const utterance = new SpeechSynthesisUtterance(`New auction: ${itemName}`);
    
    // Flag to prevent duplicate speech synthesis calls
    let hasSpoken = false;
    
    // Wait for voices to load (especially important in Chrome)
    const selectVoice = () => {
      // Prevent duplicate calls
      if (hasSpoken) {
        log('TTS: Already spoken, skipping duplicate call');
        return;
      }
      hasSpoken = true;
      
      if (settings.VOICE) {
        const voices = speechSynthesis.getVoices();
        // Case-insensitive voice matching
        const selected = voices.find(v => 
          v.name.toLowerCase() === settings.VOICE.toLowerCase()
        );
        if (selected) {
          utterance.voice = selected;
          log('TTS: Using voice:', selected.name);
        } else if (voices.length > 0) {
          log('TTS: Voice not found:', settings.VOICE, 'available voices:', voices.map(v => v.name));
        }
      }
      
      // Chrome's Speech Synthesis API caps rate at 2.0x, Firefox supports higher
      const isFirefox = typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox');
      const maxRate = isFirefox ? 2.5 : 2.0;
      utterance.rate = Math.min(settings.VOICE_SPEED || 1.0, maxRate);
      utterance.volume = 0.9;
      speechSynthesis.speak(utterance);
      log('TTS: New auction:', itemName);
    };
    
    // If voices are already loaded, use them immediately
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      selectVoice();
      // Don't set up onvoiceschanged listener if voices are already loaded
      // This prevents potential duplicate calls
    } else {
      // Wait for voices to load
      let voicesChangedFired = false;
      speechSynthesis.onvoiceschanged = () => {
        if (!voicesChangedFired) {
          voicesChangedFired = true;
        selectVoice();
        }
        speechSynthesis.onvoiceschanged = null; // Clean up
      };
      // Fallback: try after a short delay if onvoiceschanged doesn't fire
      setTimeout(() => {
        if (!voicesChangedFired) {
          selectVoice(); // Will check hasSpoken flag internally
        }
          if (speechSynthesis.onvoiceschanged) {
            speechSynthesis.onvoiceschanged = null;
        }
      }, 100);
    }
  }
  
  /**
   * Check all currently known timers for completion
   * Called repeatedly by the polling interval
   */
  function checkAllTimers() {
    // Debug: Log that we're checking timers
    log('Checking timers...');
    
    // Rescan for new timers
    const currentTimers = scanForTimers();
    
    // Track new timers
    let newTimerCount = 0;
    let completedCount = 0;
    currentTimers.forEach(timer => {
      if (!allTimers.has(timer)) {
        allTimers.add(timer);
        newTimerCount++;
        // Announce new auctions if enabled and within window
        maybeAnnounceNewAuction(timer);
        
        // Only pre-mark completed timers during the brief navigation
        // protection window. Outside of this window, allow checkTimer()
        // to handle completion and trigger alerts.
        const width = getWidthPercent(timer);
        if (navigationProtectionActive && width !== null && width <= 0) {
          log('🚨 (Protection) New timer already completed on load, marking as alerted:', timer);
          alertedTimers.add(timer);
          completedCount++;
        }
      }
    });
    
    if (newTimerCount > 0) {
      log(`Found ${newTimerCount} new timer(s), total monitoring: ${allTimers.size}`);
    }
    
    if (completedCount > 0) {
      log(`🚨 Found ${completedCount} completed timer(s) that were not marked as alerted - fixed!`);
    }
    
    // Check each timer
    allTimers.forEach(timer => {
      // Remove from monitoring if element is no longer in DOM
      if (!document.contains(timer)) {
        allTimers.delete(timer);
        return;
      }
      
      // Reduce noise: omit per-timer logs in normal mode
      checkTimer(timer);
    });
  }

  // ===========================================================================
  // MUTATION OBSERVER - Dynamic DOM Monitoring
  // ===========================================================================
  
  /**
   * Initialize MutationObserver to detect when new timer bars are added to DOM
   * This ensures we catch timers that appear after the initial page load
   */
  function initializeMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      // Check if any relevant DOM changes occurred
      let shouldRescan = false;
      
      for (const mutation of mutations) {
        // Check for added nodes
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // If a timer is added directly
              if (node.matches && node.matches(CONFIG.TIMER_SELECTOR)) {
                shouldRescan = true;
                log('New timer detected via MutationObserver');
                break;
              }
              // If a timer is added within this subtree
              if (node.querySelector && node.querySelector(CONFIG.TIMER_SELECTOR)) {
                shouldRescan = true;
                log('New timer detected in subtree');
                break;
              }
            }
          }
        }
      }
      
      // If timer-related changes detected, update our timer set
      if (shouldRescan) {
        const newTimers = scanForTimers();
        newTimers.forEach(timer => {
          if (!allTimers.has(timer)) {
            allTimers.add(timer);
            // Immediately consider announcing newly added auction
            maybeAnnounceNewAuction(timer);
          }
        });
        log(`Monitoring ${allTimers.size} timer(s)`);
      }
    });
    
    // Start observing the document body for DOM changes
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    log('MutationObserver initialized');
  }

  // ===========================================================================
  // INITIALIZATION & CLEANUP
  // ===========================================================================
  
  /**
   * Initialize the timer monitoring system
   * Sets up audio, starts polling loop, and initializes MutationObserver
   */
  function initialize() {
    log('Initializing OpenDKP Helper');
    console.log('OpenDKP Helper content script starting...');
    // Start with protection active during initial DOM churn
    navigationProtectionActive = true;
    
    // IMMEDIATELY scan for timers and check for completed ones
    allTimers = scanForTimers();
    log(`Found ${allTimers.size} initial timer(s)`);
    
    // Check if we have completed timers on page load (indicates navigation)
    const completedTimers = Array.from(allTimers).filter(timer => {
      const width = getWidthPercent(timer);
      return width !== null && width <= 0;
    });
    
    if (completedTimers.length > 0) {
      log(`🚨 NAVIGATION DETECTED: Found ${completedTimers.length} already-completed timer(s) on page load`);
      log('🚨 This indicates navigation from another page - marking ALL completed timers as alerted IMMEDIATELY');
      
      // Mark ALL completed timers as alerted immediately to prevent false alerts
      completedTimers.forEach(timer => {
        alertedTimers.add(timer);
        // Record signature so if DOM recreates the element, we still suppress
        const ctx = extractTableContext(timer) || extractTimerContext(timer);
        try { recordCompleted(buildCompletionSignature(ctx)); } catch (_) {}
        log('🚨 Marked completed timer as alerted (navigation protection):', timer);
      });
      
      log(`✅ Navigation protection: Marked ${completedTimers.length} completed timer(s) as alerted`);
      log('✅ NO ALERTS WILL BE TRIGGERED FOR THESE OLD AUCTIONS');
    } else {
      log('Fresh page load detected - no completed timers found');
    }
    
    // Initialize audio system
    initializeAudio();
    
    // Load settings (this is async, but we've already marked expired timers)
    loadSettings();
    
    // Start polling loop to check timer widths (with delay to ensure page is loaded)
    setTimeout(() => {
      log('Starting timer monitoring after delay');
      initializationComplete = true; // Allow alerts now
      pageInitialized = true; // Mark page as initialized
      // Keep navigation protection for a short window
      checkIntervalId = setInterval(() => {
        checkAllTimers();
      }, settings.CHECK_INTERVAL);
      // Turn off protection shortly after we begin monitoring so newly
      // completed auctions can trigger alerts.
      setTimeout(() => {
        navigationProtectionActive = false;
        log('Navigation protection window ended');
      }, 1500);
    }, 3000); // 3 second delay to prevent alerts when navigating to bidding tool
    
    // Start watching for dynamically added timers
    initializeMutationObserver();
    
          // Track bid activity for smart bidding mode
          trackBidActivity();
          
          // Extract user's character names for smart bidding mode
          extractUserCharacterNames();
          
          // Setup raid leader notification reminder
          setupRaidLeaderNotification();
    
  // Listen for settings updates
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'settingsUpdated') {
      log('Settings updated, reloading...');
      loadSettings();
      
      // Restart polling with new interval
      if (checkIntervalId) {
        clearInterval(checkIntervalId);
      }
      checkIntervalId = setInterval(() => {
        checkAllTimers();
      }, settings.CHECK_INTERVAL);
      
      // Update audio volume
      if (audioElement) {
        audioElement.volume = settings.VOLUME;
      }
      
      // Re-extract character names in case user switched characters
      extractUserCharacterNames();
      
      // Send response for settings update (synchronous)
      if (sendResponse) {
        sendResponse({success: true});
      }
      return false; // Synchronous response, no need to return true
    } else if (message.action === 'testSound') {
      log('Test sound requested from popup');
      // Sound playing might take time, but we respond synchronously
      const soundDuration = playChime();
      log('Test sound played, duration:', soundDuration + 'ms');
      if (sendResponse) {
        sendResponse({success: true, duration: soundDuration});
      }
      return false; // Synchronous response
    } else if (message.action === 'reminderFlash') {
      try { 
        // Always log (not conditional on DEBUG) so we can diagnose flash issues
        console.log('[OpenDKP Helper] Reminder flash received, color:', message.color || '#7e57c2');
        console.log('[OpenDKP Helper] Flash settings check - FLASH_SCREEN:', settings.FLASH_SCREEN, 'DISABLE_VISUALS:', settings.DISABLE_VISUALS);
        // Respect user's flash screen setting, but reminders always show flash unless visuals are disabled
        if (!settings.DISABLE_VISUALS) {
          console.log('[OpenDKP Helper] Calling flashScreen with color:', message.color || '#7e57c2');
          flashScreen(message.color || '#7e57c2'); 
          console.log('[OpenDKP Helper] Flash overlay executed successfully');
          
          // Send response for Firefox compatibility
          if (sendResponse) {
            sendResponse({success: true});
          }
        } else {
          console.log('[OpenDKP Helper] Flash skipped - visuals disabled');
          // Send response even when skipped
          if (sendResponse) {
            sendResponse({success: true, skipped: true, reason: 'visuals_disabled'});
          }
        }
      } catch(e) {
        console.error('[OpenDKP Helper] Reminder flash error:', e);
        console.error('[OpenDKP Helper] Error stack:', e.stack);
        log('Reminder flash error:', e);
        
        // Send error response
        if (sendResponse) {
          sendResponse({success: false, error: e.message});
        }
      }
      
      // Return true to indicate async response (Firefox requires this)
      return true;
    }
    
    // Unknown action - don't send response
    return false;
  });
    
    log('OpenDKP Helper initialized successfully');
    console.log('OpenDKP Helper content script initialized successfully');
  }

  // Add a short protection window whenever the tab becomes visible again
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      navigationProtectionActive = true;
      // On return, mark already-completed timers to avoid re-alerting
      try {
        const timers = scanForTimers();
        timers.forEach(t => {
          const w = getWidthPercent(t);
          if (w !== null && w <= 0) {
            alertedTimers.add(t);
            const ctx = extractTableContext(t) || extractTimerContext(t);
            try { recordCompleted(buildCompletionSignature(ctx)); } catch (_) {}
          }
        });
      } catch (_) {}
      setTimeout(() => { navigationProtectionActive = false; }, 2000);
    }
  });
  
  /**
   * Cleanup function for when extension is disabled or page is unloaded
   */
  function cleanup() {
    log('Cleaning up OpenDKP Helper');
    
    if (checkIntervalId) {
      clearInterval(checkIntervalId);
      checkIntervalId = null;
    }
  }
  
  // ===========================================================================
  // DEBUGGING HELPERS
  // ===========================================================================
  
  /**
   * Test function - manually trigger chime
   * Run this in console: testChimeSound()
   */
  function testChimeSound() {
    log('Testing chime sound...');
    playChime();
  }
  
  /**
   * Check status function - shows current state
   * Run this in console: checkExtensionStatus()
   */
  function checkExtensionStatus() {
    const timers = scanForTimers();
    const activeTimers = Array.from(timers).filter(t => {
      const width = getWidthPercent(t);
      return width !== null && width > 0;
    });
    
    console.log('=== OpenDKP Helper Status ===');
    console.log('Debug mode: removed (all logs now unconditional)');
    console.log('Audio element:', audioElement ? 'Loaded' : 'NOT loaded');
    console.log('Total timers found:', timers.size);
    console.log('Active timers (width > 0%):', activeTimers.length);
    console.log('Completed timers (width = 0%):', timers.size - activeTimers.length);
    console.log('Timers already alerted:', alertedTimers ? 'Tracked' : 'NOT tracked');
    console.log('');
    console.log('Timer widths:');
    Array.from(timers).forEach((timer, i) => {
      const width = getWidthPercent(timer);
      console.log(`  Timer ${i}: ${width}%`, timer);
    });
    console.log('');
    console.log('Run testChimeSound() to test the chime');
  }
  
  // Expose functions to window for debugging
  window.openDKPTimerDebug = {
    testChime: testChimeSound,
    checkStatus: checkExtensionStatus,
    scan: scanForTimers,
    playChime: playChime,
    extractContext: extractTimerContext,
    extractTableContext: extractTableContext,
    readAuctionsTest: () => speakAuctionItem('Test auction item'),
    testNotification: () => {
      const context = {
        winner: 'TestPlayer',
        bidAmount: 100,
        itemName: 'Test Item',
        quantity: 1
      };
      showNotification(context);
    },
    testRollOff: () => {
      const context = {
        itemName: 'Epic Sword',
        quantity: 1,
        rollOffWinners: [
          { winner: 'Player1', bid: 1000 },
          { winner: 'Player2', bid: 1000 },
          { winner: 'Player3', bid: 1000 }
        ],
        rollOffBid: 1000
      };
      showNotification(context);
    },
    testMultiWinner: () => {
      const context = {
        itemName: 'Rare Potion',
        quantity: 2,
        rollOffWinners: [
          { winner: 'Player1', bid: 500 },
          { winner: 'Player2', bid: 500 }
        ],
        bidAmount: 500
      };
      showNotification(context);
    },
    testNoBid: () => {
      const context = {
        itemName: 'Common Item',
        quantity: 1,
        noBid: true
      };
      log('No bid test - should not show notification');
      shouldAlert(context);
    }
  };

  // ===========================================================================
  // FUTURE EXPANSION POINTS
  // ===========================================================================
  
  /**
   * Extract context information from a timer element
   * Pulls auction details from the DOM structure
   */
  function extractTimerContext(timerElement) {
    try {
      // Navigate up to find the auction container
      const auctionContainer = timerElement.closest('a[id*="_header_action"]') || 
                              timerElement.closest('.p-tabview-nav-link') ||
                              timerElement.parentElement;
      
      if (!auctionContainer) {
        log('Could not find auction container');
        return null;
      }
      
      // Find the tab-offset div with winner info
      const winnerDiv = auctionContainer.querySelector('.tab-offset');
      const winnerText = winnerDiv ? winnerDiv.textContent.trim() : '';
      
      // Parse winner and bid amount (format: "PlayerName - Amount")
      let winner = null;
      let bidAmount = null;
      if (winnerText) {
        const match = winnerText.match(/^(.+?)\s*-\s*(\d+)$/);
        if (match) {
          winner = match[1].trim();
          bidAmount = parseInt(match[2]);
        }
      }
      
      // Find item name and quantity
      const itemDivs = auctionContainer.querySelectorAll('div');
      let itemName = null;
      let quantity = null;
      
      for (const div of itemDivs) {
        const text = div.textContent.trim();
        // Look for pattern like "item name x 1" or just "item name"
        const itemMatch = text.match(/^(.+?)\s*x\s*(\d+)$/);
        if (itemMatch) {
          let extractedName = itemMatch[1].trim();
          // CRITICAL: Remove leading bid amounts from item name (e.g., "150 Yelinak's Talisman" -> "Yelinak's Talisman")
          // Pattern: starts with digits followed by space(s) or dash, then the actual item name
          // Also handle cases like "10Dagger" (no space) or "10  Dagger" (multiple spaces)
          const bidPrefixMatch = extractedName.match(/^\d+[\s-]+(.+)$/);
          if (bidPrefixMatch) {
            extractedName = bidPrefixMatch[1].trim();
            log(`Removed bid amount prefix from item name: "${itemMatch[1]}" -> "${extractedName}"`);
          } else {
            // Also try pattern without space (e.g., "10Dagger" -> "Dagger")
            const noSpaceMatch = extractedName.match(/^\d+(.+)$/);
            if (noSpaceMatch && noSpaceMatch[1].length > 0) {
              extractedName = noSpaceMatch[1].trim();
              log(`Removed bid amount prefix (no space) from item name: "${itemMatch[1]}" -> "${extractedName}"`);
            }
          }
          itemName = extractedName;
          quantity = parseInt(itemMatch[2]);
          break;
        } else if (text && !text.includes('-') && !text.includes('x') && text.length > 3) {
          // Fallback: if it looks like an item name (no dashes, no x, reasonable length)
          // Also clean bid amounts from fallback
          let fallbackName = text;
          const bidPrefixMatch = fallbackName.match(/^\d+[\s-]+(.+)$/);
          if (bidPrefixMatch) {
            fallbackName = bidPrefixMatch[1].trim();
            log(`Removed bid amount prefix from fallback item name: "${text}" -> "${fallbackName}"`);
          } else {
            // Also try pattern without space (e.g., "10Dagger" -> "Dagger")
            const noSpaceMatch = fallbackName.match(/^\d+(.+)$/);
            if (noSpaceMatch && noSpaceMatch[1].length > 0) {
              fallbackName = noSpaceMatch[1].trim();
              log(`Removed bid amount prefix (no space) from fallback item name: "${text}" -> "${fallbackName}"`);
            }
          }
          itemName = fallbackName;
          quantity = 1; // Default quantity
        }
      }
      
      // Helper function to extract winners from a table
      function extractWinnersFromTable(table, defaultBid) {
        const winnersMap = new Map(); // Use Map to track highest bid per person
        const rows = table.querySelectorAll('tbody tr, tr');
        
        for (const row of rows) {
          // Skip header rows
          if (row.querySelector('th')) continue;
          
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            // Based on DOM structure: Column 0 = row number, Column 1 = name (link), Column 3 = quantity
            // But also check if structure is different (bid table might have different columns)
            let nameCell = null;
            let bidCell = null;
            
            // Strategy 1: Look for character name links (common pattern: <a href="#/characters/...">Name</a>)
            for (let i = 0; i < cells.length; i++) {
              const cell = cells[i];
              const nameLink = cell.querySelector('a[href*="/characters/"]');
              if (nameLink) {
                const name = nameLink.textContent.trim();
                if (name && name.length > 0) {
                  nameCell = cell;
                  // Look for bid in nearby cells (check cells after the name)
                  // IMPORTANT: Check for input fields first (bid amounts are in editable inputs)
                  for (let j = i + 1; j < Math.min(i + 4, cells.length); j++) {
                    const cell = cells[j];
                    // Check for input field with value (bid amounts are in <input type="number">)
                    const bidInput = cell.querySelector('input[type="number"]');
                    if (bidInput && bidInput.value) {
                      const bidValue = parseInt(bidInput.value);
                      if (!isNaN(bidValue) && bidValue > 0) {
                        bidCell = cell;
                        break;
                      }
                    }
                    // Fallback: check text content
                    const cellText = cell.textContent.trim();
                    const bidMatch = cellText.match(/^\d+$/);
                    if (bidMatch && parseInt(cellText) > 10) {
                      bidCell = cell;
                      break;
                    }
                  }
                  break; // Found name link, stop searching
                }
              }
            }
            
            // Strategy 2: If no name link found, try to find name in cells with text content
            if (!nameCell) {
              for (let i = 0; i < cells.length; i++) {
                const cellText = cells[i].textContent.trim();
                
                // Check if this cell looks like a name (contains letters, not just numbers)
                if (cellText && cellText.match(/^[a-zA-Z][a-zA-Z0-9\s-]+$/) && cellText.length > 1) {
                  // Check if it's not a header or known non-name values
                  if (!['name', 'winner', '#', 'rank', 'raid main', 'raid main'].includes(cellText.toLowerCase())) {
                    if (!nameCell) {
                      nameCell = cells[i];
                    }
                  }
                }
                
                // Check if this cell looks like a bid amount (input field or numbers)
                const bidInput = cells[i].querySelector('input[type="number"]');
                if (bidInput && bidInput.value) {
                  const bidValue = parseInt(bidInput.value);
                  if (!isNaN(bidValue) && bidValue > 0) {
                    bidCell = cells[i];
                  }
                } else {
                  const bidMatch = cellText.match(/^\d+$/);
                  if (bidMatch && parseInt(cellText) > 10) {
                    bidCell = cells[i];
                  }
                }
              }
            }
            
            if (nameCell) {
              // Try to find link first (winners are often links), otherwise use text
              const nameLink = nameCell.querySelector('a');
              let name = nameLink ? nameLink.textContent.trim() : nameCell.textContent.trim();
              
              // Clean up name (remove trailing "(event" or other text)
              name = name.replace(/\s*\(.*?$/, '').trim();
              
              if (name && name.length > 0 && !name.match(/^\d+$/) && name.length > 1) {
                // Extract bid amount: prefer input field value, fallback to textContent, then defaultBid
                let rowBid = null;
                if (bidCell) {
                  const bidInput = bidCell.querySelector('input[type="number"]');
                  if (bidInput && bidInput.value) {
                    rowBid = parseInt(bidInput.value);
                  } else {
                    const cellText = bidCell.textContent.trim();
                    const bidMatch = cellText.match(/^\d+$/);
                    if (bidMatch) {
                      rowBid = parseInt(cellText);
                    }
                  }
                }
                
                // If no bid found, use defaultBid
                if (!rowBid && defaultBid) {
                  rowBid = defaultBid;
                }
                
                // CRITICAL: Track highest bid per person (table shows bid history)
                // If person already exists, only update if this bid is higher
                const existing = winnersMap.get(name);
                if (!existing || !rowBid || (rowBid && (!existing.bid || rowBid > existing.bid))) {
                  winnersMap.set(name, { winner: name, bid: rowBid });
                }
              }
            }
          }
        }
        
        return Array.from(winnersMap.values());
      }
      
      // CRITICAL: Always check for roll-offs, not just when quantity > 1
      // Roll-offs happen when multiple people bid the same amount (especially 1000 cap)
      // This can happen on single-item auctions too!
      let rollOffWinners = [];
      let rollOffBid = null;
      
      // Strategy 1: Check tab-offset for multiple winners with same bid (roll-off scenario)
      // Format might be: "Player1 - 1000, Player2 - 1000, Player3 - 1000" or just comma-separated
      if (winnerText && winnerText.includes(',')) {
        const winnerParts = winnerText.split(',').map(s => s.trim());
        const parsedWinners = winnerParts
          .map(part => {
            const match = part.match(/^(.+?)\s*-\s*(\d+)$/);
            if (match) {
              return { winner: match[1].trim(), bid: parseInt(match[2]) };
            }
            // If no bid amount in part, use the extracted bidAmount if available
            if (bidAmount && part.trim().length > 0) {
              return { winner: part.trim(), bid: bidAmount };
            }
            return null;
          })
          .filter(Boolean);
        
        // Check if all winners have the same bid amount (roll-off)
        if (parsedWinners.length > 1) {
          const allSameBid = parsedWinners.every(w => w.bid === parsedWinners[0].bid);
          if (allSameBid && parsedWinners[0].bid > 0) {
            rollOffWinners = parsedWinners;
            rollOffBid = parsedWinners[0].bid;
            log('Found roll-off from tab-offset (multiple winners with same bid):', rollOffWinners);
          } else {
            // Multiple winners but different bids - might be multi-item auction
            rollOffWinners = parsedWinners;
            log('Found multiple winners from tab-offset (different bids):', rollOffWinners);
          }
        }
      }
      
      // Strategy 2: Look for bids/results table to find all winners with same bid
      // This works for both single-item roll-offs and multi-item auctions
      // IMPORTANT: Always check the table to verify/improve bid amounts, even for single winners
      if (bidAmount && bidAmount > 0) {
        // Find the tab panel associated with this auction container
        let tabPanel = null;
        if (auctionContainer && auctionContainer.id) {
          // Try to find tab panel that corresponds to this auction
          const tabId = auctionContainer.id.replace('_header_action', '');
          tabPanel = document.querySelector(`[data-pc-section="content"] .p-tabview-panel[id*="${tabId}"]`) ||
                     document.querySelector(`.p-tabview-panel[aria-labelledby="${auctionContainer.id}"]`) ||
                     document.querySelector('.p-tabview-panel.p-tabview-panel-active');
        } else {
          // Fallback: use active tab panel
          tabPanel = document.querySelector('.p-tabview-panel.p-tabview-panel-active');
        }
        
        if (tabPanel) {
          // Look for datatable in the tab panel (based on your DOM: class="p-datatable-table")
          const bidsTable = tabPanel.querySelector('table.p-datatable-table, table');
          if (bidsTable) {
            const extracted = extractWinnersFromTable(bidsTable, bidAmount);
            
            if (extracted.length > 1) {
              // CRITICAL: Only consider it a roll-off if ALL winners have the SAME bid amount
              // Check if all extracted winners have the same bid
              const allSameBid = extracted.every(w => w.bid === extracted[0].bid && w.bid !== null);
              if (allSameBid && extracted[0].bid > 0) {
                // Multiple people with same bid = roll-off
                rollOffWinners = extracted;
                rollOffBid = extracted[0].bid;
                log('Found roll-off from tab panel table (multiple winners with same bid):', rollOffWinners);
              } else {
                // Multiple winners but different bids - not a roll-off, just multiple bidders
                rollOffWinners = extracted;
                log('Found multiple winners from tab panel table (different bids, not roll-off):', rollOffWinners);
              }
            } else if (extracted.length === 1) {
              // Single winner found in table - verify/improve bid amount from table
              const tableWinner = extracted[0];
              const oldBidAmount = bidAmount;
              
              // If we have a winner name match, use the table's bid amount (more reliable)
              if (winner && tableWinner.winner && 
                  winner.toLowerCase() === tableWinner.winner.toLowerCase()) {
                // Table has more accurate bid amount - use it
                if (tableWinner.bid && tableWinner.bid > 0) {
                  bidAmount = tableWinner.bid;
                  if (oldBidAmount !== bidAmount) {
                    log(`Improved bid amount from table: ${bidAmount} (was ${oldBidAmount})`);
                  } else {
                    log(`Verified bid amount from table: ${bidAmount}`);
                  }
                }
              } else if (tableWinner.winner && !winner) {
                // Table found a winner but tab-offset didn't - use table's winner
                winner = tableWinner.winner;
                if (tableWinner.bid && tableWinner.bid > 0) {
                  bidAmount = tableWinner.bid;
                  log(`Found winner and bid from table: ${winner} - ${bidAmount}`);
                }
              }
              
              // Store the extracted winner for consistency
              rollOffWinners = extracted;
              log('Found single winner from tab panel table:', rollOffWinners);
            } else if (extracted.length === 0 && winner) {
              // No winners found in table extraction, but we have a winner from tab-offset
              // Try to find this specific winner in the table to get their actual bid
              const rows = bidsTable.querySelectorAll('tbody tr, tr');
              for (const row of rows) {
                if (row.querySelector('th')) continue; // Skip headers
                
                const nameLink = row.querySelector('a[href*="/characters/"]');
                if (nameLink && nameLink.textContent.trim().toLowerCase() === winner.toLowerCase()) {
                  // Found the winner's row - extract their bid from input field
                  const bidInput = row.querySelector('input[type="number"]');
                  if (bidInput && bidInput.value) {
                    const tableBid = parseInt(bidInput.value);
                    if (!isNaN(tableBid) && tableBid > 0) {
                      const oldBidAmount = bidAmount;
                      bidAmount = tableBid;
                      if (oldBidAmount !== bidAmount) {
                        log(`Found winner's bid in table: ${bidAmount} (was ${oldBidAmount})`);
                      } else {
                        log(`Verified winner's bid in table: ${bidAmount}`);
                      }
                      rollOffWinners = [{ winner: winner, bid: bidAmount }];
                      break;
                    }
                  }
                }
              }
            }
          }
        }
        
        // Strategy 3: If not found in tab panel, look for tables WITHIN THIS AUCTION'S TAB PANEL ONLY
        // CRITICAL: Only look at tables in the same tab panel to avoid mixing with other auctions
        if (rollOffWinners.length <= 1 && tabPanel) {
          // Only search tables within this auction's tab panel
          const auctionTables = tabPanel.querySelectorAll('table');
          log(`Searching ${auctionTables.length} table(s) within auction's tab panel for winners`);
          
          for (const table of auctionTables) {
            // Check if this table has character links (indicates it's a results/bids table)
            const hasCharacterLinks = table.querySelectorAll('a[href*="/characters/"]').length > 0;
            
            if (hasCharacterLinks) {
              // Extract winners with same bid amount (only from THIS auction's table)
              const extracted = extractWinnersFromTable(table, bidAmount);
              log(`Found ${extracted.length} winner(s) in auction's table:`, extracted);
              
              if (extracted.length > 1) {
                // CRITICAL: Only consider it a roll-off if ALL winners have the SAME bid amount
                const allSameBid = extracted.every(w => w.bid === extracted[0].bid && w.bid !== null);
                if (allSameBid && extracted[0].bid > 0) {
                  // Multiple people with same bid = roll-off
                  rollOffWinners = extracted;
                  rollOffBid = extracted[0].bid;
                  log('Found roll-off from auction table (multiple winners with same bid):', rollOffWinners);
                  break;
                } else {
                  // Multiple winners but different bids - not a roll-off, just bid history
                  log('Found multiple winners in auction table (different bids, not roll-off):', extracted);
                  if (rollOffWinners.length === 0) {
                    rollOffWinners = extracted;
                  }
                }
              } else if (extracted.length === 1) {
                // Single winner found - verify/improve bid amount from table
                const tableWinner = extracted[0];
                const oldBidAmount = bidAmount;
                
                // If we have a winner name match, use the table's bid amount (more reliable)
                if (winner && tableWinner.winner && 
                    winner.toLowerCase() === tableWinner.winner.toLowerCase()) {
                  if (tableWinner.bid && tableWinner.bid > 0) {
                    bidAmount = tableWinner.bid;
                    if (oldBidAmount !== bidAmount) {
                      log(`Improved bid amount from auction table: ${bidAmount} (was ${oldBidAmount})`);
                    }
                  }
                } else if (tableWinner.winner && !winner) {
                  // Table found a winner but tab-offset didn't - use table's winner
                  winner = tableWinner.winner;
                  if (tableWinner.bid && tableWinner.bid > 0) {
                    bidAmount = tableWinner.bid;
                    log(`Found winner and bid from auction table: ${winner} - ${bidAmount}`);
                  }
                }
                
                rollOffWinners = extracted;
                log('Found single winner from auction table:', rollOffWinners);
              } else if (extracted.length > 0 && rollOffWinners.length === 0) {
                // At least save what we found
                rollOffWinners = extracted;
                log('Found winner(s) from auction table:', rollOffWinners);
              }
            }
          }
        }
      }
      
      // Strategy 4: Special case - if bidAmount is 1000 (cap) and we have a winner,
      // check if there are other rows in THIS AUCTION'S TABLE with 1000 bid (roll-off likely)
      // CRITICAL: Only check tables within this auction's tab panel to avoid mixing with other auctions
      if (rollOffWinners.length <= 1 && bidAmount === 1000) {
        log('Bid amount is 1000 (cap), checking for roll-off participants in THIS auction only...');
        
        // Find the tab panel for THIS auction
        let tabPanel = null;
        if (auctionContainer && auctionContainer.id) {
          const tabId = auctionContainer.id.replace('_header_action', '');
          tabPanel = document.querySelector(`[data-pc-section="content"] .p-tabview-panel[id*="${tabId}"]`) ||
                     document.querySelector(`.p-tabview-panel[aria-labelledby="${auctionContainer.id}"]`);
        }
        
        if (tabPanel) {
          // Only look at tables within THIS auction's tab panel
          const auctionTables = tabPanel.querySelectorAll('table');
          log(`Checking ${auctionTables.length} table(s) in THIS auction for 1000 cap bidders`);
          
          for (const table of auctionTables) {
            const rows = table.querySelectorAll('tbody tr, tr');
            const capBidders = [];
            
            for (const row of rows) {
              if (row.querySelector('th')) continue; // Skip headers
              
              const cells = row.querySelectorAll('td');
              if (cells.length >= 2) {
                // Find bid cell (usually contains numbers)
                let rowBid = null;
                let rowWinner = null;
                
                for (let i = 0; i < cells.length; i++) {
                  const cellText = cells[i].textContent.trim();
                  const bidMatch = cellText.match(/^(\d+)$/);
                  if (bidMatch && parseInt(cellText) === 1000) {
                    rowBid = 1000;
                    // Look for winner name in nearby cells
                    for (let j = 0; j < cells.length; j++) {
                      const nameLink = cells[j].querySelector('a[href*="/characters/"]');
                      if (nameLink) {
                        rowWinner = nameLink.textContent.trim();
                        break;
                      }
                    }
                    break;
                  }
                }
                
                if (rowBid === 1000 && rowWinner) {
                  capBidders.push({ winner: rowWinner, bid: 1000 });
                }
              }
            }
            
            if (capBidders.length > 1) {
              rollOffWinners = capBidders;
              rollOffBid = 1000;
              log('Found roll-off in THIS auction: Multiple bidders at 1000 cap:', rollOffWinners);
              break;
            }
          }
        } else {
          log('Could not find tab panel for this auction, skipping 1000 cap check');
        }
      }
      
      // Check if no one bid (bid amount is 0 or null)
      const noBid = !bidAmount || bidAmount === 0;
      
      // Determine if this is a roll-off (multiple people with same bid AND more people than items)
      // Roll-off only happens when participants > quantity (e.g., 2 people bid 1000 on 1 item)
      // If quantity >= participants, they all win (e.g., 2 people bid 1000 on 2 items = both win)
      const isRollOff = rollOffWinners.length > 1 && rollOffBid !== null && rollOffWinners.length > (quantity || 1);
      
      // CRITICAL: Determine if there are actually multiple WINNERS (not just multiple bidders)
      // Multiple winners only occur when:
      // 1. It's a roll-off (multiple people with same bid, more people than items), OR
      // 2. Multiple people won in a multi-item auction (top N bidders where N = quantity)
      // For single-item auctions with one clear winner, there's only ONE winner, not multiple
      let actualWinners = [];
      if (isRollOff) {
        // Roll-off: all people with the same highest bid are winners (but need roll-off)
        actualWinners = rollOffWinners;
      } else if (rollOffWinners.length > 0 && bidAmount) {
        // For multi-item auctions: select top N bidders (where N = quantity)
        // Sort all bidders by bid amount (descending) and take top N
        if (quantity && quantity > 1 && rollOffWinners.length > 0) {
          // Multi-item auction: sort by bid descending and take top N
          const sortedBidders = [...rollOffWinners].sort((a, b) => (b.bid || 0) - (a.bid || 0));
          actualWinners = sortedBidders.slice(0, quantity);
          log(`Multi-item auction (quantity=${quantity}): Selected top ${actualWinners.length} bidders:`, actualWinners.map(w => `${w.winner} (${w.bid})`).join(', '));
        } else {
          // Single-item auction: only the highest bidder wins
          const highestBid = Math.max(...rollOffWinners.map(w => w.bid || 0));
          actualWinners = rollOffWinners.filter(w => w.bid === highestBid);
          
          // If multiple people have the same highest bid but only 1 item, it's a roll-off
          if (actualWinners.length > 1 && (!quantity || quantity === 1)) {
            // Multiple people with same bid but only 1 item = roll-off (should have been caught above)
            // This shouldn't happen if roll-off detection is working, but handle it
            actualWinners = [actualWinners[0]]; // Only first one wins until roll-off
          }
        }
      } else if (winner) {
        // We have a winner from tab-offset but no roll-off winners found
        actualWinners = [{ winner: winner, bid: bidAmount }];
      }
      
      const multipleWinners = actualWinners.length > 1;
      
      let context = {
        winner: winner,
        bidAmount: bidAmount,
        itemName: itemName,
        quantity: quantity,
        timerWidth: getWidthPercent(timerElement),
        rawWinnerText: winnerText,
        noBid: noBid,
        isTableStructure: false,
        rollOffWinners: rollOffWinners.length > 0 ? rollOffWinners : undefined,
        rollOffBid: rollOffBid,
        isRollOff: isRollOff,
        multipleWinners: multipleWinners, // Only true if there are actually multiple winners
        actualWinners: actualWinners.length > 0 ? actualWinners : undefined // Store actual winners for TTS
      };
      // Sanitize: item name should not include winner name prefixes like "Winner - Item"
      if (context.itemName && context.winner) {
        const w = context.winner.trim().toLowerCase();
        const n = context.itemName.trim();
        if (n.toLowerCase().startsWith(w + ' -')) {
          context.itemName = n.substring(n.indexOf('-') + 1).trim();
        }
      }
      
      // Enhanced logging for roll-off detection debugging
      log('=== ROLL-OFF DETECTION DEBUG ===');
      log('Winner text:', winnerText);
      log('Extracted winner:', winner);
      log('Bid amount:', bidAmount);
      log('Quantity:', quantity);
      log('All bidders found:', rollOffWinners);
      log('Actual winners (highest bid):', actualWinners);
      log('Roll-off bid:', rollOffBid);
      log('Is roll-off?', isRollOff);
      log('Multiple winners?', multipleWinners, `(${actualWinners.length} actual winner(s) out of ${rollOffWinners.length} bidder(s))`);
      log('Final context:', context);
      
      // Capture DOM snapshot when roll-off is detected OR when multiple actual winners are found
      if (isRollOff || multipleWinners) {
        const reason = isRollOff ? 'roll-off-detected' : 'multiple-winners-detected';
        log('Capturing DOM snapshot for:', reason);
        captureDOMSnapshot(context, timerElement, reason);
      }
      
      log('=== END ROLL-OFF DEBUG ===');
      return context;
      
    } catch (error) {
      log('Error extracting context:', error);
      return null;
    }
  }
  
  /**
   * Extract context from table-based auction structure
   * Handles multiple winners, roll-offs, and no-bid scenarios
   */
  function extractTableContext(timerElement) {
    try {
      // Find the table row containing this timer
      const tableRow = timerElement.closest('tr');
      if (!tableRow) {
        log('Could not find table row');
        return null;
      }
      
      const cells = tableRow.querySelectorAll('td');
      if (cells.length < 4) {
        log('Not enough table cells found');
        return null;
      }
      
      // Extract data from table cells
      const rowNumber = cells[0]?.textContent?.trim();
      const winnerCell = cells[1];
      const itemCell = cells[2];
      const bidCell = cells[3];
      const timerCell = cells[4]; // This should contain our timer
      const timestampCell = cells[5];
      
      // Get winner name from link
      const winnerLink = winnerCell?.querySelector('a');
      const winner = winnerLink ? winnerLink.textContent.trim() : winnerCell?.textContent?.trim();
      
      // Get item name and quantity
      const itemText = itemCell?.textContent?.trim() || '';
      const quantityMatch = itemText.match(/x\s*(\d+)$/);
      const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
      let itemName = quantityMatch ? itemText.replace(/\s*x\s*\d+$/, '').trim() : itemText;
      
      // CRITICAL: Remove leading bid amounts from item name (e.g., "50 Essence Emerald" -> "Essence Emerald")
      // Pattern: starts with digits followed by space(s) or dash, then the actual item name
      // Also handle cases like "10Dagger" (no space) or "10  Dagger" (multiple spaces)
      const bidPrefixMatch = itemName.match(/^\d+[\s-]+(.+)$/);
      if (bidPrefixMatch) {
        itemName = bidPrefixMatch[1].trim();
        log(`Removed bid amount prefix from table item name: "${itemText.replace(/\s*x\s*\d+$/, '').trim()}" -> "${itemName}"`);
      } else {
        // Also try pattern without space (e.g., "10Dagger" -> "Dagger")
        const noSpaceMatch = itemName.match(/^\d+(.+)$/);
        if (noSpaceMatch && noSpaceMatch[1].length > 0) {
          itemName = noSpaceMatch[1].trim();
          log(`Removed bid amount prefix (no space) from table item name: "${itemText.replace(/\s*x\s*\d+$/, '').trim()}" -> "${itemName}"`);
        }
      }
      
      // Get bid amount
      const bidText = bidCell?.textContent?.trim();
      const bidAmount = bidText ? parseInt(bidText) : null;
      
      // Check if this is a roll-off (multiple winners with same bid)
      const allRows = tableRow.parentElement?.querySelectorAll('tr');
      let rollOffWinners = [];
      let rollOffBid = null;
      
      if (allRows && bidAmount) {
        rollOffWinners = Array.from(allRows)
          .map(row => {
            const cells = row.querySelectorAll('td');
            const rowWinner = cells[1]?.querySelector('a')?.textContent?.trim();
            const rowBid = cells[3]?.textContent?.trim();
            return { winner: rowWinner, bid: parseInt(rowBid) };
          })
          .filter(entry => entry.winner && entry.bid === bidAmount);
        
        if (rollOffWinners.length > 1) {
          rollOffBid = bidAmount;
        }
      }
      
      // Check if no one bid (bid amount is 0 or null)
      const noBid = !bidAmount || bidAmount === 0;
      
      // Determine if this is a roll-off (multiple people with same bid AND more people than items)
      // Roll-off only happens when participants > quantity (e.g., 2 people bid 1000 on 1 item)
      // If quantity >= participants, they all win (e.g., 2 people bid 1000 on 2 items = both win)
      const isRollOff = rollOffWinners.length > 1 && rollOffBid !== null && rollOffWinners.length > (quantity || 1);
      
      // CRITICAL: Determine if there are actually multiple WINNERS (not just multiple bidders)
      // Multiple winners only occur when:
      // 1. It's a roll-off (multiple people with same bid, more people than items), OR
      // 2. Multiple people won in a multi-item auction (top N bidders where N = quantity)
      // For single-item auctions with one clear winner, there's only ONE winner, not multiple
      let actualWinners = [];
      if (isRollOff) {
        // Roll-off: all people with the same highest bid are winners (but need roll-off)
        actualWinners = rollOffWinners;
      } else if (rollOffWinners.length > 0 && bidAmount) {
        // For multi-item auctions: select top N bidders (where N = quantity)
        // Sort all bidders by bid amount (descending) and take top N
        if (quantity && quantity > 1 && rollOffWinners.length > 0) {
          // Multi-item auction: sort by bid descending and take top N
          const sortedBidders = [...rollOffWinners].sort((a, b) => (b.bid || 0) - (a.bid || 0));
          actualWinners = sortedBidders.slice(0, quantity);
          log(`Multi-item auction (quantity=${quantity}): Selected top ${actualWinners.length} bidders:`, actualWinners.map(w => `${w.winner} (${w.bid})`).join(', '));
        } else {
          // Single-item auction: only the highest bidder wins
          const highestBid = Math.max(...rollOffWinners.map(w => w.bid || 0));
          actualWinners = rollOffWinners.filter(w => w.bid === highestBid);
          
          // If multiple people have the same highest bid but only 1 item, it's a roll-off
          if (actualWinners.length > 1 && (!quantity || quantity === 1)) {
            // Multiple people with same bid but only 1 item = roll-off (should have been caught above)
            // This shouldn't happen if roll-off detection is working, but handle it
            actualWinners = [actualWinners[0]]; // Only first one wins until roll-off
          }
        }
      } else if (winner) {
        // We have a winner from table but no roll-off winners found
        actualWinners = [{ winner: winner, bid: bidAmount }];
      }
      
      const multipleWinners = actualWinners.length > 1;
      
      let context = {
        winner: winner,
        bidAmount: bidAmount,
        itemName: itemName,
        quantity: quantity,
        timerWidth: getWidthPercent(timerElement),
        rowNumber: rowNumber,
        timestamp: timestampCell?.textContent?.trim(),
        rollOffWinners: rollOffWinners,
        rollOffBid: rollOffBid,
        noBid: noBid,
        isTableStructure: true,
        isRollOff: isRollOff,
        multipleWinners: multipleWinners, // Only true if there are actually multiple winners
        actualWinners: actualWinners.length > 0 ? actualWinners : undefined // Store actual winners for TTS
      };
      
      // Enhanced logging for roll-off detection debugging (table-based)
      log('=== ROLL-OFF DETECTION DEBUG (TABLE) ===');
      log('Winner:', winner);
      log('Bid amount:', bidAmount);
      log('Quantity:', quantity);
      log('All bidders found:', rollOffWinners);
      log('Actual winners (highest bid):', actualWinners);
      log('Roll-off bid:', rollOffBid);
      log('Is roll-off?', isRollOff);
      log('Multiple winners?', multipleWinners, `(${actualWinners.length} actual winner(s) out of ${rollOffWinners.length} bidder(s))`);
      log('Final context:', context);
      
      // Capture DOM snapshot when roll-off is detected OR when multiple actual winners are found
      if (isRollOff || multipleWinners) {
        const reason = isRollOff ? 'roll-off-detected-table' : 'multiple-winners-detected-table';
        log('Capturing DOM snapshot for:', reason);
        captureDOMSnapshot(context, timerElement, reason);
      }
      
      log('=== END ROLL-OFF DEBUG (TABLE) ===');
      // Sanitize stray winner prefixes in itemName
      if (context.itemName && context.winner) {
        const w = context.winner.trim().toLowerCase();
        const n = context.itemName.trim();
        if (n.toLowerCase().startsWith(w + ' -')) {
          context.itemName = n.substring(n.indexOf('-') + 1).trim();
        }
      }
      
      log('Extracted table context:', context);
      return context;
      
    } catch (error) {
      log('Error extracting table context:', error);
      return null;
    }
  }
  
  /**
   * Speak auction completion notification using TTS
   */
  function speakNotification(context) {
    if (!settings.ENABLE_TTS) {
      return;
    }
    
    // Prevent duplicate TTS calls
    if (speakNotification.speaking) {
      log('TTS: Already speaking, skipping duplicate call');
      return;
    }
    speakNotification.speaking = true;
    
    // CRITICAL: Ensure actualWinners is populated if multipleWinners is true but actualWinners is missing
    // This is a safety net in case the context wasn't fully populated
    if (context.multipleWinners && (!context.actualWinners || context.actualWinners.length === 0)) {
      log('TTS: multipleWinners is true but actualWinners is missing, reconstructing...');
      if (context.rollOffWinners && context.rollOffWinners.length > 0 && context.quantity && context.quantity > 1) {
        // Multi-item auction: sort by bid descending and take top N
        const sorted = [...context.rollOffWinners].sort((a, b) => (b.bid || 0) - (a.bid || 0));
        context.actualWinners = sorted.slice(0, context.quantity);
        log('TTS: Reconstructed actualWinners:', context.actualWinners);
      } else if (context.rollOffWinners && context.rollOffWinners.length > 0) {
        // Fallback: use rollOffWinners
        context.actualWinners = context.rollOffWinners;
        log('TTS: Using rollOffWinners as actualWinners:', context.actualWinners);
      }
    }
    
    let message = '';
    
    // Check if advanced TTS is enabled and use custom template
    if (settings.ENABLE_ADVANCED_TTS && settings.TTS_TEMPLATE) {
      log('TTS: Advanced TTS enabled, context:', { multipleWinners: context.multipleWinners, actualWinners: context.actualWinners, winner: context.winner });
      message = generateTTSMessage(settings.TTS_TEMPLATE, context);
      log('TTS: Using custom template, generated message:', message);
    } else {
      log('TTS: Default TTS, context:', { multipleWinners: context.multipleWinners, actualWinners: context.actualWinners, winner: context.winner });
      // Use default logic
      // CRITICAL: Check multipleWinners FIRST (before roll-off) to ensure multi-item auctions are handled
      if (context.multipleWinners && context.actualWinners && context.actualWinners.length > 1) {
        // Multiple winners for multi-item auction
        const winnersList = context.actualWinners.map(w => w.winner || w);
        const winners = winnersList.join(', ');
        message = `Multiple winners for ${context.itemName}. Winners: ${winners}`;
        log('TTS: Multiple winners message (using actualWinners):', message);
      } else if (context.isRollOff && context.rollOffWinners && context.rollOffWinners.length > 1) {
        const participants = context.rollOffWinners.map(w => w.winner || w).join(', ');
        message = `Roll-off for ${context.itemName}. Participants: ${participants}`;
      } else if (context.multipleWinners) {
        // Use actualWinners if available (most accurate), otherwise reconstruct from rollOffWinners
        let winnersList = [];
        if (context.actualWinners && context.actualWinners.length > 0) {
          // Use the pre-calculated actual winners (most accurate)
          winnersList = context.actualWinners.map(w => w.winner || w);
          log('TTS: Using actualWinners from context:', winnersList);
        } else if (context.rollOffWinners && context.rollOffWinners.length > 0 && context.quantity) {
          // Fallback: Sort by bid descending and take top N
          const sorted = [...context.rollOffWinners].sort((a, b) => (b.bid || 0) - (a.bid || 0));
          winnersList = sorted.slice(0, context.quantity).map(w => w.winner || w);
          log('TTS: Reconstructed winners from rollOffWinners:', winnersList);
        } else if (context.rollOffWinners) {
          winnersList = context.rollOffWinners.map(w => w.winner || w);
          log('TTS: Using all rollOffWinners:', winnersList);
        }
        const winners = winnersList.join(', ');
        message = `Multiple winners for ${context.itemName}. Winners: ${winners}`;
        log('TTS: Multiple winners message:', message);
      } else if (context.winner && context.bidAmount) {
        message = `Auction Finished. ${context.winner} for ${context.bidAmount} DKP on ${context.itemName}`;
      } else {
        message = `Auction Finished for ${context.itemName}`;
      }
    }
    
    const utterance = new SpeechSynthesisUtterance(message);
    let hasSpoken = false; // Flag to prevent duplicate speak() calls
    
    // Wait for voices to load (especially important in Chrome)
    const selectVoice = () => {
      if (hasSpoken) {
        log('TTS: Already spoke, skipping duplicate speak() call');
        return;
      }
      
      if (settings.VOICE) {
        const voices = speechSynthesis.getVoices();
        // Case-insensitive voice matching
        const selectedVoice = voices.find(voice => 
          voice.name.toLowerCase() === settings.VOICE.toLowerCase()
        );
        if (selectedVoice) {
          utterance.voice = selectedVoice;
          log('TTS: Using voice:', selectedVoice.name);
        } else if (voices.length > 0) {
          log('TTS: Voice not found:', settings.VOICE, 'available voices:', voices.map(v => v.name));
        }
      }
      
      // Chrome's Speech Synthesis API caps rate at 2.0x, Firefox supports higher
      const isFirefox = typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox');
      const maxRate = isFirefox ? 2.5 : 2.0;
      utterance.rate = Math.min(settings.VOICE_SPEED || 1.0, maxRate);
      utterance.volume = 0.8;
      speechSynthesis.speak(utterance);
      hasSpoken = true;
      log('TTS: Speaking notification:', message);
      
      // Reset speaking flag when utterance finishes
      utterance.onend = () => {
        speakNotification.speaking = false;
      };
      utterance.onerror = () => {
        speakNotification.speaking = false;
      };
    };
    
    // If voices are already loaded, use them immediately
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      selectVoice();
    } else {
      // Wait for voices to load
      speechSynthesis.onvoiceschanged = () => {
        selectVoice();
        speechSynthesis.onvoiceschanged = null; // Clean up
      };
      // Fallback: try after a short delay if onvoiceschanged doesn't fire
      setTimeout(() => {
        if (!hasSpoken && speechSynthesis.getVoices().length > 0) {
          selectVoice();
          if (speechSynthesis.onvoiceschanged) {
            speechSynthesis.onvoiceschanged = null;
          }
        }
      }, 100);
    }
  }
  
  /**
   * Generate TTS message from template
   */
  function generateTTSMessage(template, context) {
    let message = template;
    
    // Handle winners list FIRST - prioritize actualWinners if multiple winners
    let winnersList = 'Unknown';
    if (context.multipleWinners && context.actualWinners && context.actualWinners.length > 0) {
      // Multiple winners: use actualWinners
      winnersList = context.actualWinners.map(w => w.winner || w).join(', ');
      log('TTS Template: Using actualWinners for multiple winners:', winnersList);
    } else if (context.rollOffWinners && context.rollOffWinners.length > 0) {
      winnersList = context.rollOffWinners.map(w => w.winner || w).join(', ');
    } else if (context.winner) {
      winnersList = context.winner;
    }
    
    // Replace variables
    // If multiple winners, replace {winner} with winners list for better UX
    if (context.multipleWinners && context.actualWinners && context.actualWinners.length > 1) {
      message = message.replace(/\{winner\}/g, winnersList);
    } else {
      message = message.replace(/\{winner\}/g, context.winner || 'Unknown');
    }
    message = message.replace(/\{bidAmount\}/g, context.bidAmount || '0');
    message = message.replace(/\{itemName\}/g, context.itemName || 'Unknown Item');
    message = message.replace(/\{winners\}/g, winnersList);
    
    message = message.replace(/\{isRollOff\}/g, context.isRollOff ? 'true' : 'false');
    message = message.replace(/\{multipleWinners\}/g, context.multipleWinners ? 'true' : 'false');
    
    log('TTS Template: Generated message:', message, 'Context:', { multipleWinners: context.multipleWinners, actualWinners: context.actualWinners });
    
    return message;
  }

  /**
   * Show enhanced notification with auction details
   */
  function showNotification(context) {
    if (!context) {
      log('No context available for notification');
      return;
    }
    
    // Final cleanup: Remove any leading bid amounts from item name before showing notification
    // This is a safety net in case the item name wasn't cleaned during extraction
    if (context.itemName) {
      let cleanedItemName = context.itemName.trim();
      // Pattern: starts with digits followed by space(s) or dash, then the actual item name
      const bidPrefixMatch = cleanedItemName.match(/^\d+[\s-]+(.+)$/);
      if (bidPrefixMatch) {
        cleanedItemName = bidPrefixMatch[1].trim();
        log(`Final cleanup: Removed bid amount prefix from item name in notification: "${context.itemName}" -> "${cleanedItemName}"`);
      } else {
        // Also try pattern without space (e.g., "10Dagger" -> "Dagger")
        const noSpaceMatch = cleanedItemName.match(/^\d+(.+)$/);
        if (noSpaceMatch && noSpaceMatch[1].length > 0) {
          cleanedItemName = noSpaceMatch[1].trim();
          log(`Final cleanup: Removed bid amount prefix (no space) from item name in notification: "${context.itemName}" -> "${cleanedItemName}"`);
        }
      }
      context.itemName = cleanedItemName; // Update context for consistency
    }
    
    // Create notification message based on context type
    let message = 'Auction Timer Complete!';
    let details = [];
    
    if (context.itemName) {
      details.push(`Item: ${context.itemName}`);
    }
    if (context.quantity && context.quantity > 1) {
      details.push(`Quantity: ${context.quantity}`);
    }
    
    // Handle different auction scenarios
    if (context.isRollOff && context.rollOffWinners && context.rollOffWinners.length > 1) {
      // Roll-off scenario (multiple people with same bid, especially 1000 cap)
      message = 'Roll-off Required!';
      details.push(`Bid Amount: ${context.rollOffBid || context.bidAmount}`);
      details.push(`Roll-off Participants: ${context.rollOffWinners.map(w => w.winner || w).join(', ')}`);
    } else if (context.quantity > 1 && context.rollOffWinners && context.rollOffWinners.length >= context.quantity) {
      // Multiple winners for multi-item auction
      message = 'Multiple Winners!';
      details.push(`Winners: ${context.rollOffWinners.slice(0, context.quantity).map(w => w.winner).join(', ')}`);
      details.push(`Bid Amount: ${context.bidAmount}`);
    } else if (context.winner) {
      // Single winner
      details.push(`Winner: ${context.winner}`);
      if (context.bidAmount) {
        details.push(`Bid: ${context.bidAmount}`);
      }
    }
    
    const fullMessage = details.length > 0 ? 
      `${message}\n${details.join('\n')}` : 
      message;
    
    log('Notification:', fullMessage);
    
    // Browser notification (if enabled and visuals not disabled)
    if (settings.BROWSER_NOTIFICATIONS && !settings.DISABLE_VISUALS) {
      // Use extension URL for icon (cross-browser compatible)
      let iconUrl = null;
      try {
        iconUrl = api.runtime.getURL('icons/icon-48.png');
      } catch (e) {
        // Extension context invalidated - extension was reloaded
        log('Extension context invalidated, cannot get icon URL:', e);
        // Continue without icon
      }
      
      try {
        if (Notification.permission === 'granted') {
          // Use unique tag to prevent Chrome from grouping/replacing notifications
          // Include timestamp to make each notification unique
          const uniqueTag = `opendkp-timer-${Date.now()}`;
          const notification = new Notification(message, {
            body: details.join('\n'),
            icon: iconUrl,
            tag: uniqueTag,
            requireInteraction: false, // Auto-dismiss after a few seconds
            silent: false // Allow system sound if user wants it
          });
          notification.onerror = (error) => {
            log('Notification error:', error);
          };
          notification.onshow = () => {
            log('Notification shown successfully');
          };
          log('Notification created:', { message, icon: iconUrl, tag: uniqueTag, permission: Notification.permission });
        } else if (Notification.permission !== 'denied') {
          // Request permission
          Notification.requestPermission().then(permission => {
            log('Notification permission result:', permission);
            if (permission === 'granted') {
              const uniqueTag = `opendkp-timer-${Date.now()}`;
              const notification = new Notification(message, {
                body: details.join('\n'),
                icon: iconUrl,
                tag: uniqueTag,
                requireInteraction: false,
                silent: false
              });
              notification.onerror = (error) => {
                log('Notification error:', error);
              };
              notification.onshow = () => {
                log('Notification shown successfully');
              };
              log('Notification created after permission grant:', { message, icon: iconUrl, tag: uniqueTag });
            }
          }).catch(error => {
            log('Error requesting notification permission:', error);
          });
        } else {
          log('Notification permission denied - cannot show notification');
        }
      } catch (error) {
        log('Error creating notification:', error);
      }
    }
    
    // Console notification (if enabled and visuals not disabled)
    if (!settings.DISABLE_VISUALS) {
      console.log('🔔 OpenDKP Helper:', fullMessage);
    }
    
    // Screen flash effect (if enabled and visuals not disabled)
    if (settings.FLASH_SCREEN && !settings.DISABLE_VISUALS) {
      flashScreen();
    }

    // Respect quiet hours for audio and TTS (but keep visuals)
    if (isQuietHours()) {
      log('Quiet hours active, skipping sound and TTS');
      return;
    }
    
    // Play notification sound and get duration
    const soundDuration = playChime();
    
    // Speak notification using TTS - wait for sound to finish plus buffer
    const ttsDelay = Math.max(soundDuration + 200, 500); // At least 500ms, or sound duration + 200ms buffer
    log('TTS will start after:', ttsDelay + 'ms (sound duration:', soundDuration + 'ms)');
    
    setTimeout(() => {
      speakNotification(context);
    }, ttsDelay);
  }
  
  /**
   * Flash screen effect
   */
  function flashScreen(color) {
    // Use a temporary overlay to avoid mutating page background styles
    try {
      console.log('[OpenDKP Helper] flashScreen called with color:', color || '#ff6b6b');
      // Clear any accidental inline background flash from previous logic
      try {
        document.body.style.backgroundColor = '';
        document.body.style.transition = '';
      } catch (_) {}

      const overlay = document.createElement('div');
      overlay.setAttribute('data-opendkp-flash', '');
      overlay.style.position = 'fixed';
      // Explicit sizing for widest compatibility
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      // And inset for modern browsers
      overlay.style.inset = '0';
      overlay.style.zIndex = '2147483647';
      overlay.style.background = color || '#ff6b6b';
      overlay.style.opacity = '0.9';
      overlay.style.pointerEvents = 'none';
      overlay.style.transition = 'opacity 200ms ease';
      console.log('[OpenDKP Helper] Flash overlay created, adding to DOM. Color:', overlay.style.background, 'zIndex:', overlay.style.zIndex);
      
      // Try appending to body first, fallback to documentElement if body isn't available
      const container = document.body || document.documentElement;
      if (!container) {
        console.error('[OpenDKP Helper] Cannot find container for flash overlay');
        return;
      }
      
      container.appendChild(overlay);
      console.log('[OpenDKP Helper] Flash overlay added to DOM, container children:', container.children.length);
      
      // Verify overlay is actually visible
      setTimeout(() => {
        const rect = overlay.getBoundingClientRect();
        console.log('[OpenDKP Helper] Flash overlay bounds:', rect.width, 'x', rect.height, 'at', rect.left, rect.top);
        if (rect.width === 0 || rect.height === 0) {
          console.warn('[OpenDKP Helper] Flash overlay has zero dimensions!');
        }
      }, 10);
      setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => {
          if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
            console.log('[OpenDKP Helper] Flash overlay removed from DOM');
          }
        }, 220);
      }, 20);
    } catch (e) {
      console.error('[OpenDKP Helper] flashScreen error:', e);
      console.error('[OpenDKP Helper] flashScreen error stack:', e.stack);
    }
  }

  /**
   * Track bid activity for smart bidding mode
   */
  function trackBidActivity() {
    // Listen for clicks on bid-related elements
    document.addEventListener('click', function(event) {
      const target = event.target;
      
      // Check if clicked element is bid-related
      if (target.matches('button[class*="bid"], button[id*="bid"], input[type="number"], input[name*="bid"], input[id*="bid"]') ||
          target.closest('button[class*="bid"], button[id*="bid"]')) {
        
        // Record bid activity timestamp
        sessionStorage.setItem('opendkp_bid_activity', Date.now().toString());
        log('Bid activity detected and recorded');
      }
    });
    
    // Listen for form submissions that might be bids
    document.addEventListener('submit', function(event) {
      const form = event.target;
      if (form.querySelector('input[name*="bid"], input[id*="bid"], button[class*="bid"]')) {
        sessionStorage.setItem('opendkp_bid_activity', Date.now().toString());
        log('Bid form submission detected and recorded');
      }
    });
  }

  /**
   * Setup raid leader tab close confirmation
   */
  function setupRaidLeaderNotification() {
    // Only setup if in raid leader mode and notification is enabled
    if (settings.SOUND_PROFILE !== 'raidleader' || !settings.RAID_LEADER_NOTIFICATION) {
      log('Not in raid leader mode or notification disabled, skipping raid leader reminder');
      return;
    }
    
    log('Setting up raid leader notification reminder');
    
    // Show browser notification reminder
    showRaidLeaderReminder();
    
    log('Raid leader notification reminder setup complete');
  }
  
  function showRaidLeaderReminder() {
    // Request notification permission if not already granted
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          showRaidLeaderNotification();
        } else {
          log('Notification permission denied, cannot show raid leader reminder');
        }
      });
    } else if (Notification.permission === 'granted') {
      showRaidLeaderNotification();
    } else {
      log('Notification permission denied, cannot show raid leader reminder');
    }
  }
  
  function showRaidLeaderNotification() {
    // Create browser notification with custom message
    let iconUrl = null;
    try {
      iconUrl = api.runtime.getURL('icons/icon-48.png');
    } catch (e) {
      log('Extension context invalidated, cannot get icon URL:', e);
      // Continue without icon
    }
    const notification = new Notification('Raid Leader Mode Active', {
      body: 'Remember to upload raid logs!',
      icon: iconUrl,
      tag: 'raid-leader-reminder', // Prevents multiple notifications
      requireInteraction: false, // Auto-dismiss after a few seconds
      silent: true // Don't play sound (we have our own sounds)
    });
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      notification.close();
    }, 5000);
    
    // Handle notification click
    notification.onclick = function() {
      notification.close();
      window.focus(); // Focus the window
    };
    
    log('Raid leader reminder notification shown');
  }

  // ===========================================================================
  // STARTUP
  // ===========================================================================
  
  // Run initialization when DOM is ready
  console.log('Content script loaded, document ready state:', document.readyState);
  if (document.readyState === 'loading') {
    console.log('DOM still loading, waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    console.log('DOM already loaded, initializing immediately');
    initialize();
  }
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanup);

})();
