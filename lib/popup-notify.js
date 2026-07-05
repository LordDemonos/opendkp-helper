/**
 * Inline notices for the extension popup — avoids native alert/confirm dialogs.
 */
(function (global) {
  'use strict';

  var pendingRestore = null;

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = String(text != null ? text : '');
    return div.innerHTML;
  }

  /**
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'|'active'|'inactive'} [type]
   * @param {number} [durationMs]
   */
  function showPopupNotice(message, type, durationMs) {
    var statusDiv = document.getElementById('status');
    var statusText = document.getElementById('statusText');
    if (!statusText || !message) return;

    type = type || 'error';
    durationMs = durationMs != null ? durationMs : 3500;

    if (pendingRestore) {
      clearTimeout(pendingRestore.timer);
      pendingRestore = null;
    }

    var snapshot = {
      html: statusText.innerHTML,
      className: statusDiv ? statusDiv.className : ''
    };

    if (statusDiv) {
      statusDiv.className = 'status ' + type;
    }
    statusText.innerHTML = escapeHtml(message);

    pendingRestore = {
      timer: setTimeout(function () {
        statusText.innerHTML = snapshot.html;
        if (statusDiv) statusDiv.className = snapshot.className;
        pendingRestore = null;
      }, durationMs)
    };
  }

  var LOOT_MONITOR_POPUP_HEIGHT = 720;
  var POPUP_COMPACT_MAX_HEIGHT = 560;

  function getExtensionApi() {
    if (typeof browser !== 'undefined') return browser;
    if (typeof chrome !== 'undefined') return chrome;
    return null;
  }

  /** Grow popup only while raid-leader loot monitor section is visible (toolbar or popped-out window). */
  function setLootMonitorExpanded(expanded) {
    var body = document.body;
    if (!body) return;
    if (expanded) {
      body.classList.add('loot-monitor-expanded');
      body.style.height = LOOT_MONITOR_POPUP_HEIGHT + 'px';
    } else {
      body.classList.remove('loot-monitor-expanded');
      body.style.height = 'auto';
    }
    syncPopupWindowSize(expanded);
  }

  function syncPopupWindowSize(expanded) {
    var api = getExtensionApi();
    if (!api || !api.windows || !api.windows.getCurrent || !api.windows.update) return;
    requestAnimationFrame(function () {
      api.windows.getCurrent().then(function (win) {
        if (!win || win.id == null) return;
        var width = win.width || 332;
        var height = expanded
          ? LOOT_MONITOR_POPUP_HEIGHT
          : Math.max(320, Math.min(document.documentElement.scrollHeight + 8, POPUP_COMPACT_MAX_HEIGHT));
        return api.windows.update(win.id, { width: width, height: height });
      }).catch(function () {});
    });
  }

  global.PopupNotify = {
    show: showPopupNotice
  };

  global.PopupLayout = {
    setLootMonitorExpanded: setLootMonitorExpanded
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
