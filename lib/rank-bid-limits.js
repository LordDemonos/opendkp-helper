/**
 * Guild rank min/max bid limits — parsed from opendkp.com Bid Rules UI, cached locally.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'opendkpRankBidLimitsBySlug';

  function getApi() {
    return typeof browser !== 'undefined' ? browser : chrome;
  }

  function normalizeRankName(rank) {
    return String(rank || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * @param {string} text
   * @returns {Record<string, { min?: number, max?: number }>}
   */
  function parseRankBidLimitsFromText(text) {
    var ranks = {};
    var src = String(text || '');
    var maxRe = /Maximum Bid for ([^\n:]+?) is:\s*(\d+)/gi;
    var minRe = /Minimum Bid for ([^\n:]+?) is:\s*(\d+)/gi;
    var match;

    while ((match = maxRe.exec(src)) !== null) {
      var rankName = normalizeRankName(match[1]);
      var maxVal = parseInt(match[2], 10);
      if (!rankName || Number.isNaN(maxVal) || maxVal < 1) continue;
      ranks[rankName] = ranks[rankName] || {};
      ranks[rankName].max = maxVal;
    }

    while ((match = minRe.exec(src)) !== null) {
      var rankMinName = normalizeRankName(match[1]);
      var minVal = parseInt(match[2], 10);
      if (!rankMinName || Number.isNaN(minVal) || minVal < 1) continue;
      ranks[rankMinName] = ranks[rankMinName] || {};
      ranks[rankMinName].min = minVal;
    }

    return ranks;
  }

  function clientSlugFromHostname(hostname) {
    var host = String(hostname || '')
      .trim()
      .toLowerCase()
      .replace(/^www\./, '');
    if (!host.endsWith('.opendkp.com')) return '';
    var slug = host.slice(0, -'.opendkp.com'.length);
    if (!slug || slug === 'opendkp') return '';
    return slug;
  }

  function storageLocalGet(key) {
    return new Promise(function (resolve) {
      var api = getApi();
      if (!api.storage || !api.storage.local) return resolve({});
      api.storage.local.get([key], function (r) {
        resolve(r && r[key] ? r[key] : {});
      });
    });
  }

  function storageLocalSet(key, value) {
    return new Promise(function (resolve, reject) {
      var api = getApi();
      if (!api.storage || !api.storage.local) return resolve();
      var payload = {};
      payload[key] = value;
      api.storage.local.set(payload, function () {
        var err = api.runtime && api.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * @param {Document} doc
   * @returns {Record<string, { min?: number, max?: number }>}
   */
  function parseFromDocument(doc) {
    if (!doc || !doc.body) return {};
    return parseRankBidLimitsFromText(doc.body.innerText || '');
  }

  /**
   * @param {string} slug
   * @returns {Promise<Record<string, { min?: number, max?: number }>>}
   */
  function loadForSlug(slug) {
    var normalized = String(slug || '')
      .trim()
      .toLowerCase();
    if (!normalized) return Promise.resolve({});
    return storageLocalGet(STORAGE_KEY).then(function (root) {
      var entry = root && root[normalized];
      return entry && entry.ranks && typeof entry.ranks === 'object' ? entry.ranks : {};
    });
  }

  /**
   * Merge incoming rank limits into existing (Bidding Tool only shows one rank at a time).
   * @param {Record<string, { min?: number, max?: number }>} existing
   * @param {Record<string, { min?: number, max?: number }>} incoming
   */
  function mergeRankMaps(existing, incoming) {
    var out = {};
    Object.keys(existing || {}).forEach(function (key) {
      var name = normalizeRankName(key);
      if (!name || !existing[key] || typeof existing[key] !== 'object') return;
      out[name] = Object.assign({}, existing[key]);
    });
    Object.keys(incoming || {}).forEach(function (key) {
      var name = normalizeRankName(key);
      if (!name || !incoming[key] || typeof incoming[key] !== 'object') return;
      out[name] = out[name] || {};
      if (incoming[key].max != null) out[name].max = incoming[key].max;
      if (incoming[key].min != null) out[name].min = incoming[key].min;
    });
    return out;
  }

  /**
   * @param {string} slug
   * @param {Record<string, { min?: number, max?: number }>} ranks
   */
  function saveForSlug(slug, ranks) {
    var normalized = String(slug || '')
      .trim()
      .toLowerCase();
    if (!normalized || !ranks || typeof ranks !== 'object') return Promise.resolve();
    return storageLocalGet(STORAGE_KEY).then(function (root) {
      var next = root && typeof root === 'object' ? Object.assign({}, root) : {};
      var prevRanks =
        next[normalized] && next[normalized].ranks && typeof next[normalized].ranks === 'object'
          ? next[normalized].ranks
          : {};
      next[normalized] = {
        fetchedAt: Date.now(),
        ranks: mergeRankMaps(prevRanks, ranks)
      };
      return storageLocalSet(STORAGE_KEY, next);
    });
  }

  /**
   * @param {Record<string, { min?: number, max?: number }>} limits
   * @param {string} rank
   * @returns {number|null}
   */
  function getRankMax(limits, rank) {
    if (!limits || !rank) return null;
    var key = normalizeRankName(rank);
    var entry = limits[key];
    if (!entry || entry.max == null) return null;
    var n = parseInt(String(entry.max), 10);
    return Number.isNaN(n) || n < 1 ? null : n;
  }

  /**
   * @param {number} maxDkp
   * @param {string} rank
   * @param {Record<string, { min?: number, max?: number }>} limits
   * @returns {{ value: number, rankMax: number|null, clamped: boolean }}
   */
  function clampMaxDkpForRank(maxDkp, rank, limits) {
    var value = parseInt(String(maxDkp != null ? maxDkp : ''), 10);
    if (Number.isNaN(value) || value < 1) return { value: value, rankMax: null, clamped: false };
    var rankMax = getRankMax(limits, rank);
    if (rankMax == null || value <= rankMax) {
      return { value: value, rankMax: rankMax, clamped: false };
    }
    return { value: rankMax, rankMax: rankMax, clamped: true };
  }

  global.OpenDkpRankBidLimits = {
    STORAGE_KEY: STORAGE_KEY,
    normalizeRankName: normalizeRankName,
    parseRankBidLimitsFromText: parseRankBidLimitsFromText,
    parseFromDocument: parseFromDocument,
    clientSlugFromHostname: clientSlugFromHostname,
    loadForSlug: loadForSlug,
    saveForSlug: saveForSlug,
    mergeRankMaps: mergeRankMaps,
    getRankMax: getRankMax,
    clampMaxDkpForRank: clampMaxDkpForRank
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
