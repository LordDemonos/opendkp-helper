(function(){
  const statusEl = () => document.getElementById('status');
  const fileInput = () => document.getElementById('fileInput');
  const pickBtn = () => document.getElementById('pick');

  function setStatus(msg) { if (statusEl()) statusEl().textContent = msg; }

  function detectLootLine(line, tag) {
    if (!window.EqLogParse) return false;
    return EqLogParse.detectLootLine(line, tag);
  }

  function extractItems(line, tag) {
    if (!window.EqLogParse) return [];
    return EqLogParse.extractItems(line, tag);
  }

  function extractTimestamp(line) {
    const m = line.match(/\[([^\]]+)\]/);
    return m ? m[1] : new Date().toLocaleString();
  }

  async function handleFiles(files) {
    const file = files && files[0];
    if (!file) { setStatus('No file selected. Closing...'); setTimeout(()=>window.close(), 800); return; }
    setStatus(`Reading ${file.name}...`);

    const [settings] = await Promise.all([
      (typeof browser !== 'undefined' ? browser.storage.sync.get(['eqLogTag', 'eqLogEvents', 'eqLogLootExceptions']) : Promise.resolve({}))
    ]);
    const tag = (settings && settings.eqLogTag) || 'FG';
    const lootExceptions = Array.isArray(settings && settings.eqLogLootExceptions)
      ? settings.eqLogLootExceptions
      : [];
    let events = (settings && settings.eqLogEvents) || [];

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const content = reader.result || '';
        const lines = content.split('\n');
        let lastLine = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (!line) continue;
          if (!detectLootLine(line, tag)) continue;
          lastLine = line;
          break;
        }
        if (!lastLine) {
          setStatus(`No loot line found with tag "${tag}" (raid/party/say tells). Closing...`);
          setTimeout(()=>window.close(),1200);
          return;
        }
        const rawItems = extractItems(lastLine, tag);
        const items = window.EqLogParse && EqLogParse.filterExcludedItems
          ? EqLogParse.filterExcludedItems(rawItems, lootExceptions)
          : rawItems;
        if (!items.length) { setStatus('Loot line matched only excluded items. Closing...'); setTimeout(()=>window.close(),1200); return; }
        const event = {
          id: Date.now() + Math.random().toString(36).slice(2),
          timestamp: extractTimestamp(lastLine),
          date: new Date().toISOString().split('T')[0],
          items,
          logLine: lastLine
        };
        events.unshift(event);
        if (events.length > 200) events = events.slice(0,200);
        if (typeof browser !== 'undefined') {
          await browser.storage.sync.set({ eqLogEvents: events, eqLogFileMeta: { name: file.name, lastModified: file.lastModified } });
        }
        setStatus(`✅ Found ${items.length} items. Saved. Closing...`);
        setTimeout(()=>window.close(), 1000);
      } catch (e) {
        setStatus('❌ Error: ' + e.message);
      }
    };
    reader.onerror = () => setStatus('❌ Failed to read file');
    reader.readAsText(file);
  }

  function init(){
    if (pickBtn()) pickBtn().addEventListener('click', ()=> fileInput().click());
    if (fileInput()) fileInput().addEventListener('change', ()=> handleFiles(fileInput().files));
    setTimeout(()=>{ try { fileInput().click(); } catch(_){} }, 50);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
