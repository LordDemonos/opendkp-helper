/**
 * Keeps the OpenDKP Bidding Tool "Raid" dropdown on the most recent raid.
 */
(function (global) {
  'use strict';

  var POLL_MS = 20000;
  var DEBOUNCE_MS = 300;
  var PROGRAMMATIC_GRACE_MS = 800;
  var BANNER_AUTO_HIDE_MS = 8000;
  var INIT_DELAY_MS = 3200;
  var PAGE_DETECT_MS = 3000;
  var LOG_PREFIX = '[OpenDKP Raid Lock]';

  var extApi = typeof browser !== 'undefined' ? browser : chrome;
  var getSettings = null;
  var logFn = function () {};
  var debounceTimer = null;
  var pollTimer = null;
  var pageDetectTimer = null;
  var observer = null;
  var storageListenerAttached = false;
  var watchersActive = false;
  var isSelecting = false;
  var isProgrammaticSelect = false;
  var programmaticGraceUntil = 0;
  var started = false;
  var bannerEl = null;
  var bannerHideTimer = null;
  var missingRaidFromPage = null;
  var refreshBannerRaidName = null;
  var lastDiagnose = null;
  var logThrottle = {};
  var lastApiFailureAt = 0;
  var lastApiErrorKey = '';
  var API_BACKOFF_MS = 45000;
  var LOG_THROTTLE_MS = 60000;
  var MESSAGE_TIMEOUT_MS = 10000;
  var DIAG_CMD = 'opendkp-helper-raid-lock-cmd';
  var DIAG_RESULT = 'opendkp-helper-raid-lock-result';

  function log() {
    try {
      var args = [LOG_PREFIX].concat(Array.prototype.slice.call(arguments));
      logFn.apply(null, args);
    } catch (_) {}
  }

  function logThrottled(key, message) {
    var now = Date.now();
    if (logThrottle[key] && now - logThrottle[key] < LOG_THROTTLE_MS) return;
    logThrottle[key] = now;
    log(message);
  }

  function normalizeApiResponse(resp) {
    if (resp === true || resp === false) {
      return {
        ok: false,
        error:
          'background returned ' +
          String(resp) +
          ' (listener return value — reload extension after update)'
      };
    }
    if (resp == null) {
      return { ok: false, error: 'no response from background (reload extension)' };
    }
    if (typeof resp !== 'object') {
      return { ok: false, error: 'invalid background response: ' + String(resp) };
    }
    if (resp.ok === true) return resp;
    return {
      ok: false,
      error:
        resp.error ||
        resp.reason ||
        resp.message ||
        'background returned ok:false'
    };
  }

  function describeApiFailure(apiResult) {
    if (!apiResult || typeof apiResult !== 'object') {
      return 'no response from background';
    }
    return apiResult.error || 'unknown API failure';
  }

  function shouldSkipApiCheck() {
    return lastApiFailureAt > 0 && Date.now() - lastApiFailureAt < API_BACKOFF_MS;
  }

  function sendRuntimeMessage(payload) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(resp) {
        if (settled) return;
        settled = true;
        resolve(normalizeApiResponse(resp));
      }

      var timer = setTimeout(function () {
        finish({ ok: false, error: 'background message timed out after 10s' });
      }, MESSAGE_TIMEOUT_MS);

      try {
        var maybePromise = extApi.runtime.sendMessage(payload);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise
            .then(function (resp) {
              clearTimeout(timer);
              finish(resp);
            })
            .catch(function (err) {
              clearTimeout(timer);
              finish({
                ok: false,
                error: err && err.message ? err.message : String(err)
              });
            });
          return;
        }
      } catch (err) {
        clearTimeout(timer);
        finish({ ok: false, error: err && err.message ? err.message : String(err) });
        return;
      }

      extApi.runtime.sendMessage(payload, function (resp) {
        clearTimeout(timer);
        var lastErr = extApi.runtime.lastError;
        if (lastErr) {
          finish({ ok: false, error: lastErr.message });
          return;
        }
        finish(resp);
      });
    });
  }

  function markExtensionActive() {
    try {
      document.documentElement.setAttribute('data-opendkp-helper-active', '1');
    } catch (_) {}
  }

  function isEnabled() {
    if (!getSettings) return false;
    var s = getSettings();
    return !!(s && s.SOUND_PROFILE === 'raidleader' && s.BIDDING_TOOL_RAID_LOCK === true);
  }

  function textEquals(el, text) {
    return el && (el.textContent || '').trim() === text;
  }

  function getAuctionControlsRoot() {
    var nodes = document.querySelectorAll('h1, h2, h3, h4, h5, h6, .p-panel-title, legend');
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].textContent || '').trim();
      if (t === 'Auction Controls' || t.indexOf('Auction Controls') === 0) {
        return (
          nodes[i].closest('.p-panel, .p-fluid, [class*="grid"]') ||
          nodes[i].parentElement
        );
      }
    }

    var dropdowns = document.querySelectorAll(
      '.p-dropdown, .p-select, [data-pc-name="dropdown"], [data-pc-name="select"]'
    );
    for (var j = 0; j < dropdowns.length; j++) {
      var block = dropdowns[j].closest('.p-panel, .p-fluid, [class*="grid"]');
      if (!block) continue;
      var blockText = block.textContent || '';
      if (
        blockText.indexOf('Bid Type') >= 0 &&
        blockText.indexOf('Min Bid') >= 0 &&
        blockText.indexOf('Max Bid') >= 0
      ) {
        return block;
      }
    }
    return null;
  }

  function isBiddingToolPage() {
    if (getAuctionControlsRoot()) return true;
    var body = document.body;
    if (!body) return false;
    var text = body.innerText || '';
    return (
      text.indexOf('Auction Controls') >= 0 ||
      (text.indexOf('Bid Type') >= 0 &&
        text.indexOf('Min Bid') >= 0 &&
        text.indexOf('Max Bid') >= 0 &&
        text.indexOf('Raid') >= 0)
    );
  }

  function normalizeLabel(text) {
    return String(text || '').trim().toLowerCase();
  }

  function isUnselectedLabel(text) {
    var n = normalizeLabel(text);
    // OpenDKP may show the field label "Raid" or "None" when nothing is selected.
    return !n || n === 'none' || n === 'raid' || n === '—' || n === '-';
  }

  function dropdownSelector() {
    return '.p-dropdown, .p-select, p-dropdown, p-select, [data-pc-name="dropdown"], [data-pc-name="select"]';
  }

  function findDropdownNear(el) {
    if (!el) return null;
    var container = el.parentElement;
    for (var d = 0; d < 10 && container; d++) {
      var dropdown = container.querySelector(dropdownSelector());
      if (dropdown) return dropdown;
      container = container.parentElement;
    }
    var sibling = el.nextElementSibling;
    for (var s = 0; s < 5 && sibling; s++) {
      if (sibling.matches && sibling.matches(dropdownSelector().split(',')[0])) {
        return sibling;
      }
      var nested = sibling.querySelector && sibling.querySelector(dropdownSelector());
      if (nested) return nested;
      sibling = sibling.nextElementSibling;
    }
    return null;
  }

  function findRaidDropdownByExtendedDuration() {
    var labels = document.querySelectorAll('label, span, div, p');
    for (var i = 0; i < labels.length; i++) {
      if (!textEquals(labels[i], 'Extended Duration')) continue;
      var row = labels[i].closest('[class*="col-"], .field, .grid, .p-fluid') || labels[i].parentElement;
      if (!row || !row.parentElement) continue;
      var siblings = row.parentElement.querySelectorAll(dropdownSelector());
      for (var j = siblings.length - 1; j >= 0; j--) {
        if (row.compareDocumentPosition(siblings[j]) & Node.DOCUMENT_POSITION_PRECEDING) {
          return siblings[j];
        }
      }
    }
    return null;
  }

  function findRaidDropdownByNoneLabel(root) {
    root = root || getAuctionControlsRoot() || document.body;
    if (!root) return null;
    var dropdowns = root.querySelectorAll(dropdownSelector());
    var noneMatches = [];
    for (var i = 0; i < dropdowns.length; i++) {
      var label = readDropdownLabel(dropdowns[i]);
      if (isUnselectedLabel(label)) {
        noneMatches.push(dropdowns[i]);
      }
    }
    if (noneMatches.length === 1) return noneMatches[0];
    return null;
  }

  function findRaidDropdown() {
    var byDuration = findRaidDropdownByExtendedDuration();
    if (byDuration) return byDuration;

    var root = getAuctionControlsRoot();
    if (root) {
      var byNone = findRaidDropdownByNoneLabel(root);
      if (byNone) return byNone;

      var dropdowns = root.querySelectorAll(dropdownSelector());
      for (var j = 0; j < dropdowns.length; j++) {
        var field = dropdowns[j].closest('.field, [class*="col-"]') || dropdowns[j].parentElement;
        var fieldText = field ? field.textContent || '' : '';
        if (fieldText.indexOf('Raid') >= 0 && fieldText.indexOf('Extended Duration') >= 0) {
          return dropdowns[j];
        }
      }
    }

    var labelCandidates = document.querySelectorAll('label');
    for (var i = 0; i < labelCandidates.length; i++) {
      if (!textEquals(labelCandidates[i], 'Raid')) continue;
      var near = findDropdownNear(labelCandidates[i]);
      if (near) return near;
    }

    return null;
  }

  function listRaidNamesFromDropdown(dropdown) {
    if (!dropdown) return null;
    var select = dropdown.querySelector('select');
    if (!select || !select.options || !select.options.length) return null;
    var names = [];
    for (var i = 0; i < select.options.length; i++) {
      var optText = (select.options[i].textContent || select.options[i].label || '').trim();
      if (!isUnselectedLabel(optText)) names.push(optText);
    }
    return names;
  }

  /**
   * @returns {boolean|null} true/false if hidden select exists; null if options unknown
   */
  function isRaidAvailableInDropdown(dropdown, raidName) {
    var names = listRaidNamesFromDropdown(dropdown);
    if (names === null) return null;
    var target = normalizeLabel(raidName);
    for (var i = 0; i < names.length; i++) {
      if (normalizeLabel(names[i]) === target) return true;
    }
    return false;
  }

  function isRaidInOpenPanel(raidName) {
    var target = normalizeLabel(raidName);
    var options = listDropdownOptions();
    for (var i = 0; i < options.length; i++) {
      if (normalizeLabel(options[i].textContent) === target) return true;
    }
    return false;
  }

  function shouldSkipMissingRaidAttempt(dropdown, targetName) {
    if (!missingRaidFromPage) return false;
    if (normalizeLabel(missingRaidFromPage) !== normalizeLabel(targetName)) {
      missingRaidFromPage = null;
      return false;
    }
    var avail = isRaidAvailableInDropdown(dropdown, targetName);
    if (avail === true) {
      missingRaidFromPage = null;
      return false;
    }
    return true;
  }

  function markRaidMissingFromPage(raidName) {
    missingRaidFromPage = raidName;
  }

  function clearMissingRaidFromPage() {
    missingRaidFromPage = null;
    refreshBannerRaidName = null;
  }

  function readDropdownLabel(dropdown) {
    if (!dropdown) return '';

    var hidden = dropdown.querySelector('select');
    if (hidden && hidden.options && hidden.options.length) {
      var opt = hidden.options[hidden.selectedIndex];
      if (opt) {
        var hiddenText = (opt.textContent || opt.label || '').trim();
        if (hiddenText) return hiddenText;
      }
    }

    var placeholderEl = dropdown.querySelector(
      '.p-dropdown-label.p-placeholder, .p-select-label.p-placeholder, [data-pc-section="input"].p-placeholder'
    );
    if (placeholderEl) {
      return 'None';
    }

    var labelEl = dropdown.querySelector(
      '.p-dropdown-label, .p-select-label, [data-pc-section="input"]'
    );
    var text = labelEl ? (labelEl.textContent || '').trim() : '';
    if (text === 'Raid') return 'None';
    return text;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function simulateClick(el) {
    if (!el) return;
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    } catch (_) {}
    el.click();
  }

  function getOpenDropdownPanel() {
    var panels = document.querySelectorAll(
      '.p-dropdown-panel, .p-select-overlay, .p-select-list, .p-select-panel, [data-pc-section="panel"], [data-pc-section="listbox"]'
    );
    return panels.length ? panels[panels.length - 1] : null;
  }

  function listDropdownOptions() {
    var panel = getOpenDropdownPanel();
    if (!panel) return [];
    return Array.prototype.slice.call(
      panel.querySelectorAll(
        '[role="option"], .p-dropdown-item, .p-select-option, li.p-dropdown-item, li.p-select-option, .p-select-option-label'
      )
    );
  }

  function clickOptionByName(raidName) {
    var target = normalizeLabel(raidName);
    var options = listDropdownOptions();
    for (var i = 0; i < options.length; i++) {
      if (normalizeLabel(options[i].textContent) === target) {
        simulateClick(options[i]);
        return true;
      }
    }
    return false;
  }

  function openDropdown(dropdown) {
    var trigger = dropdown.querySelector(
      '.p-dropdown-trigger, .p-select-dropdown, [data-pc-section="trigger"], [data-pc-section="dropdown"]'
    );
    if (trigger) {
      simulateClick(trigger);
      return;
    }
    var label = dropdown.querySelector(
      '.p-dropdown-label, .p-select-label, [data-pc-section="input"]'
    );
    if (label) {
      simulateClick(label);
      return;
    }
    simulateClick(dropdown);
  }

  function tryHiddenSelect(dropdown, raidName) {
    var select = dropdown.querySelector('select');
    if (!select || !select.options || !select.options.length) return false;
    var target = normalizeLabel(raidName);
    for (var i = 0; i < select.options.length; i++) {
      var opt = select.options[i];
      var optText = (opt.textContent || opt.label || '').trim();
      if (normalizeLabel(optText) === target) {
        select.selectedIndex = i;
        select.value = opt.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        log('Selected raid via hidden select:', optText);
        return true;
      }
    }
    return false;
  }

  function selectRaidByName(dropdown, raidName) {
    if (tryHiddenSelect(dropdown, raidName)) {
      programmaticGraceUntil = Date.now() + PROGRAMMATIC_GRACE_MS;
      return Promise.resolve(true);
    }

    var availability = isRaidAvailableInDropdown(dropdown, raidName);
    if (availability === false) {
      log('Raid not in page dropdown list yet:', raidName);
      return Promise.resolve(false);
    }

    isSelecting = true;
    isProgrammaticSelect = true;
    var attemptIndex = 0;

    function trySelect() {
      if (attemptIndex >= 2) {
        isSelecting = false;
        setTimeout(function () {
          isProgrammaticSelect = false;
        }, PROGRAMMATIC_GRACE_MS);
        simulateClick(document.body);
        log('Failed to select raid after retries:', raidName);
        return Promise.resolve(false);
      }
      openDropdown(dropdown);
      return sleep(180 + attemptIndex * 120).then(function () {
        if (isRaidInOpenPanel(raidName) && clickOptionByName(raidName)) {
          programmaticGraceUntil = Date.now() + PROGRAMMATIC_GRACE_MS;
          isSelecting = false;
          setTimeout(function () {
            isProgrammaticSelect = false;
          }, PROGRAMMATIC_GRACE_MS);
          log('Selected raid via panel click:', raidName);
          return true;
        }
        if (attemptIndex === 0 && !isRaidInOpenPanel(raidName)) {
          simulateClick(document.body);
          isSelecting = false;
          setTimeout(function () {
            isProgrammaticSelect = false;
          }, PROGRAMMATIC_GRACE_MS);
          log('Raid not found in open dropdown panel:', raidName);
          return false;
        }
        simulateClick(document.body);
        attemptIndex += 1;
        return sleep(120).then(trySelect);
      });
    }

    return trySelect();
  }

  function resolveLatestRaidViaBackground() {
    return sendRuntimeMessage({ type: 'resolveLatestRaid' });
  }

  function dismissBanner() {
    if (bannerHideTimer) {
      clearTimeout(bannerHideTimer);
      bannerHideTimer = null;
    }
    if (bannerEl && bannerEl.parentNode) {
      bannerEl.parentNode.removeChild(bannerEl);
      bannerEl = null;
    }
    refreshBannerRaidName = null;
  }

  function showBanner(message, opts) {
    opts = opts || {};
    var s = getSettings ? getSettings() : null;
    if (s && s.DISABLE_VISUALS) {
      log(message);
      return;
    }
    if (
      opts.kind === 'refresh' &&
      refreshBannerRaidName &&
      bannerEl &&
      bannerEl.getAttribute('data-opendkp-raid-lock-banner-kind') === 'refresh'
    ) {
      return;
    }
    dismissBanner();
    bannerEl = document.createElement('div');
    bannerEl.setAttribute('data-opendkp-raid-lock-banner', '');
    if (opts.kind) {
      bannerEl.setAttribute('data-opendkp-raid-lock-banner-kind', opts.kind);
    }
    bannerEl.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:2147483645;' +
      (opts.kind === 'refresh'
        ? 'background:#3d2a14;color:#ffe8c8;'
        : 'background:#4a3728;color:#f5e6c8;') +
      'padding:10px 40px 10px 16px;' +
      'font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35);' +
      'display:flex;align-items:center;justify-content:center;text-align:center;';
    var msg = document.createElement('span');
    msg.textContent = message;
    bannerEl.appendChild(msg);
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '\u00d7';
    close.setAttribute('aria-label', 'Dismiss');
    close.style.cssText =
      'position:absolute;right:12px;top:50%;transform:translateY(-50%);' +
      'background:transparent;border:none;color:inherit;font-size:22px;cursor:pointer;padding:4px 8px;';
    close.addEventListener('click', function () {
      dismissBanner();
      if (opts.kind === 'refresh') {
        scheduleCheck();
      }
    });
    bannerEl.appendChild(close);
    document.body.appendChild(bannerEl);
    if (opts.autoHideMs && opts.autoHideMs > 0) {
      bannerHideTimer = setTimeout(dismissBanner, opts.autoHideMs);
    }
  }

  function showSwitchBanner(raidName) {
    showBanner('Switched to most recent raid: ' + raidName, {
      kind: 'switch',
      autoHideMs: BANNER_AUTO_HIDE_MS
    });
  }

  function showRefreshBanner(raidName) {
    refreshBannerRaidName = raidName;
    showBanner(
      'Refresh this page to load the latest raid list, then OpenDKP Helper can select "' +
        raidName +
        '".',
      { kind: 'refresh' }
    );
  }

  function persistRaid(raidId, summary) {
    if (global.RaidContext && RaidContext.persistCurrentRaid) {
      return RaidContext.persistCurrentRaid(raidId, summary);
    }
    return Promise.resolve();
  }

  function domFallbackSelect(dropdown) {
    if (tryHiddenSelect(dropdown, '')) {
      return Promise.resolve(true);
    }
    openDropdown(dropdown);
    return sleep(220).then(function () {
      var options = listDropdownOptions();
      for (var i = 0; i < options.length; i++) {
        var optText = (options[i].textContent || '').trim();
        if (!isUnselectedLabel(optText)) {
          isProgrammaticSelect = true;
          simulateClick(options[i]);
          programmaticGraceUntil = Date.now() + PROGRAMMATIC_GRACE_MS;
          setTimeout(function () {
            isProgrammaticSelect = false;
          }, PROGRAMMATIC_GRACE_MS);
          log('DOM fallback selected:', optText);
          return true;
        }
      }
      simulateClick(document.body);
      return false;
    });
  }

  function runCheck() {
    if (Date.now() < programmaticGraceUntil) return Promise.resolve();
    if (isSelecting) return Promise.resolve();
    if (!isEnabled()) return Promise.resolve();
    if (!isBiddingToolPage()) return Promise.resolve();

    var dropdown = findRaidDropdown();
    if (!dropdown) {
      logThrottled('dropdown-missing', 'Bidding tool page detected but Raid dropdown not found yet');
      return Promise.resolve();
    }

    var currentLabel = readDropdownLabel(dropdown);

    if (shouldSkipApiCheck()) {
      if (!isUnselectedLabel(currentLabel)) {
        lastApiFailureAt = 0;
        lastApiErrorKey = '';
        return Promise.resolve();
      }
      return domFallbackSelect(dropdown).then(function (ok) {
        if (ok) {
          lastApiFailureAt = 0;
          lastApiErrorKey = '';
        }
        return ok;
      });
    }

    return resolveLatestRaidViaBackground().then(function (apiResult) {
      apiResult = normalizeApiResponse(apiResult);
      lastDiagnose = {
        at: new Date().toISOString(),
        enabled: isEnabled(),
        onBiddingTool: true,
        dropdownFound: true,
        currentLabel: currentLabel,
        apiResult: apiResult
      };

      if (!apiResult.ok) {
        var errText = describeApiFailure(apiResult);
        lastApiFailureAt = Date.now();
        lastApiErrorKey = errText;
        logThrottled('api-failure', 'API resolve failed: ' + errText);
        if (!isUnselectedLabel(currentLabel)) return null;
        return domFallbackSelect(dropdown).then(function (ok) {
          if (ok) {
            lastApiFailureAt = 0;
            lastApiErrorKey = '';
          }
          return ok;
        });
      }

      lastApiFailureAt = 0;
      lastApiErrorKey = '';

      var targetName = apiResult.raidName;
      if (!targetName) {
        logThrottled('api-no-name', 'API returned no raid name');
        return null;
      }

      if (
        !isUnselectedLabel(currentLabel) &&
        normalizeLabel(currentLabel) === normalizeLabel(targetName)
      ) {
        clearMissingRaidFromPage();
        return null;
      }

      if (shouldSkipMissingRaidAttempt(dropdown, targetName)) {
        showRefreshBanner(targetName);
        return null;
      }

      var available = isRaidAvailableInDropdown(dropdown, targetName);
      if (available === false) {
        markRaidMissingFromPage(targetName);
        showRefreshBanner(targetName);
        return null;
      }

      log('Correcting raid selection:', currentLabel || 'None', '->', targetName);
      return selectRaidByName(dropdown, targetName).then(function (ok) {
        if (!ok) {
          markRaidMissingFromPage(targetName);
          showRefreshBanner(targetName);
          return null;
        }
        clearMissingRaidFromPage();
        var summary = apiResult.summary || { name: targetName, ticks: [] };
        return persistRaid(apiResult.raidId, summary).then(function () {
          showSwitchBanner(targetName);
          return true;
        });
      });
    });
  }

  function scheduleCheck() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      runCheck().catch(function (err) {
        log('Error:', err);
      });
    }, DEBOUNCE_MS);
  }

  function onStorageChanged(changes, area) {
    if (area !== 'sync') return;
    if (changes.opendkpCurrentRaidId) {
      clearMissingRaidFromPage();
      dismissBanner();
    }
    if (
      changes.opendkpBiddingToolRaidLock ||
      changes.soundProfile ||
      changes.opendkpCurrentRaidId
    ) {
      reconfigure();
    }
  }

  function attachStorageListener() {
    if (storageListenerAttached || !extApi.storage || !extApi.storage.onChanged) return;
    extApi.storage.onChanged.addListener(onStorageChanged);
    storageListenerAttached = true;
  }

  function detachStorageListener() {
    if (!storageListenerAttached || !extApi.storage || !extApi.storage.onChanged) return;
    extApi.storage.onChanged.removeListener(onStorageChanged);
    storageListenerAttached = false;
  }

  function startWatchers() {
    if (watchersActive) {
      scheduleCheck();
      return;
    }
    watchersActive = true;
    log('Watchers started on Bidding Tool');
    attachStorageListener();
    pollTimer = setInterval(scheduleCheck, POLL_MS);

    observer = new MutationObserver(function () {
      if (isProgrammaticSelect || Date.now() < programmaticGraceUntil || isSelecting) return;
      if (missingRaidFromPage) return;
      scheduleCheck();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class']
    });

    scheduleCheck();
  }

  function stopWatchers() {
    if (!watchersActive) return;
    watchersActive = false;
    log('Watchers stopped');
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    detachStorageListener();
    clearMissingRaidFromPage();
    dismissBanner();
  }

  function startPageDetection() {
    if (pageDetectTimer) return;
    pageDetectTimer = setInterval(function () {
      if (!started) return;
      if (!isEnabled()) {
        stopWatchers();
        return;
      }
      reconfigure();
    }, PAGE_DETECT_MS);
  }

  function reconfigure() {
    if (!started) return;
    if (isEnabled() && isBiddingToolPage()) {
      startWatchers();
    } else {
      stopWatchers();
    }
  }

  function diagnose() {
    var s = getSettings ? getSettings() : null;
    var dropdown = findRaidDropdown();
    var report = {
      extensionInjected: document.documentElement.getAttribute('data-opendkp-helper-active') === '1',
      started: started,
      watchersActive: watchersActive,
      enabled: isEnabled(),
      soundProfile: s ? s.SOUND_PROFILE : null,
      biddingToolRaidLock: s ? s.BIDDING_TOOL_RAID_LOCK : null,
      onBiddingToolPage: isBiddingToolPage(),
      raidDropdownFound: !!dropdown,
      currentRaidLabel: dropdown ? readDropdownLabel(dropdown) : null,
      lastDiagnose: lastDiagnose
    };

    return resolveLatestRaidViaBackground().then(function (apiResult) {
      report.api = apiResult;
      console.log(LOG_PREFIX, 'Diagnostic report:', report);
      return report;
    });
  }

  function wireDiagnoseBridge() {
    document.addEventListener(DIAG_CMD, function (ev) {
      var cmd = ev && ev.detail && ev.detail.cmd;
      if (cmd !== 'diagnose') return;
      diagnose().then(function (report) {
        document.dispatchEvent(new CustomEvent(DIAG_RESULT, { detail: report }));
      });
    });
  }

  function init(opts) {
    opts = opts || {};
    getSettings = opts.getSettings || null;
    logFn = opts.log || function () {};
    markExtensionActive();
    wireDiagnoseBridge();
    if (started) {
      reconfigure();
      return;
    }
    started = true;
    log('Initialized (helper active marker set on <html>)');

    startPageDetection();

    setTimeout(function () {
      reconfigure();
    }, INIT_DELAY_MS);
  }

  global.BiddingToolRaid = {
    init: init,
    reconfigure: reconfigure,
    scheduleCheck: scheduleCheck,
    diagnose: diagnose
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
