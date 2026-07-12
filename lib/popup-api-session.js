/**
 * Popup API sign-in / session refresh and current-raid picker (configurable recent raids).
 */
(function (global) {
  'use strict';

  var OPEN_DKP_COGNITO_CLIENT_ID = '2sq61k8dj39e309tnh5tm70dd4';
  var OPEN_DKP_API_HOST = 'api.opendkp.com';
  var OPEN_DKP_PASSWORD_STORAGE_KEY = 'opendkpCognitoPassword';
  var OPEN_DKP_POOLS_CACHE_STORAGE_KEY = 'opendkpPoolsCache';
  var CREATE_RAID_VALUE = '__create__';

  function getApi() {
    return typeof browser !== 'undefined' ? browser : chrome;
  }

  function storageSyncGet(keys) {
    return new Promise(function (resolve) {
      getApi().storage.sync.get(keys, function (r) {
        resolve(r || {});
      });
    });
  }

  function storageSyncSet(obj) {
    return new Promise(function (resolve, reject) {
      getApi().storage.sync.set(obj, function () {
        var err = getApi().runtime && getApi().runtime.lastError;
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

  function coerceArray(body) {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== 'object') return [];
    if (Array.isArray(body.Models)) return body.Models;
    if (Array.isArray(body.Raids)) return body.Raids;
    return [];
  }

  function persistCurrentRaid(id, summaryObj) {
    if (global.RaidContext && RaidContext.persistCurrentRaid) {
      return RaidContext.persistCurrentRaid(id, summaryObj);
    }
    var payload = {
      opendkpCurrentRaidId: id == null ? null : Number(id),
      opendkpCurrentRaidSummaryJson: summaryObj ? JSON.stringify(summaryObj) : ''
    };
    return storageSyncSet(payload);
  }

  function parseRaidSummary(json) {
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function storedRaidFromSummary(storedId, summaryJson) {
    var summary = parseRaidSummary(summaryJson);
    var name = summary && summary.name ? String(summary.name) : '';
    return { Id: storedId, Name: name || 'Raid #' + storedId };
  }

  /**
   * Validates stored current raid against the API when needed.
   * @returns {Promise<{ raids: Array, currentId: number|null, cleared?: boolean, verifyFailed?: boolean, switchedToRecent?: boolean, currentSummaryJson?: string }>}
   */
  function resolveStoredCurrentRaid(cfg, raids, storedId, summaryJson, opts) {
    opts = opts || {};
    var forceVerify = !!opts.forceVerify;
    var raidListCount =
      opts.raidListCount != null
        ? global.OpenDkpApi && OpenDkpApi.normalizeRaidListCount
          ? OpenDkpApi.normalizeRaidListCount(opts.raidListCount)
          : opts.raidListCount
        : global.OpenDkpApi && OpenDkpApi.readRaidListCount
          ? null
          : 1;
    var countPromise =
      raidListCount != null
        ? Promise.resolve(raidListCount)
        : global.OpenDkpApi.readRaidListCount();

    return countPromise.then(function (resolvedCount) {
      var strictSingle = resolvedCount === 1;
      raids = raids.slice(0, resolvedCount);

      if (storedId == null || storedId === '' || Number.isNaN(Number(storedId))) {
        return { raids: raids, currentId: null, cleared: false };
      }
      var idNum = Number(storedId);
      var inList = raidIdInList(raids, idNum);

      function clearStale() {
        return persistCurrentRaid(null, null).then(function () {
          return { raids: raids, currentId: null, cleared: true };
        });
      }

      function withCurrent(raidList, currentId, extra) {
        return Object.assign({ raids: raidList, currentId: currentId, cleared: false }, extra || {});
      }

      function addStoredToList(name) {
        var next = raids.slice();
        if (!raidIdInList(next, idNum)) {
          next.unshift({ Id: idNum, Name: name || 'Raid #' + idNum });
        }
        return withCurrent(next.slice(0, resolvedCount), idNum);
      }

      function autoSelectMostRecent() {
        if (!raids.length) {
          return clearStale();
        }
        var newestId = Number(raidListId(raids[0]));
        if (Number.isNaN(newestId)) {
          return clearStale();
        }
        if (idNum === newestId) {
          return Promise.resolve(withCurrent(raids, idNum));
        }
        return loadRaidSummary(cfg, newestId).then(function (summary) {
          var summaryJsonOut = JSON.stringify(summary);
          return persistCurrentRaid(newestId, summary).then(function () {
            return withCurrent(raids, newestId, {
              switchedToRecent: true,
              currentSummaryJson: summaryJsonOut
            });
          });
        });
      }

      if (strictSingle && !inList) {
        if (!global.OpenDkpApi || !global.OpenDkpApi.getRaid) {
          return autoSelectMostRecent();
        }
        return global.OpenDkpApi.getRaid(cfg, idNum)
          .then(function () {
            return autoSelectMostRecent();
          })
          .catch(function (err) {
            if (err && err.status === 404) {
              return clearStale();
            }
            return autoSelectMostRecent();
          });
      }

      if (!global.OpenDkpApi || !global.OpenDkpApi.getRaid) {
        if (inList) {
          return Promise.resolve(withCurrent(raids, idNum));
        }
        var fallback = raids.slice();
        fallback.unshift(storedRaidFromSummary(idNum, summaryJson));
        return Promise.resolve(withCurrent(fallback.slice(0, resolvedCount), idNum));
      }

      if (inList && !forceVerify) {
        return Promise.resolve(withCurrent(raids, idNum));
      }

      return global.OpenDkpApi.getRaid(cfg, idNum)
        .then(function (body) {
          var name = body && (body.Name != null ? body.Name : body.name);
          return addStoredToList(name);
        })
        .catch(function (err) {
          if (err && err.status === 404) {
            return clearStale();
          }
          var next = raids.slice();
          if (!raidIdInList(next, idNum)) {
            next.unshift(storedRaidFromSummary(idNum, summaryJson));
          }
          return withCurrent(next.slice(0, resolvedCount), idNum, { verifyFailed: true });
        });
    });
  }

  function formatRaidOptionLabel(id, name) {
    var label = 'Raid #' + id;
    if (name) label += ' — ' + name;
    return label;
  }

  function raidListId(raid) {
    return raid.Id != null ? raid.Id : raid.RaidId;
  }

  function raidIdInList(raids, id) {
    if (id == null || id === '' || Number.isNaN(Number(id))) return false;
    var idNum = Number(id);
    return raids.some(function (r) {
      return Number(raidListId(r)) === idNum;
    });
  }

  function populateRaidSelect(selectEl, raids, currentId, allowCreate, summaryJson, raidListCount) {
    var strictSingle =
      raidListCount === 1 ||
      (global.OpenDkpApi &&
        OpenDkpApi.normalizeRaidListCount &&
        OpenDkpApi.normalizeRaidListCount(raidListCount) === 1);
    selectEl.innerHTML = '';
    if (allowCreate) {
      var optCreate = document.createElement('option');
      optCreate.value = CREATE_RAID_VALUE;
      optCreate.textContent = 'Create a raid';
      selectEl.appendChild(optCreate);
    }

    var opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = raids.length ? '— Select raid —' : '— No raids —';
    selectEl.appendChild(opt0);
    raids.forEach(function (r) {
      var id = raidListId(r);
      var o = document.createElement('option');
      o.value = String(id);
      o.textContent = formatRaidOptionLabel(id, r.Name || '');
      selectEl.appendChild(o);
    });
    if (
      !strictSingle &&
      currentId != null &&
      currentId !== '' &&
      !Number.isNaN(Number(currentId)) &&
      !raidIdInList(raids, currentId)
    ) {
      var summary = parseRaidSummary(summaryJson);
      var fallbackName = summary && summary.name ? String(summary.name) : '';
      var orphan = document.createElement('option');
      orphan.value = String(currentId);
      orphan.textContent = formatRaidOptionLabel(currentId, fallbackName);
      selectEl.appendChild(orphan);
    }
    if (currentId != null && currentId !== '' && !Number.isNaN(Number(currentId))) {
      selectEl.value = String(currentId);
    } else {
      selectEl.value = '';
    }
  }

  function parseAttendance(raw) {
    if (raw === 0 || raw === '0' || raw === false) return 0;
    if (raw === 1 || raw === '1' || raw === true) return 1;
    var n = parseInt(String(raw != null ? raw : '1'), 10);
    return n === 0 ? 0 : 1;
  }

  function parseTickDkpValue(raw) {
    var n = parseInt(String(raw != null ? raw : '1'), 10);
    return isNaN(n) || n < 0 ? 1 : n;
  }

  function defaultRaidTickDefs(fallbackDkp) {
    var value = parseTickDkpValue(fallbackDkp);
    return [
      { description: 'Hour #1', value: value },
      { description: 'Hour #2', value: value },
      { description: 'Hour #3', value: value }
    ];
  }

  function normalizeRaidTickDefs(raw, fallbackDkp) {
    if (!Array.isArray(raw)) return defaultRaidTickDefs(fallbackDkp);
    if (!raw.length) return [];
    var out = [];
    raw.forEach(function (t, i) {
      if (!t || typeof t !== 'object') return;
      var description = String(
        t.description != null ? t.description : t.name != null ? t.name : 'Tick ' + (i + 1)
      ).trim();
      if (!description) return;
      out.push({
        description: description,
        value: parseTickDkpValue(t.value != null ? t.value : t.dkp)
      });
    });
    return out.length ? out : defaultRaidTickDefs(fallbackDkp);
  }

  function buildCreateRaidTicks(defs) {
    return (defs || []).map(function (t) {
      return {
        Characters: [],
        Description: t.description,
        Value: String(parseTickDkpValue(t.value))
      };
    });
  }

  function findPoolForCreate(pools, preferredPoolId) {
    pools = pools || [];
    if (preferredPoolId) {
      var pref = String(preferredPoolId);
      for (var i = 0; i < pools.length; i++) {
        if (String(pools[i].id) === pref) return pools[i];
      }
    }
    for (var j = 0; j < pools.length; j++) {
      if (String(pools[j].name || '').trim().toLowerCase() === 'classic') return pools[j];
    }
    return pools[0] || null;
  }

  function loadCreateRaidSettings() {
    return storageSyncGet([
      'opendkpAttendance',
      'opendkpPreferredPoolId',
      'opendkpRaidTickDefs',
      'opendkpTickDkpValue'
    ]).then(function (sync) {
      return storageLocalGet([OPEN_DKP_POOLS_CACHE_STORAGE_KEY]).then(function (local) {
        var cache = local[OPEN_DKP_POOLS_CACHE_STORAGE_KEY] || { pools: [] };
        return {
          attendance: parseAttendance(sync.opendkpAttendance),
          preferredPoolId: sync.opendkpPreferredPoolId || '',
          tickDefs: normalizeRaidTickDefs(sync.opendkpRaidTickDefs, sync.opendkpTickDkpValue),
          pools: cache.pools || []
        };
      });
    });
  }

  function buildCreateRaidBody(name, settings, pool) {
    return {
      Name: name,
      Timestamp: new Date().toISOString(),
      Attendance: settings.attendance,
      Pool: {
        Name: pool.name || '',
        Description: pool.desc || '',
        Order: parseInt(String(pool.order != null ? pool.order : 0), 10),
        PoolId: parseInt(String(pool.id), 10)
      },
      Items: [],
      Ticks: buildCreateRaidTicks(settings.tickDefs)
    };
  }

  function fetchRaidsList(cfg) {
    return global.OpenDkpApi.readRaidListCount().then(function (count) {
      return global.OpenDkpApi.getRaids(cfg, { count: count }).then(function (body) {
        return {
          raids: coerceArray(body).slice(0, count),
          count: count
        };
      });
    });
  }

  function loadRaidSummary(cfg, raidId) {
    return global.OpenDkpApi.getRaid(cfg, raidId).then(function (full) {
      var ticks = (full.Ticks || []).map(function (t) {
        return {
          id: t.Id != null ? t.Id : t.TickId,
          description: t.Description,
          value: t.Value
        };
      });
      return { name: full.Name, ticks: ticks };
    });
  }

  function updateSessionButtonLabel(btn) {
    if (!global.OpenDkpApi) {
      btn.textContent = '🔑';
      btn.title = 'Sign in to OpenDKP API (uses credentials from Settings)';
      return Promise.resolve();
    }
    return global.OpenDkpApi.getTokenMeta().then(function (meta) {
      btn.textContent = meta.isActive ? '🔄' : '🔑';
      btn.title = meta.isActive
        ? 'Refresh session, validate current raid, and reload recent raids'
        : meta.hasToken
          ? 'API session expired — click 🔑 to refresh'
          : 'Sign in to OpenDKP API (uses credentials from Settings)';
    });
  }

  function applyApiSessionHint(cfg, meta, hintEl) {
    if (!hintEl) return Promise.resolve();
    if (!cfg || !cfg.clientSlug) {
      hintEl.textContent = 'Set guild subdomain in Settings.';
      hintEl.classList.add('api-session-hint-invalid');
      return Promise.resolve();
    }
    if (!global.OpenDkpApi) {
      hintEl.textContent = '';
      hintEl.classList.remove('api-session-hint-invalid');
      return Promise.resolve();
    }
    if (!meta || !meta.hasToken) {
      hintEl.textContent = 'Sign in with 🔑 to load raids and create raids.';
      hintEl.classList.add('api-session-hint-invalid');
      return Promise.resolve();
    }
    if (!meta.isActive) {
      hintEl.textContent = 'API session expired — click 🔑 to refresh.';
      hintEl.classList.add('api-session-hint-invalid');
      return Promise.resolve();
    }
    return refreshHint(hintEl);
  }

  function refreshHint(hintEl) {
    if (!hintEl) return Promise.resolve();
    if (!global.LootQueue) {
      hintEl.textContent = '';
      hintEl.classList.remove('api-session-hint-invalid');
      return Promise.resolve();
    }
    var readCtx = LootQueue.readValidatedLootQueueContext || LootQueue.readLootQueueContext;
    return readCtx(false)
      .then(function (ctx) {
        if (ctx.raidValid === false || ctx.raidId == null) {
          hintEl.textContent =
            ctx.raidId == null
              ? 'Select a raid to enable Queue / Post all.'
              : 'Selected raid is no longer valid — pick another.';
          hintEl.classList.add('api-session-hint-invalid');
        } else {
          hintEl.textContent = '';
          hintEl.classList.remove('api-session-hint-invalid');
        }
      })
      .catch(function () {
        hintEl.textContent = '';
        hintEl.classList.remove('api-session-hint-invalid');
      });
  }

  function getStoredCredentials() {
    return storageSyncGet(['opendkpCognitoUsername']).then(function (sync) {
      return storageLocalGet([OPEN_DKP_PASSWORD_STORAGE_KEY]).then(function (local) {
        return {
          username: String(sync.opendkpCognitoUsername || '').trim(),
          password: local[OPEN_DKP_PASSWORD_STORAGE_KEY] || ''
        };
      });
    });
  }

  function refreshSessionToken() {
    return storageLocalGet([global.OpenDkpApi.STORAGE_KEYS.refreshToken]).then(function (local) {
      var rt = local[global.OpenDkpApi.STORAGE_KEYS.refreshToken];
      if (!rt) {
        return Promise.reject(new Error('No refresh token; sign in via Settings or save credentials there.'));
      }
      return global.OpenDkpApi.cognitoRefresh({
        clientId: OPEN_DKP_COGNITO_CLIENT_ID,
        refreshToken: rt
      });
    });
  }

  function signInWithStoredCredentials() {
    return getStoredCredentials().then(function (creds) {
      if (!creds.username || !creds.password) {
        throw new Error('Enter API username and password in Settings, then use Sign in here.');
      }
      return global.OpenDkpApi.cognitoInitiatePasswordAuth({
        clientId: OPEN_DKP_COGNITO_CLIENT_ID,
        username: creds.username,
        password: creds.password
      });
    });
  }

  function showSessionMessage(hintEl, message, isError) {
    if (hintEl) {
      hintEl.textContent = message || '';
      hintEl.classList.toggle('api-session-hint-invalid', isError !== false);
      hintEl.classList.remove('api-session-hint-queued');
      return;
    }
    if (global.PopupNotify) {
      PopupNotify.show(message, isError === false ? 'success' : 'error');
    }
  }

  /**
   * @param {{ isRaidLeader?: boolean, onRaidChanged?: function }} [opts]
   */
  function init(opts) {
    opts = opts || {};
    var row = document.getElementById('apiSessionRow');
    var btn = document.getElementById('apiSessionBtn');
    var createBtn = document.getElementById('apiCreateRaidBtn');
    var createRow = document.getElementById('apiCreateRaidRow');
    var createNameInput = document.getElementById('apiCreateRaidName');
    var select = document.getElementById('apiRaidSelect');
    var hint = document.getElementById('apiSessionHint');
    if (!row || !btn || !select) return;

    if (opts.isRaidLeader === false) {
      row.style.display = 'none';
      return;
    }
    row.style.display = 'flex';

    function refreshQueueUi() {
      var row = document.getElementById('apiRaidtickQueueRow');
      if (select && (select.value === '' || select.value === CREATE_RAID_VALUE)) {
        if (row) row.style.display = 'none';
        return Promise.resolve();
      }
      if (global.RaidTickQueue && global.RaidTickQueue.renderPopupQueueUi) {
        return global.RaidTickQueue.renderPopupQueueUi();
      }
      return Promise.resolve();
    }

    if (global.RaidTickQueue && global.RaidTickQueue.initPopupUi) {
      global.RaidTickQueue.initPopupUi();
    }

    var sessionBusy = false;
    var createBusy = false;

    function showCreateRaidUi(show) {
      if (createRow) createRow.style.display = show ? 'flex' : 'none';
      if (createNameInput && !show) createNameInput.value = '';
      if (show && createNameInput) {
        setTimeout(function () {
          createNameInput.focus();
        }, 0);
      }
    }

    function getConfig() {
      return storageSyncGet(['opendkpClientSlug']).then(function (data) {
        return buildApiConfig(data.opendkpClientSlug);
      });
    }

    function loadRaidsIntoSelect(opts) {
      opts = opts || {};
      var wasCreate = select.value === CREATE_RAID_VALUE;
      return getConfig()
        .then(function (cfg) {
          if (!cfg.clientSlug) {
            populateRaidSelect(select, [], null, false);
            showCreateRaidUi(false);
            return applyApiSessionHint(cfg, null, hint);
          }
          return global.OpenDkpApi.getTokenMeta()
            .then(function (meta) {
              if (!meta.isActive && meta.hasRefresh) {
                return refreshSessionToken()
                  .then(function () {
                    return global.OpenDkpApi.getTokenMeta();
                  })
                  .catch(function () {
                    return meta;
                  });
              }
              return meta;
            })
            .then(function (meta) {
              if (!meta.isActive) {
                return storageSyncGet(['opendkpCurrentRaidId', 'opendkpCurrentRaidSummaryJson']).then(
                  function (syncData) {
                    return global.OpenDkpApi.readRaidListCount().then(function (count) {
                      var storedId =
                        syncData.opendkpCurrentRaidId != null &&
                        syncData.opendkpCurrentRaidId !== '' &&
                        !Number.isNaN(Number(syncData.opendkpCurrentRaidId))
                          ? Number(syncData.opendkpCurrentRaidId)
                          : null;
                      if (storedId != null && count !== 1) {
                        populateRaidSelect(
                          select,
                          [],
                          storedId,
                          true,
                          syncData.opendkpCurrentRaidSummaryJson,
                          count
                        );
                      } else {
                        populateRaidSelect(select, [], null, true, '', count);
                      }
                      showCreateRaidUi(false);
                      return applyApiSessionHint(cfg, meta, hint);
                    });
                  }
                );
              }
              if (global.LootQueue && LootQueue.invalidateValidatedContextCache) {
                LootQueue.invalidateValidatedContextCache();
              }
              return storageSyncGet(['opendkpCurrentRaidId', 'opendkpCurrentRaidSummaryJson'])
                .then(function (syncData) {
                  return fetchRaidsList(cfg).then(function (payload) {
                    var raids = payload.raids;
                    var count = payload.count;
                    var storedId = syncData.opendkpCurrentRaidId;
                    var resolveOpts = Object.assign({}, opts, { raidListCount: count });
                    return resolveStoredCurrentRaid(
                      cfg,
                      raids,
                      storedId,
                      syncData.opendkpCurrentRaidSummaryJson,
                      resolveOpts
                    ).then(function (result) {
                      var summaryJson =
                        result.currentSummaryJson ||
                        (result.currentId != null ? syncData.opendkpCurrentRaidSummaryJson : '');
                      populateRaidSelect(
                        select,
                        result.raids,
                        result.currentId,
                        true,
                        summaryJson,
                        count
                      );
                      if (wasCreate) {
                        select.value = CREATE_RAID_VALUE;
                        showCreateRaidUi(true);
                      } else {
                        showCreateRaidUi(false);
                      }
                      if (result.switchedToRecent) {
                        showSessionMessage(hint, 'Switched to most recent raid.', false);
                        return applyApiSessionHint(cfg, meta, hint);
                      }
                      if (result.cleared) {
                        showSessionMessage(
                          hint,
                          'Previous raid no longer exists — select a raid.',
                          false
                        );
                        return null;
                      }
                      return applyApiSessionHint(cfg, meta, hint);
                    });
                  });
                })
                .catch(function (e) {
                  if (hint) {
                    hint.textContent = 'Could not load raids: ' + (e.message || e);
                    hint.classList.add('api-session-hint-invalid');
                  }
                });
            });
        })
        .then(function () {
          return refreshQueueUi();
        });
    }

    function handleSessionAction() {
      if (sessionBusy || !global.OpenDkpApi) return;
      sessionBusy = true;
      btn.disabled = true;
      btn.textContent = '⏳';
      var hadToken = false;

      return global.OpenDkpApi.getTokenMeta()
        .then(function (meta) {
          hadToken = !!meta.hasToken;
          return getConfig();
        })
        .then(function (cfg) {
          if (!cfg.clientSlug) {
            showSessionMessage(hint, 'Set guild subdomain in Settings first.');
            return null;
          }
          if (hadToken) {
            return refreshSessionToken().catch(function () {
              return signInWithStoredCredentials();
            });
          }
          return signInWithStoredCredentials();
        })
        .then(function (result) {
          if (result === null) return;
          return loadRaidsIntoSelect({ forceVerify: hadToken });
        })
        .catch(function (e) {
          showSessionMessage(
            hint,
            (hadToken ? 'Refresh' : 'Sign-in') + ' failed: ' + (e.message || e)
          );
        })
        .then(function () {
          sessionBusy = false;
          btn.disabled = false;
          return updateSessionButtonLabel(btn);
        });
    }

    select.addEventListener('change', function () {
      var val = select.value;
      if (val === CREATE_RAID_VALUE) {
        global.OpenDkpApi.getTokenMeta().then(function (meta) {
          if (!meta.isActive) {
            select.value = '';
            showCreateRaidUi(false);
            showSessionMessage(hint, 'API session expired. Click 🔑 to refresh, then try again.');
            return getConfig().then(function (cfg) {
              return applyApiSessionHint(cfg, meta, hint);
            });
          }
          showCreateRaidUi(true);
          refreshQueueUi();
        });
        return;
      }
      showCreateRaidUi(false);
      if (!val) {
        persistCurrentRaid(null, null).then(function () {
          return refreshHint(hint);
        }).then(function () {
          return refreshQueueUi();
        });
        return;
      }
      var raidId = Number(val);
      if (Number.isNaN(raidId)) return;
      select.disabled = true;
      getConfig()
        .then(function (cfg) {
          return loadRaidSummary(cfg, raidId).then(function (summary) {
            return persistCurrentRaid(raidId, summary);
          });
        })
        .then(function () {
          return refreshHint(hint);
        })
        .then(function () {
          if (opts.onRaidChanged) opts.onRaidChanged();
          return refreshQueueUi();
        })
        .catch(function (e) {
          showSessionMessage(hint, 'Could not set raid: ' + (e.message || e));
          return storageSyncGet(['opendkpCurrentRaidId']).then(function (syncData) {
            select.value =
              syncData.opendkpCurrentRaidId != null ? String(syncData.opendkpCurrentRaidId) : '';
          });
        })
        .then(function () {
          select.disabled = false;
        });
    });

    function handleCreateRaid() {
      if (createBusy || !global.OpenDkpApi) return;
      var name = createNameInput ? String(createNameInput.value || '').trim() : '';
      if (!name) {
        showSessionMessage(hint, 'Enter a raid name.');
        if (createNameInput) createNameInput.focus();
        return;
      }
      createBusy = true;
      if (createBtn) createBtn.disabled = true;
      if (select) select.disabled = true;

      return getConfig()
        .then(function (cfg) {
          if (!cfg.clientSlug) {
            throw new Error('Enter your guild subdomain in Settings first.');
          }
          return global.OpenDkpApi.getTokenMeta().then(function (meta) {
            if (!meta.isActive) {
              throw new Error('API session expired. Click 🔑 to refresh, then try again.');
            }
            return loadCreateRaidSettings().then(function (settings) {
              var pool = findPoolForCreate(settings.pools, settings.preferredPoolId);
              if (!pool || !pool.id) {
                throw new Error('No pool cached. Open Settings and click Refresh pools once.');
              }
              var body = buildCreateRaidBody(name, settings, pool);
              return global.OpenDkpApi.putRaid(cfg, body).then(function (created) {
                var rid = created && (created.Id != null ? created.Id : created.RaidId);
                if (rid == null) throw new Error('Raid created but response had no id.');
                var ticksOut = (created.Ticks || []).map(function (t) {
                  return {
                    id: t.Id != null ? t.Id : t.TickId,
                    description: t.Description,
                    value: t.Value
                  };
                });
                var summary = { name: created.Name || name, ticks: ticksOut };
                return fetchRaidsList(cfg).then(function (payload) {
                  var raids = payload.raids;
                  var count = payload.count;
                  if (!raidIdInList(raids, rid)) {
                    raids = [{ Id: rid, Name: created.Name || name }].concat(raids);
                  }
                  raids = raids.slice(0, count);
                  populateRaidSelect(select, raids, rid, true, JSON.stringify(summary), count);
                  showCreateRaidUi(false);
                  return persistCurrentRaid(rid, summary).then(function () {
                    return refreshHint(hint);
                  });
                });
              });
            });
          });
        })
        .then(function () {
          if (opts.onRaidChanged) opts.onRaidChanged();
          return refreshQueueUi();
        })
        .catch(function (e) {
          showSessionMessage(hint, 'Create raid failed: ' + (e.message || e));
        })
        .then(function () {
          createBusy = false;
          if (createBtn) createBtn.disabled = false;
          if (select) select.disabled = false;
        });
    }

    if (createBtn) {
      createBtn.addEventListener('click', handleCreateRaid);
    }
    if (createNameInput) {
      createNameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleCreateRaid();
        }
      });
    }

    btn.addEventListener('click', handleSessionAction);

    getApi().storage.onChanged.addListener(function (changes, namespace) {
      if (namespace !== 'sync') return;
      if (changes.opendkpCurrentRaidId || changes.opendkpCurrentRaidSummaryJson) {
        storageSyncGet(['opendkpCurrentRaidId']).then(function (d) {
          var id = d.opendkpCurrentRaidId;
          showCreateRaidUi(false);
          if (id != null && select.querySelector('option[value="' + String(id) + '"]')) {
            select.value = String(id);
          } else if (select.value === CREATE_RAID_VALUE) {
            /* keep create mode */
          } else {
            select.value = '';
          }
          refreshHint(hint);
          refreshQueueUi();
        });
      }
      if (changes.opendkpClientSlug || changes.opendkpRaidListCount) {
        loadRaidsIntoSelect();
      }
    });

    updateSessionButtonLabel(btn).then(function () {
      return loadRaidsIntoSelect();
    });
  }

  global.PopupApiSession = {
    init: init,
    refreshHint: refreshHint
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
