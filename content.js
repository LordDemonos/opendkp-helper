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
    BIDDING_TOOL_RAID_LOCK: true,
    // Auction readout defaults (Issue #2: day-of-week filter)
    ANNOUNCE_NEW_AUCTIONS: false,
    ANNOUNCE_START: '19:00',
    ANNOUNCE_END: '23:59',
    ANNOUNCE_NEW_AUCTIONS_DAYS: [0, 1, 2, 3, 4, 5, 6], // 0=Sun .. 6=Sat; all days by default
    WATCHLIST_ALARM_ENABLED: false,
    WATCHLIST_ITEMS: ''
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
  let autoBidIntervalId = null;
  let autoBidCurrentPollSec = null;
  let autoBidUrgentMode = false;
  const AUTO_BID_URGENT_POLL_SEC = 2;
  let rankBidLimitsSyncIntervalId = null;
  let rankBidLimitsObserver = null;
  let rankBidLimitsDebounceTimer = null;
  
  // Audio element for playing chime
  let audioElement = null;
  // Flag: have settings been loaded from storage at least once?
  let settingsLoaded = false;
  // Reusable AudioContext for beep fallback (prevents rapid beeps)
  let beepAudioContext = null;
  
  // Track if audio has been unlocked (required for Chrome autoplay policy)
  let audioUnlocked = false;
  // One-time hint banner element (click to enable sounds) - removed on first interaction
  let audioUnlockHintEl = null;

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
      const todayDay = new Date().getDay();
      const allowedDays = Array.isArray(settings.ANNOUNCE_NEW_AUCTIONS_DAYS) ? settings.ANNOUNCE_NEW_AUCTIONS_DAYS : CONFIG.ANNOUNCE_NEW_AUCTIONS_DAYS;
      const dayOk = allowedDays.includes(todayDay);
      {
        const ctxPeek = extractTableContext(timerElement) || extractTimerContext(timerElement) || {};
        log('ReadAuctions: maybeAnnounce called', {
          settingsLoaded,
          ENABLE_TTS: settings.ENABLE_TTS,
          ANNOUNCE_NEW_AUCTIONS: settings.ANNOUNCE_NEW_AUCTIONS,
          windowOk,
          quiet,
          dayOk,
          todayDay,
          allowedDays,
          peekItem: ctxPeek.itemName || null
        });
      }
      {
        log('ReadAuctions check (observer):', {
          ttsEnabled: settings.ENABLE_TTS,
          featureEnabled: settings.ANNOUNCE_NEW_AUCTIONS,
          windowOk: windowOk,
          quietHours: quiet,
          dayOk
        });
      }
      const featureEnabled = (settings.ANNOUNCE_NEW_AUCTIONS === true) ||
                             (settings.ANNOUNCE_NEW_AUCTIONS === undefined && settings.ENABLE_TTS);
      if (settingsLoaded && settings.ENABLE_TTS && featureEnabled && !quiet && windowOk && dayOk) {
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
          quiet,
          dayOk
        });
      }
    } catch (_) {}
  }

  const WATCHLIST_ALARM_MS = 5000;
  const WATCHLIST_FLASH_COUNT = 5;
  const watchlistAlertedTimers = new WeakSet();
  let watchlistAlarmAudio = null;
  let watchlistTtsTimerIds = [];
  let watchlistFlashTimerIds = [];

  function parseWatchlistItems(raw) {
    if (!raw || typeof raw !== 'string') return [];
    return raw.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
  }

  function normalizeWatchlistName(name) {
    return String(name || '').toLowerCase().trim();
  }

  function itemMatchesWatchlist(itemName, watchlist) {
    const normalized = normalizeWatchlistName(itemName);
    if (!normalized || !watchlist.length) return false;
    return watchlist.some(function(entry) {
      const needle = normalizeWatchlistName(entry);
      if (!needle) return false;
      return normalized.includes(needle) || needle.includes(normalized);
    });
  }

  function stopWatchlistAlarmEffects() {
    if (watchlistAlarmAudio) {
      watchlistAlarmAudio.pause();
      watchlistAlarmAudio.currentTime = 0;
      watchlistAlarmAudio = null;
    }
    watchlistTtsTimerIds.forEach(function(id) { clearTimeout(id); });
    watchlistTtsTimerIds = [];
    watchlistFlashTimerIds.forEach(function(id) { clearTimeout(id); });
    watchlistFlashTimerIds = [];
    document.querySelectorAll('[data-opendkp-watchlist-flash]').forEach(function(el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function configureWatchlistUtterance(utterance) {
    if (settings.VOICE) {
      const voices = speechSynthesis.getVoices();
      const selected = voices.find(function(v) {
        return v.name.toLowerCase() === settings.VOICE.toLowerCase();
      });
      if (selected) utterance.voice = selected;
    }
    const isFirefox = typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox');
    const maxRate = isFirefox ? 2.5 : 2.0;
    utterance.rate = Math.min(settings.VOICE_SPEED || 1.0, maxRate);
    utterance.volume = Math.max(0, Math.min(1, settings.VOLUME !== undefined ? settings.VOLUME : 0.7));
  }

  function speakWatchlistItemOnce(itemName) {
    if (!itemName || typeof speechSynthesis === 'undefined') return;
    const utterance = new SpeechSynthesisUtterance(itemName);
    configureWatchlistUtterance(utterance);
    speechSynthesis.speak(utterance);
  }

  function speakWatchlistItemRepeated(itemName) {
    if (!itemName || typeof speechSynthesis === 'undefined') return;
    try { speechSynthesis.cancel(); } catch (_) {}

    for (let i = 0; i < WATCHLIST_FLASH_COUNT; i++) {
      const timerId = setTimeout(function() {
        speakWatchlistItemOnce(itemName);
      }, i * 1000);
      watchlistTtsTimerIds.push(timerId);
    }
    log('Watchlist alarm: repeating TTS for', itemName, 'every second for', WATCHLIST_ALARM_MS + 'ms');
  }

  function playWatchlistAlarmSound() {
    try {
      let audioUrl;
      try {
        audioUrl = api.runtime.getURL('alarm.mp3');
      } catch (e) {
        log('Extension context invalidated, cannot play watchlist alarm:', e);
        playBeepFallback();
        return;
      }
      const audio = new Audio(audioUrl);
      const volume = settings.VOLUME !== undefined ? settings.VOLUME : 0.7;
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.loop = true;
      watchlistAlarmAudio = audio;
      playAudioWithUnlock(audio, function() {
        log('Failed to play watchlist alarm, using beep fallback');
        playBeepFallback();
      });
      const stopId = setTimeout(function() {
        if (watchlistAlarmAudio === audio) {
          audio.pause();
          audio.currentTime = 0;
          watchlistAlarmAudio = null;
        }
      }, WATCHLIST_ALARM_MS);
      watchlistTtsTimerIds.push(stopId);
      log('Playing watchlist alarm for', WATCHLIST_ALARM_MS + 'ms');
    } catch (error) {
      log('Error playing watchlist alarm:', error);
      playBeepFallback();
    }
  }

  function flashWatchlistAlarm() {
    try {
      const overlay = document.createElement('div');
      overlay.setAttribute('data-opendkp-watchlist-flash', '');
      overlay.style.position = 'fixed';
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      overlay.style.inset = '0';
      overlay.style.zIndex = '2147483647';
      overlay.style.background = '#dc2626';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      overlay.style.transition = 'opacity 120ms ease';

      const container = document.body || document.documentElement;
      if (!container) return;
      container.appendChild(overlay);

      for (let i = 0; i < WATCHLIST_FLASH_COUNT; i++) {
        const onId = setTimeout(function() {
          overlay.style.opacity = '0.9';
          const offId = setTimeout(function() {
            overlay.style.opacity = '0';
          }, 450);
          watchlistFlashTimerIds.push(offId);
        }, i * 1000);
        watchlistFlashTimerIds.push(onId);
      }

      const removeId = setTimeout(function() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, WATCHLIST_ALARM_MS + 200);
      watchlistFlashTimerIds.push(removeId);

      log('Watchlist alarm: flashing red once per second for', WATCHLIST_ALARM_MS + 'ms');
    } catch (e) {
      log('flashWatchlistAlarm error:', e);
    }
  }

  function triggerWatchlistAlarm(itemName) {
    log('Watchlist alarm triggered for:', itemName);
    stopWatchlistAlarmEffects();
    playWatchlistAlarmSound();
    flashWatchlistAlarm();
    speakWatchlistItemRepeated(itemName);

    if (settings.BROWSER_NOTIFICATIONS && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('OpenDKP Watchlist Alert!', {
          body: itemName + ' is now up for bid!',
          icon: api.runtime.getURL('icons/icon-128.png')
        });
      } catch (_) {}
    }
  }

  function maybeTriggerWatchlistAlarm(timerElement) {
    try {
      if (!settingsLoaded || !settings.WATCHLIST_ALARM_ENABLED) return;

      const watchlist = parseWatchlistItems(settings.WATCHLIST_ITEMS);
      if (!watchlist.length) return;

      if (watchlistAlertedTimers.has(timerElement)) return;

      const initialWidth = getWidthPercent(timerElement);
      if (initialWidth !== null && initialWidth < 50) return;
      if (initialWidth !== null && initialWidth <= 0) return;

      watchlistAlertedTimers.add(timerElement);

      const tryMatch = function(attemptsLeft) {
        const ctx = extractTableContext(timerElement) || extractTimerContext(timerElement);
        const name = ctx && ctx.itemName && String(ctx.itemName).trim();
        if (name && itemMatchesWatchlist(name, watchlist)) {
          triggerWatchlistAlarm(name);
        } else if (attemptsLeft > 0 && !name) {
          setTimeout(function() { tryMatch(attemptsLeft - 1); }, 200);
        }
      };
      tryMatch(15);
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

  /** @type {Array<Record<string, unknown>>} */
  const completionAnnounceQueue = [];
  let completionAnnounceProcessing = false;
  const COMPLETION_ANNOUNCE_GAP_MS = 450;

  function buildCompletionSignature(ctx) {
    const item = (ctx?.itemName || '').toLowerCase().trim();
    if (ctx && ctx.isRollOff) {
      const bid = ctx.rollOffBid || ctx.bidAmount || 0;
      const parts = (ctx.rollOffWinners || [])
        .map(function (w) {
          return String((w && w.winner) || w || '')
            .toLowerCase()
            .trim();
        })
        .filter(Boolean)
        .sort()
        .join(',');
      return 'rolloff|' + item + '|' + bid + '|' + parts;
    }
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
  let bidParticipationIntervalId = null;
  const BID_PARTICIPATION_POLL_MS = 5000;

  // ===========================================================================
  // AUDIO NOTIFICATION SYSTEM
  // ===========================================================================
  
  /**
   * Poll background auto-bid engine while on OpenDKP (requires open tab).
   * Speeds up to every 2s when a matching auction has ≤30s remaining.
   */
  function setupAutoBidPolling() {
    autoBidUrgentMode = false;
    autoBidCurrentPollSec = null;
    if (autoBidIntervalId) {
      clearInterval(autoBidIntervalId);
      autoBidIntervalId = null;
    }
    if (!settings.AUTO_BID_ENABLED) return;
    scheduleAutoBidPoll(settings.AUTO_BID_POLL_SEC || 15);
  }

  function setupBidParticipationPolling() {
    if (bidParticipationIntervalId) {
      clearInterval(bidParticipationIntervalId);
      bidParticipationIntervalId = null;
    }
    if (settings.ITEM_PRICE_HISTORY_ENABLED === false) return;
    scanAndWriteBidParticipation();
    bidParticipationIntervalId = setInterval(scanAndWriteBidParticipation, BID_PARTICIPATION_POLL_MS);
  }

  function clientSlugFromHostname() {
    try {
      if (typeof OpenDkpRankBidLimits !== 'undefined' && OpenDkpRankBidLimits.clientSlugFromHostname) {
        return OpenDkpRankBidLimits.clientSlugFromHostname(window.location.hostname) || '';
      }
    } catch (_) {}
    var host = String(window.location.hostname || '').toLowerCase();
    var m = host.match(/^([a-z0-9-]+)\.opendkp\.com$/i);
    return m ? m[1] : '';
  }

  function loadCachedCharacterNames() {
    return new Promise(function (resolve) {
      try {
        api.storage.local.get(['autoBidCharactersCache'], function (r) {
          var names = [];
          var cache = r && r.autoBidCharactersCache;
          if (cache && Array.isArray(cache.characters)) {
            cache.characters.forEach(function (c) {
              if (c && c.name) names.push(String(c.name).trim());
            });
          }
          resolve(names);
        });
      } catch (_) {
        resolve([]);
      }
    });
  }

  function isParticipatingCharacter(name, nameSet) {
    if (!name) return false;
    var lower = String(name).toLowerCase();
    return nameSet.some(function (n) {
      return String(n).toLowerCase() === lower;
    });
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Bidding Tool headers often include "Winner - Bid ItemName".
   * Strip character / bid prefixes so history lookup uses the real item name.
   */
  function sanitizeAuctionItemName(raw, characterNames) {
    var name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!name) return '';
    name = name.replace(/\s*x\s*\d+\s*$/i, '').trim();

    (characterNames || []).forEach(function (charName) {
      var c = String(charName || '').trim();
      if (!c || c.length < 2) return;
      var re = new RegExp('^' + escapeRegExp(c) + '\\s*-\\s*', 'i');
      if (re.test(name)) {
        name = name.replace(re, '').trim();
      }
    });

    // "Someone - 10 Zlandicar's Heart" → "Zlandicar's Heart"
    var afterBid = name.match(/^.+?\s*-\s*\d+\s+(.+)$/);
    if (afterBid && afterBid[1]) {
      name = afterBid[1].trim();
    }

    // "10 Zlandicar's Heart" / "10-Zlandicar's Heart"
    var bidPrefix = name.match(/^\d+[\s-]+(.+)$/);
    if (bidPrefix && bidPrefix[1]) {
      name = bidPrefix[1].trim();
    }

    return name;
  }

  function extractItemNameFromAuctionHeader(container) {
    if (!container) return '';
    // Prefer Magelo / item links — their text is the clean item name
    var link = container.querySelector('a[href*="/items/"], a[rel*="eq:item"], a[rel^="eq:item"]');
    if (link && link.textContent) {
      return String(link.textContent || '').replace(/\s+/g, ' ').trim();
    }
    var text = (container.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    text = text.replace(/\s*x\s*\d+\s*$/i, '').trim();
    var lines = text.split(/\s{2,}|\n/).map(function (l) {
      return l.trim();
    }).filter(Boolean);
    return lines[0] || text.slice(0, 120);
  }

  function resolveCleanItemName(header, tabPanel, characterNames) {
    var scopes = [header, tabPanel].filter(Boolean);
    for (var i = 0; i < scopes.length; i++) {
      var link = scopes[i].querySelector(
        'a[href*="/items/"], a[rel*="eq:item"], a[rel^="eq:item"]'
      );
      if (link && link.textContent && String(link.textContent).trim()) {
        return sanitizeAuctionItemName(String(link.textContent).trim(), characterNames);
      }
    }
    return sanitizeAuctionItemName(extractItemNameFromAuctionHeader(header), characterNames);
  }

  /**
   * Scan active Bidding Tool bid tables for the user's characters.
   */
  function scanAndWriteBidParticipation() {
    if (typeof BidParticipation === 'undefined' || !BidParticipation.writeParticipation) return;
    if (settings.ITEM_PRICE_HISTORY_ENABLED === false) return;

    extractUserCharacterNames();
    loadCachedCharacterNames().then(function (cachedNames) {
      var nameSet = [];
      var seen = {};
      userCharacterNames.concat(cachedNames).forEach(function (n) {
        var key = String(n || '').toLowerCase();
        if (!key || seen[key]) return;
        seen[key] = true;
        nameSet.push(n);
      });
      if (!nameSet.length) return;

      var items = [];
      var headers = document.querySelectorAll(
        '[id*="header_action"], .p-tabview-nav-link, a[role="tab"]'
      );
      var seenItems = {};

      headers.forEach(function (header) {
        var tabPanel = resolveTabPanelForAuction(header);
        var itemName = resolveCleanItemName(header, tabPanel, nameSet);
        if (!itemName || itemName.length < 2) return;
        // Skip chrome / nav labels
        if (/^(bidding|auctions|results|details|raid|summary)$/i.test(itemName)) return;

        var table =
          (tabPanel && tabPanel.querySelector('table.p-datatable-table, table')) ||
          findBidsTableForItem(itemName);

        var mine = [];
        if (table) {
          var rows = extractWinnersFromBidsTable(table, null);
          mine = rows.filter(function (row) {
            return isParticipatingCharacter(row.winner, nameSet);
          });
        }

        // Fallback: auction card shows "Xanax - 20" above the item — treat as participation
        if (!mine.length) {
          var headerText = ((header && header.textContent) || '').replace(/\s+/g, ' ').trim();
          var panelText = ((tabPanel && tabPanel.textContent) || '').slice(0, 400).replace(/\s+/g, ' ');
          var blob = headerText + ' ' + panelText;
          nameSet.forEach(function (charName) {
            if (!charName) return;
            var re = new RegExp(
              '(?:^|\\s)' + escapeRegExp(charName) + '\\s*-\\s*(\\d+)\\b',
              'i'
            );
            var m = blob.match(re);
            if (m) {
              mine.push({ winner: charName, bid: parseInt(m[1], 10) });
            }
          });
        }

        if (!mine.length) return;

        var key = itemName.toLowerCase();
        if (seenItems[key]) return;
        seenItems[key] = true;

        var best = mine[0];
        mine.forEach(function (row) {
          if ((row.bid || 0) > (best.bid || 0)) best = row;
        });

        items.push({
          itemName: itemName,
          characterName: best.winner,
          myHighBid: best.bid != null && !Number.isNaN(best.bid) ? best.bid : undefined,
          source: 'manual-dom'
        });
      });

      BidParticipation.writeParticipation({
        clientSlug: clientSlugFromHostname(),
        items: items,
        replaceSource: 'manual-dom'
      }).catch(function (e) {
        log('Bid participation write failed:', e);
      });
    });
  }

  function scheduleAutoBidPoll(pollSec) {
    if (autoBidIntervalId) {
      clearInterval(autoBidIntervalId);
      autoBidIntervalId = null;
    }
    var sec = pollSec > 0 ? pollSec : 15;
    autoBidCurrentPollSec = sec;
    var ms = sec * 1000;
    autoBidIntervalId = setInterval(runAutoBidPollTick, ms);
    log('Auto-bid polling every', ms + 'ms' + (autoBidUrgentMode ? ' (urgent)' : ''));
  }

  function applyAutoBidPollMode(urgent) {
    if (!settings.AUTO_BID_ENABLED) return;
    var nextSec = urgent ? AUTO_BID_URGENT_POLL_SEC : (settings.AUTO_BID_POLL_SEC || 15);
    if (urgent === autoBidUrgentMode && nextSec === autoBidCurrentPollSec) return;
    autoBidUrgentMode = !!urgent;
    scheduleAutoBidPoll(nextSec);
  }

  function runAutoBidPollTick() {
    try {
      api.runtime.sendMessage({ type: 'autoBidRun' }, function (resp) {
        if (api.runtime.lastError) return;
        if (resp && resp.results && resp.results.length) {
          log('Auto-bid:', resp.results);
        }
        applyAutoBidPollMode(resp && resp.urgentPoll === true);
      });
    } catch (e) {
      log('Auto-bid poll error:', e);
    }
  }

  /**
   * Scrape Bid Rules from the OpenDKP Bidding Tool and merge rank min/max into local cache.
   * Bid Rules only show the currently selected rank, so each selection is merged in.
   */
  function syncRankBidLimitsFromPage() {
    try {
      if (typeof OpenDkpRankBidLimits === 'undefined') return;
      var slug = OpenDkpRankBidLimits.clientSlugFromHostname(window.location.hostname);
      if (!slug) return;
      var ranks = OpenDkpRankBidLimits.parseFromDocument(document);
      if (!ranks || !Object.keys(ranks).length) return;
      OpenDkpRankBidLimits.saveForSlug(slug, ranks).then(function () {
        log('Synced rank bid limits for', slug, Object.keys(ranks).join(', '));
      }).catch(function (e) {
        log('Rank bid limits save failed:', e);
      });
    } catch (e) {
      log('Rank bid limits sync failed:', e);
    }
  }

  function scheduleRankBidLimitsSync() {
    if (rankBidLimitsDebounceTimer) clearTimeout(rankBidLimitsDebounceTimer);
    rankBidLimitsDebounceTimer = setTimeout(function () {
      rankBidLimitsDebounceTimer = null;
      syncRankBidLimitsFromPage();
    }, 400);
  }

  function setupRankBidLimitsSync() {
    syncRankBidLimitsFromPage();
    if (rankBidLimitsSyncIntervalId) {
      clearInterval(rankBidLimitsSyncIntervalId);
    }
    // Backup poll — Bid Rules often appear only after character/rank selection on Bidding Tool
    rankBidLimitsSyncIntervalId = setInterval(syncRankBidLimitsFromPage, 15000);
    if (!rankBidLimitsObserver && document.body) {
      try {
        rankBidLimitsObserver = new MutationObserver(function () {
          scheduleRankBidLimitsSync();
        });
        rankBidLimitsObserver.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        });
      } catch (e) {
        log('Rank bid limits observer failed:', e);
      }
    }
  }

  /**
   * Load settings from storage
   */
  function loadSettings() {
    api.storage.sync.get({
      volume: 70,
      soundProfile: 'raidleader', // Default to raid leader
      soundType: 'bell', // Default to bell for raid leader
      // Canonical keys written by options; plural aliases kept for older backups
      raidleaderSound: 'bell',
      raiderSound: 'chime',
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
      watchlistAlarmEnabled: false,
      watchlistItems: '',
      autoBidEnabled: false,
      autoBidIncrement: 10,
      autoBidPollIntervalSec: 15,
      autoBidPriority: 1,
      autoBidRules: [],
      itemPriceHistoryEnabled: true,
      enableTTS: false,
      voice: '',
      voiceSpeed: 1.0,
      enableAdvancedTTS: false,
      ttsTemplate: 'Auction Finished. {winner} for {bidAmount} DKP on {itemName}',
      disableVisuals: false,
      flashScreen: true,
      browserNotifications: true,
      consoleLogs: true,
      checkInterval: 100,
      opendkpBiddingToolRaidLock: true
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
        CHECK_INTERVAL: CONFIG.CHECK_INTERVAL,
        FLASH_SCREEN: storedSettings.flashScreen !== undefined ? storedSettings.flashScreen : CONFIG.FLASH_SCREEN,
        VOLUME: (storedSettings.volume !== undefined && storedSettings.volume !== null ? storedSettings.volume : 70) / 100,
        SOUND_TYPE: storedSettings.soundType || CONFIG.SOUND_TYPE,
        SOUND_PROFILE: storedSettings.soundProfile || CONFIG.SOUND_PROFILE,
        RAID_LEADER_SOUNDS: storedSettings.raidleaderSound
          || storedSettings.raidLeaderSounds
          || 'bell',
        RAIDER_SOUNDS: storedSettings.raiderSound
          || storedSettings.raiderSounds
          || 'chime',
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
      // Auction readout (Issue #2: day-of-week for Read New Auctions)
      settings.ANNOUNCE_NEW_AUCTIONS = storedSettings.announceAuctions !== undefined ? storedSettings.announceAuctions : CONFIG.ANNOUNCE_NEW_AUCTIONS;
      settings.ANNOUNCE_START = storedSettings.announceStart || CONFIG.ANNOUNCE_START;
      settings.ANNOUNCE_END = storedSettings.announceEnd || CONFIG.ANNOUNCE_END;
      const rawDays = storedSettings.announceNewAuctionsDays;
      settings.ANNOUNCE_NEW_AUCTIONS_DAYS = Array.isArray(rawDays) && rawDays.length > 0
        ? rawDays.filter(d => typeof d === 'number' && d >= 0 && d <= 6)
        : CONFIG.ANNOUNCE_NEW_AUCTIONS_DAYS;
      settings.WATCHLIST_ALARM_ENABLED = storedSettings.watchlistAlarmEnabled === true;
      settings.WATCHLIST_ITEMS = typeof storedSettings.watchlistItems === 'string'
        ? storedSettings.watchlistItems
        : CONFIG.WATCHLIST_ITEMS;
      settings.BIDDING_TOOL_RAID_LOCK =
        storedSettings.opendkpBiddingToolRaidLock !== false;
      settings.AUTO_BID_ENABLED = storedSettings.autoBidEnabled === true;
      var pollSec = parseInt(String(storedSettings.autoBidPollIntervalSec != null ? storedSettings.autoBidPollIntervalSec : 15), 10);
      settings.AUTO_BID_POLL_SEC = Number.isNaN(pollSec) || pollSec < 5 ? 15 : pollSec;
      settings.ITEM_PRICE_HISTORY_ENABLED = storedSettings.itemPriceHistoryEnabled !== false;
      
      setupAutoBidPolling();
      setupBidParticipationPolling();
      setupRankBidLimitsSync();
      
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
      if (typeof BiddingToolRaid !== 'undefined' && BiddingToolRaid.reconfigure) {
        BiddingToolRaid.reconfigure();
      }
      settingsLoaded = true;
    }).catch(function(error) {
      log('Error loading settings:', error);
      // Use default settings if storage fails
      settings = { ...CONFIG };
    });
  }
  
  /**
   * Remove the "click to enable sounds" hint banner if it exists
   */
  function removeAudioUnlockHint() {
    if (audioUnlockHintEl && audioUnlockHintEl.parentNode) {
      audioUnlockHintEl.parentNode.removeChild(audioUnlockHintEl);
      audioUnlockHintEl = null;
    }
  }

  /**
   * Show a one-time hint asking the user to click to enable sounds (Chrome autoplay policy).
   * Hint is removed on first user interaction or after 8 seconds.
   */
  function showAudioUnlockHint() {
    if (audioUnlocked || audioUnlockHintEl || (settings.DISABLE_VISUALS === true)) return;
    try {
      const container = document.body || document.documentElement;
      if (!container) return;
      const hint = document.createElement('div');
      hint.setAttribute('data-opendkp-audio-hint', '');
      hint.textContent = 'Click anywhere on this page to enable auction sounds and alerts';
      hint.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);max-width:90%;padding:10px 16px;background:#1a1a2e;color:#eaeaea;font-size:13px;font-family:system-ui,sans-serif;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:2147483646;pointer-events:none;transition:opacity 0.3s ease;';
      container.appendChild(hint);
      audioUnlockHintEl = hint;
      setTimeout(function autoRemoveHint() {
        if (audioUnlockHintEl === hint && hint.parentNode) {
          hint.style.opacity = '0';
          setTimeout(function remove() {
            if (hint.parentNode) hint.parentNode.removeChild(hint);
            if (audioUnlockHintEl === hint) audioUnlockHintEl = null;
          }, 320);
        }
      }, 8000);
    } catch (e) {
      log('Could not show audio unlock hint:', e);
    }
  }

  /**
   * Unlock audio by playing a silent sound on first user interaction
   * This is required for Chrome's autoplay policy - audio must be unlocked
   * by a user gesture before programmatic audio can play
   */
  function unlockAudio() {
    if (audioUnlocked) return;
    
    try {
      // Create a silent audio buffer and play it to unlock audio
      if (!beepAudioContext || beepAudioContext.state === 'closed') {
        beepAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // Resume AudioContext if suspended
      if (beepAudioContext.state === 'suspended') {
        beepAudioContext.resume().then(() => {
          // Create a very short silent buffer
          const buffer = beepAudioContext.createBuffer(1, 1, 22050);
          const source = beepAudioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(beepAudioContext.destination);
          source.start(0);
          source.stop(0.001);
          
          audioUnlocked = true;
          log('✅ Audio unlocked successfully - programmatic audio playback is now enabled');
          console.log('%c🔊 Audio Unlocked', 'color: green; font-weight: bold; font-size: 14px;', 
            'Audio playback has been enabled. Auction alerts will now play sounds.');
        }).catch(err => {
          log('Failed to unlock audio context:', err);
        });
      } else {
        // AudioContext already active, just mark as unlocked
        audioUnlocked = true;
        log('✅ Audio already active, marked as unlocked - programmatic audio playback is enabled');
      }
      
      // Also unlock HTML Audio by playing a silent audio element
      try {
        const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
        silentAudio.volume = 0;
        silentAudio.play().then(() => {
          log('HTML Audio unlocked successfully');
        }).catch(() => {
          // Ignore errors - Web Audio API unlock is more important
        });
      } catch (e) {
        // Ignore errors
      }
    } catch (error) {
      log('Error unlocking audio:', error);
    }
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
    
    // Set up audio unlock on first user interaction
    // Chrome requires user interaction before programmatic audio can play
    const unlockEvents = ['click', 'mousedown', 'touchstart', 'keydown'];
    const unlockHandler = () => {
      unlockAudio();
      removeAudioUnlockHint();
      // Remove listeners after first unlock to avoid unnecessary calls
      unlockEvents.forEach(event => {
        document.removeEventListener(event, unlockHandler, true);
      });
    };
    
    unlockEvents.forEach(event => {
      document.addEventListener(event, unlockHandler, true);
    });
    
    // Show a short hint so users know to click to enable sounds (Chrome/Firefox autoplay policy)
    setTimeout(showAudioUnlockHint, 1500);
    
    log('Audio unlock listeners registered for:', unlockEvents);
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

    // Prefer the sound saved for the active profile so popup/mode toggles apply.
    if (settings.SOUND_PROFILE === 'raidleader') {
      const sound = settings.RAID_LEADER_SOUNDS || settings.SOUND_TYPE || CONFIG.SOUND_TYPE;
      log('Using raid leader profile sound:', sound);
      return sound;
    }

    if (settings.SOUND_PROFILE === 'raider') {
      const sound = settings.RAIDER_SOUNDS || settings.SOUND_TYPE || CONFIG.SOUND_TYPE;
      log('Using raider profile sound:', sound);
      return sound;
    }

    const fallback = settings.SOUND_TYPE || CONFIG.SOUND_TYPE;
    log('Using fallback sound:', fallback);
    return fallback;
  }
  
  /**
   * Helper function to play audio with autoplay policy handling
   * Attempts to unlock audio if blocked by Chrome's autoplay policy
   */
  function playAudioWithUnlock(audio, errorCallback) {
    audio.play().then(() => {
      // Audio played successfully - no need to log here as callers log their own messages
    }).catch(err => {
      log('Error playing audio:', err.name, err.message);
      // If audio failed due to autoplay policy, try to unlock and retry once
      if (!audioUnlocked && (err.name === 'NotAllowedError' || err.message.includes('play'))) {
        log('Audio blocked by autoplay policy, attempting unlock...');
        unlockAudio();
        // Retry after a short delay
        setTimeout(() => {
          audio.play().catch(() => {
            log('Retry failed after unlock attempt');
            if (errorCallback) errorCallback();
          });
        }, 100);
      } else {
        if (errorCallback) errorCallback();
      }
    });
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
            playAudioWithUnlock(audio, playBeepFallback);
            audio.onended = () => URL.revokeObjectURL(url);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
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
                playAudioWithUnlock(audio, playBeepFallback);
                audio.onended = () => URL.revokeObjectURL(url);
                setTimeout(() => URL.revokeObjectURL(url), 10000);
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
            playAudioWithUnlock(audio, playBeepFallback);
            audio.onended = () => URL.revokeObjectURL(url);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
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
      playAudioWithUnlock(audio, playBeepFallback);
      audio.onended = () => URL.revokeObjectURL(url);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
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
      
      playAudioWithUnlock(audio, () => {
        log('Failed to play Warcraft sound:', filename);
        playBeepFallback();
      });
      
      log('Attempting to play Warcraft sound:', filename, 'at volume:', audio.volume);
      
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
      } else {
        context = finalizeAuctionContext(context, timerElement);
      }
      
      if (!context || !context.itemName) {
        log('No context extracted, suppressing alert');
        alertedTimers.add(timerElement);
        return false;
      }
      
      // Suppress duplicates across DOM reloads using a completion signature.
      // Same item/winner/bid within the window = same auction end (timer nodes often recreate).
      const sig = buildCompletionSignature(context);
      if (isRecentlyCompleted(sig)) {
        log('Completion duplicate suppressed (signature recently seen):', sig);
        alertedTimers.add(timerElement);
        return false;
      }
      
      // Mark as alerted IMMEDIATELY to prevent rapid duplicate calls
      alertedTimers.add(timerElement);
      
      // Apply bidding rules
      if (shouldAlert(context)) {
        log('🚨 ALERTING! Playing chime and showing notification');
        log('Alert context:', { item: context.itemName, winner: context.winner, bid: context.bidAmount, sig });
        
        maybeDisableAutoBidRulesOnWin(context);
        // Show enhanced notification with context (queued sound + TTS)
        enqueueCompletionAnnouncement(context);
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
      utterance.volume = Math.max(0, Math.min(1, settings.VOLUME)); // Issue #6: respect volume
      speechSynthesis.speak(utterance);
      log('TTS: New auction:', itemName, 'volume:', utterance.volume);
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
        maybeTriggerWatchlistAlarm(timer);
        
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
            maybeTriggerWatchlistAlarm(timer);
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

          if (typeof BiddingToolRaid !== 'undefined' && BiddingToolRaid.init) {
            BiddingToolRaid.init({
              getSettings: function () { return settings; },
              log: log
            });
          }
    
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
      setupAutoBidPolling();
      setupBidParticipationPolling();
      setupRankBidLimitsSync();
      
      // Update audio volume
      if (audioElement) {
        audioElement.volume = settings.VOLUME;
      }
      
      // Re-extract character names in case user switched characters
      extractUserCharacterNames();

      if (typeof BiddingToolRaid !== 'undefined' && BiddingToolRaid.reconfigure) {
        BiddingToolRaid.reconfigure();
      }
      
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
    } else if (message.action === 'testWatchlistAlarm') {
      const itemName = message.itemName && String(message.itemName).trim();
      if (itemName) {
        triggerWatchlistAlarm(itemName);
      }
      if (sendResponse) {
        sendResponse({ success: true });
      }
      return false;
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
      let context = {
        itemName: 'Epic Sword',
        quantity: 1,
        bidAmount: 1000
      };
      context = applyWinnersToContext(
        context,
        [
          { winner: 'Player1', bid: 1000 },
          { winner: 'Player2', bid: 1000 },
          { winner: 'Player3', bid: 1000 }
        ],
        1000,
        1,
        1000
      );
      showNotification(context);
    },
    testMultiWinner: () => {
      let context = {
        itemName: 'Rare Potion',
        quantity: 2,
        bidAmount: 500
      };
      context = applyWinnersToContext(
        context,
        [
          { winner: 'Player1', bid: 500 },
          { winner: 'Player2', bid: 500 }
        ],
        500,
        2,
        500
      );
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

  function getTableColumnIndex(table, headerPattern) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr:has(th)');
    if (!headerRow) return -1;
    const headers = headerRow.querySelectorAll('th, td');
    for (let i = 0; i < headers.length; i++) {
      if (headerPattern.test(headers[i].textContent.trim())) return i;
    }
    return -1;
  }

  function normalizeBidValue(raw) {
    if (raw == null || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Parse "Item Name x N" from Bidding Tool tab/panel text.
   * Handles prefixes like "Xanathema - 400 | Zlandicar's Heart x 1".
   */
  function parseItemNameAndQuantity(rawText) {
    const text = String(rawText || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return { itemName: null, quantity: null };

    let match =
      text.match(/\|\s*([^|]+?)\s+x\s+(\d+)\s*$/i) ||
      text.match(/^(.+?)\s+x\s+(\d+)\s*$/i) ||
      text.match(/([^|]+?)\s+x\s+(\d+)/i);

    if (!match) {
      return { itemName: text, quantity: null };
    }

    let itemName = match[1].trim();
    const quantity = parseInt(match[2], 10);

    // Strip "Winner - Bid" prefixes if the pipe form wasn't used
    const winnerBidPrefix = itemName.match(/^(.+?)\s+-\s+(\d+)\s+(.+)$/);
    if (winnerBidPrefix) {
      itemName = winnerBidPrefix[3].trim();
    }

    const bidOnlyPrefix = itemName.match(/^\d+[\s-]+(.+)$/);
    if (bidOnlyPrefix) itemName = bidOnlyPrefix[1].trim();

    return {
      itemName: itemName || null,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null
    };
  }

  /**
   * @param {HTMLTableElement|null|undefined} table
   * @param {number|null|undefined} defaultBid
   * @returns {Array<{ winner: string, bid: number|null }>}
   */
  function extractWinnersFromBidsTable(table, defaultBid) {
    const winnersMap = new Map();
    if (!table) return [];

    const nameCol = getTableColumnIndex(table, /^name$/i);
    const valueCol = getTableColumnIndex(table, /^value$/i);
    const priorityCol = getTableColumnIndex(table, /^priority$/i);
    const hashCol = getTableColumnIndex(table, /^#$/);
    const rows = table.querySelectorAll('tbody tr, tr');

    for (const row of rows) {
      if (row.querySelector('th')) continue;
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) continue;

      let name = null;
      let rowBid = null;

      if (nameCol >= 0 && nameCol < cells.length) {
        const nameLink = cells[nameCol].querySelector('a[href*="/characters/"], a');
        name = (nameLink || cells[nameCol]).textContent.trim().replace(/\s*\(.*?$/, '').trim();
      } else {
        const nameLink = row.querySelector('a[href*="/characters/"]');
        if (nameLink) name = nameLink.textContent.trim().replace(/\s*\(.*?$/, '').trim();
      }

      if (valueCol >= 0 && valueCol < cells.length) {
        const bidInput = cells[valueCol].querySelector('input[type="number"]');
        if (bidInput && bidInput.value !== '') {
          rowBid = normalizeBidValue(bidInput.value);
        } else {
          rowBid = normalizeBidValue(cells[valueCol].textContent.trim());
        }
      }

      // Prefer the highest number-input in the row (Value), never row # / Priority
      if (rowBid == null) {
        const inputs = row.querySelectorAll('input[type="number"]');
        let best = null;
        for (let i = 0; i < inputs.length; i++) {
          const n = normalizeBidValue(inputs[i].value);
          if (n == null) continue;
          if (best == null || n > best) best = n;
        }
        rowBid = best;
      }

      if (rowBid == null) {
        for (let i = 0; i < cells.length; i++) {
          if (i === nameCol || i === priorityCol || i === hashCol) continue;
          const n = normalizeBidValue(cells[i].textContent.trim());
          // Skip tiny index-like values when a clearer bid exists elsewhere
          if (n == null) continue;
          if (i === 0 && n > 0 && n < 50 && cells.length > 3) continue;
          rowBid = n;
          break;
        }
      }

      if (!name || name.match(/^\d+$/) || name.length < 2) continue;
      if (rowBid == null && defaultBid) rowBid = normalizeBidValue(defaultBid);
      if (rowBid == null || isNaN(rowBid)) continue;

      const existing = winnersMap.get(name);
      if (!existing || rowBid > (existing.bid || 0)) {
        winnersMap.set(name, { winner: name, bid: rowBid });
      }
    }

    return Array.from(winnersMap.values());
  }

  function resolveTabPanelForAuction(auctionContainer) {
    if (!auctionContainer) return null;

    if (auctionContainer.id) {
      const byAria = document.querySelector('.p-tabview-panel[aria-labelledby="' + auctionContainer.id + '"]');
      if (byAria) return byAria;

      const tabId = auctionContainer.id.replace(/_header_action$/, '');
      const candidates = document.querySelectorAll('.p-tabview-panel, [data-pc-section="content"] .p-tabview-panel');
      for (const panel of candidates) {
        if (panel.id && (panel.id === tabId || panel.id.indexOf(tabId) !== -1)) return panel;
        const labelledBy = panel.getAttribute('aria-labelledby') || '';
        if (labelledBy === auctionContainer.id || labelledBy.indexOf(tabId) !== -1) return panel;
      }
    }

    const navLink = auctionContainer.closest('.p-tabview-nav-link, a[role="tab"], [role="tab"]') || auctionContainer;
    const tabNav = navLink.closest('.p-tabview-nav, ul.p-tabview-nav, [data-pc-section="nav"]');
    if (tabNav) {
      const tabs = Array.from(tabNav.querySelectorAll('.p-tabview-nav-link, a[role="tab"], [role="tab"]'));
      const linkEl = navLink.closest('.p-tabview-nav-link, a[role="tab"]') || navLink;
      const idx = tabs.findIndex(function (t) {
        return t === linkEl || t.contains(linkEl) || linkEl.contains(t);
      });
      const tabView = tabNav.closest('.p-tabview, [data-pc-section="root"]') || document;
      const panels = tabView.querySelectorAll(
        ':scope > [data-pc-section="content"] .p-tabview-panel, :scope > .p-tabview-panels .p-tabview-panel, .p-tabview-panel'
      );
      if (idx >= 0 && idx < panels.length) return panels[idx];
    }

    return null;
  }

  function findBidsTableForItem(itemName) {
    if (!itemName) return null;
    const baseName = itemName.replace(/\s*x\s*\d+$/i, '').trim().toLowerCase();
    if (!baseName) return null;

    const panels = document.querySelectorAll('.p-tabview-panel, [data-pc-section="content"] .p-tabview-panel');
    for (const panel of panels) {
      const panelText = ((panel.getAttribute('aria-label') || '') + ' ' + (panel.id || '')).toLowerCase();
      const headerEl = panel.querySelector('h1, h2, h3, .p-tabview-panel-header');
      const headerText = headerEl ? headerEl.textContent.toLowerCase() : '';
      const snippet = panel.textContent.slice(0, 500).toLowerCase();
      if (panelText.indexOf(baseName) === -1 && headerText.indexOf(baseName) === -1 && snippet.indexOf(baseName) === -1) {
        continue;
      }
      const table = panel.querySelector('table.p-datatable-table, table');
      if (table && table.querySelector('a[href*="/characters/"]')) return table;
    }
    return null;
  }

  /**
   * Resolve roll-off vs multi-win vs single-win from the bidder list.
   * Roll-off = more people tied at the highest bid than there are items (no winners yet).
   */
  function resolveAuctionOutcome(bidders, rollOffBid, quantity, bidAmount, fallbackWinner) {
    const list = (Array.isArray(bidders) ? bidders : [])
      .filter(Boolean)
      .map(function (w) {
        return {
          winner: w.winner || w,
          bid: normalizeBidValue(w.bid)
        };
      })
      .filter(function (w) {
        return w.winner;
      });
    const qtyRaw = normalizeBidValue(quantity);
    const qty = qtyRaw && qtyRaw > 0 ? qtyRaw : 1;
    const normalizedFallbackBid = normalizeBidValue(bidAmount);
    let tiedBid = normalizeBidValue(rollOffBid);

    if (list.length > qty) {
      const highestBid = Math.max.apply(
        null,
        list.map(function (w) {
          return w.bid != null ? w.bid : 0;
        })
      );
      const tiedAtHigh = list.filter(function (w) {
        return w.bid === highestBid;
      });
      if (tiedAtHigh.length > qty) {
        return {
          isRollOff: true,
          rollOffBid: highestBid,
          rollOffWinners: tiedAtHigh,
          actualWinners: [],
          multipleWinners: false,
          winner: null,
          bidAmount: highestBid
        };
      }
    }

    if (
      list.length > 1 &&
      tiedBid !== null &&
      list.length > qty &&
      list.every(function (w) {
        return w.bid === tiedBid;
      })
    ) {
      return {
        isRollOff: true,
        rollOffBid: tiedBid,
        rollOffWinners: list,
        actualWinners: [],
        multipleWinners: false,
        winner: null,
        bidAmount: tiedBid
      };
    }

    let actualWinners = [];
    if (
      list.length > 0 &&
      (normalizedFallbackBid != null ||
        list.some(function (w) {
          return w.bid != null;
        }))
    ) {
      if (qty > 1) {
        const sortedBidders = list.slice().sort(function (a, b) {
          return (b.bid || 0) - (a.bid || 0);
        });
        actualWinners = sortedBidders.slice(0, qty);
        const high = actualWinners[0] ? actualWinners[0].bid : null;
        const tiedForSlots = list.filter(function (w) {
          return w.bid === high;
        });
        if (high != null && tiedForSlots.length > qty) {
          return {
            isRollOff: true,
            rollOffBid: high,
            rollOffWinners: tiedForSlots,
            actualWinners: [],
            multipleWinners: false,
            winner: null,
            bidAmount: high
          };
        }
      } else {
        const highestBid = Math.max.apply(
          null,
          list.map(function (w) {
            return w.bid || 0;
          })
        );
        actualWinners = list.filter(function (w) {
          return w.bid === highestBid;
        });
        if (actualWinners.length > 1) {
          return {
            isRollOff: true,
            rollOffBid: highestBid,
            rollOffWinners: actualWinners,
            actualWinners: [],
            multipleWinners: false,
            winner: null,
            bidAmount: highestBid
          };
        }
      }
    } else if (fallbackWinner) {
      actualWinners = [{ winner: fallbackWinner, bid: normalizedFallbackBid }];
    }

    const winnerEntry = actualWinners[0] || null;
    return {
      isRollOff: false,
      rollOffBid: tiedBid,
      rollOffWinners: list,
      actualWinners: actualWinners,
      multipleWinners: actualWinners.length > 1,
      winner: winnerEntry ? winnerEntry.winner : fallbackWinner || null,
      bidAmount: winnerEntry && winnerEntry.bid != null ? winnerEntry.bid : normalizedFallbackBid
    };
  }

  function applyWinnersToContext(context, rollOffWinners, rollOffBid, quantity, bidAmount) {
    const outcome = resolveAuctionOutcome(
      rollOffWinners,
      rollOffBid,
      quantity != null ? quantity : context.quantity,
      bidAmount != null ? bidAmount : context.bidAmount,
      context.winner
    );
    context.rollOffWinners =
      outcome.rollOffWinners && outcome.rollOffWinners.length > 0
        ? outcome.rollOffWinners
        : undefined;
    context.rollOffBid = outcome.rollOffBid;
    context.isRollOff = outcome.isRollOff;
    context.actualWinners =
      outcome.actualWinners && outcome.actualWinners.length > 0
        ? outcome.actualWinners
        : undefined;
    // Roll-offs are not multi-wins — there is no winner until the roll resolves
    context.multipleWinners = !outcome.isRollOff && outcome.multipleWinners;
    if (outcome.isRollOff) {
      context.winner = undefined;
      if (outcome.bidAmount != null) context.bidAmount = outcome.bidAmount;
    } else if (outcome.winner) {
      context.winner = outcome.winner;
      if (outcome.bidAmount != null) context.bidAmount = outcome.bidAmount;
    }
    return context;
  }

  /**
   * Last-chance correction before TTS/notification: re-parse qty from labels and
   * never announce "multiple winners" when a same-bid tie exceeds item count.
   */
  function reinforceContextForAnnouncement(context) {
    if (!context || context.noBid) return context;

    let qty = normalizeBidValue(context.quantity);
    if (!qty || qty < 1) qty = 1;

    try {
      const labels = document.querySelectorAll(
        'a[id*="_header_action"], .p-tabview-nav-link[aria-selected="true"], [role="tab"][aria-selected="true"]'
      );
      for (let i = 0; i < labels.length; i++) {
        const parsed = parseItemNameAndQuantity(labels[i].textContent);
        if (!parsed.itemName || parsed.quantity == null) continue;
        const ctxName = String(context.itemName || '')
          .replace(/\s*x\s*\d+$/i, '')
          .trim()
          .toLowerCase();
        const labelName = parsed.itemName
          .replace(/\s*x\s*\d+$/i, '')
          .trim()
          .toLowerCase();
        if (
          !ctxName ||
          labelName === ctxName ||
          labelName.indexOf(ctxName) !== -1 ||
          ctxName.indexOf(labelName) !== -1
        ) {
          qty = parsed.quantity;
          context.quantity = qty;
          if (parsed.itemName) context.itemName = parsed.itemName;
          break;
        }
      }
    } catch (_) {}

    // Same-bid ties: if the active tab label clearly says x 1, never treat as multi-win
    try {
      const activeTab =
        document.querySelector(
          'a[id*="_header_action"][aria-selected="true"], .p-tabview-nav-link[aria-selected="true"], [role="tab"][aria-selected="true"]'
        ) || null;
      if (activeTab) {
        const activeParsed = parseItemNameAndQuantity(activeTab.textContent);
        if (activeParsed.quantity === 1) {
          qty = 1;
          context.quantity = 1;
          if (activeParsed.itemName) {
            const ctxName = String(context.itemName || '')
              .replace(/\s*x\s*\d+$/i, '')
              .trim()
              .toLowerCase();
            const labelName = activeParsed.itemName
              .replace(/\s*x\s*\d+$/i, '')
              .trim()
              .toLowerCase();
            if (!ctxName || labelName.indexOf(ctxName) !== -1 || ctxName.indexOf(labelName) !== -1) {
              context.itemName = activeParsed.itemName;
            }
          }
        }
      }
    } catch (_) {}

    const pool = [].concat(context.rollOffWinners || []).concat(context.actualWinners || []);
    const byName = new Map();
    pool.forEach(function (w) {
      if (!w) return;
      const name = String(w.winner || w).trim();
      const bid = normalizeBidValue(w.bid != null ? w.bid : context.bidAmount);
      if (!name) return;
      const key = name.toLowerCase();
      const prev = byName.get(key);
      if (!prev || (bid != null && bid > (prev.bid || 0))) {
        byName.set(key, { winner: name, bid: bid });
      }
    });
    const bidders = Array.from(byName.values());
    if (bidders.length > 1) {
      applyWinnersToContext(context, bidders, context.rollOffBid, qty, context.bidAmount);
    }

    // Absolute TTS guard: single-item auctions cannot have multiple winners
    if ((context.quantity || 1) <= 1 && context.multipleWinners) {
      context.multipleWinners = false;
      if (context.actualWinners && context.actualWinners.length > 1) {
        context.isRollOff = true;
        context.rollOffWinners = context.actualWinners;
        context.rollOffBid = normalizeBidValue(context.actualWinners[0].bid);
        context.actualWinners = undefined;
        context.winner = undefined;
      }
    }

    log('TTS reinforce:', {
      itemName: context.itemName,
      quantity: context.quantity,
      isRollOff: context.isRollOff,
      multipleWinners: context.multipleWinners,
      bidders: bidders
    });
    return context;
  }

  function finalizeAuctionContext(context, timerElement) {
    if (!context || !context.itemName || context.noBid) return context;

    const quantity = context.quantity || 1;
    if (quantity <= 1) return context;

    const winnerCount = context.actualWinners ? context.actualWinners.length : 0;
    if (winnerCount >= quantity) return context;

    let table = null;
    if (timerElement) {
      const auctionContainer =
        timerElement.closest('a[id*="_header_action"]') ||
        timerElement.closest('.p-tabview-nav-link') ||
        timerElement.parentElement;
      const tabPanel = resolveTabPanelForAuction(auctionContainer);
      if (tabPanel) {
        table = tabPanel.querySelector('table.p-datatable-table, table');
      }
    }
    if (!table) {
      table = findBidsTableForItem(context.itemName);
    }
    if (!table) return context;

    const extracted = extractWinnersFromBidsTable(table, context.bidAmount);
    if (!extracted.length) return context;

    let rollOffBid = null;
    if (extracted.length > 1 && extracted.every(function (w) { return w.bid === extracted[0].bid; })) {
      rollOffBid = extracted[0].bid;
    }
    return applyWinnersToContext(context, extracted, rollOffBid, quantity, context.bidAmount);
  }

  function enqueueCompletionAnnouncement(context) {
    completionAnnounceQueue.push(context);
    processCompletionAnnounceQueue();
  }

  /**
   * When our auto-bid character wins, disable matching rules (user rarely wants to bid again).
   */
  function maybeDisableAutoBidRulesOnWin(context) {
    if (!context || context.noBid || context.isRollOff) return;

    var winnerNames = [];
    if (context.actualWinners && context.actualWinners.length) {
      context.actualWinners.forEach(function (w) {
        var name = w && (w.winner || w);
        if (name) winnerNames.push(String(name));
      });
    } else if (context.winner) {
      winnerNames.push(String(context.winner));
    }
    if (!winnerNames.length || !context.itemName) return;

    try {
      api.runtime.sendMessage(
        {
          type: 'autoBidDisableRulesOnWin',
          itemName: context.itemName,
          winnerNames: winnerNames
        },
        function (resp) {
          if (api.runtime.lastError) return;
          if (resp && resp.disabled && resp.disabled.length) {
            log('Auto-bid: disabled rule(s) after win:', resp.disabled.join('; '));
          }
        }
      );
    } catch (e) {
      log('Auto-bid disable-on-win failed:', e);
    }
  }

  function processCompletionAnnounceQueue() {
    if (completionAnnounceProcessing || completionAnnounceQueue.length === 0) return;
    completionAnnounceProcessing = true;
    const context = completionAnnounceQueue.shift();
    showNotification(context, function () {
      completionAnnounceProcessing = false;
      if (completionAnnounceQueue.length > 0) {
        setTimeout(processCompletionAnnounceQueue, COMPLETION_ANNOUNCE_GAP_MS);
      }
    });
  }
  
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
      
      // Find item name and quantity — prefer full tab text (handles "Winner - Bid | Item x N")
      let itemName = null;
      let quantity = null;
      const fromTab = parseItemNameAndQuantity(auctionContainer.textContent);
      if (fromTab.itemName && fromTab.quantity != null) {
        itemName = fromTab.itemName;
        quantity = fromTab.quantity;
        log('Parsed item/qty from tab text:', itemName, 'x', quantity);
      } else {
        const itemDivs = auctionContainer.querySelectorAll('div');
        for (const div of itemDivs) {
          const parsed = parseItemNameAndQuantity(div.textContent);
          if (parsed.itemName && parsed.quantity != null) {
            // Prefer the shortest matching label (leaf nodes over ancestors)
            if (!itemName || parsed.itemName.length < itemName.length) {
              itemName = parsed.itemName;
              quantity = parsed.quantity;
            }
          }
        }
        if (!quantity) quantity = 1;
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
      {
        const tabPanel = resolveTabPanelForAuction(auctionContainer);
        let bidsTable = tabPanel ? tabPanel.querySelector('table.p-datatable-table, table') : null;
        if (!bidsTable && itemName) {
          bidsTable = findBidsTableForItem(itemName);
        }

        if (bidsTable) {
            const extracted = extractWinnersFromBidsTable(bidsTable, bidAmount);
            
            if (extracted.length > 1) {
              // CRITICAL: Only consider it a roll-off if ALL winners have the SAME bid amount
              // Check if all extracted winners have the same bid
              const allSameBid = extracted.every(function (w) {
                return normalizeBidValue(w.bid) === normalizeBidValue(extracted[0].bid) && w.bid != null;
              });
              if (allSameBid && normalizeBidValue(extracted[0].bid) > 0) {
                // Multiple people with same bid = roll-off
                rollOffWinners = extracted;
                rollOffBid = normalizeBidValue(extracted[0].bid);
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
              const extracted = extractWinnersFromBidsTable(table, bidAmount);
              log(`Found ${extracted.length} winner(s) in auction's table:`, extracted);
              
              if (extracted.length > 1) {
                // CRITICAL: Only consider it a roll-off if ALL winners have the SAME bid amount
                const allSameBid = extracted.every(function (w) {
                  return normalizeBidValue(w.bid) === normalizeBidValue(extracted[0].bid) && w.bid != null;
                });
                if (allSameBid && normalizeBidValue(extracted[0].bid) > 0) {
                  // Multiple people with same bid = roll-off
                  rollOffWinners = extracted;
                  rollOffBid = normalizeBidValue(extracted[0].bid);
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

      let context = {
        winner: winner,
        bidAmount: bidAmount,
        itemName: itemName,
        quantity: quantity,
        timerWidth: getWidthPercent(timerElement),
        rawWinnerText: winnerText,
        noBid: noBid,
        isTableStructure: false
      };
      context = applyWinnersToContext(context, rollOffWinners, rollOffBid, quantity, bidAmount);
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
      log('Extracted winner:', context.winner);
      log('Bid amount:', context.bidAmount);
      log('Quantity:', quantity);
      log('All bidders found:', context.rollOffWinners);
      log('Actual winners (highest bid):', context.actualWinners);
      log('Roll-off bid:', context.rollOffBid);
      log('Is roll-off?', context.isRollOff);
      log(
        'Multiple winners?',
        context.multipleWinners,
        `(${(context.actualWinners || []).length} actual winner(s) out of ${(context.rollOffWinners || []).length} bidder(s))`
      );
      log('Final context:', context);

      // Capture DOM snapshot when roll-off is detected OR when multiple actual winners are found
      if (context.isRollOff || context.multipleWinners) {
        const reason = context.isRollOff ? 'roll-off-detected' : 'multiple-winners-detected';
        log('Capturing DOM snapshot for:', reason);
        captureDOMSnapshot(context, timerElement, reason);
      }

      log('=== END ROLL-OFF DEBUG ===');
      return finalizeAuctionContext(context, timerElement);
      
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

      let context = {
        winner: winner,
        bidAmount: bidAmount,
        itemName: itemName,
        quantity: quantity,
        timerWidth: getWidthPercent(timerElement),
        rowNumber: rowNumber,
        timestamp: timestampCell?.textContent?.trim(),
        noBid: noBid,
        isTableStructure: true
      };
      context = applyWinnersToContext(context, rollOffWinners, rollOffBid, quantity, bidAmount);

      // Enhanced logging for roll-off detection debugging (table-based)
      log('=== ROLL-OFF DETECTION DEBUG (TABLE) ===');
      log('Winner:', context.winner);
      log('Bid amount:', context.bidAmount);
      log('Quantity:', quantity);
      log('All bidders found:', context.rollOffWinners);
      log('Actual winners (highest bid):', context.actualWinners);
      log('Roll-off bid:', context.rollOffBid);
      log('Is roll-off?', context.isRollOff);
      log(
        'Multiple winners?',
        context.multipleWinners,
        `(${(context.actualWinners || []).length} actual winner(s) out of ${(context.rollOffWinners || []).length} bidder(s))`
      );
      log('Final context:', context);

      // Capture DOM snapshot when roll-off is detected OR when multiple actual winners are found
      if (context.isRollOff || context.multipleWinners) {
        const reason = context.isRollOff ? 'roll-off-detected-table' : 'multiple-winners-detected-table';
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
  function speakNotification(context, onComplete) {
    function completeTts() {
      if (typeof onComplete === 'function') onComplete();
    }

    if (!settings.ENABLE_TTS) {
      completeTts();
      return;
    }
    
    let message = '';
    // This is a safety net in case the context wasn't fully populated
    reinforceContextForAnnouncement(context);
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
    
    // Check if advanced TTS is enabled and use custom template
    if (settings.ENABLE_ADVANCED_TTS && settings.TTS_TEMPLATE) {
      log('TTS: Advanced TTS enabled, context:', {
        isRollOff: context.isRollOff,
        multipleWinners: context.multipleWinners,
        actualWinners: context.actualWinners,
        winner: context.winner
      });
      message = generateTTSMessage(settings.TTS_TEMPLATE, context);
      log('TTS: Using custom template, generated message:', message);
    } else {
      log('TTS: Default TTS, context:', {
        isRollOff: context.isRollOff,
        multipleWinners: context.multipleWinners,
        actualWinners: context.actualWinners,
        winner: context.winner
      });
      // Roll-off first: tied high bids are not winners yet
      if (context.isRollOff && context.rollOffWinners && context.rollOffWinners.length > 1) {
        const participants = context.rollOffWinners.map(function (w) {
          return w.winner || w;
        }).join(', ');
        message = `Roll-off for ${context.itemName}. Participants: ${participants}`;
        log('TTS: Roll-off message:', message);
      } else if (
        context.multipleWinners &&
        (context.quantity || 1) > 1 &&
        context.actualWinners &&
        context.actualWinners.length > 1
      ) {
        // Multiple winners for multi-item auction
        const winnersList = context.actualWinners.map(function (w) {
          return w.winner || w;
        });
        const winners = winnersList.join(', ');
        message = `Multiple winners for ${context.itemName}. Winners: ${winners}`;
        log('TTS: Multiple winners message (using actualWinners):', message);
      } else if (context.multipleWinners) {
        // Use actualWinners if available (most accurate), otherwise reconstruct from rollOffWinners
        let winnersList = [];
        if (context.actualWinners && context.actualWinners.length > 0) {
          winnersList = context.actualWinners.map(function (w) {
            return w.winner || w;
          });
          log('TTS: Using actualWinners from context:', winnersList);
        } else if (context.rollOffWinners && context.rollOffWinners.length > 0 && context.quantity) {
          const sorted = [...context.rollOffWinners].sort(function (a, b) {
            return (b.bid || 0) - (a.bid || 0);
          });
          winnersList = sorted.slice(0, context.quantity).map(function (w) {
            return w.winner || w;
          });
          log('TTS: Reconstructed winners from rollOffWinners:', winnersList);
        } else if (context.rollOffWinners) {
          winnersList = context.rollOffWinners.map(function (w) {
            return w.winner || w;
          });
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
        completeTts();
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
      utterance.volume = Math.max(0, Math.min(1, settings.VOLUME)); // Issue #6: respect volume
      speechSynthesis.speak(utterance);
      hasSpoken = true;
      log('TTS: Speaking notification:', message, 'volume:', utterance.volume);
      
      utterance.onend = () => {
        completeTts();
      };
      utterance.onerror = () => {
        completeTts();
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
        } else if (!hasSpoken) {
          completeTts();
        }
      }, 100);
    }
  }
  
  /**
   * Generate TTS message from template
   */
  function generateTTSMessage(template, context) {
    // Stock / winner-only templates still need a roll-off announcement when tied
    if (context.isRollOff && context.rollOffWinners && context.rollOffWinners.length > 1) {
      const participants = context.rollOffWinners
        .map(function (w) {
          return w.winner || w;
        })
        .join(', ');
      const rollOffMessage = `Roll-off for ${context.itemName || 'Unknown Item'}. Participants: ${participants}`;
      if (
        !template ||
        !/\{isRollOff\}|\{winners\}/i.test(template) ||
        /Auction Finished\.\s*\{winner\}/i.test(template)
      ) {
        log('TTS Template: Using roll-off message instead of winner template:', rollOffMessage);
        return rollOffMessage;
      }
    }

    let message = template;

    // Handle winners / participants list
    let winnersList = 'Unknown';
    if (context.isRollOff && context.rollOffWinners && context.rollOffWinners.length > 0) {
      winnersList = context.rollOffWinners.map(function (w) {
        return w.winner || w;
      }).join(', ');
    } else if (context.multipleWinners && context.actualWinners && context.actualWinners.length > 0) {
      winnersList = context.actualWinners.map(function (w) {
        return w.winner || w;
      }).join(', ');
      log('TTS Template: Using actualWinners for multiple winners:', winnersList);
    } else if (context.rollOffWinners && context.rollOffWinners.length > 0) {
      winnersList = context.rollOffWinners.map(function (w) {
        return w.winner || w;
      }).join(', ');
    } else if (context.winner) {
      winnersList = context.winner;
    }

    // Replace variables
    if (context.isRollOff) {
      message = message.replace(/\{winner\}/g, winnersList);
    } else if (context.multipleWinners && context.actualWinners && context.actualWinners.length > 1) {
      message = message.replace(/\{winner\}/g, winnersList);
    } else {
      message = message.replace(/\{winner\}/g, context.winner || 'Unknown');
    }
    message = message.replace(/\{bidAmount\}/g, context.bidAmount || '0');
    message = message.replace(/\{itemName\}/g, context.itemName || 'Unknown Item');
    message = message.replace(/\{winners\}/g, winnersList);

    message = message.replace(/\{isRollOff\}/g, context.isRollOff ? 'true' : 'false');
    message = message.replace(/\{multipleWinners\}/g, context.multipleWinners ? 'true' : 'false');

    log('TTS Template: Generated message:', message, 'Context:', {
      isRollOff: context.isRollOff,
      multipleWinners: context.multipleWinners,
      actualWinners: context.actualWinners
    });

    return message;
  }

  /**
   * Show enhanced notification with auction details
   * @param {Record<string, unknown>} context
   * @param {() => void} [onComplete] Called after sound + TTS finish (for queue pacing)
   */
  function showNotification(context, onComplete) {
    function done() {
      if (typeof onComplete === 'function') onComplete();
    }

    if (!context) {
      log('No context available for notification');
      done();
      return;
    }

    reinforceContextForAnnouncement(context);
    
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
    } else if (context.multipleWinners && context.actualWinners && context.actualWinners.length > 1) {
      // Multiple winners for multi-item auction
      message = 'Multiple Winners!';
      details.push(`Winners: ${context.actualWinners.map(function (w) { return w.winner; }).join(', ')}`);
      const bids = context.actualWinners.map(function (w) { return w.bid; }).filter(Boolean);
      if (bids.length) {
        details.push(`Bid Amount${bids.length > 1 ? 's' : ''}: ${bids.join(', ')}`);
      }
    } else if (context.quantity > 1 && context.rollOffWinners && context.rollOffWinners.length >= context.quantity) {
      // Multiple winners for multi-item auction (legacy path)
      message = 'Multiple Winners!';
      details.push(`Winners: ${context.rollOffWinners.slice(0, context.quantity).map(function (w) { return w.winner; }).join(', ')}`);
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
      done();
      return;
    }
    
    // Play notification sound and get duration
    const soundDuration = playChime();
    
    // Speak notification using TTS - wait for sound to finish plus buffer
    const ttsDelay = Math.max(soundDuration + 200, 500); // At least 500ms, or sound duration + 200ms buffer
    log('TTS will start after:', ttsDelay + 'ms (sound duration:', soundDuration + 'ms)');
    
    setTimeout(function () {
      speakNotification(context, done);
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

  /** Issue #4: Speak "upload raid log" reminder via TTS when leaving (uses settings volume/voice). */
  function speakUploadLogReminder() {
    if (!settings.ENABLE_TTS) return;
    const msg = 'Remember to upload raid logs!';
    try {
      const u = new SpeechSynthesisUtterance(msg);
      u.volume = Math.max(0, Math.min(1, settings.VOLUME));
      if (settings.VOICE) {
        const voices = speechSynthesis.getVoices();
        const v = voices.find(x => x.name.toLowerCase() === (settings.VOICE || '').toLowerCase());
        if (v) u.voice = v;
      }
      const isFirefox = typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox');
      u.rate = Math.min(settings.VOICE_SPEED || 1.0, isFirefox ? 2.5 : 2.0);
      speechSynthesis.speak(u);
      log('TTS: Upload raid log reminder on leave', 'volume:', u.volume);
    } catch (e) {
      log('TTS: Upload log reminder speak failed', e);
    }
  }

  /** Issue #8: Trigger upload raid log reminder when user leaves (notification + TTS). */
  function onLeaveUploadLogReminder() {
    if (settings.SOUND_PROFILE !== 'raidleader' || !settings.RAID_LEADER_NOTIFICATION) return;
    if (uploadLogReminderFiredOnLeave) return;
    uploadLogReminderFiredOnLeave = true;
    try {
      showRaidLeaderNotification();
      speakUploadLogReminder();
      log('Upload raid log reminder fired on leave (notification + TTS)');
    } catch (e) {
      log('Upload log reminder on leave error', e);
    }
  }
  let uploadLogReminderFiredOnLeave = false;

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

  // Issue #8 / #4: When user leaves opendkp (close tab or navigate away), show upload raid log reminder + TTS
  window.addEventListener('pagehide', function(e) {
    onLeaveUploadLogReminder();
  });

})();
