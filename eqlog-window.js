(function(){
  const statusEl = () => document.getElementById('status');
  const fileInput = () => document.getElementById('fileInput');
  const pickBtn = () => document.getElementById('pick');

  function setStatus(msg) { if (statusEl()) statusEl().textContent = msg; }

  function detectLootLine(line, tag) {
    if (!tag || !line) return false;
    const lowerLine = line.toLowerCase();
    const lowerTag = tag.toLowerCase();
    const tagIndex = lowerLine.indexOf(lowerTag);
    if (tagIndex === -1) return false;
    const pipeIndex = lowerLine.indexOf('|');
    const commaIndex = lowerLine.indexOf(',');
    if (pipeIndex !== -1 && tagIndex > pipeIndex) return false;
    if (commaIndex !== -1 && tagIndex > commaIndex) return false;
    return true;
  }

  function extractItems(line, tag) {
    if (!line || !tag) return [];
    const lowerLine = line.toLowerCase();
    const lowerTag = tag.toLowerCase();
    const tagIndex = lowerLine.indexOf(lowerTag);
    if (tagIndex === -1) return [];
    let startIndex = line.lastIndexOf("'", tagIndex);
    let endIndex = line.indexOf("'", tagIndex + tag.length);
    let lootText = '';
    if (startIndex !== -1 && endIndex !== -1) {
      lootText = line.substring(tagIndex + tag.length, endIndex).trim();
    } else {
      lootText = line.substring(tagIndex + tag.length).trim();
    }
    if (!lootText) return [];
    const hasPipe = lootText.includes('|');
    const hasComma = lootText.includes(',');
    let items = [];
    if (!hasPipe && !hasComma) {
      items = [lootText.trim()];
    } else {
      const delimiter = hasPipe ? '|' : ',';
      items = lootText.split(delimiter).map(s => s.trim());
    }
    return items
      .map(i => i.replace(new RegExp('^' + tag + '\\s*', 'gi'), '').trim())
      .filter(i => i.replace(new RegExp(tag, 'gi'), '').trim());
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
      (typeof browser !== 'undefined' ? browser.storage.sync.get(['eqLogTag','eqLogEvents']) : Promise.resolve({}))
    ]);
    const tag = (settings && settings.eqLogTag) || 'FG';
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
          // Require raid/party tell format and quoted message
          const m = line.match(/^\[[^\]]+\]\s.*?(tells the raid|tell the raid|tell your raid|tell your party|tells your party|say),\s*'(.*)'\s*$/i);
          if (!m) continue;
          const quoted = m[2];
          const startsWithTag = new RegExp('^\n?\r?\t?\uFEFF?\s*' + tag + '\\b','i').test(quoted);
          if (!startsWithTag) continue;
          lastLine = line;
          break;
        }
        if (!lastLine) { setStatus(`No loot line found with tag "${tag}". Closing...`); setTimeout(()=>window.close(),1200); return; }
        const items = extractItems(lastLine, tag);
        if (!items.length) { setStatus('Found line but no items parsed. Closing...'); setTimeout(()=>window.close(),1200); return; }
        const event = {
          id: Date.now() + Math.random().toString(36).slice(2),
          timestamp: extractTimestamp(lastLine),
          date: new Date().toISOString().split('T')[0],
          items,
          logLine: lastLine
        };
        events.unshift(event);
        // keep last 200
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
    // Try to auto-open (may still require a click in Firefox)
    setTimeout(()=>{ try { fileInput().click(); } catch(_){} }, 50);
  }
  document.addEventListener('DOMContentLoaded', init);
})();


