(function(){
  // Browser detection for cross-compatibility
  const api = typeof browser !== 'undefined' ? browser : chrome;
  
  const fileInput = () => document.getElementById('fileInput');
  const pickBtn = () => document.getElementById('pick');
  const logEl = () => document.getElementById('log');
  const nameEl = () => document.getElementById('fileName');
  const tagInput = () => document.getElementById('tagInput');
  const scanLatestNowEl = () => document.getElementById('scanLatestNow');

  let monitoring = false;
  let timer = null;
  let selectedFile = null;
  let lastSeenLogLine = null;
  let tag = 'FG';

  function addLog(msg){ if (logEl()){ const d=document.createElement('div'); d.textContent=`${new Date().toLocaleTimeString()} ${msg}`; logEl().appendChild(d); logEl().scrollTop=logEl().scrollHeight; } }

  function detectLootLine(line, tag) {
    if (!tag || !line) {
      console.log('[EQ Log Monitor] detectLootLine: missing tag or line', { tag: tag, hasLine: !!line });
      return false;
    }
    // Try to match the standard EQ log format: [timestamp] name tells the raid, 'message'
    const m = line.match(/^\[[^\]]+\]\s.*?(?:tells the raid|tell the raid|tell your raid|tell your party|tells your party|say),\s*'(.*)'\s*$/i);
    if (!m) {
      return false;
    }
    const quoted = m[1];
    if (!quoted) {
      return false;
    }
    // Check if quoted text starts with the tag (case-insensitive, word boundary)
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^\s*' + escapedTag + '\\b', 'i');
    const matches = re.test(quoted);
    if (!matches && quoted.length > 0 && quoted.length < 200) {
      // Debug: log why it didn't match (only for short lines to avoid spam)
      console.log('[EQ Log Monitor] detectLootLine: Tag "' + tag + '" did not match quoted text:', quoted.substring(0, 100));
    }
    return matches;
  }

  function extractItems(line, tag) {
    const m = line.match(/^\[[^\]]+\]\s.*?(?:tells the raid|tell the raid|tell your raid|tell your party|tells your party|say),\s*'(.*)'\s*$/i);
    if (!m) return [];
    const quoted = m[1];
    const after = quoted.replace(new RegExp('^\n?\r?\t?\uFEFF?\s*' + tag + '\\s*','i'),'').trim();
    if (!after) return [];
    const hasPipe = after.includes('|');
    const hasComma = after.includes(',');
    let items = [];
    if (!hasPipe && !hasComma) items = [after]; else items = after.split(hasPipe ? '|' : ',').map(s=>s.trim());
    return items.filter(Boolean);
  }

  async function pushEvent(line){
    const items = extractItems(line, tag);
    if (!items.length) return;
    // Use local date format to match popup-firefox.js formatDate()
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const event = { id: Date.now()+Math.random().toString(36).slice(2), timestamp: (line.match(/\[([^\]]+)\]/)||[])[1]||new Date().toLocaleString(), date: localDate, items, logLine: line };
    console.log('[EQ Log Monitor] Saving event:', { date: localDate, items: items.length, timestamp: event.timestamp });
    const data = await api.storage.sync.get(['eqLogEvents']);
    const list = (data.eqLogEvents||[]);
    list.unshift(event);
    if (list.length>200) list.splice(200);
    await api.storage.sync.set({ eqLogEvents: list });
    console.log('[EQ Log Monitor] Saved', list.length, 'total events to storage');
  }

  async function poll(){
    if (!selectedFile) {
      console.log('[EQ Log Monitor] Poll skipped - no file selected');
      return;
    }
    try {
      console.log('[EQ Log Monitor] Polling file:', selectedFile.name, '- Tag:', tag);
      const text = await selectedFile.text();
      const lines = text.split('\n');
      console.log('[EQ Log Monitor] File has', lines.length, 'lines, searching from end...');
      let checkedLines = 0;
      let potentialMatches = 0;
      
      // Collect all new loot lines (those after lastSeenLogLine)
      const newLootLines = [];
      let foundLastSeenLine = false;
      
      // Search backwards (newest to oldest)
      for (let i=lines.length-1;i>=0;i--){
        const line = lines[i].trim();
        if (!line) continue;
        checkedLines++;
        
        // Check for potential loot lines (contains "tells the raid")
        if (line.includes('tells the raid') || line.includes('tell the raid') || line.includes('tell your raid') || line.includes('say,')) {
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
      // Since we collected them backwards, reverse to get oldest first
      newLootLines.reverse();
      
      if (newLootLines.length === 0) {
        if (foundLastSeenLine) {
          addLog('No new loot lines.');
          console.log('[EQ Log Monitor] No new loot lines since last check');
        } else {
      addLog('No loot line matched.');
      console.log('[EQ Log Monitor] No loot line found in last', checkedLines, 'lines (found', potentialMatches, 'potential matches)');
      if (potentialMatches > 0 && checkedLines <= 20) {
        console.log('[EQ Log Monitor] ⚠️ Found potential loot lines but tag "' + tag + '" did not match');
          }
        }
        return;
      }
      
      // Process all new loot lines in chronological order (oldest first)
      // Limit to prevent UI overload - if too many, only process the most recent ones
      const maxProcessPerPoll = 10;
      const linesToProcess = newLootLines.length > maxProcessPerPoll 
        ? newLootLines.slice(-maxProcessPerPoll) // Take only the most recent ones
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
      
      // Update lastSeenLogLine to the newest line processed
      if (linesToProcess.length > 0) {
        lastSeenLogLine = linesToProcess[linesToProcess.length - 1];
        console.log('[EQ Log Monitor] Updated lastSeenLogLine to:', lastSeenLogLine.substring(0, 100));
      }
    } catch(e){ 
      console.error('[EQ Log Monitor] Poll error:', e);
      const errorMsg = e.message || String(e);
      // Check if it's a permission error (file locked by another application)
      if (errorMsg.includes('permission') || errorMsg.includes('could not be read') || errorMsg.includes('locked')) {
        // Don't spam the log - only show this error occasionally
        const now = Date.now();
        if (!window.lastPermissionError || (now - window.lastPermissionError) > 30000) {
          addLog('⚠️ File locked - close other apps using the log file');
          window.lastPermissionError = now;
        }
      } else {
        addLog('Error: ' + errorMsg);
      }
      // Continue monitoring - don't stop on errors
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
    if (pickBtn()) pickBtn().addEventListener('click', ()=> fileInput().click());
    if (fileInput()) fileInput().addEventListener('change', async ()=>{
      selectedFile = (fileInput().files||[])[0];
      if (!selectedFile) {
        console.log('[EQ Log Monitor] No file selected');
        return;
      }
      console.log('[EQ Log Monitor] File selected:', selectedFile.name);
      nameEl().textContent = selectedFile.name;
      await api.storage.sync.set({ eqLogFileMeta: { name: selectedFile.name, lastModified: selectedFile.lastModified } });
      
      // Load tag from storage before starting
      const tagData = await api.storage.sync.get(['eqLogTag']);
      tag = (tagData.eqLogTag || 'FG');
      console.log('[EQ Log Monitor] Using tag:', tag);
      
      if (!monitoring) {
        console.log('[EQ Log Monitor] Starting monitoring...');
        // If user doesn't want to capture the latest on start, prime lastSeenLogLine with the current latest
        const captureLatest = !scanLatestNowEl || (scanLatestNowEl() && scanLatestNowEl().checked);
        console.log('[EQ Log Monitor] Capture latest:', captureLatest);
        if (!captureLatest) {
          try {
            const text = await selectedFile.text();
            const lines = text.split('\n');
            for (let i=lines.length-1;i>=0;i--){
              const line = lines[i].trim();
              if (line && detectLootLine(line, tag)) { 
                lastSeenLogLine = line; 
                console.log('[EQ Log Monitor] Primed with line:', line.substring(0, 50));
                break; 
              }
            }
            if (lastSeenLogLine) addLog('Primed with latest loot line; will only capture new ones.');
          } catch(e){
            console.error('[EQ Log Monitor] Error priming:', e);
            addLog('Error priming: ' + e.message);
          }
        } else {
          // If capturing latest, find and process the latest loot line immediately
          try {
            const text = await selectedFile.text();
            const lines = text.split('\n');
            let latestLootLine = null;
            for (let i=lines.length-1;i>=0;i--){
              const line = lines[i].trim();
              if (line && detectLootLine(line, tag)) { 
                latestLootLine = line;
                console.log('[EQ Log Monitor] Found latest loot line to capture:', line.substring(0, 50));
                break; 
              }
            }
            if (latestLootLine) {
              // Process the latest line immediately
              addLog('Capturing latest loot line...');
              await pushEvent(latestLootLine);
              // Set lastSeenLogLine so we don't process it again
              lastSeenLogLine = latestLootLine;
              addLog('Latest loot line captured.');
            } else {
              addLog('No loot line found with tag: ' + tag);
            }
          } catch(e){
            console.error('[EQ Log Monitor] Error capturing latest:', e);
            addLog('Error capturing latest: ' + e.message);
          }
        }
        start();
      } else {
        addLog('File changed.');
      }
      // First poll immediately (will skip if lastSeenLogLine is already set)
      console.log('[EQ Log Monitor] Running initial poll...');
      poll();
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
    // attempt auto open picker first time
    setTimeout(()=>{ try{ fileInput().click(); }catch(_){} }, 100);
  }

  document.addEventListener('DOMContentLoaded', init);
})();


