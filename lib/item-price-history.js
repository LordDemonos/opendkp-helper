/**
 * Fetch and summarize past winning bids for an item (Include-All bid results).
 */
(function (global) {
  'use strict';

  var CACHE_KEY = 'itemPriceHistoryCache';
  var CACHE_TTL_MS = 20 * 60 * 1000;
  var MAX_PAGES = 50;
  var ESTIMATE_WINDOW = 8;
  var OPEN_DKP_COGNITO_CLIENT_ID = '2sq61k8dj39e309tnh5tm70dd4';

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

  function storageSyncGet(keys) {
    return new Promise(function (resolve) {
      var api = getApi();
      if (!api.storage || !api.storage.sync) return resolve({});
      api.storage.sync.get(keys, function (r) {
        resolve(r || {});
      });
    });
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s*x\s*\d+\s*$/i, '')
      .replace(/\s*\(\d+\)\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function itemNamesEqual(a, b) {
    return normalizeText(a) === normalizeText(b);
  }

  /**
   * Strip Bidding Tool chrome like "CharName - 10 Item Name" / "Item (2)" / "Item x 2"
   * down to the bare item name used for history lookup.
   */
  function sanitizeLookupItemName(raw) {
    var name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!name) return '';
    // Stack / auction quantity — not part of the OpenDKP item name
    name = name.replace(/\s*x\s*\d+\s*$/i, '').trim();
    name = name.replace(/\s*[×xX]\s*\d+\s*$/i, '').trim();
    name = name.replace(/\s*\(\d+\)\s*$/g, '').trim();

    var afterBid = name.match(/^.+?\s*-\s*\d+\s+(.+)$/);
    if (afterBid && afterBid[1]) {
      name = afterBid[1].trim();
    } else {
      var afterDash = name.match(/^.+?\s*-\s+(.+)$/);
      if (afterDash && afterDash[1] && !/^\d+$/.test(afterDash[1].trim())) {
        // Only strip if the remainder still looks like an item (not a lone number)
        var rest = afterDash[1].trim();
        if (/[a-zA-Z]/.test(rest)) name = rest;
      }
    }

    var bidPrefix = name.match(/^\d+[\s-]+(.+)$/);
    if (bidPrefix && bidPrefix[1]) {
      name = bidPrefix[1].trim();
    }

    // Quantity may trail after the bid/winner prefix was removed
    name = name.replace(/\s*x\s*\d+\s*$/i, '').trim();
    name = name.replace(/\s*[×xX]\s*\d+\s*$/i, '').trim();
    name = name.replace(/\s*\(\d+\)\s*$/g, '').trim();
    return name;
  }

  function parseDateMs(value) {
    if (value == null || value === '') return 0;
    if (value instanceof Date) {
      var t = value.getTime();
      return Number.isNaN(t) ? 0 : t;
    }
    var ms = Date.parse(String(value));
    return Number.isNaN(ms) ? 0 : ms;
  }

  function formatDisplayDate(value) {
    var ms = parseDateMs(value);
    if (!ms) return String(value || '');
    var d = new Date(ms);
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var yyyy = d.getFullYear();
    return mm + '/' + dd + '/' + yyyy;
  }

  function readItemName(auction) {
    if (!auction || typeof auction !== 'object') return '';
    if (auction.Item && auction.Item.Name) return String(auction.Item.Name);
    if (auction.ItemName) return String(auction.ItemName);
    if (auction.Name) return String(auction.Name);
    return '';
  }

  function readItemId(auction) {
    if (!auction || typeof auction !== 'object') return null;
    var raw =
      (auction.Item && (auction.Item.ItemId != null ? auction.Item.ItemId : auction.Item.ItemID)) ||
      auction.ItemId ||
      auction.ItemID;
    if (raw == null || raw === '') return null;
    var n = parseInt(String(raw), 10);
    return Number.isNaN(n) || n < 1 ? null : n;
  }

  /**
   * Bid Results rows expose winning Bids as { CharacterName, Value, CharacterId }.
   * @param {object} auction
   * @returns {Array<{ date: string, dateMs: number, winnerName: string, bidAmount: number, auctionId: number|null, itemId: number|null, itemName: string }>}
   */
  function winsFromBidResult(auction) {
    var itemName = readItemName(auction);
    var itemId = readItemId(auction);
    var auctionId =
      auction && auction.AuctionId != null
        ? parseInt(String(auction.AuctionId), 10)
        : null;
    if (auctionId != null && (Number.isNaN(auctionId) || auctionId < 1)) auctionId = null;
    var dateRaw = auction.EndTimestamp || auction.Timestamp || '';
    var dateMs = parseDateMs(dateRaw);
    var out = [];

    var bids = auction && Array.isArray(auction.Bids) ? auction.Bids : [];
    if (bids.length) {
      bids.forEach(function (bid) {
        if (!bid || typeof bid !== 'object') return;
        var winner =
          bid.CharacterName || bid.Name || bid.Winner || bid.Character || '';
        var amount = parseInt(
          String(bid.Value != null ? bid.Value : bid.BidAmount != null ? bid.BidAmount : ''),
          10
        );
        if (!winner || Number.isNaN(amount) || amount < 0) return;
        out.push({
          itemName: itemName,
          itemId: itemId,
          auctionId: auctionId,
          date: formatDisplayDate(dateRaw),
          dateMs: dateMs,
          winnerName: String(winner).trim(),
          bidAmount: amount
        });
      });
      return out;
    }

    if (auction.Winner || auction.winner) {
      var amt = parseInt(
        String(auction.BidAmount != null ? auction.BidAmount : auction.Value != null ? auction.Value : ''),
        10
      );
      if (!Number.isNaN(amt) && amt >= 0) {
        out.push({
          itemName: itemName,
          itemId: itemId,
          auctionId: auctionId,
          date: formatDisplayDate(dateRaw),
          dateMs: dateMs,
          winnerName: String(auction.Winner || auction.winner).trim(),
          bidAmount: amt
        });
      }
    }
    return out;
  }

  function winsFromItemHistoryBody(body, itemName, itemId) {
    var rows = [];
    if (Array.isArray(body)) rows = body;
    else if (body && Array.isArray(body.Models)) rows = body.Models;
    else if (body && Array.isArray(body.History)) rows = body.History;
    else if (body && Array.isArray(body.Items)) rows = body.Items;
    else if (body && typeof body === 'object' && (body.CharacterName || body.DKP != null)) {
      rows = [body];
    }

    var out = [];
    rows.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var name = row.ItemName || row.Name || itemName || '';
      if (itemName && name && !itemNamesEqual(name, itemName)) return;
      var winner = row.CharacterName || row.Winner || row.Name || '';
      var amount = parseInt(String(row.DKP != null ? row.DKP : row.BidAmount != null ? row.BidAmount : row.Value), 10);
      var dateRaw = row.Timestamp || row.EndTimestamp || row.Date || '';
      if (!winner || Number.isNaN(amount) || amount < 0) return;
      out.push({
        itemName: name || itemName,
        itemId: itemId,
        auctionId: row.AuctionId != null ? parseInt(String(row.AuctionId), 10) : null,
        date: formatDisplayDate(dateRaw),
        dateMs: parseDateMs(dateRaw),
        winnerName: String(winner).trim(),
        bidAmount: amount
      });
    });
    return out;
  }

  function sortWinsNewestFirst(wins) {
    return (wins || []).slice().sort(function (a, b) {
      if (b.dateMs !== a.dateMs) return b.dateMs - a.dateMs;
      return (b.auctionId || 0) - (a.auctionId || 0);
    });
  }

  function median(nums) {
    if (!nums || !nums.length) return null;
    var sorted = nums.slice().sort(function (a, b) {
      return a - b;
    });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    }
    return sorted[mid];
  }

  /**
   * Estimate = median of the most recent ESTIMATE_WINDOW wins.
   * @param {object[]} wins newest-first
   */
  function computeStats(wins) {
    var list = wins || [];
    var amounts = list.map(function (w) {
      return w.bidAmount;
    });
    var windowAmounts = amounts.slice(0, ESTIMATE_WINDOW);
    var last = amounts.length ? amounts[0] : null;
    var high = amounts.length ? Math.max.apply(null, amounts) : null;
    var medAll = median(amounts);
    var estimate = median(windowAmounts);
    return {
      estimate: estimate,
      last: last,
      median: medAll,
      high: high,
      count: list.length
    };
  }

  function cacheKey(clientSlug, itemName) {
    return normalizeText(clientSlug) + '|' + normalizeText(itemName);
  }

  function readCacheEntry(clientSlug, itemName) {
    return storageLocalGet([CACHE_KEY]).then(function (r) {
      var bag = r[CACHE_KEY];
      if (!bag || typeof bag !== 'object') return null;
      var entry = bag[cacheKey(clientSlug, itemName)];
      if (!entry || !entry.fetchedAt) return null;
      if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
      return entry;
    });
  }

  function writeCacheEntry(clientSlug, itemName, payload) {
    return storageLocalGet([CACHE_KEY]).then(function (r) {
      var bag = r[CACHE_KEY] && typeof r[CACHE_KEY] === 'object' ? r[CACHE_KEY] : {};
      bag[cacheKey(clientSlug, itemName)] = {
        fetchedAt: Date.now(),
        wins: payload.wins,
        stats: payload.stats,
        meta: payload.meta
      };
      var out = {};
      out[CACHE_KEY] = bag;
      return storageLocalSet(out);
    });
  }

  function buildApiConfig(clientSlug) {
    return {
      apiHost: 'api.opendkp.com',
      clientSlug: String(clientSlug || '').trim().toLowerCase(),
      cognitoClientId: OPEN_DKP_COGNITO_CLIENT_ID
    };
  }

  function hasAuthToken() {
    if (!global.OpenDkpApi || !global.OpenDkpApi.STORAGE_KEYS) return Promise.resolve(false);
    var key = global.OpenDkpApi.STORAGE_KEYS.idToken;
    return storageLocalGet([key]).then(function (r) {
      return !!(r[key] && String(r[key]).trim());
    });
  }

  /**
   * @param {{ apiHost?: string, clientSlug: string, cognitoClientId?: string }} cfg
   * @param {string} itemName
   * @param {{ itemId?: number, forceRefresh?: boolean, maxPages?: number }} [opts]
   */
  function fetchItemWinHistory(cfg, itemName, opts) {
    opts = opts || {};
    var rawName = String(itemName || '').trim();
    var name = sanitizeLookupItemName(rawName);
    if (!name) return Promise.reject(new Error('Item name is required'));
    if (!cfg || !cfg.clientSlug) return Promise.reject(new Error('Guild subdomain is required'));
    if (!global.OpenDkpApi || !global.OpenDkpApi.getAllPaginatedAuctions) {
      return Promise.reject(new Error('OpenDKP API unavailable'));
    }

    var apiCfg = {
      apiHost: cfg.apiHost || 'api.opendkp.com',
      clientSlug: String(cfg.clientSlug).trim().toLowerCase(),
      cognitoClientId: cfg.cognitoClientId || OPEN_DKP_COGNITO_CLIENT_ID
    };

    function finish(wins, meta) {
      var sorted = sortWinsNewestFirst(wins);
      var stats = computeStats(sorted);
      var result = { wins: sorted, stats: stats, meta: meta || {} };
      return writeCacheEntry(apiCfg.clientSlug, name, result).then(function () {
        return result;
      });
    }

    // Dirty names must not reuse an empty cache keyed on the mangled title
    var forceRefresh = !!opts.forceRefresh || sanitizeLookupItemName(rawName) !== rawName;

    var cachePromise = forceRefresh
      ? Promise.resolve(null)
      : readCacheEntry(apiCfg.clientSlug, name);

    return cachePromise.then(function (cached) {
      if (cached && Array.isArray(cached.wins)) {
        return {
          wins: cached.wins,
          stats: cached.stats || computeStats(cached.wins),
          meta: Object.assign({}, cached.meta || {}, { fromCache: true })
        };
      }

      return global.OpenDkpApi.getAllPaginatedAuctions(apiCfg, {
        maxPages: opts.maxPages != null ? opts.maxPages : MAX_PAGES
      }).then(function (pageResult) {
        var rows = (pageResult && pageResult.BidResults) || [];
        var wins = [];
        rows.forEach(function (auction) {
          if (!itemNamesEqual(readItemName(auction), name)) return;
          wins = wins.concat(winsFromBidResult(auction));
        });

        var meta = {
          strategy: 'auctions',
          includeAll: true,
          pagesFetched: pageResult && pageResult.pagesFetched,
          truncated: !!(pageResult && pageResult.truncated),
          fromCache: false,
          lookupName: name
        };

        if (wins.length || !opts.itemId || !global.OpenDkpApi.getItemHistory) {
          return finish(wins, meta);
        }

        return global.OpenDkpApi.getItemHistory(apiCfg, opts.itemId)
          .then(function (body) {
            var fallback = winsFromItemHistoryBody(body, name, opts.itemId);
            return finish(fallback, {
              strategy: 'itemHistory',
              includeAll: true,
              fromCache: false,
              lookupName: name
            });
          })
          .catch(function () {
            return finish(wins, meta);
          });
      });
    });
  }

  function loadClientSlug() {
    return storageSyncGet(['opendkpClientSlug']).then(function (r) {
      return String(r.opendkpClientSlug || '')
        .trim()
        .toLowerCase();
    });
  }

  global.ItemPriceHistory = {
    CACHE_KEY: CACHE_KEY,
    ESTIMATE_WINDOW: ESTIMATE_WINDOW,
    normalizeText: normalizeText,
    itemNamesEqual: itemNamesEqual,
    sanitizeLookupItemName: sanitizeLookupItemName,
    winsFromBidResult: winsFromBidResult,
    computeStats: computeStats,
    buildApiConfig: buildApiConfig,
    hasAuthToken: hasAuthToken,
    loadClientSlug: loadClientSlug,
    fetchItemWinHistory: fetchItemWinHistory,
    formatDisplayDate: formatDisplayDate
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
