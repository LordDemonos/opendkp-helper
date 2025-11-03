(function() {
  const statusEl = () => document.getElementById('status');
  const inputEl = () => document.getElementById('fileInput');
  const pickBtn = () => document.getElementById('pick');

  function setStatus(msg) {
    const el = statusEl();
    if (el) el.textContent = msg;
  }

  function countDataLines(text) {
    const lines = text.split('\n');
    return lines.filter(l => l.trim() && !l.includes('RaidTick') && !l.includes('Date:') && !l.includes('Time:')).length;
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(text);
  }

  function handleFiles(files) {
    const file = files && files[0];
    if (!file) {
      setStatus('No file selected. Closing...');
      setTimeout(() => window.close(), 800);
      return;
    }
    setStatus(`Reading ${file.name}...`);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = reader.result || '';
        await copyText(text);
        const count = countDataLines(text);
        setStatus(`✅ Copied ${count} lines (excluding header). Closing...`);
        setTimeout(() => window.close(), 1200);
      } catch (err) {
        setStatus('❌ Failed to copy to clipboard. You can try again.');
      }
    };
    reader.onerror = () => {
      setStatus('❌ Failed to read file.');
    };
    reader.readAsText(file);
  }

  function init() {
    if (pickBtn()) {
      pickBtn().addEventListener('click', () => inputEl().click());
    }
    if (inputEl()) {
      inputEl().addEventListener('change', () => handleFiles(inputEl().files));
    }
    // Immediately trigger picker once as the window opens (still under user gesture from popup button)
    setTimeout(() => {
      if (inputEl()) inputEl().click();
    }, 50);
  }

  document.addEventListener('DOMContentLoaded', function() {
    init();
    // Fallback auto-close if nothing happens (moved from inline script in HTML)
    setTimeout(() => { 
      window.close(); 
    }, 120000); // 2 minutes safeguard
  });
})();


