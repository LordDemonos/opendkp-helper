(function(){
  // Browser detection for cross-compatibility
  const api = typeof browser !== 'undefined' ? browser : chrome;

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
  /** Byte offset in the log file — only content after this is scanned on each poll. */
  let logReadOffset = 0;
  /** Incomplete line carried over when a read ends mid-line. */
  let partialLineBuffer = '';
  /** After a failed prime, skip historical lines on first successful read. */
  let needsEndOffsetSync = false;
  let tag = 'FG';
  let autoPostEnabled = false;
  let pollInFlight = false;
  let lootExceptions = [];
  let raidLeaderMode = true;
  let consecutiveReadFailures = 0;
  let sessionKeepAliveTimer = null;
  const OPEN_DKP_COGNITO_CLIENT_ID = '2sq61k8dj39e309tnh5tm70dd4';

  /** Tail size for handle-based setup reads — smaller reads release the lock sooner on Windows. */
  var TAIL_READ_BYTES = 256 * 1024;
  var READ_RETRY_COUNT = 16;
  var READ_RETRY_DELAY_MS = 75;

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function refreshSelectedFileFromInput() {
    if (logFileHandle) return;
    var inp = fileInput();
    if (inp && inp.files && inp.files.length > 0) {
      selectedFile = inp.files[0];
    }
  }

  async function refreshLogFile() {
    refreshSelectedFileFromInput();
    if (logFileHandle && typeof logFileHandle.getFile === 'function') {
      try {
        selectedFile = await logFileHandle.getFile();
      } catch (err) {
        console.warn('[EQ Log Monitor] getFile() failed, using last file snapshot:', err);
      }
    }
    return selectedFile;
  }

  function resetLogReadState() {
    logReadOffset = 0;
    partialLineBuffer = '';
    needsEndOffsetSync = false;
  }

  function trimTailBlobText(text, truncated) {
    if (!truncated || !text || text.length === 0) return text;
    const firstNl = text.indexOf('\n');
    return firstNl !== -1 ? text.slice(firstNl + 1) : text;
  }

  async function syncLogReadOffsetToEnd() {
    const file = await refreshLogFile();
    if (!file) return;
    if (logFileHandle) {
      logReadOffset = file.size;
    } else {
      // Snapshot mode (Firefox): file.size is frozen at pick time, but reading the
      // whole File object returns current disk content — track offset in characters.
      const text = await readFileAsTextWithRetry(file);
      logReadOffset = text.length;
    }
    partialLineBuffer = '';
    needsEndOffsetSync = false;
  }

  function parseCompleteLinesFromText(text) {
    const lastNl = text.lastIndexOf('\n');
    if (lastNl === -1) {
      return { lines: [], remainder: text };
    }
    const remainder = text.slice(lastNl + 1);
    const completeText = text.slice(0, lastNl);
    const lines = [];
    completeText.split('\n').forEach(function (raw) {
      const trimmed = raw.trim();
      if (!trimmed) return;
      lines.push(window.EqLogParse ? EqLogParse.normalizeLogLine(trimmed) : trimmed);
    });
    return { lines: lines, remainder: remainder };
  }

  function addLog(msg) {
    if (logEl()) {
      const d = document.createElement('div');
      d.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
      logEl().appendChild(d);
      logEl().scrollTop = logEl().scrollHeight;
    }
  }

  function logFileBusyMessage() {
    const now = Date.now();
    if (!window.lastPermissionError || (now - window.lastPermissionError) > 180000) {
      addLog('EQ is writing to the log — retrying until the file unlocks…');
      window.lastPermissionError = now;
    }
  }

  function noteReadRecovered() {
    if (consecutiveReadFailures > 0) {
      addLog('Log file readable again.');
    }
    consecutiveReadFailures = 0;
  }

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
    // Prefer Blob.text(): in Firefox it returns current on-disk content after the
    // file grows, while FileReader permanently fails once the size changes
    // (mozbug 1752057). Chrome uses fresh files via getFile(), so either works.
    if (typeof file.text === 'function') {
      return file.text().then(function (t) { return String(t || ''); });
    }
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () {
        reject(reader.error || new Error('Failed to read file'));
      };
      reader.readAsText(file);
    });
  }

  async function readFileAsTextWithRetry(blob) {
    let lastErr;
    for (let attempt = 0; attempt < READ_RETRY_COUNT; attempt++) {
      try {
        return await readFileAsText(blob);
      } catch (err) {
        lastErr = err;
        if (!isLogFileBusyError(err) || attempt >= READ_RETRY_COUNT - 1) break;
        const waitMs = Math.min(600, Math.round(READ_RETRY_DELAY_MS * Math.pow(1.45, attempt)));
        await delay(waitMs);
      }
    }
    throw lastErr;
  }

  /**
   * Read the log for setup scans. Handle path reads the recent tail; snapshot
   * path must read the whole File — slicing by the frozen size misses new bytes.
   */
  async function readLogContent() {
    const file = await refreshLogFile();
    if (!file) throw new Error('No file selected');

    if (!logFileHandle) {
      return readFileAsTextWithRetry(file);
    }

    const truncated = file.size > TAIL_READ_BYTES;
    const blob = truncated ? file.slice(file.size - TAIL_READ_BYTES) : file;
    const text = await readFileAsTextWithRetry(blob);
    return trimTailBlobText(text, truncated);
  }

  /**
   * Read log lines appended since the last poll.
   * Handle path: byte-offset incremental read via getFile().
   * Snapshot path (Firefox): full read each poll, diffed by character offset —
   * the File's size/slice bounds are frozen at pick time, but a full read
   * returns current disk content.
   * @returns {Promise<string[]>}
   */
  async function readNewLogLines() {
    const file = await refreshLogFile();
    if (!file) throw new Error('No file selected');

    if (needsEndOffsetSync) {
      try {
        await syncLogReadOffsetToEnd();
        console.log('[EQ Log Monitor] Synced read offset to end (', logReadOffset, ')');
      } catch (e) {
        if (isLogFileBusyError(e)) return [];
        throw e;
      }
      return [];
    }

    let appendedText;

    if (logFileHandle) {
      if (file.size < logReadOffset) {
        addLog('Log file shrank — reading from start.');
        logReadOffset = 0;
        partialLineBuffer = '';
      }
      if (file.size <= logReadOffset) return [];

      const chunkEnd = file.size;
      const chunk = file.slice(logReadOffset, chunkEnd);
      const readText = await readFileAsTextWithRetry(chunk);
      logReadOffset = chunkEnd;
      appendedText = partialLineBuffer + readText;
    } else {
      const fullText = await readFileAsTextWithRetry(file);
      if (fullText.length < logReadOffset) {
        addLog('Log file shrank — reading from start.');
        logReadOffset = 0;
        partialLineBuffer = '';
      }
      if (fullText.length <= logReadOffset) return [];

      appendedText = partialLineBuffer + fullText.slice(logReadOffset);
      logReadOffset = fullText.length;
    }

    const parsed = parseCompleteLinesFromText(appendedText);
    partialLineBuffer = parsed.remainder;
    return parsed.lines;
  }

  async function setupLogReadPosition(captureLatest) {
    if (!captureLatest) {
      try {
        const text = await readLogContent();
        const lines = text.split('\n');
        let primed = false;
        for (let i = lines.length - 1; i >= 0; i--) {
          let line = lines[i].trim();
          if (!line) continue;
          if (window.EqLogParse) line = EqLogParse.normalizeLogLine(line);
          if (detectLootLine(line, tag)) {
            console.log('[EQ Log Monitor] Primed with line:', line.substring(0, 50));
            primed = true;
            break;
          }
        }
        await syncLogReadOffsetToEnd();
        if (primed) addLog('Primed with latest loot line; will only capture new ones.');
        else addLog('No existing loot line found — will capture the next one.');
      } catch (e) {
        console.error('[EQ Log Monitor] Error priming:', e);
        needsEndOffsetSync = true;
        if (isLogFileBusyError(e)) {
          addLog('EQ is writing to the log — monitoring will retry until reads succeed.');
        } else {
          addLog('Error priming: ' + (e.message || String(e)));
        }
      }
      return;
    }

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
        addLog('Latest loot line captured.');
      } else {
        addLog('No loot line found with tag: ' + tag);
      }
      await syncLogReadOffsetToEnd();
    } catch (e) {
      console.error('[EQ Log Monitor] Error capturing latest:', e);
      needsEndOffsetSync = true;
      if (isLogFileBusyError(e)) {
        addLog('EQ is writing to the log — monitoring will retry until reads succeed.');
      } else {
        addLog('Error capturing latest: ' + (e.message || String(e)));
      }
    }
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
      addLog('Live log link — new lines are picked up automatically.');
    } else if (!monitoring) {
      addLog('Snapshot mode (Firefox) — if new loot does not appear after you post, choose the log file again.');
    } else {
      addLog('Log snapshot refreshed.');
    }

    consecutiveReadFailures = 0;
    resetLogReadState();

    const captureLatest = !scanLatestNowEl || (scanLatestNowEl() && scanLatestNowEl().checked);
    const startingFresh = !monitoring;

    if (startingFresh) {
      console.log('[EQ Log Monitor] Starting monitoring...');
      console.log('[EQ Log Monitor] Capture latest:', captureLatest);
      await setupLogReadPosition(captureLatest);
      start();
    } else {
      console.log('[EQ Log Monitor] Re-selected log while monitoring');
      await setupLogReadPosition(captureLatest);
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
    } else {
      console.log('[EQ Log Monitor] showOpenFilePicker unavailable — using file input (may need re-select when log grows)');
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

  async function keepApiSessionWarm() {
    if (!raidLeaderMode || !window.OpenDkpApi || !OpenDkpApi.ensureFreshToken) return;
    try {
      const data = await api.storage.sync.get(['opendkpClientSlug']);
      const slug = String(data.opendkpClientSlug || '').trim().toLowerCase();
      if (!slug) return;
      await OpenDkpApi.ensureFreshToken({ clientId: OPEN_DKP_COGNITO_CLIENT_ID });
    } catch (_) {
      /* ignore — next queue attempt will surface a useful error */
    }
  }

  function startSessionKeepAlive() {
    if (sessionKeepAliveTimer) return;
    void keepApiSessionWarm();
    sessionKeepAliveTimer = setInterval(function () {
      void keepApiSessionWarm();
    }, 10 * 60 * 1000);
  }

  function stopSessionKeepAlive() {
    if (!sessionKeepAliveTimer) return;
    clearInterval(sessionKeepAliveTimer);
    sessionKeepAliveTimer = null;
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
      const newLines = await readNewLogLines();
      noteReadRecovered();

      if (newLines.length === 0) {
        console.log('[EQ Log Monitor] No new log bytes (offset', logReadOffset + ')');
        return;
      }

      console.log('[EQ Log Monitor] Read', newLines.length, 'new line(s) since last poll');

      const newLootLines = newLines.filter(function (line) {
        return detectLootLine(line, tag);
      });

      if (newLootLines.length === 0) {
        console.log('[EQ Log Monitor] New log activity but no loot lines with tag "' + tag + '"');
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
    } catch(e){ 
      console.error('[EQ Log Monitor] Poll error:', e);
      if (isLogFileBusyError(e)) {
        consecutiveReadFailures++;
        logFileBusyMessage();
      } else {
        consecutiveReadFailures = 0;
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
      stopSessionKeepAlive();
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
    startSessionKeepAlive();
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


