(function() {
  const statusEl = () => document.getElementById('status');
  const inputEl = () => document.getElementById('fileInput');
  const pickBtn = () => document.getElementById('pick');

  function setStatus(msg) {
    const el = statusEl();
    if (el) el.textContent = msg;
  }

  function stripHeaderRow(text) {
    const lines = text.split('\n');
    if (lines.length === 0) return text;
    
    // Check if first line matches the header pattern (case-insensitive, flexible whitespace/tabs)
    const firstLine = lines[0].trim();
    
    // More robust check: split by whitespace and check if it matches the header words
    const words = firstLine.split(/\s+/).map(w => w.toLowerCase());
    const headerWords = ['player', 'level', 'class', 'timestamp', 'points'];
    
    // Check if first 5 words match the header exactly
    if (words.length >= 5 && 
        words[0] === headerWords[0] &&
        words[1] === headerWords[1] &&
        words[2] === headerWords[2] &&
        words[3] === headerWords[3] &&
        words[4] === headerWords[4]) {
      // Remove the header row and return the rest
      return lines.slice(1).join('\n');
    }
    
    // Fallback: regex pattern check
    const headerPattern = /^player\s+level\s+class\s+timestamp\s+points$/i;
    if (headerPattern.test(firstLine)) {
      return lines.slice(1).join('\n');
    }
    
    return text;
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
        const cleanedText = stripHeaderRow(text);
        await copyText(cleanedText);
        const count = countDataLines(cleanedText);
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


