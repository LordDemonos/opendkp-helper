/**
 * Connection health — OpenDKP disconnect modal auto-reconnect,
 * API vs DOM stale auction UI detection, overlays, diagnose/simulate.
 */
(function (global) {
  'use strict';

  var LOG_PREFIX = '[OpenDKP Connection Health]';
  var DIAG_CMD = 'opendkp-helper-connection-health-cmd';
  var DIAG_RESULT = 'opendkp-helper-connection-health-result';

  var DISCONNECT_POLL_MS = 4000;
  var DISCONNECT_OBSERVER_DEBOUNCE_MS = 400;
  var STALE_POLL_MS = 15000;
  var RECONNECT_FALLBACK_MS = 12000;
  var STALE_DISMISS_MS = 5 * 60 * 1000;
  var STALE_RELOAD_COUNTDOWN_SEC = 20;
  var STALE_CONSECUTIVE_NEEDED = 3;
  var TIMER_FROZEN_MS = 20000;
  var API_ERROR_BACKOFF_MS = 60000;
  var PAGE_LOAD_GRACE_MS = 45000;

  var DISCONNECT_TITLE = "You've been disconnected!";
  var DISCONNECT_BODY_SNIPPET = 'no longer appear to be connected to the websocket';

  var extApi = typeof browser !== 'undefined' ? browser : chrome;
  var getSettings = null;
  var logFn = function () {};
  var started = false;
  var disconnectObserver = null;
  var disconnectPollId = null;
  var disconnectObserverDebounce = null;
  var stalePollId = null;
  var reconnectBannerEl = null;
  var staleOverlayEl = null;
  var handlingDisconnect = false;
  var lastDisconnectHandledAt = 0;
  var disconnectFallbackTimer = null;
  var staleMismatchStreak = 0;
  var staleDismissUntil = 0;
  var staleCountdownTimer = null;
  var staleCountdownLeft = 0;
  var lastApiErrorAt = 0;
  var staleCheckInFlight = false;
  var pageLoadedAt = Date.now();
  var timerWidthMemory = {};
  var lastDiagnose = null;
  var messageListenerAttached = false;
  var visibilityListenerAttached = false;

  function log() {
    try {
      var args = [LOG_PREFIX].concat(Array.prototype.slice.call(arguments));
      logFn.apply(null, args);
    } catch (_) {}
  }

  function readSettings() {
    return getSettings ? getSettings() : null;
  }

  function visualsDisabled() {
    var s = readSettings();
    return !!(s && s.DISABLE_VISUALS);
  }

  function autoReconnectEnabled() {
    var s = readSettings();
    return !s || s.AUTO_RECONNECT !== false;
  }

  function staleUiMode() {
    var s = readSettings();
    // Default warn-only: auto-reload during busy auction nights caused browser lockups.
    var mode = s && s.STALE_UI_MODE != null ? String(s.STALE_UI_MODE) : 'warn';
    if (mode === 'off' || mode === 'warn-reload' || mode === 'warn') return mode;
    return 'warn';
  }

  function normalizeItemName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function itemNamesMatch(a, b) {
    var na = normalizeItemName(a);
    var nb = normalizeItemName(b);
    if (!na || !nb) return false;
    return na === nb || na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1;
  }

  // ---------------------------------------------------------------------------
  // Disconnect detection
  // ---------------------------------------------------------------------------

  function textIncludesDisconnect(text) {
    var t = String(text || '');
    return t.indexOf(DISCONNECT_TITLE) !== -1 || t.indexOf(DISCONNECT_BODY_SNIPPET) !== -1;
  }

  function findDisconnectRoot() {
    var candidates = document.querySelectorAll(
      '[role="dialog"], .p-dialog, .p-confirm-dialog, .p-dialog-mask, .modal, [class*="dialog"]'
    );
    for (var i = 0; i < candidates.length; i++) {
      if (textIncludesDisconnect(candidates[i].textContent)) return candidates[i];
    }
    if (document.body && textIncludesDisconnect(document.body.innerText)) {
      // Prefer a smaller container that has the title
      var walkers = document.body.querySelectorAll('div, section, aside');
      var best = null;
      var bestLen = Infinity;
      for (var j = 0; j < walkers.length; j++) {
        var el = walkers[j];
        var txt = el.textContent || '';
        if (!textIncludesDisconnect(txt)) continue;
        if (txt.length < 40 || txt.length > 4000) continue;
        if (txt.length < bestLen) {
          best = el;
          bestLen = txt.length;
        }
      }
      return best || document.body;
    }
    return null;
  }

  function findReconnectButton(root) {
    if (!root) return null;
    var buttons = root.querySelectorAll('button, a[role="button"], .p-button');
    for (var i = 0; i < buttons.length; i++) {
      var label = String(buttons[i].textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (/^reconnect$/i.test(label)) return buttons[i];
    }
    return null;
  }

  function showReconnectBanner(message) {
    if (visualsDisabled()) return;
    dismissReconnectBanner();
    reconnectBannerEl = document.createElement('div');
    reconnectBannerEl.setAttribute('data-opendkp-connection-banner', '');
    reconnectBannerEl.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:2147483646;' +
      'background:#7f1d1d;color:#fff;padding:12px 16px;' +
      'font:600 15px/1.4 system-ui,sans-serif;text-align:center;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.45);';
    reconnectBannerEl.textContent = message;
    document.documentElement.appendChild(reconnectBannerEl);
  }

  function dismissReconnectBanner() {
    if (reconnectBannerEl && reconnectBannerEl.parentNode) {
      reconnectBannerEl.parentNode.removeChild(reconnectBannerEl);
    }
    reconnectBannerEl = null;
  }

  function clickReconnectOrReload(btn) {
    if (btn) {
      log('Clicking Reconnect button');
      try {
        btn.click();
      } catch (err) {
        log('Reconnect click failed:', err);
        reloadForDisconnect();
        return;
      }
      if (disconnectFallbackTimer) clearTimeout(disconnectFallbackTimer);
      disconnectFallbackTimer = setTimeout(function () {
        disconnectFallbackTimer = null;
        if (findDisconnectRoot()) {
          log('Disconnect modal still present after Reconnect click; showing manual banner (no force-reload)');
          // Prefer not to hard-reload mid-raid — OpenDKP SPA can 404 / hang under load.
          handlingDisconnect = false;
          showReconnectBanner(
            'OpenDKP Helper: Reconnect did not clear the disconnect dialog. Click Reconnect on the page, or reload manually if needed.'
          );
        } else {
          handlingDisconnect = false;
          dismissReconnectBanner();
        }
      }, RECONNECT_FALLBACK_MS);
      return;
    }
    // No Reconnect button: only reload if allowed (respects cooldown / caps).
    reloadForDisconnect();
  }

  function reloadForDisconnect(opts) {
    opts = opts || {};
    if (!global.OpenDkpPageReload) {
      location.reload();
      return;
    }
    var result = global.OpenDkpPageReload.safeReload({
      reason: 'disconnect',
      bypassFocusGuard: true,
      bypassGlobalCooldown: false,
      skipRecord: !!opts.skipRecord
    });
    if (!result.ok) {
      log('Disconnect reload blocked:', result.why);
      handlingDisconnect = false;
      showReconnectBanner(
        'OpenDKP Helper: disconnect detected. Click Reconnect on the OpenDKP dialog (auto-reload paused).'
      );
    }
  }

  function recordDisconnectAttemptOnly() {
    if (global.OpenDkpPageReload && global.OpenDkpPageReload.recordAttempt) {
      global.OpenDkpPageReload.recordAttempt('disconnect', {});
    }
  }

  function handleDisconnectIfPresent() {
    if (!autoReconnectEnabled()) return;
    var root = findDisconnectRoot();
    if (!root) {
      if (handlingDisconnect && !disconnectFallbackTimer) {
        handlingDisconnect = false;
        dismissReconnectBanner();
      }
      return;
    }

    if (handlingDisconnect) return;
    if (Date.now() - lastDisconnectHandledAt < 8000) return;

    if (global.OpenDkpPageReload) {
      var can = global.OpenDkpPageReload.canReload('disconnect', { bypassFocusGuard: true });
      if (!can.ok && can.why === 'attempt_cap') {
        log('Disconnect attempt cap reached; not auto-reconnecting');
        showReconnectBanner(
          'OpenDKP Helper: disconnect detected, but auto-reconnect limit reached. Click Reconnect manually.'
        );
        return;
      }
    }

    handlingDisconnect = true;
    lastDisconnectHandledAt = Date.now();
    showReconnectBanner('OpenDKP Helper: reconnecting…');
    var btn = findReconnectButton(root);
    if (btn) {
      recordDisconnectAttemptOnly();
      clickReconnectOrReload(btn);
    } else {
      log('No Reconnect button found; reloading');
      reloadForDisconnect();
    }
  }

  function startDisconnectWatchers() {
    if (disconnectObserver) return;
    try {
      disconnectObserver = new MutationObserver(function () {
        if (disconnectObserverDebounce) clearTimeout(disconnectObserverDebounce);
        disconnectObserverDebounce = setTimeout(function () {
          disconnectObserverDebounce = null;
          handleDisconnectIfPresent();
        }, DISCONNECT_OBSERVER_DEBOUNCE_MS);
      });
      // Avoid characterData — auction timers mutate text constantly on raid nights.
      disconnectObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    } catch (err) {
      log('Disconnect observer failed:', err);
    }
    if (!disconnectPollId) {
      disconnectPollId = setInterval(handleDisconnectIfPresent, DISCONNECT_POLL_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // Simulate disconnect modal
  // ---------------------------------------------------------------------------

  function injectSimulateDisconnectModal() {
    if (document.querySelector('[data-opendkp-simulate-disconnect]')) return;
    var mask = document.createElement('div');
    mask.setAttribute('data-opendkp-simulate-disconnect', '');
    mask.setAttribute('role', 'dialog');
    mask.style.cssText =
      'position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.65);' +
      'display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText =
      'background:#2a2a2a;color:#f0f0f0;padding:24px 28px;max-width:420px;' +
      'border:1px solid #555;border-radius:6px;font:14px/1.45 system-ui,sans-serif;text-align:center;';
    var title = document.createElement('div');
    title.style.cssText = 'font-weight:700;font-size:18px;margin-bottom:12px;';
    title.textContent = DISCONNECT_TITLE;
    var body = document.createElement('p');
    body.style.margin = '0 0 18px';
    body.textContent =
      'You no longer appear to be connected to the websocket, click here to reconnect. ' +
      "Websocket's automatically disconnected every 2 hours, whether you've been active or not. " +
      'Simply click Reconnect below to quickly reconnect and resume auctions. (Simulated by OpenDKP Helper)';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Reconnect';
    btn.style.cssText =
      'background:#8fbc8f;color:#111;border:none;border-radius:4px;padding:10px 28px;' +
      'font:600 15px system-ui,sans-serif;cursor:pointer;';
    btn.addEventListener('click', function () {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      location.reload();
    });
    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(btn);
    mask.appendChild(box);
    document.documentElement.appendChild(mask);
    log('Injected simulate disconnect modal');
    setTimeout(handleDisconnectIfPresent, 50);
  }

  // ---------------------------------------------------------------------------
  // DOM auction snapshot (for stale compare)
  // ---------------------------------------------------------------------------

  function parseHighBidFromTabOffset(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return { highBid: 0, highBidderName: '' };
    // "Name - 20" or "A - 10, B - 10"
    var parts = t.split(',');
    var best = 0;
    var bestName = '';
    for (var i = 0; i < parts.length; i++) {
      var m = parts[i].trim().match(/^(.+?)\s*-\s*(\d+)\s*$/);
      if (!m) continue;
      var bid = parseInt(m[2], 10);
      if (!Number.isNaN(bid) && bid > best) {
        best = bid;
        bestName = m[1].trim();
      }
    }
    return { highBid: best, highBidderName: bestName };
  }

  function scrapeDomAuctions() {
    var out = [];
    var seen = {};
    var headers = document.querySelectorAll(
      '[id*="header_action"], .p-tabview-nav-link, a[role="tab"]'
    );
    headers.forEach(function (header) {
      var container =
        header.closest('[id*="header_action"]') ||
        header.closest('.p-tabview') ||
        header.parentElement;
      var headerText = ((header && header.textContent) || '').replace(/\s+/g, ' ').trim();
      // Item often appears as "... | ItemName x N" or link text
      var itemName = '';
      var link = header.querySelector('a[href*="/items/"], a[href*="item"]');
      if (link) itemName = String(link.textContent || '').trim();
      if (!itemName) {
        var pipe = headerText.split('|');
        if (pipe.length > 1) {
          itemName = pipe[pipe.length - 1].replace(/\s*x\s*\d+\s*$/i, '').trim();
        }
      }
      if (!itemName || itemName.length < 2) return;
      if (/^(bidding|auctions|results|details|raid|summary)$/i.test(itemName)) return;

      var key = normalizeItemName(itemName);
      if (seen[key]) return;
      seen[key] = true;

      var highBid = 0;
      var highBidderName = '';
      var tabOffset = container && container.querySelector('.tab-offset');
      if (tabOffset) {
        var parsed = parseHighBidFromTabOffset(tabOffset.textContent);
        highBid = parsed.highBid;
        highBidderName = parsed.highBidderName;
      }

      // Fallback: bids table first row Value
      if (highBid <= 0 && container) {
        var table = container.querySelector('table.p-datatable-table, table');
        if (table) {
          var rows = table.querySelectorAll('tbody tr');
          for (var r = 0; r < rows.length; r++) {
            var cells = rows[r].querySelectorAll('td');
            if (cells.length < 2) continue;
            var nameCell = cells[0].textContent.replace(/\s+/g, ' ').trim();
            var valText = '';
            for (var c = 1; c < cells.length; c++) {
              var n = parseInt(String(cells[c].textContent || '').replace(/[^\d]/g, ''), 10);
              if (!Number.isNaN(n) && n > highBid) {
                highBid = n;
                highBidderName = nameCell;
                valText = String(n);
              }
            }
            if (valText) break;
          }
        }
      }

      var bar =
        (container && container.querySelector('.p-progressbar-value')) ||
        null;
      var widthPct = null;
      if (bar && bar.style && bar.style.width) {
        widthPct = parseFloat(String(bar.style.width).replace('%', ''));
        if (Number.isNaN(widthPct)) widthPct = null;
      }

      out.push({
        itemName: itemName,
        highBid: highBid,
        highBidderName: highBidderName,
        timerWidth: widthPct
      });
    });
    return out;
  }

  function requestActiveAuctionsSnapshot() {
    return new Promise(function (resolve) {
      try {
        var maybe = extApi.runtime.sendMessage({ type: 'getActiveAuctionsSnapshot' });
        if (maybe && typeof maybe.then === 'function') {
          maybe
            .then(function (resp) {
              resolve(resp || { ok: false, error: 'empty' });
            })
            .catch(function (err) {
              resolve({ ok: false, error: err && err.message ? err.message : String(err) });
            });
          return;
        }
        extApi.runtime.sendMessage({ type: 'getActiveAuctionsSnapshot' }, function (resp) {
          var err = extApi.runtime && extApi.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: err.message || String(err) });
            return;
          }
          resolve(resp || { ok: false, error: 'empty' });
        });
      } catch (err) {
        resolve({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    });
  }

  function updateTimerMemory(domRows) {
    var now = Date.now();
    var next = {};
    (domRows || []).forEach(function (row) {
      var key = normalizeItemName(row.itemName);
      if (!key || row.timerWidth == null) return;
      var prev = timerWidthMemory[key];
      if (prev && prev.width === row.timerWidth) {
        next[key] = { width: row.timerWidth, since: prev.since || now };
      } else {
        next[key] = { width: row.timerWidth, since: now };
      }
    });
    timerWidthMemory = next;
  }

  function isTimerFrozen(itemName) {
    var key = normalizeItemName(itemName);
    var mem = timerWidthMemory[key];
    if (!mem) return false;
    return Date.now() - mem.since >= TIMER_FROZEN_MS;
  }

  function findStaleMismatches(apiRows, domRows) {
    var mismatches = [];
    (apiRows || []).forEach(function (api) {
      if (!api || !api.itemName) return;
      if (api.endMs != null && api.endMs > 0 && api.endMs < Date.now()) return;
      var dom = null;
      for (var i = 0; i < (domRows || []).length; i++) {
        if (itemNamesMatch(api.itemName, domRows[i].itemName)) {
          dom = domRows[i];
          break;
        }
      }
      if (!dom) return;
      var apiBid = parseInt(String(api.highBid != null ? api.highBid : 0), 10) || 0;
      var domBid = parseInt(String(dom.highBid != null ? dom.highBid : 0), 10) || 0;
      if (apiBid > domBid) {
        var frozen = isTimerFrozen(dom.itemName);
        mismatches.push({
          itemName: api.itemName,
          apiHighBid: apiBid,
          domHighBid: domBid,
          timerFrozen: frozen
        });
      }
    });
    return mismatches;
  }

  function dismissStaleOverlay() {
    if (staleCountdownTimer) {
      clearInterval(staleCountdownTimer);
      staleCountdownTimer = null;
    }
    staleCountdownLeft = 0;
    if (staleOverlayEl && staleOverlayEl.parentNode) {
      staleOverlayEl.parentNode.removeChild(staleOverlayEl);
    }
    staleOverlayEl = null;
  }

  function showStaleOverlay(mismatches, mode) {
    if (staleOverlayEl) return;
    if (visualsDisabled() && mode === 'warn') {
      log('Stale UI detected (visuals disabled):', mismatches);
      return;
    }

    staleOverlayEl = document.createElement('div');
    staleOverlayEl.setAttribute('data-opendkp-stale-overlay', '');
    staleOverlayEl.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:rgba(127,29,29,.92);' +
      'display:flex;align-items:center;justify-content:center;padding:24px;' +
      'color:#fff;font:16px/1.45 system-ui,sans-serif;';

    var card = document.createElement('div');
    card.style.cssText =
      'max-width:520px;text-align:center;background:#450a0a;border:2px solid #fecaca;' +
      'border-radius:8px;padding:28px 24px;box-shadow:0 8px 32px rgba(0,0,0,.5);';

    var title = document.createElement('div');
    title.style.cssText = 'font-weight:700;font-size:22px;margin-bottom:12px;';
    title.textContent = 'OpenDKP may be out of date';

    var body = document.createElement('p');
    body.style.margin = '0 0 12px';
    body.textContent =
      'Bids on this page may not be updating. You could lose an item if you trust this view. ' +
      'Reload to catch up with the server.';

    var detail = document.createElement('p');
    detail.style.cssText = 'margin:0 0 18px;font-size:13px;opacity:.9;';
    if (mismatches && mismatches[0]) {
      var m = mismatches[0];
      detail.textContent =
        m.itemName +
        ': server high bid ' +
        m.apiHighBid +
        ' vs page showing ' +
        m.domHighBid +
        (mismatches.length > 1 ? ' (+' + (mismatches.length - 1) + ' more)' : '');
    }

    var countdownEl = document.createElement('p');
    countdownEl.setAttribute('data-opendkp-stale-countdown', '');
    countdownEl.style.cssText = 'margin:0 0 16px;font-weight:600;';

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:12px;justify-content:center;flex-wrap:wrap;';

    var reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.textContent = 'Reload now';
    reloadBtn.style.cssText =
      'background:#fecaca;color:#450a0a;border:none;border-radius:4px;padding:10px 20px;' +
      'font:600 15px system-ui,sans-serif;cursor:pointer;';
    reloadBtn.addEventListener('click', function () {
      dismissStaleOverlay();
      if (global.OpenDkpPageReload) {
        global.OpenDkpPageReload.safeReload({ reason: 'stale', bypassFocusGuard: true });
      } else {
        location.reload();
      }
    });

    var dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.style.cssText =
      'background:transparent;color:#fecaca;border:1px solid #fecaca;border-radius:4px;' +
      'padding:10px 20px;font:600 15px system-ui,sans-serif;cursor:pointer;';
    dismissBtn.addEventListener('click', function () {
      dismissStaleOverlay();
      staleDismissUntil = Date.now() + STALE_DISMISS_MS;
      staleMismatchStreak = 0;
      log('Stale overlay dismissed; cooldown', STALE_DISMISS_MS, 'ms');
    });

    actions.appendChild(reloadBtn);
    actions.appendChild(dismissBtn);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(detail);
    card.appendChild(countdownEl);
    card.appendChild(actions);
    staleOverlayEl.appendChild(card);
    document.documentElement.appendChild(staleOverlayEl);

    if (mode === 'warn-reload') {
      staleCountdownLeft = STALE_RELOAD_COUNTDOWN_SEC;
      countdownEl.textContent = 'Auto-reloading in ' + staleCountdownLeft + 's…';
      staleCountdownTimer = setInterval(function () {
        if (global.OpenDkpPageReload && global.OpenDkpPageReload.isEditableFocus()) {
          countdownEl.textContent = 'Auto-reload paused while you are typing…';
          return;
        }
        staleCountdownLeft -= 1;
        if (staleCountdownLeft <= 0) {
          clearInterval(staleCountdownTimer);
          staleCountdownTimer = null;
          dismissStaleOverlay();
          if (global.OpenDkpPageReload) {
            global.OpenDkpPageReload.safeReload({ reason: 'stale' });
          } else {
            location.reload();
          }
          return;
        }
        countdownEl.textContent = 'Auto-reloading in ' + staleCountdownLeft + 's…';
      }, 1000);
    } else if (visualsDisabled() && mode === 'warn-reload') {
      // Overlay may be suppressed above — still reload after countdown via functional path
    }
  }

  function runStaleCheck() {
    var mode = staleUiMode();
    if (mode === 'off') return;
    if (document.visibilityState !== 'visible') return;
    if (Date.now() < staleDismissUntil) return;
    if (staleOverlayEl) return;
    if (staleCheckInFlight) return;
    if (Date.now() - lastApiErrorAt < API_ERROR_BACKOFF_MS) return;
    if (Date.now() - pageLoadedAt < PAGE_LOAD_GRACE_MS) return;
    if (
      global.OpenDkpPageReload &&
      global.OpenDkpPageReload.inPostReloadGrace &&
      global.OpenDkpPageReload.inPostReloadGrace()
    ) {
      return;
    }

    var onBiddingTool =
      global.BiddingToolRaid && typeof global.BiddingToolRaid.isBiddingToolPage === 'function'
        ? global.BiddingToolRaid.isBiddingToolPage()
        : false;
    if (!onBiddingTool) {
      staleMismatchStreak = 0;
      return;
    }

    var domRows = scrapeDomAuctions();
    updateTimerMemory(domRows);
    if (!domRows.length) {
      staleMismatchStreak = 0;
      return;
    }

    staleCheckInFlight = true;
    requestActiveAuctionsSnapshot()
      .then(function (resp) {
      lastDiagnose = {
        at: new Date().toISOString(),
        mode: mode,
        snapshotOk: !!(resp && resp.ok),
        apiCount: resp && resp.auctions ? resp.auctions.length : 0,
        domCount: domRows.length
      };
      if (!resp || !resp.ok) {
        lastApiErrorAt = Date.now();
        staleMismatchStreak = 0;
        log('Active auctions snapshot failed:', resp && resp.error);
        return;
      }
      var apiRows = resp.auctions || [];
      if (!apiRows.length) {
        staleMismatchStreak = 0;
        return;
      }
      var mismatches = findStaleMismatches(apiRows, domRows);
      lastDiagnose.mismatches = mismatches;
      if (!mismatches.length) {
        staleMismatchStreak = 0;
        return;
      }
      staleMismatchStreak += 1;
      log('Stale mismatch streak', staleMismatchStreak, mismatches[0]);
      if (staleMismatchStreak < STALE_CONSECUTIVE_NEEDED) return;

      if (visualsDisabled() && mode === 'warn-reload') {
        log('Stale confirmed; visuals off — auto-reloading');
        if (global.OpenDkpPageReload) {
          global.OpenDkpPageReload.safeReload({ reason: 'stale' });
        } else {
          location.reload();
        }
        return;
      }
      showStaleOverlay(mismatches, mode);
    })
      .finally(function () {
        staleCheckInFlight = false;
      });
  }

  function startStaleWatchers() {
    stopStaleWatchers();
    if (staleUiMode() === 'off') return;
    stalePollId = setInterval(runStaleCheck, STALE_POLL_MS);
    if (!visibilityListenerAttached) {
      visibilityListenerAttached = true;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') runStaleCheck();
      });
    }
  }

  function stopStaleWatchers() {
    if (stalePollId) {
      clearInterval(stalePollId);
      stalePollId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Diagnose / messages
  // ---------------------------------------------------------------------------

  function diagnose() {
    var report = {
      autoReconnect: autoReconnectEnabled(),
      staleUiMode: staleUiMode(),
      disconnectPresent: !!findDisconnectRoot(),
      onBiddingTool:
        global.BiddingToolRaid && global.BiddingToolRaid.isBiddingToolPage
          ? global.BiddingToolRaid.isBiddingToolPage()
          : null,
      lastDiagnose: lastDiagnose,
      pageReload: global.OpenDkpPageReload
        ? {
            disconnect: global.OpenDkpPageReload.getAttemptInfo('disconnect'),
            stale: global.OpenDkpPageReload.getAttemptInfo('stale')
          }
        : null
    };
    console.log(LOG_PREFIX, 'Diagnostic report:', report);
    return report;
  }

  function wireDiagnoseBridge() {
    document.addEventListener(DIAG_CMD, function (ev) {
      var cmd = ev && ev.detail && ev.detail.cmd;
      if (cmd === 'diagnose') {
        document.dispatchEvent(new CustomEvent(DIAG_RESULT, { detail: diagnose() }));
        return;
      }
      if (cmd === 'simulateDisconnect') {
        injectSimulateDisconnectModal();
        document.dispatchEvent(
          new CustomEvent(DIAG_RESULT, { detail: { ok: true, cmd: 'simulateDisconnect' } })
        );
        return;
      }
      if (cmd === 'forceStaleOverlay') {
        showStaleOverlay(
          [{ itemName: 'Simulated Item', apiHighBid: 100, domHighBid: 10 }],
          staleUiMode() === 'off' ? 'warn' : staleUiMode()
        );
        document.dispatchEvent(
          new CustomEvent(DIAG_RESULT, { detail: { ok: true, cmd: 'forceStaleOverlay' } })
        );
      }
    });
  }

  function wireRuntimeMessages() {
    if (messageListenerAttached || !extApi.runtime || !extApi.runtime.onMessage) return;
    messageListenerAttached = true;
    extApi.runtime.onMessage.addListener(function (message) {
      if (!message) return;
      if (message.action === 'simulateDisconnect' || message.type === 'simulateDisconnect') {
        injectSimulateDisconnectModal();
      }
      if (message.action === 'forceStaleOverlay') {
        showStaleOverlay(
          [{ itemName: 'Simulated Item', apiHighBid: 100, domHighBid: 10 }],
          staleUiMode() === 'off' ? 'warn' : staleUiMode()
        );
      }
    });
  }

  function reconfigure() {
    startDisconnectWatchers();
    startStaleWatchers();
  }

  function init(opts) {
    opts = opts || {};
    getSettings = opts.getSettings || null;
    logFn = opts.log || function () {};
    wireDiagnoseBridge();
    wireRuntimeMessages();
    if (started) {
      reconfigure();
      return;
    }
    started = true;
    log('Initialized');
    reconfigure();
    // Catch modal already present at inject time
    setTimeout(handleDisconnectIfPresent, 500);
  }

  global.OpenDkpConnectionHealth = {
    init: init,
    reconfigure: reconfigure,
    diagnose: diagnose,
    simulateDisconnect: injectSimulateDisconnectModal,
    scrapeDomAuctions: scrapeDomAuctions,
    runStaleCheck: runStaleCheck
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
