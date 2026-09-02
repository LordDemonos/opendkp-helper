/**
 * Shared safe page reload — cooldowns, attempt caps, focus guard.
 * Used by connection-health (disconnect/stale) and bidding-tool-raid (missing raid list).
 */
(function (global) {
  'use strict';

  var LOG_PREFIX = '[OpenDKP Page Reload]';
  /** Minimum gap between any automatic reloads (heavy raid nights need more breathing room). */
  var GLOBAL_COOLDOWN_MS = 90000;
  /** After a reload, suppress follow-up auto-reloads briefly while the SPA settles. */
  var POST_RELOAD_GRACE_MS = 45000;
  var LAST_AT_KEY = 'opendkpReload:lastAt';
  var GRACE_UNTIL_KEY = 'opendkpReload:graceUntil';

  var LIMITS = {
    disconnect: { maxAttempts: 2, windowMs: 10 * 60 * 1000, key: 'opendkpReload:disconnect' },
    stale: { maxAttempts: 1, windowMs: 15 * 60 * 1000, key: 'opendkpReload:stale' },
    'raid-missing': { maxAttempts: 1, windowMs: 15 * 60 * 1000, keyPrefix: 'opendkpReload:raid:' }
  };

  function log() {
    try {
      var args = [LOG_PREFIX].concat(Array.prototype.slice.call(arguments));
      console.log.apply(console, args);
    } catch (_) {}
  }

  function normalizeRaidName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function storageGet(key) {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      return sessionStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      sessionStorage.setItem(key, value);
    } catch (_) {}
  }

  function readAttemptState(key) {
    var raw = storageGet(key);
    if (!raw) return { attempts: 0, windowStart: 0 };
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { attempts: 0, windowStart: 0 };
      return {
        attempts: parseInt(String(parsed.attempts || 0), 10) || 0,
        windowStart: parseInt(String(parsed.windowStart || 0), 10) || 0
      };
    } catch (_) {
      return { attempts: 0, windowStart: 0 };
    }
  }

  function writeAttemptState(key, state) {
    storageSet(key, JSON.stringify(state));
  }

  function limitKeyFor(reason, meta) {
    var lim = LIMITS[reason];
    if (!lim) return null;
    if (lim.key) return lim.key;
    if (lim.keyPrefix) {
      return lim.keyPrefix + (normalizeRaidName(meta && meta.raidName) || 'unknown');
    }
    return null;
  }

  function isEditableFocus() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = String(el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    try {
      if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return true;
    } catch (_) {}
    return false;
  }

  /**
   * @param {string} reason — 'disconnect' | 'stale' | 'raid-missing'
   * @param {{ raidName?: string, bypassFocusGuard?: boolean, bypassGlobalCooldown?: boolean }} [meta]
   * @returns {{ ok: boolean, why?: string }}
   */
  function inPostReloadGrace() {
    var until = parseInt(String(storageGet(GRACE_UNTIL_KEY) || '0'), 10) || 0;
    return until > Date.now();
  }

  function canReload(reason, meta) {
    meta = meta || {};
    var lim = LIMITS[reason];
    if (!lim) return { ok: false, why: 'unknown_reason' };

    if (!meta.bypassFocusGuard && isEditableFocus()) {
      return { ok: false, why: 'focus_guard' };
    }

    if (!meta.bypassPostReloadGrace && inPostReloadGrace()) {
      return { ok: false, why: 'post_reload_grace' };
    }

    if (!meta.bypassGlobalCooldown) {
      var lastAt = parseInt(String(storageGet(LAST_AT_KEY) || '0'), 10) || 0;
      if (lastAt && Date.now() - lastAt < GLOBAL_COOLDOWN_MS) {
        return { ok: false, why: 'global_cooldown' };
      }
    }

    var key = limitKeyFor(reason, meta);
    if (!key) return { ok: false, why: 'missing_key' };

    var state = readAttemptState(key);
    var now = Date.now();
    if (!state.windowStart || now - state.windowStart > lim.windowMs) {
      return { ok: true };
    }
    if (state.attempts >= lim.maxAttempts) {
      return { ok: false, why: 'attempt_cap' };
    }
    return { ok: true };
  }

  /**
   * Record an attempt without reloading (e.g. Reconnect button click).
   * @param {string} reason
   * @param {{ raidName?: string }} [meta]
   */
  function recordAttempt(reason, meta) {
    meta = meta || {};
    var lim = LIMITS[reason];
    var key = limitKeyFor(reason, meta);
    if (!lim || !key) return;

    var now = Date.now();
    var state = readAttemptState(key);
    if (!state.windowStart || now - state.windowStart > lim.windowMs) {
      state = { attempts: 1, windowStart: now };
    } else {
      state.attempts = (state.attempts || 0) + 1;
    }
    writeAttemptState(key, state);
    storageSet(LAST_AT_KEY, String(now));
  }

  /**
   * @param {{ reason: string, raidName?: string, bypassFocusGuard?: boolean, bypassGlobalCooldown?: boolean, skipRecord?: boolean }} opts
   * @returns {{ ok: boolean, why?: string }}
   */
  function safeReload(opts) {
    opts = opts || {};
    var reason = opts.reason;
    var meta = {
      raidName: opts.raidName,
      bypassFocusGuard: !!opts.bypassFocusGuard,
      bypassGlobalCooldown: !!opts.bypassGlobalCooldown
    };
    var check = canReload(reason, meta);
    if (!check.ok) {
      log('Reload skipped:', reason, check.why);
      return check;
    }
    if (!opts.skipRecord) {
      recordAttempt(reason, meta);
    } else {
      storageSet(LAST_AT_KEY, String(Date.now()));
    }
    storageSet(GRACE_UNTIL_KEY, String(Date.now() + POST_RELOAD_GRACE_MS));
    log('Reloading page:', reason, opts.raidName || '');
    try {
      location.reload();
    } catch (err) {
      log('location.reload failed:', err);
      return { ok: false, why: 'reload_threw' };
    }
    return { ok: true };
  }

  function recordManualReload() {
    var now = Date.now();
    storageSet(LAST_AT_KEY, String(now));
    storageSet(GRACE_UNTIL_KEY, String(now + POST_RELOAD_GRACE_MS));
  }

  /**
   * @param {string} reason
   * @param {{ raidName?: string }} [meta]
   */
  function getAttemptInfo(reason, meta) {
    var lim = LIMITS[reason];
    var key = limitKeyFor(reason, meta || {});
    if (!lim || !key) return null;
    var state = readAttemptState(key);
    return {
      attempts: state.attempts || 0,
      maxAttempts: lim.maxAttempts,
      windowStart: state.windowStart || 0,
      windowMs: lim.windowMs
    };
  }

  global.OpenDkpPageReload = {
    canReload: canReload,
    safeReload: safeReload,
    recordAttempt: recordAttempt,
    recordManualReload: recordManualReload,
    getAttemptInfo: getAttemptInfo,
    isEditableFocus: isEditableFocus,
    inPostReloadGrace: inPostReloadGrace,
    GLOBAL_COOLDOWN_MS: GLOBAL_COOLDOWN_MS,
    POST_RELOAD_GRACE_MS: POST_RELOAD_GRACE_MS
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
