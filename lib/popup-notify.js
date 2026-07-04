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

  global.PopupNotify = {
    show: showPopupNotice
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
