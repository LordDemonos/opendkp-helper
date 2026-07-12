/**
 * OpenDKP HTTP API client (options page / extension contexts with fetch + storage).
 *
 * Auth (frozen in docs/PHASE_0_INTEGRATION_MAP.md): API expects Cognito ID token in
 * Authorization: Bearer <idToken> per Postman collection info.description.
 * Cognito: POST https://cognito-idp.us-east-2.amazonaws.com/ InitiateAuth USER_PASSWORD_AUTH.
 * Refresh: REFRESH_TOKEN_AUTH when refresh token present (standard Cognito).
 */
(function (global) {
  'use strict';

  var COGNITO_URL = 'https://cognito-idp.us-east-2.amazonaws.com/';
  var COGNITO_TARGET_INIT = 'AWSCognitoIdentityProviderService.InitiateAuth';
  var DEFAULT_API_HOST = 'api.opendkp.com';
  var TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
  var OPEN_DKP_DEFAULT_RAID_LIST_COUNT = 1;
  var OPEN_DKP_MAX_RAID_LIST_COUNT = 5;
  var OPEN_DKP_RAID_LIST_COUNT_KEY = 'opendkpRaidListCount';

  var STORAGE_KEYS = {
    idToken: 'opendkpIdToken',
    accessToken: 'opendkpAccessToken',
    refreshToken: 'opendkpRefreshToken',
    expiresAt: 'opendkpTokenExpiresAtMs'
  };

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

  function storageLocalRemove(keys) {
    return new Promise(function (resolve) {
      var api = getApi();
      if (!api.storage || !api.storage.local) return resolve();
      api.storage.local.remove(keys, function () {
        resolve();
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

  function decodeBase64UrlSegment(segment) {
    var base64 = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    if (typeof atob !== 'undefined') return atob(base64);
    if (typeof Buffer !== 'undefined') return Buffer.from(base64, 'base64').toString('utf8');
    return '';
  }

  function parseJwtPayload(token) {
    try {
      var parts = String(token || '').split('.');
      if (parts.length < 2) return null;
      var json = decodeBase64UrlSegment(parts[1]);
      return json ? JSON.parse(json) : null;
    } catch (_) {
      return null;
    }
  }

  function getCognitoUsernameFromToken(token) {
    var payload = parseJwtPayload(token);
    if (!payload) return '';
    var username = payload['cognito:username'] || payload.username || '';
    return String(username || '').trim();
  }

  /**
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {string} [idToken] — override; else read from storage.local
   */
  function buildHeaders(cfg, idToken) {
    var headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    var token = idToken;
    if (!token) {
      return storageLocalGet([STORAGE_KEYS.idToken]).then(function (r) {
        if (r[STORAGE_KEYS.idToken]) headers.Authorization = 'Bearer ' + r[STORAGE_KEYS.idToken];
        return headers;
      });
    }
    headers.Authorization = 'Bearer ' + token;
    return Promise.resolve(headers);
  }

  /**
   * Admin mutations require CognitoInfo + guild ClientId headers (see open-dkp-client dkp.service.ts).
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {{ clientId?: string }} [opts]
   */
  function buildAdminHeaders(cfg, opts) {
    opts = opts || {};
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return storageLocalGet([STORAGE_KEYS.idToken]).then(function (r) {
        var token = r[STORAGE_KEYS.idToken] || '';
        if (!token) return Promise.reject(new Error('Not signed in to OpenDKP API.'));
        var headers = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          CognitoInfo: token
        };
        if (opts.clientId) {
          headers.ClientId = String(opts.clientId);
          headers.clientid = String(opts.clientId);
        }
        return headers;
      });
    });
  }

  function getCognitoUsername(opts) {
    opts = opts || {};
    return ensureFreshToken({ clientId: opts.clientId }).then(function () {
      return storageLocalGet([STORAGE_KEYS.idToken]).then(function (r) {
        return getCognitoUsernameFromToken(r[STORAGE_KEYS.idToken] || '');
      });
    });
  }

  /**
   * OpenDKP login username — prefer saved sign-in name, then JWT cognito:username.
   * @param {{ cognitoClientId?: string }} cfg
   * @param {string} [explicitUsername]
   */
  function resolveAccountUsername(cfg, explicitUsername) {
    if (explicitUsername != null && String(explicitUsername).trim()) {
      return Promise.resolve(String(explicitUsername).trim());
    }
    return storageSyncGet(['opendkpCognitoUsername']).then(function (sync) {
      var stored =
        sync && sync.opendkpCognitoUsername ? String(sync.opendkpCognitoUsername).trim() : '';
      if (stored) return stored;
      return getCognitoUsername({ clientId: cfg && cfg.cognitoClientId });
    });
  }

  function accountUsernameKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  function coerceCharacterArray(body) {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== 'object') return [];
    if (Array.isArray(body.Characters)) return body.Characters;
    if (Array.isArray(body.characters)) return body.characters;
    if (Array.isArray(body.Models)) return body.Models;
    if (Array.isArray(body.models)) return body.models;
    return [];
  }

  function characterBelongsToAccount(character, accountUsername) {
    if (!character || !accountUsername) return false;
    var target = accountUsernameKey(accountUsername);
    if (!target) return false;
    var fields = [
      character.User,
      character.user,
      character.Account,
      character.account,
      character.AccountName,
      character.accountName,
      character.Username,
      character.username
    ];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i] != null && accountUsernameKey(fields[i]) === target) return true;
    }
    return false;
  }

  function apiBase(cfg) {
    var host = (cfg.apiHost || DEFAULT_API_HOST).replace(/^https?:\/\//, '').replace(/\/$/, '');
    return 'https://' + host;
  }

  function clientPath(cfg, pathSegments) {
    var slug = (cfg.clientSlug || '').trim().toLowerCase();
    if (!slug) return Promise.reject(new Error('Guild subdomain is required'));
    var base = apiBase(cfg);
    var path = '/clients/' + encodeURIComponent(slug) + '/' + pathSegments.join('/');
    return Promise.resolve(base + path);
  }

  /**
   * @param {string} url
   * @param {RequestInit} init
   */
  function fetchJson(url, init) {
    return fetch(url, init).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      return res.text().then(function (text) {
        var body = null;
        if (text && ct.indexOf('json') !== -1) {
          try {
            body = JSON.parse(text);
          } catch (e) {
            body = { _raw: text };
          }
        } else if (text) {
          body = { _raw: text };
        }
        if (!res.ok) {
          var msg =
            (body &&
              (body.message || body.Message || body.error || body.ErrorMessage)) ||
            res.statusText ||
            'HTTP ' + res.status;
          if (!body || (!body.message && !body.Message && !body.error)) {
            if (body && typeof body === 'object') {
              try {
                msg = 'HTTP ' + res.status + ': ' + JSON.stringify(body);
              } catch (_) {
                /* keep default msg */
              }
            } else if (text) {
              msg = 'HTTP ' + res.status + ': ' + text.slice(0, 500);
            }
          }
          var err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return body;
      });
    });
  }

  /**
   * @param {{ username: string, password: string, clientId: string }} creds
   */
  function cognitoInitiatePasswordAuth(creds) {
    var body = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: creds.clientId,
      AuthParameters: {
        USERNAME: creds.username,
        PASSWORD: creds.password
      }
    };
    return fetch(COGNITO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': COGNITO_TARGET_INIT
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch (e) {
          throw new Error('Cognito response not JSON');
        }
        if (!res.ok) {
          var msg =
            (parsed && (parsed.message || parsed.Message || parsed.__type)) || text || res.statusText;
          var err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
          err.status = res.status;
          err.body = parsed;
          throw err;
        }
        var ar = parsed && parsed.AuthenticationResult;
        if (!ar || !ar.IdToken) throw new Error('Cognito: missing AuthenticationResult.IdToken');
        var expMs = Date.now() + (parseInt(ar.ExpiresIn || '3600', 10) * 1000);
        return storageLocalSet({
          [STORAGE_KEYS.idToken]: ar.IdToken,
          [STORAGE_KEYS.accessToken]: ar.AccessToken || '',
          [STORAGE_KEYS.refreshToken]: ar.RefreshToken || '',
          [STORAGE_KEYS.expiresAt]: expMs
        }).then(function () {
          return {
            idToken: ar.IdToken,
            accessToken: ar.AccessToken,
            refreshToken: ar.RefreshToken,
            expiresAt: expMs
          };
        });
      });
    });
  }

  /**
   * @param {{ refreshToken: string, clientId: string }} p
   */
  function cognitoRefresh(p) {
    var body = {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: p.clientId,
      AuthParameters: { REFRESH_TOKEN: p.refreshToken }
    };
    return fetch(COGNITO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': COGNITO_TARGET_INIT
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var parsed = text ? JSON.parse(text) : null;
        if (!res.ok) {
          var err = new Error((parsed && parsed.message) || text || 'Refresh failed');
          err.status = res.status;
          throw err;
        }
        var ar = parsed && parsed.AuthenticationResult;
        if (!ar || !ar.IdToken) throw new Error('Cognito refresh: missing IdToken');
        var expMs = Date.now() + (parseInt(ar.ExpiresIn || '3600', 10) * 1000);
        return storageLocalGet([STORAGE_KEYS.refreshToken]).then(function (prev) {
          var rt = ar.RefreshToken || prev[STORAGE_KEYS.refreshToken] || p.refreshToken;
          return storageLocalSet({
            [STORAGE_KEYS.idToken]: ar.IdToken,
            [STORAGE_KEYS.accessToken]: ar.AccessToken || '',
            [STORAGE_KEYS.refreshToken]: rt,
            [STORAGE_KEYS.expiresAt]: expMs
          }).then(function () {
            return { idToken: ar.IdToken, expiresAt: expMs };
          });
        });
      });
    });
  }

  function clearTokens() {
    return storageLocalRemove([
      STORAGE_KEYS.idToken,
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.refreshToken,
      STORAGE_KEYS.expiresAt
    ]);
  }

  function getTokenMeta() {
    return storageLocalGet([
      STORAGE_KEYS.idToken,
      STORAGE_KEYS.expiresAt,
      STORAGE_KEYS.refreshToken
    ]).then(function (r) {
      var hasToken = !!r[STORAGE_KEYS.idToken];
      var exp = r[STORAGE_KEYS.expiresAt] || 0;
      var hasRefresh = !!r[STORAGE_KEYS.refreshToken];
      return {
        hasToken: hasToken,
        expiresAt: exp,
        hasRefresh: hasRefresh,
        isActive:
          hasToken &&
          (hasRefresh || (!!exp && exp > Date.now() + 60000))
      };
    });
  }

  /**
   * Ensure valid ID token; refresh if near expiry and clientId + refresh available.
   * @param {{ clientId?: string }} [opts]
   */
  function ensureFreshToken(opts) {
    opts = opts || {};
    return storageLocalGet([
      STORAGE_KEYS.idToken,
      STORAGE_KEYS.expiresAt,
      STORAGE_KEYS.refreshToken
    ]).then(function (r) {
      var id = r[STORAGE_KEYS.idToken];
      var exp = r[STORAGE_KEYS.expiresAt] || 0;
      var rt = r[STORAGE_KEYS.refreshToken];
      var clientId = opts.clientId;
      if (id && exp > Date.now() + TOKEN_REFRESH_BUFFER_MS) return id;
      if (rt && clientId) {
        return cognitoRefresh({ refreshToken: rt, clientId: clientId }).then(function (x) {
          return x.idToken;
        });
      }
      return id || null;
    });
  }

  /**
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {{ count?: number }} [q]
   */
  function normalizeRaidListCount(raw) {
    var n = parseInt(String(raw != null ? raw : OPEN_DKP_DEFAULT_RAID_LIST_COUNT), 10);
    if (Number.isNaN(n) || n < 1) return OPEN_DKP_DEFAULT_RAID_LIST_COUNT;
    if (n > OPEN_DKP_MAX_RAID_LIST_COUNT) return OPEN_DKP_MAX_RAID_LIST_COUNT;
    return n;
  }

  function readRaidListCount() {
    return storageSyncGet([OPEN_DKP_RAID_LIST_COUNT_KEY]).then(function (r) {
      return normalizeRaidListCount(r[OPEN_DKP_RAID_LIST_COUNT_KEY]);
    });
  }

  function getRaids(cfg, q) {
    q = q || {};
    var count = q.count != null ? normalizeRaidListCount(q.count) : OPEN_DKP_DEFAULT_RAID_LIST_COUNT;
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        return clientPath(cfg, ['raids']).then(function (url) {
          var u = url + '?count=' + encodeURIComponent(String(count));
          return fetchJson(u, { method: 'GET', headers: headers });
        });
      });
    });
  }

  /**
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {number|string} raidId
   */
  function getRaid(cfg, raidId) {
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        return clientPath(cfg, ['raids', String(raidId)]).then(function (url) {
          return fetchJson(url, { method: 'GET', headers: headers });
        });
      });
    });
  }

  /**
   * @param {{ apiHost: string, clientSlug: string }} cfg
   */
  function getPools(cfg) {
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        var host = (cfg.apiHost || DEFAULT_API_HOST).replace(/^https?:\/\//, '').replace(/\/$/, '');
        var url = 'https://' + host + '/pools';
        return fetchJson(url, { method: 'GET', headers: headers });
      });
    });
  }

  /**
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {{ includeInactives?: boolean }} [q]
   */
  function getCharacters(cfg, q) {
    q = q || {};
    var inc = q.includeInactives !== false;
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        return clientPath(cfg, ['characters']).then(function (url) {
          var u = url + '?IncludeInactives=' + (inc ? 'true' : 'false');
          return fetchJson(u, { method: 'GET', headers: headers });
        });
      });
    });
  }

  /**
   * Create raid — collection: PUT /clients/{client}/raids
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {object} body
   */
  function putRaid(cfg, body, opts) {
    opts = opts || {};
    return buildAdminHeaders(cfg, opts).then(function (headers) {
      return clientPath(cfg, ['raids']).then(function (url) {
        return fetchJson(url, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
      });
    });
  }

  /**
   * Update raid — collection: POST /clients/{client}/raids/{raidId}
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {number|string} raidId
   * @param {object} body
   * @param {{ clientId?: string }} [opts]
   */
  function postRaidUpdate(cfg, raidId, body, opts) {
    opts = opts || {};
    return buildAdminHeaders(cfg, opts).then(function (headers) {
      return clientPath(cfg, ['raids', String(raidId)]).then(function (url) {
        return fetchJson(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
      });
    });
  }

  /**
   * Item autocomplete — GET /items/autocomplete?item=...&limit=...&game=0
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {string} itemName
   * @param {number} [limit]
   */
  function searchItemAutocomplete(cfg, itemName, limit) {
    var lim = limit != null ? limit : 5;
    var query = String(itemName || '').trim();
    if (!query) return Promise.reject(new Error('Item name is required'));
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        var host = (cfg.apiHost || DEFAULT_API_HOST).replace(/^https?:\/\//, '').replace(/\/$/, '');
        var url =
          'https://' +
          host +
          '/items/autocomplete?item=' +
          encodeURIComponent(query) +
          '&limit=' +
          encodeURIComponent(String(lim)) +
          '&game=0';
        return fetchJson(url, { method: 'GET', headers: headers });
      });
    });
  }

  /**
   * Create auction(s) — PUT /clients/{client}/auctions (array body)
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {object[]} body
   */
  function createAuctions(cfg, body) {
    if (!Array.isArray(body) || body.length === 0) {
      return Promise.reject(new Error('At least one auction is required'));
    }
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        return clientPath(cfg, ['auctions']).then(function (url) {
          return fetchJson(url, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
        });
      });
    });
  }

  /**
   * Active auctions — GET /clients/{client}/auctions/active
   * @param {{ apiHost: string, clientSlug: string }} cfg
   */
  function getActiveAuctions(cfg) {
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        return clientPath(cfg, ['auctions', 'active']).then(function (url) {
          return fetchJson(url, { method: 'GET', headers: headers });
        });
      });
    });
  }

  /**
   * Paginated auction history — GET /clients/{client}/auctions?page=N
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {{ page?: number }} [q]
   */
  function getAllAuctions(cfg, q) {
    q = q || {};
    var page = q.page != null ? q.page : 1;
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        return clientPath(cfg, ['auctions']).then(function (url) {
          var u = url + '?page=' + encodeURIComponent(String(page));
          return fetchJson(u, { method: 'GET', headers: headers });
        });
      });
    });
  }

  /**
   * Single auction — GET /clients/{client}/auctions/{auctionId}
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {number|string} auctionId
   */
  function getAuction(cfg, auctionId) {
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        return clientPath(cfg, ['auctions', String(auctionId)]).then(function (url) {
          return fetchJson(url, { method: 'GET', headers: headers });
        });
      });
    });
  }

  /**
   * Guild DKP summary — GET /clients/{client}/dkp
   * @param {{ apiHost: string, clientSlug: string }} cfg
   */
  function getDkpSummary(cfg) {
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        return clientPath(cfg, ['dkp']).then(function (url) {
          return fetchJson(url, { method: 'GET', headers: headers });
        });
      });
    });
  }

  /**
   * Character DKP — GET /clients/{client}/characters/{characterId}/dkp
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {number|string} characterId
   */
  function getCharacterDkp(cfg, characterId) {
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        return clientPath(cfg, ['characters', String(characterId), 'dkp']).then(function (url) {
          return fetchJson(url, { method: 'GET', headers: headers });
        });
      });
    });
  }

  /**
   * Characters linked to an OpenDKP account.
   * Loads the guild roster and filters by the character User/Account field.
   * (Dedicated /characters/account/{user} routes reject Bearer JWT on api.opendkp.com.)
   * @param {{ apiHost: string, clientSlug: string, cognitoClientId?: string }} cfg
   * @param {string} [username] — defaults to saved sign-in username or JWT cognito:username
   */
  function getAccountCharacters(cfg, username) {
    return resolveAccountUsername(cfg, username).then(function (user) {
      if (!user) return Promise.reject(new Error('OpenDKP username is required'));
      return getCharacters(cfg, { includeInactives: true }).then(function (body) {
        return coerceCharacterArray(body).filter(function (character) {
          return characterBelongsToAccount(character, user);
        });
      });
    });
  }

  /**
   * Build place-bid JSON body (PascalCase keys required by API).
   * SessionId matches auctionId (same value as URL path segment).
   *
   * @param {number|string} auctionId
   * @param {{ characterId: number|string, priority: number, rank: string, value: number }} bid
   */
  function buildBidBody(auctionId, bid) {
    var sessionId = parseInt(String(auctionId), 10);
    if (!sessionId || sessionId < 1) throw new Error('Valid auction id is required');
    var characterId = parseInt(String(bid.characterId), 10);
    if (!characterId || characterId < 1) throw new Error('Valid character id is required');
    var value = parseInt(String(bid.value), 10);
    if (!value || value < 1) throw new Error('Bid value must be at least 1');
    var rank = String(bid.rank || '').trim();
    if (!rank) throw new Error('Character rank is required');
    var priority = parseInt(String(bid.priority != null ? bid.priority : 1), 10);
    if (!priority || priority < 1) priority = 1;
    return {
      CharacterId: characterId,
      Priority: priority,
      Rank: rank,
      SessionId: sessionId,
      Value: value
    };
  }

  /**
   * Place bid — PUT /clients/{client}/auctions/{auctionId}/bids
   * Auth: Bearer IdToken (same as other raider endpoints).
   *
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {number|string} auctionId
   * @param {object} body — full API body or use buildBidBody()
   */
  function placeBid(cfg, auctionId, body) {
    var aid = String(auctionId || '').trim();
    if (!aid) return Promise.reject(new Error('Auction id is required'));
    if (!body || typeof body !== 'object') {
      return Promise.reject(new Error('Bid body is required'));
    }
    return ensureFreshToken({ clientId: cfg.cognitoClientId }).then(function () {
      return buildHeaders(cfg).then(function (headers) {
        return clientPath(cfg, ['auctions', aid, 'bids']).then(function (url) {
          return fetchJson(url, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
        });
      });
    });
  }

  /**
   * Probe which token works for GET raids (optional diagnostics).
   * @param {{ apiHost: string, clientSlug: string }} cfg
   * @param {string} idToken
   * @param {string} accessToken
   */
  function probeTokenForRaids(cfg, idToken, accessToken) {
    return clientPath(cfg, ['raids']).then(function (url) {
      var u = url + '?count=1';
      var tryOne = function (token) {
        if (!token) return Promise.resolve({ ok: false, label: 'none' });
        return fetchJson(u, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
        })
          .then(function () {
            return { ok: true };
          })
          .catch(function (e) {
            return { ok: false, error: e.message, status: e.status };
          });
      };
      return tryOne(idToken).then(function (idRes) {
        return tryOne(accessToken).then(function (acRes) {
          return { idToken: idRes, accessToken: acRes };
        });
      });
    });
  }

  /**
   * Guild ClientId for admin headers — always prefer the raid record from GET.
   * Wrong clientid header makes InsertOrUpdateRaid fail to load the raid (HTTP 500).
   * @param {object} [raid] — GET /raids/{id} response
   * @param {string} [cachedClientId] — roster cache fallback
   */
  function resolveGuildClientId(raid, cachedClientId) {
    var fromRaid = '';
    if (raid && raid.ClientId != null && String(raid.ClientId).trim()) {
      fromRaid = String(raid.ClientId).trim();
    }
    var cached = cachedClientId != null ? String(cachedClientId).trim() : '';
    return fromRaid || cached || '';
  }

  global.OpenDkpApi = {
    STORAGE_KEYS: STORAGE_KEYS,
    OPEN_DKP_DEFAULT_RAID_LIST_COUNT: OPEN_DKP_DEFAULT_RAID_LIST_COUNT,
    OPEN_DKP_MAX_RAID_LIST_COUNT: OPEN_DKP_MAX_RAID_LIST_COUNT,
    OPEN_DKP_RAID_LIST_COUNT_KEY: OPEN_DKP_RAID_LIST_COUNT_KEY,
    normalizeRaidListCount: normalizeRaidListCount,
    readRaidListCount: readRaidListCount,
    resolveGuildClientId: resolveGuildClientId,
    cognitoInitiatePasswordAuth: cognitoInitiatePasswordAuth,
    cognitoRefresh: cognitoRefresh,
    clearTokens: clearTokens,
    getTokenMeta: getTokenMeta,
    getCognitoUsername: getCognitoUsername,
    ensureFreshToken: ensureFreshToken,
    getRaids: getRaids,
    getRaid: getRaid,
    getPools: getPools,
    getCharacters: getCharacters,
    putRaid: putRaid,
    postRaidUpdate: postRaidUpdate,
    searchItemAutocomplete: searchItemAutocomplete,
    createAuctions: createAuctions,
    getActiveAuctions: getActiveAuctions,
    getAllAuctions: getAllAuctions,
    getAuction: getAuction,
    getDkpSummary: getDkpSummary,
    getCharacterDkp: getCharacterDkp,
    getAccountCharacters: getAccountCharacters,
    buildBidBody: buildBidBody,
    placeBid: placeBid,
    probeTokenForRaids: probeTokenForRaids,
    apiBase: apiBase
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
