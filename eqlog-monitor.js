(function(){
  // Browser detection for cross-compatibility
  const api = typeof browser !== 'undefined' ? browser : chrome;

  // Issue #3: Show correct paste shortcut (Cmd+V on Mac, Ctrl+V elsewhere)
  const pasteShortcutEl = document.getElementById('pasteShortcut');
  if (pasteShortcutEl && /Mac|iPod|iPhone|iPad/.test(navigator.platform)) pasteShortcutEl.textContent = 'Cmd+V';
  
  const fileInput = () => document.getElementById('fileInput');
  const pickBtn = () => document.getElementById('pick');
  const logEl = () => document.getElementById('log');
  const nameEl = () => document.getElementById('fileName');
  const tagInput = () => document.getElementById('tagInput');
  const scanLatestNowEl = () => document.getElementById('scanLatestNow');
  const lootEventsEl = () => document.getElementById('lootEvents');
  const raidStatusEl = () => document.getElementById('raidStatus');

  let monitoring = false;
  let timer = null;
  let selectedFile = null;
  /** @type {FileSystemFileHandle | null} Chrome: refreshed each poll via getFile() */
  let logFileHandle = null;
  let lastSeenLogLine = null;
  let tag = 'FG';
  let autoPostEnabled = false;
  let pollInFlight = false;
  let lootExceptions = [];
  let raidLeaderMode = true;

  function addLog(msg){ if (logEl()){ const d=document.createElement('div'); d.textContent=`${new Date().toLocaleTimeString()} ${msg}`; logEl().appendChild(d); logEl().scrollTop=logEl().scrollHeight; } }

  async function loadProfileMode() {
    const data = await api.storage.sync.get(['soundProfile']);
    raidLeaderMode = data.soundProfile === 'raidleader';
    applyRaidLeaderOnlyUi();
  }

  function applyRaidLeaderOnlyUi() {
    const raidStatus = raidStatusEl();
    const autoPostBtn = document.getElementById('toggleAutoPost');
    if (raidStatus) raidStatus.style.display = raidLeaderMode ? '' : 'none';
    if (autoPostBtn) autoPostBtn.style.display = raidLeaderMode ? '' : 'none';
  }

  function isLogFileBusyError(err) {
    const name = err && err.name ? String(err.name) : '';
    const msg = (err && err.message ? err.message : String(err || '')).toLowerCase();
    return name === 'NotReadableError'
      || name === 'NotAllowedError'
      || msg.includes('locked')
      || msg.includes('could not be read')
      || msg.includes('permission')
      || msg.includes('access');
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () {
        reject(reader.error || new Error('Failed to read file'));
      };
      reader.readAsText(file);
    });
  }

  async function readLogContent() {
    let file = selectedFile;
    if (logFileHandle && typeof logFileHandle.getFile === 'function') {
      try {
        file = await logFileHandle.getFile();
        selectedFile = file;
      } catch (err) {
        console.warn('[EQ Log Monitor] getFile() failed, using last file snapshot:', err);
      }
    }
    if (!file) throw new Error('No file selected');
    return readFileAsText(file);
  }

  async function onLogFileChosen(file, handle) {
    selectedFile = file;
    logFileHandle = handle || null;
    if (!file) {
      console.log('[EQ Log Monitor] No file selected');
      return;
    }
    console.log('[EQ Log Monitor] File selected:', file.name, handle ? '(persistent handle)' : '(file input)');
    if (nameEl()) nameEl().textContent = file.name;
    await api.storage.sync.set({ eqLogFileMeta: { name: file.name, lastModified: file.lastModified } });

    const tagData = await api.storage.sync.get(['eqLogTag']);
    tag = (tagData.eqLogTag || 'FG');
    if (tagInput()) tagInput().value = tag;
    console.log('[EQ Log Monitor] Using tag:', tag);

    if (handle) {
      addLog('File linked — will retry automatically if EverQuest is writing to the log.');
    }

    if (!monitoring) {
      console.log('[EQ Log Monitor] Starting monitoring...');
      const captureLatest = !scanLatestNowEl || (scanLatestNowEl() && scanLatestNowEl().checked);
      console.log('[EQ Log Monitor] Capture latest:', captureLatest);
      if (!captureLatest) {
        try {
          const text = await readLogContent();
          const lines = text.split('\n');
          for (let i = lines.length - 1; i >= 0; i--) {
            let line = lines[i].trim();
            if (!line) continue;
            if (window.EqLogParse) line = EqLogParse.normalizeLogLine(line);
            if (detectLootLine(line, tag)) {
              lastSeenLogLine = line;
              console.log('[EQ Log Monitor] Primed with line:', line.substring(0, 50));
              break;
            }
          }
          if (lastSeenLogLine) addLog('Primed with latest loot line; will only capture new ones.');
        } catch (e) {
          console.error('[EQ Log Monitor] Error priming:', e);
          if (isLogFileBusyError(e)) {
            addLog('Log file busy while priming — will retry on the next poll.');
          } else {
            addLog('Error priming: ' + (e.message || String(e)));
          }
        }
      } else {
        try {
          const text = await readLogContent();
          const lines = text.split('\n');
          let latestLootLine = null;
          for (let i = lines.length - 1; i >= 0; i--) {
            let line = lines[i].trim();
            if (!line) continue;
            if (window.EqLogParse) line = EqLogParse.normalizeLogLine(line);
            if (detectLootLine(line, tag)) {
              latestLootLine = line;
              console.log('[EQ Log Monitor] Found latest loot line to capture:', line.substring(0, 50));
              break;
            }
          }
          if (latestLootLine) {
            addLog('Capturing latest loot line...');
            await pushEvent(latestLootLine);
            lastSeenLogLine = latestLootLine;
            addLog('Latest loot line captured.');
          } else {
            addLog('No loot line found with tag: ' + tag);
          }
        } catch (e) {
          console.error('[EQ Log Monitor] Error capturing latest:', e);
          if (isLogFileBusyError(e)) {
            addLog('Log file busy — will capture new loot when the game releases the file.');
          } else {
            addLog('Error capturing latest: ' + (e.message || String(e)));
          }
        }
      }
      start();
    } else {
      addLog('File changed.');
    }
    console.log('[EQ Log Monitor] Running initial poll...');
    poll();
  }

  async function openLogFilePicker() {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const handles = await window.showOpenFilePicker({
          types: [{ description: 'EverQuest log', accept: { 'text/plain': ['.txt', '.log'] } }],
          multiple: false
        });
        const handle = handles && handles[0];
        if (handle) {
          const file = await handle.getFile();
          await onLogFileChosen(file, handle);
          return;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        console.warn('[EQ Log Monitor] showOpenFilePicker failed, using file input:', e);
      }
    }
    if (fileInput()) fileInput().click();
  }

  function formatLocalDate(d) {
    const now = d || new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  async function updateRaidStatusBanner(forceRefresh) {
    const el = raidStatusEl();
    if (!el || !window.LootQueue || !raidLeaderMode) return;
    try {
      const readCtx = LootQueue.readValidatedLootQueueContext || LootQueue.readLootQueueContext;
      const ctx = await readCtx(!!forceRefresh);
      el.textContent = 'Bidding queue → ' + LootQueue.formatRaidLabel(ctx);
      if (ctx.raidValid === false || ctx.raidId == null) {
        el.classList.add('raid-status-invalid');
      } else {
        el.classList.remove('raid-status-invalid');
      }
    } catch (_) {
      el.textContent = '';
      el.classList.remove('raid-status-invalid');
    }
  }

  async function resetAutoPostOnStartup() {
    autoPostEnabled = false;
    updateAutoPostButton();
    await api.storage.sync.set({ eqLogAutoPost: false });
    addLog('Auto post is off — turn on manually when ready.');
  }

  function updateAutoPostButton() {
    const btn = document.getElementById('toggleAutoPost');
    if (!btn) return;
    if (autoPostEnabled) {
      btn.textContent = 'Auto post: On';
      btn.classList.remove('off');
      btn.classList.add('on');
    } else {
      btn.textContent = 'Auto post: Off';
      btn.classList.remove('on');
      btn.classList.add('off');
    }
  }

  async function toggleAutoPostSetting() {
    autoPostEnabled = !autoPostEnabled;
    await api.storage.sync.set({ eqLogAutoPost: autoPostEnabled });
    updateAutoPostButton();
    addLog(autoPostEnabled ? 'Auto post enabled — new loot will queue automatically.' : 'Auto post disabled.');
  }

  async function markEventQueueStatus(eventId, fullyQueued) {
    const data = await api.storage.sync.get(['eqLogEvents']);
    const list = data.eqLogEvents || [];
    const idx = list.findIndex(function (e) { return String(e.id) === String(eventId); });
    if (idx < 0) return;
    list[idx].opendkpQueued = !!fullyQueued;
    await api.storage.sync.set({ eqLogEvents: list });
  }

  async function queueLootItems(itemNames, btn, eventId) {
    if (!raidLeaderMode) {
      addLog('Loot queue is available in Raid Leader mode only.');
      return false;
    }
    if (!window.LootQueue || !LootQueue.queueItemsToCurrentRaid) {
      addLog('Loot queue module not loaded.');
      return false;
    }
    const names = (itemNames || []).filter(function (n) { return String(n || '').trim(); });
    if (!names.length) return false;
    const original = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '…';
    }
    try {
      const result = await LootQueue.queueItemsToCurrentRaid(names);
      const labels = result.queued.map(function (q) { return q.label; }).join(', ');
      addLog('Queued ' + result.queued.length + ' item(s): ' + labels + ' → Raid #' + result.raidId);
      if (result.failed && result.failed.length) {
        addLog('Could not queue: ' + result.failed.map(function (f) {
          return f.rawName + ' (' + f.error + ')';
        }).join('; '));
      }
      if (eventId) {
        await markEventQueueStatus(eventId, !result.failed || !result.failed.length);
      }
      if (btn) {
        btn.textContent = '✓';
        setTimeout(function () {
          btn.textContent = original;
          btn.disabled = false;
        }, 1500);
      }
      return true;
    } catch (e) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original;
      }
      addLog('Queue failed: ' + (e.message || String(e)));
      return false;
    }
  }

  async function autoPostLootItems(items, eventId) {
    if (!raidLeaderMode || !items || !items.length) return;
    addLog('Auto posting ' + items.length + ' item(s)...');
    await queueLootItems(items, null, eventId);
  }

  async function postAllForEvent(eventId, btn) {
    const data = await api.storage.sync.get(['eqLogEvents']);
    const event = (data.eqLogEvents || []).find(function (e) {
      return String(e.id) === String(eventId);
    });
    if (!event || !event.items || !event.items.length) {
      addLog('No items found for that loot line.');
      return;
    }
    await queueLootItems(event.items, btn, eventId);
  }

  async function clearTodayLootEvents() {
    const today = formatLocalDate();
    const data = await api.storage.sync.get(['eqLogEvents']);
    const all = data.eqLogEvents || [];
    const kept = all.filter(function (e) { return e.date !== today; });
    const removed = all.length - kept.length;
    await api.storage.sync.set({ eqLogEvents: kept });
    addLog(removed ? 'Cleared ' + removed + ' loot event(s) for today.' : 'No loot events for today to clear.');
    renderLootEventsPanel();
  }

  async function renderLootEventsPanel() {
    const container = lootEventsEl();
    if (!container) return;
    const today = formatLocalDate();
    const data = await api.storage.sync.get(['eqLogEvents']);
    const events = (data.eqLogEvents || []).filter(e => e.date === today).slice(0, 30);
    await updateRaidStatusBanner();
    if (!events.length) {
      container.innerHTML = '<div class="empty-loot">No loot captured yet today.</div>';
      return;
    }
    const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    const escAttr = (s) => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;');
    container.innerHTML = events.map(event => {
      const itemsHtml = (event.items || []).map(item => {
        const queueBtn = raidLeaderMode
          ? `<button class="btn-queue" data-item="${escAttr(item)}">Queue</button>`
          : '';
        return `<div class="loot-item">
          <span class="loot-item-name">${esc(item)}</span>
          <div class="loot-item-actions">
            <button class="btn-copy" data-item="${escAttr(item)}">Copy</button>
            ${queueBtn}
          </div>
        </div>`;
      }).join('');
      const ts = esc(event.timestamp || '');
      const eventId = escAttr(String(event.id != null ? event.id : ''));
      const postAllBtn = raidLeaderMode
        ? `<button type="button" class="btn-post-all" data-event-id="${eventId}">Post all</button>`
        : '';
      return `<div class="loot-event" data-event-id="${eventId}">
        <div class="loot-event-header">
          <div class="loot-event-ts">${ts}</div>
          ${postAllBtn}
        </div>
        ${itemsHtml}
      </div>`;
    }).join('');

    container.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-item');
        navigator.clipboard.writeText(text).then(() => addLog('Copied: ' + text)).catch(() => addLog('Copy failed'));
      });
    });
    container.querySelectorAll('.btn-queue').forEach(btn => {
      btn.addEventListener('click', () => queueLootItem(btn));
    });
    container.querySelectorAll('.btn-post-all').forEach(btn => {
      btn.addEventListener('click', function () {
        postAllForEvent(btn.getAttribute('data-event-id'), btn);
      });
    });
  }

  async function queueLootItem(btn) {
    const itemName = btn.getAttribute('data-item');
    await queueLootItems([itemName], btn);
  }

  function detectLootLine(line, tagArg) {
    if (window.EqLogParse) {
      return EqLogParse.detectLootLine(line, tagArg || tag);
    }
    return false;
  }

  async function loadLootExceptions() {
    const data = await api.storage.sync.get(['eqLogLootExceptions']);
    lootExceptions = Array.isArray(data.eqLogLootExceptions) ? data.eqLogLootExceptions : [];
  }

  function filterExtractedItems(items) {
    if (!items || !items.length) return [];
    if (window.EqLogParse && EqLogParse.filterExcludedItems) {
      return EqLogParse.filterExcludedItems(items, lootExceptions);
    }
    return items;
  }

  function extractItems(line, tagArg) {
    if (window.EqLogParse) {
      return filterExtractedItems(EqLogParse.extractItems(line, tagArg || tag));
    }
    return [];
  }

  async function pushEvent(line){
    const normalizedLine = window.EqLogParse ? EqLogParse.normalizeLogLine(line) : String(line || '').trim();
    const rawItems = window.EqLogParse
      ? EqLogParse.extractItems(normalizedLine, tag)
      : [];
    const items = filterExtractedItems(rawItems);
    if (!items.length) {
      if (rawItems.length) {
        addLog('Ignored excluded loot: ' + rawItems.join(', '));
      }
      return;
    }
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const data = await api.storage.sync.get(['eqLogEvents']);
    const list = (data.eqLogEvents||[]);
    const existing = list.find(function (e) { return e.logLine === normalizedLine; });
    if (existing) {
      if (autoPostEnabled && !existing.opendkpQueued) {
        addLog('Retrying auto post for: ' + (existing.items || items).join(', '));
        await autoPostLootItems(existing.items || items, existing.id);
      } else {
        addLog('Already captured: ' + items.join(', '));
      }
      return;
    }
    const event = {
      id: Date.now()+Math.random().toString(36).slice(2),
      timestamp: (normalizedLine.match(/\[([^\]]+)\]/)||[])[1]||new Date().toLocaleString(),
      date: localDate,
      items,
      logLine: normalizedLine,
      opendkpQueued: false
    };
    console.log('[EQ Log Monitor] Saving event:', { date: localDate, items: items.length, timestamp: event.timestamp });
    list.unshift(event);
    if (list.length>200) list.splice(200);
    await api.storage.sync.set({ eqLogEvents: list });
    console.log('[EQ Log Monitor] Saved', list.length, 'total events to storage');
    renderLootEventsPanel();
    if (autoPostEnabled) {
      await autoPostLootItems(items, event.id);
    }
  }

  async function poll(){
    if (pollInFlight) {
      console.log('[EQ Log Monitor] Poll skipped — previous poll still running');
      return;
    }
    pollInFlight = true;
    try {
      if (!selectedFile) {
        console.log('[EQ Log Monitor] Poll skipped - no file selected');
        return;
      }
      if (!window.EqLogParse) {
        addLog('Parser not loaded — reload the extension.');
        return;
      }
      console.log('[EQ Log Monitor] Polling file:', selectedFile.name, '- Tag:', tag);
      const text = await readLogContent();
      const lines = text.split('\n');
      console.log('[EQ Log Monitor] File has', lines.length, 'lines, searching from end...');
      let checkedLines = 0;
      let potentialMatches = 0;
      
      // Collect all new loot lines (those after lastSeenLogLine)
      const newLootLines = [];
      let foundLastSeenLine = false;
      
      // Search backwards (newest to oldest)
      for (let i=lines.length-1;i>=0;i--){
        let line = lines[i].trim();
        if (!line) continue;
        line = EqLogParse.normalizeLogLine(line);
        checkedLines++;
        
        if (window.EqLogParse && EqLogParse.looksLikeLootChannel(line)) {
          potentialMatches++;
          console.log('[EQ Log Monitor] Potential loot line found:', line.substring(0, 100));
        }
        
        const isLootLine = detectLootLine(line, tag);
        if (!isLootLine) continue;
        
        // If we've found the last seen line, we've collected all new lines
        if (lastSeenLogLine && lastSeenLogLine === line) { 
          foundLastSeenLine = true;
          console.log('[EQ Log Monitor] Found last seen line, stopping collection');
          break;
        }
        
        // This is a new loot line (after lastSeenLogLine)
        console.log('[EQ Log Monitor] ✅ Found new loot line with tag "' + tag + '":', line.substring(0, 100));
        newLootLines.push(line);
      }
      
      // Process new loot lines in chronological order (oldest first)
      newLootLines.reverse();
      
      if (newLootLines.length === 0) {
        if (foundLastSeenLine) {
          addLog('No new loot lines.');
          console.log('[EQ Log Monitor] No new loot lines since last check');
        } else {
          addLog('No loot line matched (looking for raid/party/say tells with tag "' + tag + '").');
          console.log('[EQ Log Monitor] No loot line found in last', checkedLines, 'lines (found', potentialMatches, 'potential raid/party/say lines)');
          if (potentialMatches > 0 && checkedLines <= 20) {
            console.log('[EQ Log Monitor] ⚠️ Found potential loot lines but tag "' + tag + '" did not match');
          }
        }
        return;
      }
      
      const maxProcessPerPoll = 10;
      const linesToProcess = newLootLines.length > maxProcessPerPoll 
        ? newLootLines.slice(-maxProcessPerPoll)
        : newLootLines;
      
      if (newLootLines.length > maxProcessPerPoll) {
        console.warn('[EQ Log Monitor] Too many new loot lines (' + newLootLines.length + '), processing only the ' + maxProcessPerPoll + ' most recent');
        addLog('Found ' + newLootLines.length + ' loot lines, processing ' + maxProcessPerPoll + ' most recent...');
      }
      
      console.log('[EQ Log Monitor] Processing', linesToProcess.length, 'new loot line(s)');
      for (const line of linesToProcess) {
        addLog('New loot line found, pushing...');
        await pushEvent(line);
      }
      
      if (linesToProcess.length > 0) {
        lastSeenLogLine = linesToProcess[linesToProcess.length - 1];
        console.log('[EQ Log Monitor] Updated lastSeenLogLine to:', lastSeenLogLine.substring(0, 100));
      }
    } catch(e){ 
      console.error('[EQ Log Monitor] Poll error:', e);
      if (isLogFileBusyError(e)) {
        const now = Date.now();
        if (!window.lastPermissionError || (now - window.lastPermissionError) > 120000) {
          addLog('Log file busy (EverQuest is writing). Retrying automatically…');
          window.lastPermissionError = now;
        }
      } else {
        addLog('Error: ' + (e.message || String(e)));
      }
    } finally {
      pollInFlight = false;
    }
  }

  async function start(){
    const s = await api.storage.sync.get(['eqLogTag']);
    tag = (s.eqLogTag)||'FG';
    if (tagInput()) tagInput().value = tag;
    monitoring = true; 
    console.log('[EQ Log Monitor] Monitoring started. Tag:', tag);
    addLog('Monitoring started. Tag: '+tag);
    timer = setInterval(() => {
      console.log('[EQ Log Monitor] Poll interval tick');
      poll();
    }, 3000);
    // Set monitoring status in storage
    await api.storage.sync.set({ eqLogMonitoring: true });
  }

  function stop(){ monitoring=false; if (timer) clearInterval(timer); timer=null; addLog('Monitoring stopped.'); }

  function init(){
    console.log('[EQ Log Monitor] Initializing...');
    loadProfileMode().then(function () {
      if (!raidLeaderMode) {
        addLog('Raider mode — loot queue and raid controls are hidden.');
      }
      bootMonitorUi();
    });
  }

  function bootMonitorUi(){
    if (pickBtn()) pickBtn().addEventListener('click', function () { openLogFilePicker(); });
    if (fileInput()) fileInput().addEventListener('change', async function () {
      const file = (fileInput().files || [])[0];
      logFileHandle = null;
      await onLogFileChosen(file, null);
    });
    if (tagInput()) {
      tagInput().addEventListener('input', async ()=>{
        tag = tagInput().value || 'FG';
        await api.storage.sync.set({ eqLogTag: tag });
        addLog('Tag set to: '+tag);
      });
    }
    window.addEventListener('beforeunload', async ()=>{
      stop();
      await api.storage.sync.set({ eqLogMonitoring: false, eqLogMonitorWindowId: null });
    });
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.soundProfile) {
        loadProfileMode().then(function () {
          renderLootEventsPanel();
        });
      }
      if (area === 'sync' && changes.eqLogEvents) renderLootEventsPanel();
      if (area === 'sync' && changes.eqLogLootExceptions) {
        lootExceptions = Array.isArray(changes.eqLogLootExceptions.newValue)
          ? changes.eqLogLootExceptions.newValue
          : [];
      }
      if (area === 'sync' && changes.eqLogAutoPost) {
        autoPostEnabled = !!changes.eqLogAutoPost.newValue;
        updateAutoPostButton();
      }
      if (area === 'sync' && (changes.opendkpCurrentRaidId || changes.opendkpCurrentRaidSummaryJson)) {
        updateRaidStatusBanner(true);
      }
    });
    resetAutoPostOnStartup();
    loadLootExceptions();
    updateRaidStatusBanner(true);
    renderLootEventsPanel();
    const autoPostBtn = document.getElementById('toggleAutoPost');
    if (autoPostBtn) {
      autoPostBtn.addEventListener('click', toggleAutoPostSetting);
    }
    const clearBtn = document.getElementById('clearTodayLoot');
    if (clearBtn) {
      clearBtn.addEventListener('click', async function () {
        const ok = confirm(
          "Clear all loot captured today from this list?\n\nThis only clears the extension's local list — it does not remove auctions already queued on OpenDKP."
        );
        if (!ok) return;
        await clearTodayLootEvents();
      });
    }
    // attempt auto open picker first time
    setTimeout(function () { openLogFilePicker(); }, 100);
  }

  document.addEventListener('DOMContentLoaded', init);
})();


