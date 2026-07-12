// Load OpenDKP API + loot queue libs, then the browser-specific popup script.

(function () {
  /** Chrome can expose a `browser` alias; pick popup script by actual browser. */
  function isFirefoxBrowser() {
    return /Firefox/i.test(navigator.userAgent);
  }

  const ext = isFirefoxBrowser() && typeof browser !== 'undefined' ? browser : chrome;

  /** Wire settings cog immediately so it works even if script boot fails later. */
  function wireOpenOptionsEarly() {
    const btn = document.getElementById('openOptions');
    if (!btn || btn.dataset.odkpOptionsWired === '1') return;
    btn.dataset.odkpOptionsWired = '1';
    btn.addEventListener('click', function () {
      try {
        ext.runtime.openOptionsPage();
      } catch (err) {
        console.error('[OpenDKP Popup] openOptionsPage failed:', err);
      }
    });
  }

  function showBootError(message) {
    const statusText = document.getElementById('statusText');
    const statusDiv = document.getElementById('status');
    if (statusText) statusText.textContent = message;
    if (statusDiv) statusDiv.className = 'status error';
  }

  wireOpenOptionsEarly();

  function loadScript(path) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = path;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error('Failed to load: ' + path));
      };
      document.body.appendChild(s);
    });
  }

  async function boot() {
    await loadScript('lib/eqlog-parse.js');
    await loadScript('lib/popup-notify.js');
    await loadScript('lib/opendkp-api.js');
    await loadScript('lib/bid-participation.js');
    await loadScript('lib/item-price-history.js');
    await loadScript('lib/raidtick-parse.js');
    await loadScript('lib/loot-queue.js');
    await loadScript('lib/raidtick-queue.js');
    await loadScript('lib/raid-context.js');
    await loadScript('lib/popup-api-session.js');
    await loadScript('lib/popup-item-price-history.js');
    const popupSrc = isFirefoxBrowser() ? 'popup-firefox.js' : 'popup.js';
    await loadScript(popupSrc);
  }

  boot().catch(function (err) {
    console.error('[OpenDKP Popup] Boot failed:', err);
    showBootError('Extension UI failed to load. Use the cog or Manage extension → Settings.');
  });
})();
