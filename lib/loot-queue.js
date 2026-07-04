/**
 * Queue parsed loot items to the current raid's OpenDKP bidding queue (Create Auction API).
 */
(function (global) {
  'use strict';

  var OPEN_DKP_COGNITO_CLIENT_ID = '2sq61k8dj39e309tnh5tm70dd4';
  var OPEN_DKP_API_HOST = 'api.opendkp.com';

  var FALLBACK_AUCTION = {
    BidType: 'Open',
    MinimumBid: 10,
    MaximumBid: 0,
    Duration: 2,
    ItemQuantity: 1,
    AutoAdjustBids: 0,
    AllowDeletes: false
  };

  function getApi() {
    return typeof browser !== 'undefined' ? browser : chrome;
  }

  function storageSyncGet(keys) {
    return new Promise(function (resolve) {
      var api = getApi();
      api.storage.sync.get(keys, function (r) {
        resolve(r || {});
      });
    });
  }

  function storageSyncSet(obj) {
    return new Promise(function (resolve, reject) {
      var api = getApi();
      api.storage.sync.set(obj, function () {
        var err = api.runtime && api.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    });
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

  var RAID_CONTEXT_MIRROR_KEYS = [
    'opendkpClientSlug',
    'opendkpCurrentRaidId',
    'opendkpCurrentRaidSummaryJson'
  ];

  var validatedCtxCache = null;
  var validatedCtxCacheAt = 0;
  var VALIDATED_CTX_TTL_MS = 120000;

  function invalidateValidatedContextCache() {
    validatedCtxCache = null;
    validatedCtxCacheAt = 0;
  }

  function readSoundProfile() {
    return storageSyncGet(['soundProfile']).then(function (r) {
      return r.soundProfile === 'raidleader' ? 'raidleader' : 'raider';
    });
  }

  function assertRaidLeaderFeature(featureLabel) {
    return readSoundProfile().then(function (profile) {
      if (profile !== 'raidleader') {
        return Promise.reject(
          new Error((featureLabel || 'This feature') + ' is available in Raid Leader mode only.')
        );
      }
    });
  }

  function normalizeClientSlug(raw) {
    var s = String(raw || '')
      .trim()
      .toLowerCase();
    if (!s || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s)) return '';
    return s;
  }

  function buildApiConfig(clientSlug) {
    return {
      apiHost: OPEN_DKP_API_HOST,
      clientSlug: normalizeClientSlug(clientSlug),
      cognitoClientId: OPEN_DKP_COGNITO_CLIENT_ID
    };
  }

  function parseRaidSummary(json) {
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function parseAuctionDuration(raw) {
    var n = parseInt(String(raw != null ? raw : FALLBACK_AUCTION.Duration), 10);
    return Number.isNaN(n) || n < 1 ? FALLBACK_AUCTION.Duration : n;
  }

  /**
   * Maps settings Pay Strategy → API AutoAdjustBids (OpenDKP bidding UI).
   * @param {string} payStrategy
   */
  function autoAdjustBidsFromPayStrategy(payStrategy) {
    switch (payStrategy) {
      case 'exact':
        return 0;
      case 'second_plus_one':
        return 1;
      case 'second_plus_one_equal':
        return 2;
      default: {
        var _unknown = payStrategy;
        return 0;
      }
    }
  }

  function normalizePayStrategy(raw) {
    var v = String(raw || 'exact');
    if (v === 'second_plus_one' || v === 'second_plus_one_equal') return v;
    return 'exact';
  }

  /**
   * @returns {Promise<{ payStrategy: string, duration: number, autoAdjustBids: number }>}
   */
  function readAuctionDefaults() {
    return storageSyncGet(['opendkpAuctionPayStrategy', 'opendkpAuctionDuration']).then(function (data) {
      var payStrategy = normalizePayStrategy(data.opendkpAuctionPayStrategy);
      return {
        payStrategy: payStrategy,
        duration: parseAuctionDuration(data.opendkpAuctionDuration),
        autoAdjustBids: autoAdjustBidsFromPayStrategy(payStrategy)
      };
    });
  }

  function coerceItemSearchResults(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.Models)) return body.Models;
    return [];
  }

  function readItemId(match) {
    if (!match || typeof match !== 'object') return null;
    var id = match.ItemID != null ? match.ItemID : match.ItemId;
    if (id == null || id === '') return null;
    var n = Number(id);
    return Number.isNaN(n) ? null : n;
  }

  function readItemName(match, fallback) {
    if (match && match.ItemName) return String(match.ItemName);
    return fallback;
  }

  /**
   * Strip trailing stack counts like " (6)" from parsed loot tokens.
   * @param {string} raw
   */
  function normalizeItemName(raw) {
    return parseItemToken(raw).name;
  }

  /**
   * @param {string} raw
   * @returns {{ name: string, quantity: number }}
   */
  function parseItemToken(raw) {
    if (global.EqLogParse && global.EqLogParse.parseItemToken) {
      return global.EqLogParse.parseItemToken(raw);
    }
    var trimmed = String(raw || '').trim();
    return { name: trimmed.replace(/\s*\(\d+\)\s*$/, '').trim(), quantity: 1 };
  }

  function formatQueuedItemLabel(itemName, quantity) {
    return quantity > 1 ? itemName + ' ×' + quantity : itemName;
  }

  function pickBestItemMatch(results, normalizedName) {
    if (!results.length) return null;
    var target = normalizedName.toLowerCase();
    for (var i = 0; i < results.length; i++) {
      var name = readItemName(results[i], '');
      if (name.toLowerCase() === target) return results[i];
    }
    for (var j = 0; j < results.length; j++) {
      var candidate = readItemName(results[j], '');
      if (candidate.toLowerCase().indexOf(target) !== -1) return results[j];
    }
    return results[0];
  }

  /**
   * @returns {Promise<{ cfg: object, raidId: number|null, raidName: string, hasToken: boolean }>}
   */
  function readLootQueueContext() {
    return readRaidContextFromStorage().then(function (data) {
      var cfg = buildApiConfig(data.opendkpClientSlug);
      var raidIdRaw = data.opendkpCurrentRaidId;
      var raidId =
        raidIdRaw == null || raidIdRaw === '' || Number.isNaN(Number(raidIdRaw))
          ? null
          : Number(raidIdRaw);
      var summary = parseRaidSummary(data.opendkpCurrentRaidSummaryJson);
      var raidName = summary && summary.name ? String(summary.name) : '';
      return global.OpenDkpApi
        ? global.OpenDkpApi.getTokenMeta().then(function (meta) {
            return {
              cfg: cfg,
              raidId: raidId,
              raidName: raidName,
              hasToken: !!(meta && meta.hasToken)
            };
          })
        : Promise.resolve({
            cfg: cfg,
            raidId: raidId,
            raidName: raidName,
            hasToken: false
          });
    });
  }

  function mirrorRaidContextToLocal(data) {
    if (!data || typeof data !== 'object') return Promise.resolve();
    return storageLocalSet({
      opendkpClientSlug: data.opendkpClientSlug != null ? data.opendkpClientSlug : '',
      opendkpCurrentRaidId: data.opendkpCurrentRaidId,
      opendkpCurrentRaidSummaryJson:
        data.opendkpCurrentRaidSummaryJson != null ? data.opendkpCurrentRaidSummaryJson : ''
    });
  }

  function readRaidContextFromStorage() {
    return storageSyncGet(RAID_CONTEXT_MIRROR_KEYS).then(function (syncData) {
      var rid = syncData.opendkpCurrentRaidId;
      if (rid != null && rid !== '' && !Number.isNaN(Number(rid))) {
        mirrorRaidContextToLocal(syncData);
        return syncData;
      }
      return storageLocalGet(RAID_CONTEXT_MIRROR_KEYS).then(function (localData) {
        var localRid = localData.opendkpCurrentRaidId;
        if (localRid == null || localRid === '' || Number.isNaN(Number(localRid))) {
          return syncData;
        }
        var merged = Object.assign({}, syncData, {
          opendkpCurrentRaidId: localRid,
          opendkpCurrentRaidSummaryJson:
            localData.opendkpCurrentRaidSummaryJson || syncData.opendkpCurrentRaidSummaryJson || ''
        });
        storageSyncSet({
          opendkpCurrentRaidId: merged.opendkpCurrentRaidId,
          opendkpCurrentRaidSummaryJson: merged.opendkpCurrentRaidSummaryJson
        }).catch(function () {});
        return merged;
      });
    });
  }

  function formatRaidLabel(ctx) {
    if (ctx.raidId == null) {
      return 'No current raid — set one in Settings → OpenDKP API';
    }
    if (ctx.raidValid === false) {
      return ctx.raidError || 'Current raid is invalid — set one in Settings → OpenDKP API';
    }
    var label = 'Raid #' + ctx.raidId;
    if (ctx.raidName) label += ' (' + ctx.raidName + ')';
    if (ctx.raidVerifyWarning) label += ' — verify pending';
    return label;
  }

  function clearStoredCurrentRaid() {
    invalidateValidatedContextCache();
    return storageSyncSet({
      opendkpCurrentRaidId: null,
      opendkpCurrentRaidSummaryJson: ''
    }).then(function () {
      return storageLocalSet({
        opendkpCurrentRaidId: null,
        opendkpCurrentRaidSummaryJson: ''
      });
    });
  }

  function isRaidNotFoundError(err) {
    return !!(err && err.status === 404);
  }

  function isAuthError(err) {
    var status = err && err.status;
    return status === 401 || status === 403;
  }

  function isTransientServerError(err) {
    var status = err && err.status;
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  function trustStoredRaidOnVerifyFailure(ctx, err) {
    if (validatedCtxCache && validatedCtxCache.raidId === ctx.raidId && validatedCtxCache.raidValid) {
      return Object.assign({}, validatedCtxCache, {
        raidError: null,
        raidVerifyWarning:
          'OpenDKP verify is temporarily unavailable — using your last good raid selection.'
      });
    }
    return Object.assign({}, ctx, {
      raidValid: true,
      raidError: null,
      raidVerifyWarning:
        isTransientServerError(err)
          ? 'OpenDKP verify is temporarily unavailable — using your selected raid.'
          : null
    });
  }

  /**
   * Confirm the stored current raid still exists via OpenDKP API.
   * Clears stale storage when the raid was deleted.
   */
  function verifyCurrentRaid(ctx) {
    if (ctx.raidId == null) {
      return Promise.resolve(
        Object.assign({}, ctx, { raidValid: false, raidError: null })
      );
    }
    if (!ctx.cfg.clientSlug || !ctx.hasToken) {
      return Promise.resolve(Object.assign({}, ctx, { raidValid: false, raidError: null }));
    }
    if (!global.OpenDkpApi || !global.OpenDkpApi.getRaid) {
      return Promise.resolve(
        Object.assign({}, ctx, {
          raidValid: false,
          raidError: 'OpenDKP API module not loaded'
        })
      );
    }

    function fetchRaidOnce() {
      return global.OpenDkpApi.getRaid(ctx.cfg, ctx.raidId);
    }

    function handleVerifySuccess(body) {
      var name =
        body && (body.Name != null ? body.Name : body.name != null ? body.name : null);
      return Object.assign({}, ctx, {
        raidValid: true,
        raidName: name != null ? String(name) : ctx.raidName,
        raidError: null,
        raidVerifyWarning: null
      });
    }

    function handleVerifyFailure(err) {
      if (isRaidNotFoundError(err)) {
        return clearStoredCurrentRaid().then(function () {
          return Object.assign({}, ctx, {
            raidId: null,
            raidName: '',
            raidValid: false,
            raidError:
              'Previously selected raid no longer exists — choose a current raid in Settings.'
          });
        });
      }
      if (isAuthError(err) && global.OpenDkpApi.cognitoRefresh) {
        return storageLocalGet([global.OpenDkpApi.STORAGE_KEYS.refreshToken]).then(function (local) {
          var rt = local[global.OpenDkpApi.STORAGE_KEYS.refreshToken];
          if (!rt) {
            return Object.assign({}, ctx, {
              raidValid: false,
              raidError: 'API session expired — click 🔄 in the popup or refresh sign-in in Settings.'
            });
          }
          return global.OpenDkpApi.cognitoRefresh({
            clientId: ctx.cfg.cognitoClientId,
            refreshToken: rt
          })
            .then(function () {
              return fetchRaidOnce();
            })
            .then(handleVerifySuccess)
            .catch(function (retryErr) {
              if (isAuthError(retryErr)) {
                return Object.assign({}, ctx, {
                  raidValid: false,
                  raidError:
                    'API session expired — click 🔄 in the popup or refresh sign-in in Settings.'
                });
              }
              if (isTransientServerError(retryErr)) {
                return trustStoredRaidOnVerifyFailure(ctx, retryErr);
              }
              return Object.assign({}, ctx, {
                raidValid: false,
                raidError: 'Could not verify current raid: ' + (retryErr.message || String(retryErr))
              });
            });
        });
      }
      if (isTransientServerError(err)) {
        return Promise.resolve(trustStoredRaidOnVerifyFailure(ctx, err));
      }
      return Promise.resolve(
        Object.assign({}, ctx, {
          raidValid: false,
          raidError: 'Could not verify current raid: ' + (err.message || String(err))
        })
      );
    }

    return fetchRaidOnce().then(handleVerifySuccess).catch(handleVerifyFailure);
  }

  /**
   * Read loot queue context and verify the current raid still exists.
   * @param {boolean} [forceRefresh]
   */
  function readValidatedLootQueueContext(forceRefresh) {
    var now = Date.now();
    if (
      !forceRefresh &&
      validatedCtxCache &&
      now - validatedCtxCacheAt < VALIDATED_CTX_TTL_MS
    ) {
      return Promise.resolve(validatedCtxCache);
    }
    return readLootQueueContext().then(function (ctx) {
      return verifyCurrentRaid(ctx).then(function (validated) {
        validatedCtxCache = validated;
        validatedCtxCacheAt = now;
        return validated;
      });
    });
  }

  /**
   * Resolve item name → ItemId via autocomplete.
   * @param {object} cfg
   * @param {string} rawItemName
   */
  function resolveItemMatch(cfg, itemName) {
    if (!global.OpenDkpApi || !global.OpenDkpApi.searchItemAutocomplete) {
      return Promise.reject(new Error('OpenDKP API module not loaded'));
    }
    var normalized = String(itemName || '').trim();
    if (!normalized) return Promise.reject(new Error('Item name is empty'));
    return global.OpenDkpApi.searchItemAutocomplete(cfg, normalized, 8).then(function (body) {
      var results = coerceItemSearchResults(body);
      var match = pickBestItemMatch(results, normalized);
      if (!match) {
        return Promise.reject(new Error('Item not found in OpenDKP: ' + normalized));
      }
      var itemId = readItemId(match);
      if (itemId == null) {
        return Promise.reject(new Error('Could not resolve ItemId for: ' + normalized));
      }
      return {
        itemId: itemId,
        itemName: readItemName(match, normalized),
        gameItemId: match.GameItemId != null ? match.GameItemId : itemId
      };
    });
  }

  function buildAuctionPayload(resolved, parsed, ctx, defaults) {
    return {
      BidType: FALLBACK_AUCTION.BidType,
      MinimumBid: FALLBACK_AUCTION.MinimumBid,
      MaximumBid: FALLBACK_AUCTION.MaximumBid,
      Duration: defaults.duration,
      ItemQuantity: parsed.quantity,
      AutoAdjustBids: defaults.autoAdjustBids,
      AllowDeletes: FALLBACK_AUCTION.AllowDeletes,
      ItemId: resolved.itemId,
      RaidId: ctx.raidId,
      Item: {
        ItemId: resolved.itemId,
        Name: resolved.itemName,
        GameItemId: resolved.gameItemId,
        IdGame: 0
      }
    };
  }

  function validateLootQueueContext(ctx) {
    if (!ctx.cfg.clientSlug) {
      return 'Guild subdomain not configured. Open Settings → OpenDKP API.';
    }
    if (!ctx.hasToken) {
      return 'Not signed in to OpenDKP API. Sign in under Settings.';
    }
    if (ctx.raidId == null) {
      return 'No current raid selected. Create or set a current raid in Settings.';
    }
    if (ctx.raidValid === false) {
      return (
        ctx.raidError ||
        'Current raid is not valid. Select a current raid in Settings → OpenDKP API.'
      );
    }
    return null;
  }

  function resolveItemsForQueue(cfg, rawItemNames) {
    var names = (rawItemNames || []).filter(function (n) {
      return String(n || '').trim();
    });
    if (!names.length) {
      return Promise.reject(new Error('No items to queue'));
    }
    return names.reduce(
      function (chain, rawName) {
        return chain.then(function (acc) {
          var parsed = parseItemToken(rawName);
          if (!parsed.name) return acc;
          return resolveItemMatch(cfg, parsed.name)
            .then(function (resolved) {
              acc.resolved.push({ rawName: rawName, parsed: parsed, resolved: resolved });
              return acc;
            })
            .catch(function (err) {
              acc.failed.push({
                rawName: rawName,
                error: err && err.message ? err.message : String(err)
              });
              return acc;
            });
        });
      },
      Promise.resolve({ resolved: [], failed: [] })
    ).then(function (acc) {
      if (!acc.resolved.length) {
        var detail = acc.failed
          .map(function (f) {
            return f.rawName + ': ' + f.error;
          })
          .join('; ');
        return Promise.reject(new Error('No items could be queued.' + (detail ? ' ' + detail : '')));
      }
      return acc;
    });
  }

  /**
   * Queue one parsed loot item to the current raid bidding queue.
   * @param {string} rawItemName
   */
  function queueItemToCurrentRaid(rawItemName) {
    return queueItemsToCurrentRaid([rawItemName]).then(function (summary) {
      var first = summary.queued[0];
      return {
        itemName: first.itemName,
        quantity: first.quantity,
        raidId: summary.raidId,
        raidName: summary.raidName,
        duration: summary.duration,
        payStrategy: summary.payStrategy
      };
    });
  }

  /**
   * Queue multiple parsed loot items (single batch API call when possible).
   * @param {string[]} rawItemNames
   */
  function queueItemsToCurrentRaid(rawItemNames) {
    return assertRaidLeaderFeature('Loot queue').then(function () {
      return Promise.all([
        readValidatedLootQueueContext(true),
        readAuctionDefaults()
      ]).then(function (parts) {
        var ctx = parts[0];
        var defaults = parts[1];
        var ctxError = validateLootQueueContext(ctx);
        if (ctxError) return Promise.reject(new Error(ctxError));
        return resolveItemsForQueue(ctx.cfg, rawItemNames).then(function (result) {
          var auctions = result.resolved.map(function (row) {
            return buildAuctionPayload(row.resolved, row.parsed, ctx, defaults);
          });
          return global.OpenDkpApi.createAuctions(ctx.cfg, auctions).then(function () {
            return {
              queued: result.resolved.map(function (row) {
                return {
                  itemName: row.resolved.itemName,
                  quantity: row.parsed.quantity,
                  label: formatQueuedItemLabel(row.resolved.itemName, row.parsed.quantity)
                };
              }),
              failed: result.failed.slice(),
              raidId: ctx.raidId,
              raidName: ctx.raidName,
              duration: defaults.duration,
              payStrategy: defaults.payStrategy
            };
          });
        });
      });
    });
  }

  global.LootQueue = {
    invalidateValidatedContextCache: invalidateValidatedContextCache,
    mirrorRaidContextToLocal: mirrorRaidContextToLocal,
    readSoundProfile: readSoundProfile,
    readLootQueueContext: readLootQueueContext,
    readValidatedLootQueueContext: readValidatedLootQueueContext,
    readAuctionDefaults: readAuctionDefaults,
    formatRaidLabel: formatRaidLabel,
    normalizeItemName: normalizeItemName,
    parseItemToken: parseItemToken,
    formatQueuedItemLabel: formatQueuedItemLabel,
    queueItemToCurrentRaid: queueItemToCurrentRaid,
    queueItemsToCurrentRaid: queueItemsToCurrentRaid
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
