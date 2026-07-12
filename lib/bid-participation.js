/**
 * Shared bid-participation snapshot — which items the user is currently bidding on.
 * Written by auto-bid (API) and content.js (Bidding Tool DOM); read by the popup.
 */
(function (global) {
  'use strict';

  var SNAPSHOT_KEY = 'bidParticipationSnapshot';
  var TTL_MS = 15 * 60 * 1000;

  function getApi() {
    return typeof browser !== 'undefined' ? browser : chrome;
  }

  function storageLocalGet(keys) {
    return new Promise(function (resolve) {
      var api = getApi();
      if (!api.storage || !api.storage.local) return resolve({});
      api.storage.local.get(keys, function (r) {
        resolve(r || {});
      });
    });
  }

  function storageLocalSet(obj) {
    return new Promise(function (resolve, reject) {
      var api = getApi();
      if (!api.storage || !api.storage.local) return resolve();
      api.storage.local.set(obj, function () {
        var err = api.runtime && api.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  function normalizeItemKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function itemDedupeKey(item) {
    if (!item || typeof item !== 'object') return '';
    if (item.auctionId != null && String(item.auctionId).trim()) {
      return 'a:' + String(item.auctionId);
    }
    return 'n:' + normalizeItemKey(item.itemName);
  }

  /**
   * @param {object} [raw]
   * @returns {{ updatedAt: number, clientSlug: string, items: object[] }}
   */
  function normalizeSnapshot(raw) {
    var items = [];
    if (raw && Array.isArray(raw.items)) {
      raw.items.forEach(function (entry) {
        if (!entry || typeof entry !== 'object') return;
        var name = String(entry.itemName || '').trim();
        if (!name) return;
        var source = 'manual-dom';
        if (entry.source === 'auto-bid') source = 'auto-bid';
        else if (entry.source === 'active-api') source = 'active-api';
        else if (entry.source === 'loot') source = 'loot';
        else if (entry.source === 'manual-dom') source = 'manual-dom';
        var row = {
          itemName: name,
          source: source
        };
        if (entry.itemId != null && entry.itemId !== '') {
          var iid = parseInt(String(entry.itemId), 10);
          if (!Number.isNaN(iid) && iid > 0) row.itemId = iid;
        }
        if (entry.auctionId != null && entry.auctionId !== '') {
          var aid = parseInt(String(entry.auctionId), 10);
          if (!Number.isNaN(aid) && aid > 0) row.auctionId = aid;
        }
        if (entry.endTimestamp) row.endTimestamp = String(entry.endTimestamp);
        if (entry.characterName) row.characterName = String(entry.characterName);
        if (entry.myHighBid != null) {
          var bid = parseInt(String(entry.myHighBid), 10);
          if (!Number.isNaN(bid) && bid >= 0) row.myHighBid = bid;
        }
        items.push(row);
      });
    }
    return {
      updatedAt: raw && raw.updatedAt != null ? Number(raw.updatedAt) : 0,
      clientSlug: raw && raw.clientSlug ? String(raw.clientSlug) : '',
      items: items
    };
  }

  function isFresh(snapshot, nowMs) {
    var now = nowMs != null ? nowMs : Date.now();
    if (!snapshot || !snapshot.updatedAt) return false;
    return now - snapshot.updatedAt <= TTL_MS;
  }

  function readSnapshot() {
    return storageLocalGet([SNAPSHOT_KEY]).then(function (r) {
      return normalizeSnapshot(r[SNAPSHOT_KEY]);
    });
  }

  /**
   * Merge incoming items into the snapshot.
   * Same auctionId / item name replaces the prior row; other sources are kept if still fresh.
   * @param {{ clientSlug: string, items: object[], replaceSource?: string|null }} payload
   */
  function writeParticipation(payload) {
    payload = payload || {};
    var clientSlug = String(payload.clientSlug || '').trim().toLowerCase();
    var incoming = Array.isArray(payload.items) ? payload.items : [];
    var replaceSource = payload.replaceSource != null ? payload.replaceSource : null;
    var now = Date.now();

    return readSnapshot().then(function (existing) {
      var keep = [];
      if (isFresh(existing, now) && (!clientSlug || !existing.clientSlug || existing.clientSlug === clientSlug)) {
        existing.items.forEach(function (item) {
          if (replaceSource && item.source === replaceSource) return;
          keep.push(item);
        });
      }

      var byKey = {};
      keep.forEach(function (item) {
        byKey[itemDedupeKey(item)] = item;
      });
      incoming.forEach(function (item) {
        var key = itemDedupeKey(item);
        if (!key) return;
        byKey[key] = item;
      });

      var merged = Object.keys(byKey).map(function (k) {
        return byKey[k];
      });

      var snap = {
        updatedAt: now,
        clientSlug: clientSlug || existing.clientSlug || '',
        items: merged
      };
      var out = {};
      out[SNAPSHOT_KEY] = snap;
      return storageLocalSet(out).then(function () {
        return snap;
      });
    });
  }

  function clearSnapshot() {
    var out = {};
    out[SNAPSHOT_KEY] = { updatedAt: Date.now(), clientSlug: '', items: [] };
    return storageLocalSet(out);
  }

  /**
   * Fresh participating items (empty if stale).
   */
  function getActiveParticipation() {
    return readSnapshot().then(function (snap) {
      if (!isFresh(snap)) {
        return { updatedAt: snap.updatedAt, clientSlug: snap.clientSlug, items: [] };
      }
      return snap;
    });
  }

  global.BidParticipation = {
    SNAPSHOT_KEY: SNAPSHOT_KEY,
    TTL_MS: TTL_MS,
    normalizeItemKey: normalizeItemKey,
    normalizeSnapshot: normalizeSnapshot,
    isFresh: isFresh,
    readSnapshot: readSnapshot,
    writeParticipation: writeParticipation,
    clearSnapshot: clearSnapshot,
    getActiveParticipation: getActiveParticipation
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
