/**
 * Auto-bid engine — polls active auctions and places bids via OpenDkpApi.
 * Runs in the extension background context (not on opendkp.com pages).
 */
(function (global) {
  'use strict';

  var AUTO_BID_CHARACTERS_CACHE_KEY = 'autoBidCharactersCache';
  var LOCAL_SETTINGS_MIRROR_KEY = 'opendkpSettingsLocalMirror';
  var DEFAULT_INCREMENT = 10;
  var DEFAULT_PRIORITY = 1;
  var DEFAULT_POLL_SEC = 15;

  function getApi() {
    return typeof browser !== 'undefined' ? browser : chrome;
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

  function storageSyncSet(obj) {
    return new Promise(function (resolve, reject) {
      var api = getApi();
      if (!api.storage || !api.storage.sync) return resolve();
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

  function coerceArray(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.Models)) return body.Models;
    if (body && Array.isArray(body.models)) return body.models;
    if (body && Array.isArray(body.Auctions)) return body.Auctions;
    if (body && Array.isArray(body.Characters)) return body.Characters;
    if (body && Array.isArray(body.characters)) return body.characters;
    return [];
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * @param {string} itemName
   * @param {string} pattern
   */
  function itemNameMatches(itemName, pattern) {
    var name = normalizeText(itemName);
    var pat = normalizeText(pattern);
    if (!name || !pat) return false;
    return name.indexOf(pat) !== -1 || pat.indexOf(name) !== -1;
  }

  function readAuctionId(auction) {
    if (!auction || typeof auction !== 'object') return null;
    var id = auction.AuctionId != null ? auction.AuctionId : auction.Id != null ? auction.Id : auction.id;
    if (id == null || id === '') return null;
    var n = parseInt(String(id), 10);
    return Number.isNaN(n) || n < 1 ? null : n;
  }

  function readItemName(auction) {
    if (!auction || typeof auction !== 'object') return '';
    if (auction.Item && auction.Item.Name) return String(auction.Item.Name);
    if (auction.ItemName) return String(auction.ItemName);
    if (auction.Name) return String(auction.Name);
    return '';
  }

  function readMinimumBid(auction, increment) {
    var min = parseInt(String(auction && auction.MinimumBid != null ? auction.MinimumBid : ''), 10);
    if (!Number.isNaN(min) && min > 0) return min;
    return increment > 0 ? increment : DEFAULT_INCREMENT;
  }

  function readAuctionMaximum(auction) {
    var max = parseInt(String(auction && auction.MaximumBid != null ? auction.MaximumBid : ''), 10);
    return Number.isNaN(max) || max < 1 ? null : max;
  }

  function coerceBids(auction) {
    if (!auction || typeof auction !== 'object') return [];
    var raw = auction.Bids || auction.bids || auction.BidList || [];
    return Array.isArray(raw) ? raw : [];
  }

  function readAuctionQuantity(auction) {
    if (!auction || typeof auction !== 'object') return 1;
    var raw =
      auction.ItemQuantity != null
        ? auction.ItemQuantity
        : auction.itemQuantity != null
          ? auction.itemQuantity
          : auction.Quantity != null
            ? auction.Quantity
            : auction.quantity != null
              ? auction.quantity
              : auction.Item && auction.Item.Quantity != null
                ? auction.Item.Quantity
                : auction.Item && auction.Item.ItemQuantity != null
                  ? auction.Item.ItemQuantity
                  : null;
    var q = parseInt(String(raw != null ? raw : ''), 10);
    if (!Number.isNaN(q) && q > 0) return q;
    var name = readItemName(auction);
    var match = String(name || '').match(/\bx\s*(\d+)\s*$/i);
    if (match) {
      var fromName = parseInt(match[1], 10);
      if (!Number.isNaN(fromName) && fromName > 0) return fromName;
    }
    return 1;
  }

  function readBidValue(bid) {
    return parseInt(String(bid && bid.Value != null ? bid.Value : bid && bid.value != null ? bid.value : ''), 10);
  }

  function readBidCharacterId(bid) {
    if (!bid || typeof bid !== 'object') return null;
    return bid.CharacterId != null ? bid.CharacterId : bid.characterId;
  }

  function readBidTimestamp(bid) {
    if (!bid || typeof bid !== 'object') return 0;
    var raw =
      bid.Date != null
        ? bid.Date
        : bid.date != null
          ? bid.date
          : bid.Timestamp != null
            ? bid.Timestamp
            : bid.timestamp != null
              ? bid.timestamp
              : bid.BidTimestamp != null
                ? bid.BidTimestamp
                : bid.CreatedDate != null
                  ? bid.CreatedDate
                  : bid.createdDate != null
                    ? bid.createdDate
                    : bid.CreatedTimestamp != null
                      ? bid.CreatedTimestamp
                      : bid.Time != null
                        ? bid.Time
                        : bid.time != null
                          ? bid.time
                          : null;
    if (raw == null || raw === '') return 0;
    var str = String(raw).trim();

    // OpenDKP bid table time: H:MM:SS:ff (e.g. 1:21:42:00) — earlier wins ties at same bid
    var odMatch = str.match(/^(\d+):(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (odMatch) {
      var hours = parseInt(odMatch[1], 10);
      var mins = parseInt(odMatch[2], 10);
      var secs = parseInt(odMatch[3], 10);
      var frac = odMatch[4] != null ? parseInt(odMatch[4], 10) : 0;
      return hours * 3600000 + mins * 60000 + secs * 1000 + frac * 10;
    }

    var parsed = Date.parse(str);
    if (!Number.isNaN(parsed)) return parsed;

    if (/^\d+$/.test(str)) {
      var n = parseInt(str, 10);
      return Number.isNaN(n) ? 0 : n;
    }

    return 0;
  }

  function bidsMissingTimestamps(bids) {
    var list = bids || [];
    if (list.length < 2) return false;
    var withTs = 0;
    list.forEach(function (bid) {
      if (readBidTimestamp(bid) > 0) withTs++;
    });
    return withTs === 0;
  }

  /**
   * Highest bid per character, sorted high-to-low (earlier bid wins ties).
   * @param {object[]} bids
   */
  function summarizeBidderMaxBids(bids) {
    var byCharacter = {};
    (bids || []).forEach(function (bid, index) {
      if (!bid || typeof bid !== 'object') return;
      var value = readBidValue(bid);
      if (Number.isNaN(value) || value < 0) return;
      var characterId = readBidCharacterId(bid);
      if (characterId == null || characterId === '') return;
      var key = String(characterId);
      var ts = readBidTimestamp(bid);
      var existing = byCharacter[key];
      if (!existing || value > existing.maxBid) {
        byCharacter[key] = {
          characterId: characterId,
          maxBid: value,
          tieTs: ts,
          listOrder: index
        };
      } else if (value === existing.maxBid) {
        if (ts > 0 && (existing.tieTs === 0 || ts < existing.tieTs)) {
          existing.tieTs = ts;
          existing.listOrder = index;
        } else if (existing.tieTs === 0 && ts === 0 && index < existing.listOrder) {
          existing.listOrder = index;
        }
      }
    });
    return Object.keys(byCharacter).map(function (key) {
      return byCharacter[key];
    });
  }

  function hasAmbiguousTieAtBid(bidders, bidAmount) {
    if (!bidAmount || bidAmount < 1) return false;
    var tied = bidders.filter(function (b) {
      return b.maxBid === bidAmount;
    });
    if (tied.length < 2) return false;
    var withTs = tied.filter(function (b) {
      return b.tieTs > 0;
    });
    return withTs.length < tied.length;
  }

  /**
   * @param {object[]} bids
   * @param {number|string} characterId
   * @param {number} [quantity] — items available (top N bidders win)
   */
  function analyzeBids(bids, characterId, quantity) {
    var qty = parseInt(String(quantity != null ? quantity : 1), 10);
    if (Number.isNaN(qty) || qty < 1) qty = 1;
    var myId = parseInt(String(characterId), 10);
    var bidders = summarizeBidderMaxBids(bids);
    bidders.sort(function (a, b) {
      if (b.maxBid !== a.maxBid) return b.maxBid - a.maxBid;
      var aTs = a.tieTs || 0;
      var bTs = b.tieTs || 0;
      if (aTs > 0 && bTs > 0 && aTs !== bTs) return aTs - bTs;
      var aOrd = a.listOrder != null ? a.listOrder : 999999;
      var bOrd = b.listOrder != null ? b.listOrder : 999999;
      if (aOrd !== bOrd) return aOrd - bOrd;
      return parseInt(String(a.characterId), 10) - parseInt(String(b.characterId), 10);
    });

    var myRank = -1;
    var myHigh = 0;
    for (var i = 0; i < bidders.length; i++) {
      if (parseInt(String(bidders[i].characterId), 10) === myId) {
        myRank = i;
        myHigh = bidders[i].maxBid;
        break;
      }
    }

    var thresholdBid = 0;
    if (bidders.length >= qty) {
      thresholdBid = bidders[qty - 1].maxBid;
    } else if (bidders.length > 0) {
      thresholdBid = bidders[bidders.length - 1].maxBid;
    }

    var amWinning = myRank >= 0 && myRank < qty;

    // If tie timestamps are missing, do not assume we win a contested slot at our bid level
    if (amWinning && qty > 1 && myHigh > 0 && hasAmbiguousTieAtBid(bidders, myHigh)) {
      amWinning = false;
    }

    return {
      highBid: bidders.length ? bidders[0].maxBid : 0,
      thresholdBid: thresholdBid,
      myHighBid: myHigh,
      myRank: myRank,
      quantity: qty,
      amWinning: amWinning,
      leaderCharacterId: bidders.length ? bidders[0].characterId : null
    };
  }

  /**
   * @param {{ highBid: number, thresholdBid?: number, myHighBid?: number, myRank?: number, quantity?: number, amWinning: boolean, minBid: number, increment: number, maxRule: number, availableDkp: number, auctionMax: number|null }}
   */
  function computeNextBidAmount(opts) {
    opts = opts || {};
    var increment = opts.increment > 0 ? opts.increment : DEFAULT_INCREMENT;
    var cap = opts.maxRule > 0 ? opts.maxRule : 0;
    if (opts.availableDkp > 0) {
      cap = cap > 0 ? Math.min(cap, opts.availableDkp) : opts.availableDkp;
    }
    if (opts.auctionMax != null && opts.auctionMax > 0) {
      cap = cap > 0 ? Math.min(cap, opts.auctionMax) : opts.auctionMax;
    }
    if (!cap || cap < 1) return null;

    var qty = opts.quantity > 1 ? opts.quantity : 1;
    var myRank = opts.myRank != null ? opts.myRank : -1;
    var myHigh = opts.myHighBid > 0 ? opts.myHighBid : 0;

    // Defensive: never skip bidding when ranked outside top N (e.g. lost same-bid tie on time)
    var actuallyWinning = opts.amWinning && !(myRank >= 0 && myRank >= qty);
    if (actuallyWinning) return null;

    var beatBid =
      opts.thresholdBid != null && opts.thresholdBid > 0
        ? opts.thresholdBid
        : opts.highBid > 0
          ? opts.highBid
          : 0;

    var target;
    if (!beatBid || beatBid < 1) {
      target = opts.minBid > 0 ? opts.minBid : increment;
    } else {
      target = beatBid + increment;
    }

    if (myHigh >= target) return null;
    if (target > cap) return null;
    return target;
  }

  /**
   * @param {object} body — GET account characters response
   */
  function parseAccountCharacters(body) {
    var list = coerceArray(body);
    return list
      .map(function (c) {
        if (!c || typeof c !== 'object') return null;
        var id =
          c.Id != null
            ? c.Id
            : c.id != null
              ? c.id
              : c.CharacterId != null
                ? c.CharacterId
                : c.IdCharacter;
        var name = c.Name != null ? c.Name : c.name;
        var rank = c.Rank != null ? c.Rank : c.rank;
        if (id == null || !String(name || '').trim()) return null;
        return {
          id: parseInt(String(id), 10),
          name: String(name).trim(),
          rank: String(rank || '').trim(),
          class: c.Class != null ? String(c.Class) : '',
          level: c.Level != null ? c.Level : null,
          active: c.Active !== 0 && c.Active !== false
        };
      })
      .filter(Boolean)
      .filter(function (c) {
        return c.id > 0 && c.name;
      });
  }

  function normalizeRules(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map(function (r, i) {
        if (!r || typeof r !== 'object') return null;
        var maxDkp = parseInt(String(r.maxDkp != null ? r.maxDkp : ''), 10);
        var characterId = parseInt(String(r.characterId != null ? r.characterId : ''), 10);
        var itemPattern = String(r.itemPattern != null ? r.itemPattern : r.item || '').trim();
        if (!itemPattern || Number.isNaN(maxDkp) || maxDkp < 1 || Number.isNaN(characterId) || characterId < 1) {
          return null;
        }
        return {
          id: r.id || 'rule-' + i,
          enabled: r.enabled !== false,
          itemPattern: itemPattern,
          maxDkp: maxDkp,
          characterId: characterId,
          characterName: String(r.characterName || '').trim(),
          rank: String(r.rank || '').trim(),
          priority: parseInt(String(r.priority != null ? r.priority : DEFAULT_PRIORITY), 10) || DEFAULT_PRIORITY
        };
      })
      .filter(Boolean);
  }

  function normalizeCharacterName(name) {
    return String(name || '')
      .trim()
      .replace(/\s*\([^)]*\)\s*$/, '')
      .toLowerCase();
  }

  /**
   * Disable enabled auto-bid rules when our character won an auction (not roll-offs).
   * @param {{ itemName: string, winnerNames: string[] }} opts
   * @returns {Promise<{ disabled: string[] }>}
   */
  function disableRulesForAuctionWin(opts) {
    opts = opts || {};
    var itemName = String(opts.itemName || '').trim();
    var winnerNames = Array.isArray(opts.winnerNames) ? opts.winnerNames : [];
    if (!itemName || !winnerNames.length) {
      return Promise.resolve({ disabled: [] });
    }

    var winnerSet = {};
    winnerNames.forEach(function (name) {
      var key = normalizeCharacterName(name);
      if (key) winnerSet[key] = true;
    });
    if (!Object.keys(winnerSet).length) {
      return Promise.resolve({ disabled: [] });
    }

    return storageSyncGet(['autoBidRules']).then(function (sync) {
      var rules = normalizeRules(sync.autoBidRules);
      if (!rules.length) return { disabled: [], rules: null, changed: false };

      var disabled = [];
      var changed = false;
      var updated = rules.map(function (rule) {
        if (!rule.enabled) return rule;
        if (!itemNameMatches(itemName, rule.itemPattern)) return rule;
        var ruleName = normalizeCharacterName(rule.characterName);
        if (!ruleName || !winnerSet[ruleName]) return rule;
        changed = true;
        disabled.push((rule.characterName || 'Character') + ' — ' + rule.itemPattern);
        return Object.assign({}, rule, { enabled: false });
      });

      if (!changed) return { disabled: [], rules: null, changed: false };

      return storageSyncSet({ autoBidRules: updated }).then(function () {
        return storageLocalGet([LOCAL_SETTINGS_MIRROR_KEY]).then(function (local) {
          var mirror = local && local[LOCAL_SETTINGS_MIRROR_KEY] ? local[LOCAL_SETTINGS_MIRROR_KEY] : {};
          mirror.autoBidRules = updated;
          var payload = {};
          payload[LOCAL_SETTINGS_MIRROR_KEY] = mirror;
          return storageLocalSet(payload);
        }).then(function () {
          return { disabled: disabled, rules: updated, changed: true };
        });
      });
    });
  }

  function buildApiConfig(slug, cognitoClientId) {
    return {
      apiHost: 'api.opendkp.com',
      clientSlug: String(slug || '')
        .trim()
        .toLowerCase(),
      cognitoClientId: cognitoClientId
    };
  }

  /**
   * @param {object} cfg
   * @param {number|string} characterId
   */
  function fetchCharacterAvailableDkp(cfg, characterId) {
    if (!global.OpenDkpApi || !global.OpenDkpApi.getCharacterDkp) {
      return Promise.resolve(null);
    }
    return global.OpenDkpApi.getCharacterDkp(cfg, characterId)
      .then(function (body) {
        if (!body || typeof body !== 'object') return null;
        var dkp =
          body.CurrentDkp != null
            ? body.CurrentDkp
            : body.currentDkp != null
              ? body.currentDkp
              : body.Dkp != null
                ? body.Dkp
                : body.Value;
        var n = parseInt(String(dkp != null ? dkp : ''), 10);
        return Number.isNaN(n) ? null : n;
      })
      .catch(function () {
        return null;
      });
  }

  /**
   * In-memory throttle: avoid placing the same bid repeatedly within a short window.
   */
  var lastBidByAuction = {};

  function shouldSkipDuplicateBid(auctionId, amount) {
    var key = String(auctionId);
    var prev = lastBidByAuction[key];
    var now = Date.now();
    if (prev && prev.amount === amount && now - prev.at < 8000) return true;
    return false;
  }

  function rememberBid(auctionId, amount) {
    lastBidByAuction[String(auctionId)] = { amount: amount, at: Date.now() };
  }

  function loadRankBidLimits(slug) {
    if (!global.OpenDkpRankBidLimits || !global.OpenDkpRankBidLimits.loadForSlug) {
      return Promise.resolve({});
    }
    return global.OpenDkpRankBidLimits.loadForSlug(slug);
  }

  function effectiveMaxDkpForRule(rule, limits) {
    if (!global.OpenDkpRankBidLimits || !global.OpenDkpRankBidLimits.clampMaxDkpForRank) {
      return rule.maxDkp;
    }
    return global.OpenDkpRankBidLimits.clampMaxDkpForRank(rule.maxDkp, rule.rank, limits).value;
  }

  /**
   * @param {object} auction
   * @param {object} rule
   * @param {{ increment: number, cfg: object }} ctx
   */
  function processAuctionForRule(auction, rule, ctx) {
    if (!global.OpenDkpApi || !global.OpenDkpApi.placeBid || !global.OpenDkpApi.buildBidBody) {
      return Promise.resolve({ action: 'skip', reason: 'api_unavailable' });
    }

    var auctionId = readAuctionId(auction);
    var itemName = readItemName(auction);
    if (!auctionId || !itemName) {
      return Promise.resolve({ action: 'skip', reason: 'invalid_auction' });
    }
    if (!itemNameMatches(itemName, rule.itemPattern)) {
      return Promise.resolve({ action: 'skip', reason: 'no_match' });
    }

    function runWithAuction(fullAuction) {
      var increment = ctx.increment > 0 ? ctx.increment : DEFAULT_INCREMENT;
      var bids = coerceBids(fullAuction);
      var quantity = readAuctionQuantity(fullAuction);
      var analysis = analyzeBids(bids, rule.characterId, quantity);
      var minBid = readMinimumBid(fullAuction, increment);
      var auctionMax = readAuctionMaximum(fullAuction);

      return loadRankBidLimits(ctx.cfg.clientSlug).then(function (rankLimits) {
        var effectiveMax = effectiveMaxDkpForRule(rule, rankLimits);
        return fetchCharacterAvailableDkp(ctx.cfg, rule.characterId).then(function (availableDkp) {
          var next = computeNextBidAmount({
            highBid: analysis.highBid,
            thresholdBid: analysis.thresholdBid,
            myHighBid: analysis.myHighBid,
            myRank: analysis.myRank,
            quantity: analysis.quantity,
            amWinning: analysis.amWinning,
            minBid: minBid,
            increment: increment,
            maxRule: effectiveMax,
            availableDkp: availableDkp != null ? availableDkp : effectiveMax,
            auctionMax: auctionMax
          });

        if (next == null) {
          return {
            action: 'skip',
            reason: analysis.amWinning ? 'winning' : 'cap_reached',
            auctionId: auctionId,
            itemName: itemName
          };
        }

        if (!rule.rank) {
          return {
            action: 'skip',
            reason: 'missing_rank',
            auctionId: auctionId,
            itemName: itemName
          };
        }

        if (shouldSkipDuplicateBid(auctionId, next)) {
          return {
            action: 'skip',
            reason: 'duplicate_throttle',
            auctionId: auctionId,
            itemName: itemName
          };
        }

        var body = global.OpenDkpApi.buildBidBody(auctionId, {
          characterId: rule.characterId,
          priority: rule.priority,
          rank: rule.rank,
          value: next
        });

        return global.OpenDkpApi.placeBid(ctx.cfg, auctionId, body)
          .then(function () {
            rememberBid(auctionId, next);
            return {
              action: 'bid',
              auctionId: auctionId,
              itemName: itemName,
              amount: next,
              characterName: rule.characterName
            };
          })
          .catch(function (err) {
            return {
              action: 'error',
              auctionId: auctionId,
              itemName: itemName,
              message: err && err.message ? err.message : String(err)
            };
          });
        });
      });
    }

    if (!global.OpenDkpApi.getAuction) {
      return runWithAuction(auction);
    }

    // Always load full auction — active list often omits bid Date/timestamps needed for tie-breaks
    return global.OpenDkpApi.getAuction(ctx.cfg, auctionId)
      .then(function (full) {
        return runWithAuction(full && typeof full === 'object' ? full : auction);
      })
      .catch(function () {
        return runWithAuction(auction);
      });
  }

  /**
   * @param {{ cognitoClientId: string }} opts
   */
  function loadAutoBidSettings(opts) {
    opts = opts || {};
    return storageSyncGet([
      'autoBidEnabled',
      'autoBidIncrement',
      'autoBidPollIntervalSec',
      'autoBidPriority',
      'autoBidRules',
      'opendkpClientSlug'
    ]).then(function (sync) {
      return storageLocalGet([global.OpenDkpApi && global.OpenDkpApi.STORAGE_KEYS
        ? global.OpenDkpApi.STORAGE_KEYS.idToken
        : 'opendkpIdToken']).then(function (local) {
        var tokenKey =
          global.OpenDkpApi && global.OpenDkpApi.STORAGE_KEYS
            ? global.OpenDkpApi.STORAGE_KEYS.idToken
            : 'opendkpIdToken';
        var increment = parseInt(String(sync.autoBidIncrement != null ? sync.autoBidIncrement : DEFAULT_INCREMENT), 10);
        var pollSec = parseInt(
          String(sync.autoBidPollIntervalSec != null ? sync.autoBidPollIntervalSec : DEFAULT_POLL_SEC),
          10
        );
        var priority = parseInt(String(sync.autoBidPriority != null ? sync.autoBidPriority : DEFAULT_PRIORITY), 10);
        var slugOverride = opts.clientSlug != null ? String(opts.clientSlug).trim().toLowerCase() : '';
        return {
          enabled: sync.autoBidEnabled === true,
          increment: Number.isNaN(increment) || increment < 1 ? DEFAULT_INCREMENT : increment,
          pollIntervalSec: Number.isNaN(pollSec) || pollSec < 5 ? DEFAULT_POLL_SEC : pollSec,
          priority: Number.isNaN(priority) || priority < 1 ? DEFAULT_PRIORITY : priority,
          rules: normalizeRules(sync.autoBidRules),
          clientSlug: slugOverride || String(sync.opendkpClientSlug || '').trim().toLowerCase(),
          cognitoClientId: opts.cognitoClientId || '',
          hasToken: !!local[tokenKey]
        };
      });
    });
  }

  /**
   * @param {{ cognitoClientId: string }} opts
   */
  function refreshAccountCharacters(opts) {
    opts = opts || {};
    if (!global.OpenDkpApi || !global.OpenDkpApi.getAccountCharacters) {
      return Promise.reject(new Error('OpenDKP API module not loaded'));
    }
    return loadAutoBidSettings(opts).then(function (settings) {
      if (!settings.clientSlug) {
        return Promise.reject(new Error('Guild subdomain is required'));
      }
      if (!settings.hasToken) {
        return Promise.reject(new Error('Sign in to the OpenDKP API first'));
      }
      var cfg = buildApiConfig(settings.clientSlug, settings.cognitoClientId);
      return global.OpenDkpApi.getAccountCharacters(cfg, opts.username).then(function (body) {
        var characters = parseAccountCharacters(body);
        return storageLocalSet({
          [AUTO_BID_CHARACTERS_CACHE_KEY]: {
            fetchedAt: Date.now(),
            clientSlug: settings.clientSlug,
            characters: characters
          }
        }).then(function () {
          return characters;
        });
      });
    });
  }

  /**
   * @param {{ cognitoClientId: string }} opts
   */
  function runAutoBidTick(opts) {
    opts = opts || {};
    if (!global.OpenDkpApi || !global.OpenDkpApi.getActiveAuctions) {
      return Promise.resolve({ ok: false, reason: 'api_unavailable', results: [] });
    }

    return loadAutoBidSettings(opts).then(function (settings) {
      if (!settings.enabled) {
        return { ok: true, skipped: true, reason: 'disabled', results: [] };
      }
      if (!settings.hasToken) {
        return { ok: true, skipped: true, reason: 'not_signed_in', results: [] };
      }
      if (!settings.clientSlug) {
        return { ok: true, skipped: true, reason: 'no_guild', results: [] };
      }
      var activeRules = settings.rules.filter(function (r) {
        return r.enabled;
      });
      if (!activeRules.length) {
        return { ok: true, skipped: true, reason: 'no_rules', results: [] };
      }

      var cfg = buildApiConfig(settings.clientSlug, settings.cognitoClientId);
      return global.OpenDkpApi.getActiveAuctions(cfg)
        .then(function (body) {
          var auctions = coerceArray(body);
          if (!auctions.length) {
            return { ok: true, skipped: true, reason: 'no_active_auctions', results: [] };
          }

          var chain = Promise.resolve([]);
          activeRules.forEach(function (rule) {
            chain = chain.then(function (acc) {
              var inner = Promise.resolve(acc);
              auctions.forEach(function (auction) {
                inner = inner.then(function (results) {
                  return processAuctionForRule(auction, rule, {
                    increment: settings.increment,
                    cfg: cfg
                  }).then(function (one) {
                    if (one && one.action !== 'skip') results.push(one);
                    return results;
                  });
                });
              });
              return inner;
            });
          });

          return chain.then(function (results) {
            return { ok: true, skipped: false, results: results };
          });
        })
        .catch(function (err) {
          return {
            ok: false,
            reason: err && err.message ? err.message : String(err),
            results: []
          };
        });
    });
  }

  global.AutoBid = {
    AUTO_BID_CHARACTERS_CACHE_KEY: AUTO_BID_CHARACTERS_CACHE_KEY,
    DEFAULT_INCREMENT: DEFAULT_INCREMENT,
    DEFAULT_POLL_SEC: DEFAULT_POLL_SEC,
    coerceArray: coerceArray,
    itemNameMatches: itemNameMatches,
    parseAccountCharacters: parseAccountCharacters,
    normalizeRules: normalizeRules,
    loadAutoBidSettings: loadAutoBidSettings,
    refreshAccountCharacters: refreshAccountCharacters,
    runAutoBidTick: runAutoBidTick,
    disableRulesForAuctionWin: disableRulesForAuctionWin,
    normalizeCharacterName: normalizeCharacterName,
    readAuctionQuantity: readAuctionQuantity,
    summarizeBidderMaxBids: summarizeBidderMaxBids,
    analyzeBids: analyzeBids,
    computeNextBidAmount: computeNextBidAmount
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
