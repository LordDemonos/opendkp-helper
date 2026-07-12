// Background script for Firefox compatibility
// This ensures the browser API is available

try {
  importScripts('lib/opendkp-api.js', 'lib/raid-context.js', 'lib/auto-bid.js');
} catch (_) {
  /* Firefox loads lib scripts via manifest background.scripts */
}

/** Cognito app ClientId — must match options.js OPEN_DKP_COGNITO_CLIENT_ID */
var OPEN_DKP_COGNITO_CLIENT_ID = '2sq61k8dj39e309tnh5tm70dd4';

console.log('🔵 Background script loaded - Firefox compatibility');
console.log('🔵 Background script executing at:', new Date().toISOString());

// Reminder scheduler
(function(){
  // Get browser API - Chrome uses chrome.*, Firefox uses browser.*
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const isFirefox = typeof browser !== 'undefined';
  let cached = { reminders: [], reminderPrefs: { flash: true, notifications: true }, soundProfile: 'raidleader' };
  let tickId = null;
  let settingsLoadedAt = 0; // Track when settings were last loaded (for Firefox suspension detection)
  // Track last fired boundary per reminder to prevent duplicate fires within same 5-min window
  let lastFiredBoundary = {}; // remId -> "HH:MM" of last 5-min boundary we fired for
  // Track open reminder windows by reminder ID (best-effort; findReminderTargets is authoritative on Done)
  let reminderWindows = {}; // remId -> array of window/tab IDs

  function getReminderPageUrl() {
    try {
      return api.runtime.getURL('reminder.html');
    } catch (_) {
      return 'reminder.html';
    }
  }

  function reminderUrlMatches(url, remId) {
    if (!url || typeof url !== 'string' || !url.includes('reminder.html')) return false;
    try {
      return new URL(url).searchParams.get('id') === remId;
    } catch (_) {
      return url.includes('id=' + encodeURIComponent(remId));
    }
  }

  /** Find all extension popup windows/tabs for a reminder (survives background script restarts). */
  async function findReminderTargets(remId) {
    const targets = [];
    const seen = new Set();
    try {
      if (api.windows && api.windows.getAll) {
        const wins = await api.windows.getAll({ populate: true });
        for (const win of wins) {
          if (!win || win.id == null) continue;
          for (const tab of (win.tabs || [])) {
            if (tab && reminderUrlMatches(tab.url, remId)) {
              const key = 'window:' + win.id;
              if (!seen.has(key)) {
                seen.add(key);
                targets.push({ type: 'window', id: win.id, tabId: tab.id });
              }
              break;
            }
          }
        }
      }
      if (api.tabs && api.tabs.query) {
        const tabs = await api.tabs.query({ url: getReminderPageUrl() + '*' });
        for (const tab of tabs) {
          if (!tab || tab.id == null || !reminderUrlMatches(tab.url, remId)) continue;
          const key = tab.windowId != null ? 'window:' + tab.windowId : 'tab:' + tab.id;
          if (!seen.has(key)) {
            seen.add(key);
            if (tab.windowId != null) {
              targets.push({ type: 'window', id: tab.windowId, tabId: tab.id });
            } else {
              targets.push({ type: 'tab', id: tab.id, tabId: tab.id });
            }
          }
        }
      }
    } catch (e) {
      try { console.warn('[ODKP Reminder] findReminderTargets error', e); } catch (_) {}
    }
    return targets;
  }

  function restoreLastFiredBoundariesFromReminders() {
    for (const rem of (cached.reminders || [])) {
      if (rem && rem.id && rem.lastFiredBoundary) {
        lastFiredBoundary[rem.id] = rem.lastFiredBoundary;
      }
    }
  }

  function markLastFiredBoundary(remId, boundary) {
    lastFiredBoundary[remId] = boundary;
    cached.reminders = (cached.reminders || []).map(r =>
      r && r.id === remId ? { ...r, lastFiredBoundary: boundary } : r
    );
    persistReminders(cached.reminders).catch(() => {});
  }

  function clearLastFiredBoundary(remId) {
    delete lastFiredBoundary[remId];
    cached.reminders = (cached.reminders || []).map(r =>
      r && r.id === remId ? { ...r, lastFiredBoundary: undefined } : r
    );
    persistReminders(cached.reminders).catch(() => {});
  }

  function loadSettings() {
    try {
      console.log('[ODKP Reminder] 🔄 loadSettings called - fetching from storage...');
      return api.storage.sync.get(['reminders','reminderPrefs','soundProfile']).then((s)=>{
        console.log('[ODKP Reminder] 📦 Raw storage response:', {
          hasReminders: !!s.reminders,
          remindersType: Array.isArray(s.reminders) ? 'array' : typeof s.reminders,
          remindersLength: Array.isArray(s.reminders) ? s.reminders.length : 'N/A',
          hasReminderPrefs: !!s.reminderPrefs,
          reminderPrefs: s.reminderPrefs,
          soundProfile: s.soundProfile,
          timestamp: new Date().toISOString()
        });
        
        cached.reminders = Array.isArray(s.reminders) ? s.reminders : [];
        cached.reminderPrefs = s.reminderPrefs || { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] };
        // Ensure enabledDays is an array with valid values
        if (!Array.isArray(cached.reminderPrefs.enabledDays)) {
          cached.reminderPrefs.enabledDays = [0,1,2,3,4,5,6]; // Default to all days
        }
        cached.soundProfile = s.soundProfile || 'raidleader';

        // Firefox: if sync lost reminders (quota/eviction), restore from storage.local backup
        if (cached.reminders.length === 0 && api.storage.local) {
          return api.storage.local.get(['reminders','reminderPrefs']).then((local)=>{
            const localReminders = Array.isArray(local.reminders) ? local.reminders : [];
            if (localReminders.length > 0) {
              console.log('[ODKP Reminder] 📥 Restored', localReminders.length, 'reminders from storage.local (sync was empty)');
              cached.reminders = localReminders;
              if (local.reminderPrefs && typeof local.reminderPrefs === 'object') {
                cached.reminderPrefs = local.reminderPrefs;
              }
              // Repopulate sync so next load uses sync
              return persistReminders(cached.reminders, cached.reminderPrefs).then(() => null);
            }
            return null;
          }).then(() => finishLoadSettings());
        }
        return finishLoadSettings();
      }).catch((e)=>{
        console.error('[ODKP Reminder] ❌ Error loading settings:', e);
        return Promise.reject(e);
      });
    } catch(e) {
      console.error('[ODKP Reminder] ❌ Exception in loadSettings:', e);
      return Promise.reject(e);
    }
  }

  function finishLoadSettings() {
        // Ensure enabledDays is an array with valid values
        if (!Array.isArray(cached.reminderPrefs.enabledDays)) {
          cached.reminderPrefs.enabledDays = [0,1,2,3,4,5,6]; // Default to all days
        }
        const enabledReminders = cached.reminders.filter(r => r && r.enabled);
        
        console.log('[ODKP Reminder] ✅ Settings loaded and cached:', {
          totalReminders: cached.reminders.length,
          enabledReminders: enabledReminders.length,
          profile: cached.soundProfile,
          enabledDays: cached.reminderPrefs.enabledDays,
          reminderDetails: enabledReminders.map(r => ({
            id: r.id,
            enabled: r.enabled,
            start: r.start,
            end: r.end,
            message: r.message,
            lastAckTs: r.lastAckTs ? new Date(r.lastAckTs).toLocaleString() : 'none'
          })),
          allReminderIds: cached.reminders.map(r => r?.id),
          timestamp: new Date().toISOString()
        });
        
        // After loading, verify what will happen on next tick
        console.log('[ODKP Reminder] 🔍 Post-load state check:', {
          soundProfileMatches: cached.soundProfile === 'raidleader',
          willCheckReminders: cached.soundProfile === 'raidleader' && enabledReminders.length > 0,
          todayDayOfWeek: new Date().getDay(),
          enabledDaysIncludesToday: cached.reminderPrefs.enabledDays.includes(new Date().getDay())
        });
        
        // Restore boundary tracking lost when Firefox suspends the background script
        restoreLastFiredBoundariesFromReminders();

        // Track when settings were loaded (for Firefox suspension detection)
        settingsLoadedAt = Date.now();
        
        // Return resolved promise to allow chaining
        return Promise.resolve();
      }

  /** Persist reminders (and optionally reminderPrefs) to both sync and local (Firefox can evict sync; local is backup) */
  function persistReminders(remindersArray, reminderPrefs) {
    const payload = { reminders: remindersArray };
    if (reminderPrefs != null) payload.reminderPrefs = reminderPrefs;
    const pSync = api.storage.sync.set(payload);
    const pLocal = api.storage.local && api.storage.local.set ? api.storage.local.set(payload) : Promise.resolve();
    return Promise.all([pSync, pLocal]);
  }

  function withinWindow(nowHM, startHM, endHM) {
    const hhmm = (t)=>{ const m=t.split(':'); return (parseInt(m[0])||0)*100 + (parseInt(m[1])||0); };
    const cur = hhmm(nowHM);
    const s = hhmm(startHM);
    const e = hhmm(endHM);
    if (isNaN(s) || isNaN(e)) return false;
    if (s===e) return true;
    return s<=e ? (cur>=s && cur<=e) : (cur>=s || cur<=e);
  }

  // Calculate when the next reminder should fire after acknowledging current one
  function calculateNextReminderTime(acknowledgedRemId) {
    const now = new Date();
    const enabledReminders = (cached.reminders || []).filter(r => r && r.enabled && r.id !== acknowledgedRemId);
    
    if (enabledReminders.length === 0) {
      // No other reminders: snooze until tomorrow's start time for this reminder
      const acked = (cached.reminders || []).find(r => r && r.id === acknowledgedRemId);
      if (!acked || !acked.start) return null;
      const [h, m] = acked.start.split(':').map(x => parseInt(x) || 0);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(h, m, 0, 0);
      return tomorrow.getTime();
    }
    
    // Multiple reminders: find the next reminder's start time (today or tomorrow)
    const nowHM = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    
    let nextTime = null;
    for (const rem of enabledReminders) {
      if (!rem.start) continue;
      const [h, m] = rem.start.split(':').map(x => parseInt(x) || 0);
      const remMinutes = h * 60 + m;
      
      // Calculate next occurrence (today or tomorrow)
      const today = new Date(now);
      today.setHours(h, m, 0, 0);
      let nextOccurrence = today.getTime();
      
      // If today's time has passed, use tomorrow
      if (remMinutes <= nowMinutes) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        nextOccurrence = tomorrow.getTime();
      }
      
      // Pick the earliest next occurrence
      if (nextTime === null || nextOccurrence < nextTime) {
        nextTime = nextOccurrence;
      }
    }
    
    return nextTime;
  }

  async function triggerReminder(rem) {
    if (!rem || !rem.enabled) return;

    // One popup per reminder cycle — existing window repeats ding/TTS on its own timer
    const existing = await findReminderTargets(rem.id);
    if (existing.length > 0) {
      try { console.log('[ODKP Reminder] Popup already open for', rem.id, '- replaying alert (', existing.length, 'found)'); } catch (_) {}
      for (const target of existing) {
        if (target.tabId == null || !api.tabs || !api.tabs.sendMessage) continue;
        try {
          await api.tabs.sendMessage(target.tabId, { type: 'replayReminder' });
        } catch (_) {}
      }
      return;
    }

    // Open reminder window
    try {
      const url = (api.runtime.getURL ? api.runtime.getURL('reminder.html') : 'reminder.html') + `?id=${encodeURIComponent(rem.id)}&msg=${encodeURIComponent(rem.message||'Run /outputfile raidlist')}`;
      if (api.windows && api.windows.create) {
        const win = await api.windows.create({ url, type: 'popup', width: 380, height: 220 });
        if (win && win.id) {
          // Track window ID for this reminder
          if (!reminderWindows[rem.id]) reminderWindows[rem.id] = [];
          reminderWindows[rem.id].push({ type: 'window', id: win.id });
          try { console.log('[ODKP Reminder] Tracked window', win.id, 'for reminder', rem.id); } catch(_) {}
        }
      } else if (api.tabs && api.tabs.create) {
        const tab = await api.tabs.create({ url });
        if (tab && tab.id) {
          // Track tab ID for this reminder
          if (!reminderWindows[rem.id]) reminderWindows[rem.id] = [];
          reminderWindows[rem.id].push({ type: 'tab', id: tab.id });
          try { console.log('[ODKP Reminder] Tracked tab', tab.id, 'for reminder', rem.id); } catch(_) {}
        }
      }
    } catch(e) { console.warn('Reminder window error', e); }

    // Flash overlay on OpenDKP
    try {
      if (cached.reminderPrefs.flash && api.tabs && api.tabs.query) {
        const tabs = await api.tabs.query({ url: ['https://opendkp.com/*','https://*.opendkp.com/*'] });
        try { console.log('[ODKP Reminder] Sending flash to', tabs.length, 'OpenDKP tabs'); } catch(_) {}
        for (const t of tabs) {
          try {
            const result = await api.tabs.sendMessage(t.id, { action: 'reminderFlash', color: '#7e57c2' });
            try { console.log('[ODKP Reminder] Flash sent to tab', t.id, 'response:', result); } catch(_) {}
          } catch(err) {
            try { 
              console.warn('[ODKP Reminder] Flash failed for tab', t.id, 'error:', err.message || err);
              // If content script isn't loaded, try injecting it (Firefox may need this)
              if (err.message && (err.message.includes('Could not establish connection') || err.message.includes('Receiving end does not exist') || err.message.includes('Could not establish connection'))) {
                try {
                  console.log('[ODKP Reminder] Attempting to inject content script into tab', t.id);
                  // Try MV3 scripting API first (Chrome, modern Firefox)
                  if (api.scripting && api.scripting.executeScript) {
                    await api.scripting.executeScript({ 
                      target: { tabId: t.id }, 
                      files: ['content.js'] 
                    });
                  } else if (api.tabs && api.tabs.executeScript) {
                    // Fallback for older Firefox
                    await api.tabs.executeScript(t.id, { file: 'content.js' });
                  }
                  // Retry flash after injection
                  setTimeout(async () => {
                    try {
                      await api.tabs.sendMessage(t.id, { action: 'reminderFlash', color: '#7e57c2' });
                      console.log('[ODKP Reminder] Flash sent after injection to tab', t.id);
                    } catch(e2) {
                      console.warn('[ODKP Reminder] Flash still failed after injection', e2);
                    }
                  }, 500);
                } catch(injErr) {
                  console.warn('[ODKP Reminder] Injection failed', injErr);
                }
              }
            } catch(_) {}
          }
        }
      } else {
        try { console.log('[ODKP Reminder] Flash disabled or tabs API unavailable', { flash: cached.reminderPrefs.flash, hasTabs: !!api.tabs }); } catch(_) {}
      }
    } catch(e) { 
      try { console.warn('[ODKP Reminder] Flash overlay error', e); } catch(_) {}
    }

    // Browser notification
    try {
      if (cached.reminderPrefs.notifications && api.notifications && api.notifications.create) {
        api.notifications.create('opendkp-reminder-'+rem.id, {
          type: 'basic', iconUrl: api.runtime.getURL('icons/icon-48.png'),
          title: 'RaidTick Reminder', message: rem.message || 'Run /outputfile raidlist'
        });
      }
    } catch(_) {}
  }

  async function onTick() {
    const now = new Date();
    const hm = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    const minute = now.getMinutes();
    const ts = Date.now();
    
    try {
      console.log('[ODKP Reminder] ⏰ onTick() called at', hm, '- minute:', minute);
      console.log('[ODKP Reminder] 📊 Current cached state in onTick():', {
        soundProfile: cached.soundProfile,
        reminderCount: (cached.reminders || []).length,
        enabledReminderCount: (cached.reminders || []).filter(r => r && r.enabled).length,
        reminderIds: (cached.reminders || []).map(r => r?.id),
        reminderEnabledFlags: (cached.reminders || []).map(r => ({ id: r?.id, enabled: r?.enabled })),
        reminderPrefs: cached.reminderPrefs,
        timestamp: new Date().toISOString()
      });
    } catch(_) {}
    
    if (cached.soundProfile !== 'raidleader') {
      try { 
        console.log('[ODKP Reminder] ⏭️ Skipping - not raidleader profile (current:', cached.soundProfile, ')'); 
      } catch(_) {}
      return; // only raid leader
    }
    
    // Master switch — schedules stay saved when off
    if (cached.reminderPrefs && cached.reminderPrefs.remindersEnabled === false) {
      try { console.log('[ODKP Reminder] ⏭️ Skipping - reminders master switch is off'); } catch(_) {}
      return;
    }

    // Check if reminders are enabled
    const enabledReminders = (cached.reminders || []).filter(r => r && r.enabled);
    console.log('[ODKP Reminder] 🔍 Reminder filtering check:', {
      totalReminders: (cached.reminders || []).length,
      enabledReminders: enabledReminders.length,
      allReminders: (cached.reminders || []).map(r => ({
        id: r?.id,
        enabled: r?.enabled,
        start: r?.start,
        end: r?.end
      }))
    });
    
    if (enabledReminders.length === 0) {
      try { 
        console.log('[ODKP Reminder] ⏭️ No enabled reminders configured (total reminders:', (cached.reminders || []).length, ')'); 
      } catch(_) {}
      return;
    }
    
    // Check if today is an enabled day for reminders
    const todayDayOfWeek = now.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    const enabledDays = (cached.reminderPrefs && Array.isArray(cached.reminderPrefs.enabledDays)) 
      ? cached.reminderPrefs.enabledDays 
      : [0,1,2,3,4,5,6]; // Default to all days
    if (!enabledDays.includes(todayDayOfWeek)) {
      try { 
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        console.log('[ODKP Reminder] Skipping - reminders disabled for', dayNames[todayDayOfWeek], '(enabledDays:', enabledDays, ')'); 
      } catch(_) {}
      return; // Reminders disabled for today
    }
    
    // Current 5-min boundary identifier (e.g., "17:15" for both 17:15:00 and 17:15:30)
    const currentBoundary = hm;
    
    // If we're NOT at a 5-min boundary, just log and exit (but check at :00 and :30)
    if (minute % 5 !== 0) {
      try { 
        const nextBoundary = Math.ceil(minute / 5) * 5;
        const minutesUntilNext = nextBoundary - minute;
        console.log('[ODKP Reminder] ⏳ Not at 5-min boundary (minute:', minute, '), next boundary in', minutesUntilNext, 'minute(s) at', String(now.getHours()).padStart(2,'0') + ':' + String(nextBoundary).padStart(2,'0')); 
      } catch(_) {}
      return;
    }
    
    try {
      console.log('[ODKP Reminder] ✅ At 5-min boundary', currentBoundary, '- checking', enabledReminders.length, 'reminder(s)');
    } catch(_) {}
    
    (cached.reminders||[]).forEach(rem => {
      if (!rem || !rem.enabled) {
        try { console.log('[ODKP Reminder] Skipping disabled or invalid', rem?.id); } catch(_) {}
        return;
      }
      const start = (rem.start||'19:00');
      const end = (rem.end||'23:00');
      if (!withinWindow(hm, start, end)) {
        try { console.log('[ODKP Reminder] Outside window', rem.id, hm, 'not in', start, '-', end); } catch(_) {}
        // Clear boundary tracking when outside window (allows firing immediately when back in window)
        if (lastFiredBoundary[rem.id] || rem.lastFiredBoundary) {
          clearLastFiredBoundary(rem.id);
        }
        return;
      }
      
      // Prevent duplicate fires: only fire once per 5-minute boundary
      // This check prevents firing multiple times at the same 5-minute mark
      const lastBoundary = lastFiredBoundary[rem.id] || rem.lastFiredBoundary;
      if (lastBoundary === currentBoundary) {
        try { console.log('[ODKP Reminder] ⏭️ Skipping duplicate fire for', rem.id, 'at boundary', currentBoundary, '(already fired at this boundary)'); } catch(_) {}
        return; // Already fired for this boundary
      }
      
      // If we have a lastBoundary and it's different from current, that's expected progression
      // (e.g., fired at 14:00, now checking 14:05) - proceed to fire
      // If lastBoundary is undefined/null, this is the first time checking this reminder - also proceed
      
      // Check if user pressed Done - lastAckTs now contains the absolute timestamp when this reminder should fire next
      const lastAck = rem.lastAckTs || 0;
      if (lastAck > 0) {
        // lastAckTs is an absolute timestamp (when to fire next), not a relative age
        if (ts < lastAck) {
          const remaining = Math.round((lastAck - ts) / 1000 / 60);
          try { 
            console.log('[ODKP Reminder] ⏸️ Skipping - acknowledged (Done clicked), will fire in', remaining, 'minutes (at', new Date(lastAck).toLocaleTimeString(), ')'); 
          } catch(_) {}
          return;
        }
        // Time has passed, clear the ack so it can fire
        try { console.log('[ODKP Reminder] ✅ Ack time passed, clearing acknowledgment for', rem.id); } catch(_) {}
        rem.lastAckTs = 0;
        // Also save the cleared ack to storage
        try { 
          const updated = cached.reminders.map(r => r.id===rem.id ? { ...r, lastAckTs: 0 } : r);
          persistReminders(updated);
        } catch(_) {}
      }
      
      // All checks passed - fire the reminder
      try { 
        console.log('[ODKP Reminder] 🔔 FIRING reminder', rem.id, 'at', hm, 'window', start, '-', end, 'lastBoundary:', lastBoundary || 'none', 'message:', rem.message || 'Run /outputfile raidlist'); 
      } catch(_) {}
      markLastFiredBoundary(rem.id, currentBoundary);
      triggerReminder(rem);
    });
  }

  async function closeAllReminderTargets(remId, senderWindowId, senderTabId) {
    const tracked = (reminderWindows[remId] || []).map(w => ({ ...w }));
    const discovered = await findReminderTargets(remId);
    const merged = [];
    const seen = new Set();
    for (const winInfo of [...tracked, ...discovered]) {
      const key = winInfo.type + ':' + winInfo.id;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(winInfo);
    }
    if (merged.length === 0) return 0;

    try { console.log('[ODKP Reminder] Closing', merged.length, 'windows for reminder', remId, 'senderWindowId=', senderWindowId); } catch (_) {}

    const closeOne = async (winInfo) => {
      try {
        if (winInfo.type === 'window' && api.windows && api.windows.remove) {
          try { await api.windows.get(winInfo.id); } catch (_) { return false; }
          await api.windows.remove(winInfo.id);
          return true;
        }
        if (winInfo.type === 'tab' && api.tabs && api.tabs.remove) {
          try { await api.tabs.get(winInfo.id); } catch (_) { return false; }
          await api.tabs.remove(winInfo.id);
          return true;
        }
      } catch (err) {
        const isNotFound = err && (err.message?.includes('No such') || err.message?.includes('does not exist') || err.message?.includes('Invalid'));
        if (!isNotFound) try { console.warn('[ODKP Reminder] Failed to close', winInfo.type, winInfo.id, err); } catch (_) {}
      }
      return false;
    };

    let windows = merged.slice();
    if (senderWindowId == null && senderTabId == null) {
      windows = windows.slice().reverse();
    }

    let closedCount = 0;
    for (const winInfo of windows) {
      const isSender = (winInfo.type === 'window' && winInfo.id === senderWindowId) ||
        (winInfo.type === 'tab' && winInfo.id === senderTabId);
      if (isSender) continue;
      if (await closeOne(winInfo)) closedCount++;
    }
    for (const winInfo of windows) {
      const isSender = (winInfo.type === 'window' && winInfo.id === senderWindowId) ||
        (winInfo.type === 'tab' && winInfo.id === senderTabId);
      if (!isSender) continue;
      if (await closeOne(winInfo)) closedCount++;
    }

    delete reminderWindows[remId];
    try { console.log('[ODKP Reminder] Closed', closedCount, 'of', windows.length, 'windows for reminder', remId); } catch (_) {}
    return closedCount;
  }

  function ensureTicker() {
    console.log('[ODKP Reminder] 🔧 ensureTicker called - current cached state:', {
      soundProfile: cached.soundProfile,
      reminderCount: (cached.reminders || []).length,
      enabledReminderCount: (cached.reminders || []).filter(r => r && r.enabled).length,
      reminderIds: (cached.reminders || []).map(r => r?.id),
      timestamp: new Date().toISOString()
    });
    
    // Clear any existing interval
    if (tickId) {
      console.log('[ODKP Reminder] 🧹 Clearing existing setInterval ticker');
      clearInterval(tickId);
      tickId = null;
    }
    
    // Use Chrome alarms API for reliable scheduling (works even when service worker is suspended)
    // This is especially important for Chrome Manifest V3 service workers
    // Ensure alarms API is available (Chrome provides it via chrome.alarms, Firefox via browser.alarms)
    const alarmsAPI = api.alarms || (typeof chrome !== 'undefined' && chrome.alarms) || (typeof browser !== 'undefined' && browser.alarms);
    if (alarmsAPI) {
      try {
        // Clear any existing alarm
        alarmsAPI.clear('reminder-ticker').catch(() => {});
        
        // Set up alarm to fire every minute (Chrome minimum is 1 minute)
        // For reminders that fire at 5-minute boundaries (:00, :05, :10, etc.), 
        // checking every minute is sufficient
        try {
          alarmsAPI.create('reminder-ticker', { periodInMinutes: 1 });
          console.log('[ODKP Reminder] ✅ Alarm "reminder-ticker" created successfully - will fire every minute');
          // Verify alarm was created
          alarmsAPI.get('reminder-ticker').then((alarm) => {
            if (alarm) {
              console.log('[ODKP Reminder] ✅ Verified alarm exists:', {
                name: alarm.name,
                periodInMinutes: alarm.periodInMinutes,
                scheduledTime: alarm.scheduledTime ? new Date(alarm.scheduledTime).toISOString() : 'N/A'
              });
            } else {
              console.warn('[ODKP Reminder] ⚠️ Alarm creation returned no alarm object');
            }
          }).catch((e) => {
            console.warn('[ODKP Reminder] ⚠️ Could not verify alarm:', e);
          });
        } catch (createErr) {
          console.error('[ODKP Reminder] ❌ Failed to create alarm:', createErr);
          throw createErr;
        }
        
        console.log('[ODKP Reminder] 🔍 Ticker will check with state:', {
          soundProfile: cached.soundProfile,
          willProcessReminders: cached.soundProfile === 'raidleader',
          enabledReminderCount: (cached.reminders || []).filter(r => r && r.enabled).length
        });
    } catch(e) {
        console.warn('[ODKP Reminder] ❌ Failed to use alarms API, falling back to setInterval:', e);
        // Fallback to setInterval if alarms API fails
        tickId = setInterval(onTick, 30*1000);
        console.log('[ODKP Reminder] ✅ Fallback setInterval ticker started (every 30s)');
      }
    } else {
      // Fallback for browsers without alarms API (shouldn't happen in Chrome/Firefox)
      console.warn('[ODKP Reminder] ⚠️ Alarms API not available, using setInterval');
      tickId = setInterval(onTick, 30*1000);
      console.log('[ODKP Reminder] ✅ setInterval ticker started (every 30s)');
    }
    
    // Don't run onTick() immediately - let it fire naturally at the next 5-minute boundary
    // Running immediately can cause reminders to fire right when enabled (undesired behavior)
    // The alarm will wake the service worker at the next minute boundary
    console.log('[ODKP Reminder] 📅 Ticker configured - will check at next minute boundary');
  }

  // Set up alarm listener once during initialization
  // Ensure alarms API is available (Chrome provides it via chrome.alarms, Firefox via browser.alarms)
  // IMPORTANT: This listener is set up BEFORE loadSettings() completes
  // The listener will use cached state when onTick() is called
    console.log('[ODKP Reminder] 🎯 Setting up alarm listener BEFORE loadSettings (listener uses cached state)');
  const alarmsAPIInit = api.alarms || (typeof chrome !== 'undefined' && chrome.alarms) || (typeof browser !== 'undefined' && browser.alarms);
  console.log('[ODKP Reminder] 🔍 Alarms API check:', {
    api: api.alarms ? 'api.alarms' : (typeof chrome !== 'undefined' && chrome.alarms ? 'chrome.alarms' : (typeof browser !== 'undefined' && browser.alarms ? 'browser.alarms' : 'NOT FOUND')),
    hasAlarms: !!alarmsAPIInit,
    hasOnAlarm: !!(alarmsAPIInit && alarmsAPIInit.onAlarm),
    hasCreate: !!(alarmsAPIInit && alarmsAPIInit.create),
    hasGet: !!(alarmsAPIInit && alarmsAPIInit.get),
    timestamp: new Date().toISOString()
  });
  
  if (alarmsAPIInit && alarmsAPIInit.onAlarm) {
    console.log('[ODKP Reminder] 🎯 Alarms API available, registering onAlarm listener');
    try {
      alarmsAPIInit.onAlarm.addListener((alarm) => {
        console.log('[ODKP Reminder] 🔔 Alarm fired:', alarm.name, 'at', new Date().toISOString());
        if (alarm.name === 'reminder-ticker') {
          console.log('[ODKP Reminder] ⏰ reminder-ticker alarm triggered');
          
          // CRITICAL: In Firefox, background scripts can be suspended and lose state
          // When woken by an alarm, we must ensure settings are loaded
          // Check if settings are actually loaded (not just initialized with defaults)
          const hasValidSettings = cached.reminders && 
                                   Array.isArray(cached.reminders) && 
                                   cached.reminders.length > 0 && 
                                   cached.soundProfile;
          
          // Also check if we have reminderPrefs (indicates real load, not just defaults)
          const hasRealSettings = cached.reminderPrefs && 
                                 (cached.reminderPrefs.flash !== undefined || 
                                  cached.reminderPrefs.notifications !== undefined);
          
          // In Firefox, if settings were never loaded (settingsLoadedAt === 0) or it's been
          // more than 30 seconds since last load, reload them (script might have been suspended)
          const settingsStale = isFirefox && (settingsLoadedAt === 0 || (Date.now() - settingsLoadedAt) > 30000);
          
          if (!hasValidSettings || !hasRealSettings || settingsStale) {
            console.log('[ODKP Reminder] ⚠️ Cached settings empty or invalid, reloading before onTick()');
            console.log('[ODKP Reminder] 🔍 Current cached state:', {
              reminderCount: cached.reminders?.length || 0,
              hasSoundProfile: !!cached.soundProfile,
              hasReminderPrefs: !!cached.reminderPrefs,
              reminderPrefs: cached.reminderPrefs
            });
            
            // Reload settings and then call onTick()
            loadSettings().then(() => {
              console.log('[ODKP Reminder] ✅ Settings reloaded, now calling onTick()');
              // Re-ensure ticker is set up (in case it was lost)
              ensureTicker();
              onTick();
            }).catch((err) => {
              console.error('[ODKP Reminder] ❌ Failed to reload settings, calling onTick() anyway:', err);
              onTick(); // Still try to run with defaults
            });
          } else {
            console.log('[ODKP Reminder] ✅ Cached settings available, calling onTick()');
            onTick();
          }
        } else if (alarm.name === 'service-worker-keepalive') {
          // Keep service worker alive - this alarm fires every ~4 minutes
          // Chrome terminates service workers after 5 minutes of inactivity
          console.log('[ODKP Reminder] 💓 Service worker keepalive ping');
          // Verify settings are still loaded (for Firefox background script persistence)
          // Also ensure ticker is still active
          const hasValidSettings = cached.reminders && 
                                   Array.isArray(cached.reminders) && 
                                   cached.reminders.length > 0;
          if (!hasValidSettings) {
            console.log('[ODKP Reminder] 🔄 Keepalive: Reloading settings and ensuring ticker');
            loadSettings().then(() => {
              ensureTicker();
            }).catch(() => {});
          } else {
            // Even if settings are loaded, ensure ticker is still active
            // (alarm might have been cleared somehow)
            ensureTicker();
          }
        } else {
          console.log('[ODKP Reminder] ℹ️ Unknown alarm fired:', alarm.name);
        }
      });
      console.log('[ODKP Reminder] ✅ Alarm listener registered successfully');
      
      // Test: try to list all alarms to verify API works
      try {
        alarmsAPIInit.getAll().then((alarms) => {
          console.log('[ODKP Reminder] 📋 Current alarms:', alarms.map(a => ({
            name: a.name,
            periodInMinutes: a.periodInMinutes,
            scheduledTime: a.scheduledTime ? new Date(a.scheduledTime).toISOString() : 'N/A'
          })));
        }).catch((e) => {
          console.warn('[ODKP Reminder] ⚠️ Could not list alarms:', e);
        });
      } catch(e) {
        console.warn('[ODKP Reminder] ⚠️ Could not list alarms (sync):', e);
      }
    } catch (listenerErr) {
      console.error('[ODKP Reminder] ❌ Failed to register alarm listener:', listenerErr);
    }
  } else {
    console.error('[ODKP Reminder] ❌ Cannot set up alarm listener - alarms API not available or missing onAlarm');
    console.error('[ODKP Reminder] ❌ This is likely a permissions issue - check manifest.json has "alarms" permission');
  }

  // Set up keepalive alarm to prevent service worker from being terminated
  // Chrome terminates inactive service workers after ~5 minutes
  // This alarm fires every ~4 minutes to keep the worker alive
  // Ensure alarms API is available (Chrome provides it via chrome.alarms, Firefox via browser.alarms)
  const alarmsAPIKeepalive = api.alarms || (typeof chrome !== 'undefined' && chrome.alarms) || (typeof browser !== 'undefined' && browser.alarms);
  if (alarmsAPIKeepalive) {
    try {
      alarmsAPIKeepalive.create('service-worker-keepalive', { periodInMinutes: 4 });
      console.log('[ODKP Reminder] Service worker keepalive alarm set');
    } catch (e) {
      console.warn('[ODKP Reminder] Failed to create keepalive alarm:', e);
    }
  }

  // Ensure service worker doesn't get terminated
  // Listen for extension installation/startup
  if (api.runtime && api.runtime.onStartup) {
    api.runtime.onStartup.addListener(() => {
      console.log('[ODKP Reminder] Extension startup detected, reinitializing...');
      loadSettings().then(() => {
        ensureTicker();
      }).catch(() => {
        ensureTicker(); // Still set up ticker with defaults
      });
    });
  }
  
  if (api.runtime && api.runtime.onInstalled) {
    api.runtime.onInstalled.addListener(() => {
      console.log('[ODKP Reminder] Extension installed/updated, reinitializing...');
      loadSettings().then(() => {
        ensureTicker();
      }).catch(() => {
        ensureTicker(); // Still set up ticker with defaults
      });
    });
  }

  try {
    console.log('[ODKP Reminder] 🚀 Initializing reminder scheduler...');
    console.log('[ODKP Reminder] 📋 Initialization order: loadSettings() → ensureTicker() (after settings load)');
    console.log('[ODKP Reminder] 🌐 Browser API:', {
      hasAlarms: !!(api.alarms || (typeof chrome !== 'undefined' && chrome.alarms) || (typeof browser !== 'undefined' && browser.alarms)),
      apiType: typeof browser !== 'undefined' ? 'browser' : 'chrome',
      hasStorage: !!api.storage,
      hasStorageSync: !!(api.storage && api.storage.sync),
      timestamp: new Date().toISOString()
    });
    
    // Load settings first, then set up ticker AFTER settings are loaded
    // This ensures cached state is populated before ensureTicker() runs
    // This is critical for Firefox where background scripts may restart
    loadSettings().then(() => {
      console.log('[ODKP Reminder] ✅ Settings loaded, now calling ensureTicker()');
      ensureTicker();
    }).catch((err) => {
      console.error('[ODKP Reminder] ❌ Error loading settings, still setting up ticker:', err);
      // Still set up ticker even if settings load fails (will use defaults)
      ensureTicker();
    });
    (api.storage && api.storage.onChanged) && api.storage.onChanged.addListener((changes, area)=>{
      console.log('[ODKP Reminder] 🔔 storage.onChanged event fired:', {
        area: area,
        changedKeys: Object.keys(changes),
        hasReminders: !!changes.reminders,
        hasReminderPrefs: !!changes.reminderPrefs,
        hasSoundProfile: !!changes.soundProfile,
        reminderNewValue: changes.reminders ? {
          isArray: Array.isArray(changes.reminders.newValue),
          length: Array.isArray(changes.reminders.newValue) ? changes.reminders.newValue.length : 'N/A',
          enabledCount: Array.isArray(changes.reminders.newValue) ? changes.reminders.newValue.filter(r => r && r.enabled).length : 'N/A'
        } : 'N/A',
        timestamp: new Date().toISOString()
      });
      
      if (area === 'sync' && (changes.reminders || changes.reminderPrefs || changes.soundProfile)) {
        console.log('[ODKP Reminder] ✅ Relevant changes detected - reloading settings...');
        loadSettings().then(() => {
          // Ensure ticker is still running after settings reload
          console.log('[ODKP Reminder] 🔄 Calling ensureTicker after settings change...');
          ensureTicker();
        }).catch(() => {
          // Still refresh ticker even if settings load fails
          ensureTicker();
        });
      } else {
        console.log('[ODKP Reminder] ⏭️ Changes not relevant to reminders - skipping reload');
      }
    });
    // Clean up window tracking when windows/tabs are closed manually
    if (api.windows && api.windows.onRemoved) {
      api.windows.onRemoved.addListener((windowId) => {
        for (const remId in reminderWindows) {
          const windows = reminderWindows[remId];
          const index = windows.findIndex(w => w.type === 'window' && w.id === windowId);
          if (index >= 0) {
            windows.splice(index, 1);
            if (windows.length === 0) delete reminderWindows[remId];
            try { console.log('[ODKP Reminder] Removed tracking for closed window', windowId, 'reminder', remId); } catch(_) {}
            break;
          }
        }
      });
    }
    if (api.tabs && api.tabs.onRemoved) {
      api.tabs.onRemoved.addListener((tabId) => {
        for (const remId in reminderWindows) {
          const windows = reminderWindows[remId];
          const index = windows.findIndex(w => w.type === 'tab' && w.id === tabId);
          if (index >= 0) {
            windows.splice(index, 1);
            if (windows.length === 0) delete reminderWindows[remId];
            try { console.log('[ODKP Reminder] Removed tracking for closed tab', tabId, 'reminder', remId); } catch(_) {}
            break;
          }
        }
      });
    }
    // Acknowledge from reminder window
    (api.runtime && api.runtime.onMessage) && api.runtime.onMessage.addListener(async (msg, sender, sendResponse)=>{
      // Firefox: this listener runs first — must handle resolveLatestRaid here or
      // sendMessage resolves to literal `false` before later listeners run.
      if (msg && msg.type === 'resolveLatestRaid') {
        var fetchFn =
          (typeof self !== 'undefined' && self.OpenDkpFetchLatestRaid) ||
          (typeof globalThis !== 'undefined' && globalThis.OpenDkpFetchLatestRaid);
        if (typeof fetchFn === 'function') {
          return fetchFn();
        }
        return { ok: false, error: 'Raid resolver not loaded' };
      }
      if (msg && msg.type === 'ackReminder') {
        const { id, ts } = msg;
        try { console.log('[ODKP Reminder] Received acknowledgment for', id, 'at', new Date(ts || Date.now()).toLocaleTimeString()); } catch(_) {}
        
        // Calculate when this reminder should fire next
        const nextFireTime = calculateNextReminderTime(id);
        delete lastFiredBoundary[id];
        if (nextFireTime) {
          cached.reminders = cached.reminders.map(r =>
            r.id === id ? { ...r, lastAckTs: nextFireTime, lastFiredBoundary: undefined } : r
          );
          try { 
            await persistReminders(cached.reminders);
            const nextDate = new Date(nextFireTime);
            console.log('[ODKP Reminder] Snoozed reminder', id, 'until', nextDate.toLocaleString());
          } catch(_) {}
        } else {
          cached.reminders = cached.reminders.map(r =>
            r.id === id ? { ...r, lastAckTs: ts || Date.now(), lastFiredBoundary: undefined } : r
          );
          try { await persistReminders(cached.reminders); } catch(_) {}
        }
        
        try { console.log('[ODKP Reminder] Cleared boundary tracking for', id); } catch(_) {}
        const senderWindowId = sender && sender.tab && sender.tab.windowId != null ? sender.tab.windowId : null;
        const senderTabId = sender && sender.tab && sender.tab.id != null ? sender.tab.id : null;
        await closeAllReminderTargets(id, senderWindowId, senderTabId);
        
        // Send response for handled message
        if (sendResponse) {
          sendResponse({ ok: true });
        }
        // Return true to indicate async response was sent
        return true;
      } else if (msg && msg.type === 'getCustomSound') {
        // Proxy IndexedDB read for custom sounds (Chrome content scripts can't access extension IndexedDB)
        const soundName = msg.soundName;
        
        // IMPORTANT: Return true immediately to keep the message channel open for async response
        // Then handle the async IndexedDB operations
        (async () => {
          try {
            // Open extension's IndexedDB
            const openSoundsDB = () => {
              return new Promise((resolve, reject) => {
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
            };
            
            const db = await openSoundsDB();
            const tx = db.transaction('sounds', 'readonly');
            const store = tx.objectStore('sounds');
            
            // Try exact match first
            const exactMatch = await new Promise((resolve, reject) => {
              const req = store.get(soundName);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            
            if (exactMatch && exactMatch.data) {
              // Convert Blob to ArrayBuffer for transmission
              const data = exactMatch.data;
              let arrayBuffer;
              
              if (data instanceof Blob) {
                arrayBuffer = await data.arrayBuffer();
              } else if (data instanceof ArrayBuffer) {
                arrayBuffer = data;
              } else {
                sendResponse({ success: false, error: 'Unsupported data format' });
                return;
              }
              
              sendResponse({ success: true, data: arrayBuffer, type: exactMatch.type || 'audio/mpeg' });
              return;
            }
            
            // Try case-insensitive match
            const allSounds = await new Promise((resolve, reject) => {
              const req = store.getAll();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            
            const match = allSounds.find(s => 
              s.name && s.name.toLowerCase().trim() === soundName.toLowerCase().trim()
            );
            
            if (match && match.data) {
              const data = match.data;
              let arrayBuffer;
              
              if (data instanceof Blob) {
                arrayBuffer = await data.arrayBuffer();
              } else if (data instanceof ArrayBuffer) {
                arrayBuffer = data;
              } else {
                sendResponse({ success: false, error: 'Unsupported data format' });
                return;
              }
              
              sendResponse({ success: true, data: arrayBuffer, type: match.type || 'audio/mpeg' });
            } else {
              sendResponse({ 
                success: false, 
                error: 'Sound not found', 
                availableSounds: allSounds.map(s => s.name || 'unnamed') 
              });
            }
          } catch (error) {
            console.error('[Background] Error getting custom sound:', error);
            sendResponse({ success: false, error: error.message || 'Unknown error' });
          }
        })();
        
        return true; // Keep channel open for async response
      }
      
      // Unknown message type - don't send response, don't keep channel open
      return false;
    });
  } catch(e) { console.warn('Reminder scheduler init failed', e); }
})();

// Auto-bid API runner (background context)
(function () {
  var api = typeof browser !== 'undefined' ? browser : chrome;

  function coerceRaids(body) {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== 'object') return [];
    if (Array.isArray(body.Models)) return body.Models;
    if (Array.isArray(body.Raids)) return body.Raids;
    return [];
  }

  function buildApiConfigFromSlug(slug) {
    var s = String(slug || '')
      .trim()
      .toLowerCase();
    return {
      apiHost: 'api.opendkp.com',
      clientSlug: s,
      cognitoClientId: OPEN_DKP_COGNITO_CLIENT_ID
    };
  }

  function storageSyncGet(keys) {
    return new Promise(function (resolve) {
      if (!api.storage || !api.storage.sync) {
        resolve({});
        return;
      }
      try {
        var maybePromise = api.storage.sync.get(keys);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(function (r) {
            resolve(r || {});
          }).catch(function () {
            resolve({});
          });
          return;
        }
      } catch (_) {}
      api.storage.sync.get(keys, function (r) {
        resolve(r || {});
      });
    });
  }

  function fetchLatestRaid() {
    return storageSyncGet(['opendkpClientSlug']).then(function (data) {
      var slug = data && data.opendkpClientSlug;
      if (!slug) {
        return { ok: false, error: 'No guild subdomain configured' };
      }
      if (typeof OpenDkpApi === 'undefined' || !OpenDkpApi.getRaids) {
        return { ok: false, error: 'API module not loaded' };
      }
      var cfg = buildApiConfigFromSlug(slug);
      return OpenDkpApi.getRaids(cfg, { count: 1 })
        .then(function (body) {
          var raids = coerceRaids(body);
          if (!raids.length) {
            return { ok: false, error: 'No raids returned' };
          }
          var raid = raids[0];
          var raidId = raid.Id != null ? raid.Id : raid.RaidId;
          var raidName = raid.Name || '';
          if (!OpenDkpApi.getRaid) {
            return {
              ok: true,
              raidId: Number(raidId),
              raidName: raidName,
              summary: { name: raidName, ticks: [] }
            };
          }
          return OpenDkpApi.getRaid(cfg, raidId)
            .then(function (full) {
              var ticks = (full.Ticks || []).map(function (t) {
                return {
                  id: t.Id != null ? t.Id : t.TickId,
                  description: t.Description,
                  value: t.Value
                };
              });
              return {
                ok: true,
                raidId: Number(raidId),
                raidName: full.Name || raidName,
                summary: { name: full.Name || raidName, ticks: ticks }
              };
            })
            .catch(function () {
              return {
                ok: true,
                raidId: Number(raidId),
                raidName: raidName,
                summary: { name: raidName, ticks: [] }
              };
            });
        })
        .catch(function (err) {
          return {
            ok: false,
            error: err && err.message ? err.message : String(err)
          };
        });
    });
  }

  function resolveLatestRaidFromBackground(sendResponse) {
    fetchLatestRaid().then(function (payload) {
      if (sendResponse) sendResponse(payload);
    });
  }

  if (typeof self !== 'undefined') {
    self.OpenDkpFetchLatestRaid = fetchLatestRaid;
    self.OpenDkpResolveLatestRaid = resolveLatestRaidFromBackground;
  } else if (typeof globalThis !== 'undefined') {
    globalThis.OpenDkpFetchLatestRaid = fetchLatestRaid;
    globalThis.OpenDkpResolveLatestRaid = resolveLatestRaidFromBackground;
  }

  function runAutoBidFromBackground(sendResponse) {
    if (typeof AutoBid === 'undefined' || !AutoBid.runAutoBidTick) {
      if (sendResponse) sendResponse({ ok: false, reason: 'AutoBid module not loaded' });
      return;
    }
    AutoBid.runAutoBidTick({ cognitoClientId: OPEN_DKP_COGNITO_CLIENT_ID })
      .then(function (result) {
        if (result && result.results && result.results.length) {
          try {
            console.log('[AutoBid]', result.results);
          } catch (_) {}
        }
        if (sendResponse) sendResponse(result || { ok: true });
      })
      .catch(function (err) {
        if (sendResponse) {
          sendResponse({ ok: false, reason: err && err.message ? err.message : String(err) });
        }
      });
  }

  if (api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === 'autoBidRun') {
        runAutoBidFromBackground(sendResponse);
        return true;
      }
      if (msg && msg.type === 'autoBidRefreshCharacters') {
        if (typeof AutoBid === 'undefined' || !AutoBid.refreshAccountCharacters) {
          if (sendResponse) sendResponse({ ok: false, error: 'AutoBid module not loaded' });
          return true;
        }
        var refreshOpts = { cognitoClientId: OPEN_DKP_COGNITO_CLIENT_ID };
        if (msg.clientSlug) refreshOpts.clientSlug = msg.clientSlug;
        if (msg.username) refreshOpts.username = msg.username;
        AutoBid.refreshAccountCharacters(refreshOpts)
          .then(function (characters) {
            if (sendResponse) sendResponse({ ok: true, characters: characters });
          })
          .catch(function (err) {
            if (sendResponse) {
              sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
            }
          });
        return true;
      }
      if (msg && msg.type === 'autoBidDisableRulesOnWin') {
        if (typeof AutoBid === 'undefined' || !AutoBid.disableRulesForAuctionWin) {
          if (sendResponse) sendResponse({ ok: false, error: 'AutoBid module not loaded' });
          return true;
        }
        AutoBid.disableRulesForAuctionWin({
          itemName: msg.itemName,
          winnerNames: msg.winnerNames
        })
          .then(function (result) {
            if (sendResponse) {
              sendResponse({ ok: true, disabled: result.disabled || [] });
            }
          })
          .catch(function (err) {
            if (sendResponse) {
              sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
            }
          });
        return true;
      }
      return false;
    });
  }
})();