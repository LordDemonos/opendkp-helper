// Background script for Firefox compatibility
// This ensures the browser API is available

console.log('Background script loaded - Firefox compatibility');

// Reminder scheduler
(function(){
  // Get browser API - Chrome uses chrome.*, Firefox uses browser.*
  const api = typeof browser !== 'undefined' ? browser : chrome;
  let cached = { reminders: [], reminderPrefs: { flash: true, notifications: true }, soundProfile: 'raidleader' };
  let tickId = null;
  // Track last fired boundary per reminder to prevent duplicate fires within same 5-min window
  let lastFiredBoundary = {}; // remId -> "HH:MM" of last 5-min boundary we fired for
  // Track open reminder windows by reminder ID
  let reminderWindows = {}; // remId -> array of window/tab IDs

  function loadSettings() {
    try {
      api.storage.sync.get(['reminders','reminderPrefs','soundProfile']).then((s)=>{
        cached.reminders = Array.isArray(s.reminders) ? s.reminders : [];
        cached.reminderPrefs = s.reminderPrefs || { flash: true, notifications: true, enabledDays: [0,1,2,3,4,5,6] };
        // Ensure enabledDays is an array with valid values
        if (!Array.isArray(cached.reminderPrefs.enabledDays)) {
          cached.reminderPrefs.enabledDays = [0,1,2,3,4,5,6]; // Default to all days
        }
        cached.soundProfile = s.soundProfile || 'raidleader';
        // Don't clear fired boundary tracking on settings load - only clear when reminders are actually changed
        // This prevents losing tracking if service worker restarts between boundaries
        // lastFiredBoundary = {}; // REMOVED - let boundary tracking persist across service worker restarts
        const enabledReminders = cached.reminders.filter(r => r && r.enabled);
        console.log('[ODKP Reminder] Settings loaded:', {
          totalReminders: cached.reminders.length,
          enabledReminders: enabledReminders.length,
          profile: cached.soundProfile,
          enabledDays: cached.reminderPrefs.enabledDays,
          reminderDetails: enabledReminders.map(r => ({
            id: r.id,
            start: r.start,
            end: r.end,
            message: r.message,
            lastAckTs: r.lastAckTs ? new Date(r.lastAckTs).toLocaleString() : 'none'
          }))
        });
      }).catch((e)=>{
        console.warn('[ODKP Reminder] Error loading settings:', e);
      });
    } catch(e) {
      console.warn('[ODKP Reminder] Error in loadSettings:', e);
    }
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

  function onTick() {
    const now = new Date();
    const hm = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
    const minute = now.getMinutes();
    const ts = Date.now();
    
    try {
      console.log('[ODKP Reminder] Tick at', hm, '- minute:', minute, '- profile:', cached.soundProfile);
    } catch(_) {}
    
    if (cached.soundProfile !== 'raidleader') {
      try { console.log('[ODKP Reminder] Skipping - not raidleader profile'); } catch(_) {}
      return; // only raid leader
    }
    
    // Check if reminders are enabled
    const enabledReminders = (cached.reminders || []).filter(r => r && r.enabled);
    if (enabledReminders.length === 0) {
      try { console.log('[ODKP Reminder] No enabled reminders configured'); } catch(_) {}
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
        delete lastFiredBoundary[rem.id];
        return;
      }
      
      // Prevent duplicate fires: only fire once per 5-minute boundary
      // This check prevents firing multiple times at the same 5-minute mark
      const lastBoundary = lastFiredBoundary[rem.id];
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
          api.storage.sync.set({ reminders: updated });
        } catch(_) {}
      }
      
      // All checks passed - fire the reminder
      try { 
        console.log('[ODKP Reminder] 🔔 FIRING reminder', rem.id, 'at', hm, 'window', start, '-', end, 'lastBoundary:', lastBoundary || 'none', 'message:', rem.message || 'Run /outputfile raidlist'); 
      } catch(_) {}
      lastFiredBoundary[rem.id] = currentBoundary; // Mark as fired for this boundary
      triggerReminder(rem);
    });
  }

  function ensureTicker() {
    // Clear any existing interval
    if (tickId) clearInterval(tickId);
    
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
        alarmsAPI.create('reminder-ticker', { periodInMinutes: 1 });
        
        console.log('[ODKP Reminder] Ticker started using alarms API - will check every minute');
      } catch(e) {
        console.warn('[ODKP Reminder] Failed to use alarms API, falling back to setInterval:', e);
        // Fallback to setInterval if alarms API fails
        tickId = setInterval(onTick, 30*1000);
      }
    } else {
      // Fallback for browsers without alarms API (shouldn't happen in Chrome/Firefox)
      console.log('[ODKP Reminder] Alarms API not available, using setInterval');
      tickId = setInterval(onTick, 30*1000);
    }
    
    // Don't run onTick() immediately - let it fire naturally at the next 5-minute boundary
    // Running immediately can cause reminders to fire right when enabled (undesired behavior)
    // The alarm will wake the service worker at the next minute boundary
    console.log('[ODKP Reminder] Ticker configured - will check at next minute boundary');
  }

  // Set up alarm listener once during initialization
  // Ensure alarms API is available (Chrome provides it via chrome.alarms, Firefox via browser.alarms)
  const alarmsAPIInit = api.alarms || (typeof chrome !== 'undefined' && chrome.alarms) || (typeof browser !== 'undefined' && browser.alarms);
  if (alarmsAPIInit && alarmsAPIInit.onAlarm) {
    alarmsAPIInit.onAlarm.addListener((alarm) => {
      if (alarm.name === 'reminder-ticker') {
        onTick();
      } else if (alarm.name === 'service-worker-keepalive') {
        // Keep service worker alive - this alarm fires every ~4 minutes
        // Chrome terminates service workers after 5 minutes of inactivity
        console.log('[ODKP Reminder] Service worker keepalive ping');
        // Do nothing, just being called keeps us alive
      }
    });
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
      loadSettings();
      ensureTicker();
    });
  }
  
  if (api.runtime && api.runtime.onInstalled) {
    api.runtime.onInstalled.addListener(() => {
      console.log('[ODKP Reminder] Extension installed/updated, reinitializing...');
      loadSettings();
      ensureTicker();
    });
  }

  try {
    console.log('[ODKP Reminder] Initializing reminder scheduler...');
    loadSettings();
    ensureTicker();
    (api.storage && api.storage.onChanged) && api.storage.onChanged.addListener((changes, area)=>{
      if (area === 'sync' && (changes.reminders || changes.reminderPrefs || changes.soundProfile)) {
        console.log('[ODKP Reminder] Settings changed, reloading...', Object.keys(changes));
        loadSettings();
        // Ensure ticker is still running after settings reload
        ensureTicker();
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
      if (msg && msg.type === 'ackReminder') {
        const { id, ts } = msg;
        try { console.log('[ODKP Reminder] Received acknowledgment for', id, 'at', new Date(ts || Date.now()).toLocaleTimeString()); } catch(_) {}
        
        // Calculate when this reminder should fire next
        const nextFireTime = calculateNextReminderTime(id);
        if (nextFireTime) {
          // Store the calculated next fire time as acknowledgment timestamp
          // This will prevent firing until that time
          cached.reminders = cached.reminders.map(r => r.id===id ? { ...r, lastAckTs: nextFireTime } : r);
          try { 
            await api.storage.sync.set({ reminders: cached.reminders });
            const nextDate = new Date(nextFireTime);
            console.log('[ODKP Reminder] Snoozed reminder', id, 'until', nextDate.toLocaleString());
          } catch(_) {}
        } else {
          // Fallback: use current timestamp (shouldn't happen if reminders are valid)
          cached.reminders = cached.reminders.map(r => r.id===id ? { ...r, lastAckTs: ts||Date.now() } : r);
          try { await api.storage.sync.set({ reminders: cached.reminders }); } catch(_) {}
        }
        
        // Clear boundary tracking so it doesn't fire again at the same boundary
        delete lastFiredBoundary[id];
        try { console.log('[ODKP Reminder] Cleared boundary tracking for', id); } catch(_) {}
        // Close all windows/tabs for this reminder
        // Make a copy of the array since onRemoved listeners might modify it during iteration
        const windows = [...(reminderWindows[id] || [])];
        if (windows.length > 0) {
          try { console.log('[ODKP Reminder] Closing', windows.length, 'windows for reminder', id); } catch(_) {}
          let closedCount = 0;
          for (const winInfo of windows) {
            try {
              // Check if window/tab still exists before trying to close
              let exists = false;
              if (winInfo.type === 'window' && api.windows && api.windows.get) {
                try {
                  await api.windows.get(winInfo.id);
                  exists = true;
                } catch(_) {
                  // Window doesn't exist anymore, skip it
                  try { console.log('[ODKP Reminder] Window', winInfo.id, 'already closed'); } catch(_) {}
                }
              } else if (winInfo.type === 'tab' && api.tabs && api.tabs.get) {
                try {
                  await api.tabs.get(winInfo.id);
                  exists = true;
                } catch(_) {
                  // Tab doesn't exist anymore, skip it
                  try { console.log('[ODKP Reminder] Tab', winInfo.id, 'already closed'); } catch(_) {}
                }
              } else {
                exists = true; // If we can't check, try to close anyway
              }
              
              if (exists) {
                if (winInfo.type === 'window' && api.windows && api.windows.remove) {
                  await api.windows.remove(winInfo.id);
                  closedCount++;
                  try { console.log('[ODKP Reminder] Closed window', winInfo.id); } catch(_) {}
                } else if (winInfo.type === 'tab' && api.tabs && api.tabs.remove) {
                  await api.tabs.remove(winInfo.id);
                  closedCount++;
                  try { console.log('[ODKP Reminder] Closed tab', winInfo.id); } catch(_) {}
                }
              }
            } catch(err) {
              // Check if error is because window/tab doesn't exist (common, not a real error)
              const isNotFound = err && (err.message?.includes('No such') || err.message?.includes('does not exist') || 
                                         err.message?.includes('Invalid'));
              if (!isNotFound) {
                try { console.warn('[ODKP Reminder] Failed to close', winInfo.type, winInfo.id, err); } catch(_) {}
              }
            }
          }
          try { console.log('[ODKP Reminder] Closed', closedCount, 'of', windows.length, 'windows for reminder', id); } catch(_) {}
          // Clear tracked windows after attempting to close all
          delete reminderWindows[id];
        }
        
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