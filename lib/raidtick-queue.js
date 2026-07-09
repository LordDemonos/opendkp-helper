/**
 * Popup raid-tick upload queue: pick log files per tick slot, batch POST to OpenDKP.
 */
(function (global) {
  'use strict';

  /** Set false to re-enable popup/settings raid log upload UI. */
  var RAIDTICK_UPLOAD_SUNSET = false;

  var OPEN_DKP_COGNITO_CLIENT_ID = '2sq61k8dj39e309tnh5tm70dd4';
  var OPEN_DKP_API_HOST = 'api.opendkp.com';
  var QUEUE_STORAGE_KEY = 'opendkpRaidtickUploadQueue';
  var ROSTER_CACHE_KEY = 'opendkpRosterCacheBySlug';

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

  function parseTickDkpValue(raw) {
    var n = parseInt(String(raw != null ? raw : '1'), 10);
    return isNaN(n) || n < 0 ? 1 : n;
  }

  function defaultTickDefs(fallbackDkp) {
    var value = parseTickDkpValue(fallbackDkp);
    return [
      { description: 'Hour #1', value: value },
      { description: 'Hour #2', value: value },
      { description: 'Hour #3', value: value }
    ];
  }

  function normalizeTickDefs(raw, fallbackDkp) {
    if (!Array.isArray(raw)) return defaultTickDefs(fallbackDkp);
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
    return out.length ? out : defaultTickDefs(fallbackDkp);
  }

  function readTickDefs() {
    return storageSyncGet(['opendkpRaidTickDefs', 'opendkpTickDkpValue']).then(function (data) {
      return normalizeTickDefs(data.opendkpRaidTickDefs, data.opendkpTickDkpValue);
    });
  }

  function readRosterForSlug(clientSlug) {
    var slug = normalizeClientSlug(clientSlug);
    if (!slug) return Promise.resolve({ map: {}, clientId: '' });
    return storageLocalGet([ROSTER_CACHE_KEY]).then(function (local) {
      var root = local[ROSTER_CACHE_KEY] || {};
      var entry = root[slug] || {};
      return {
        map: Object.assign({}, entry.map || {}),
        clientId: entry.clientId || ''
      };
    });
  }

  function queueStorageKey(raidId) {
    return String(raidId);
  }

  function loadQueueDocument(raidId) {
    if (raidId == null || raidId === '') return Promise.resolve({ slots: {} });
    return storageLocalGet([QUEUE_STORAGE_KEY]).then(function (local) {
      var all = local[QUEUE_STORAGE_KEY] || {};
      return all[queueStorageKey(raidId)] || { slots: {} };
    });
  }

  function saveQueueDocument(raidId, doc) {
    return storageLocalGet([QUEUE_STORAGE_KEY]).then(function (local) {
      var all = Object.assign({}, local[QUEUE_STORAGE_KEY] || {});
      all[queueStorageKey(raidId)] = doc;
      return storageLocalSet({ [QUEUE_STORAGE_KEY]: all });
    });
  }

  function readSessionContext() {
    return storageSyncGet([
      'opendkpClientSlug',
      'opendkpCurrentRaidId',
      'opendkpCurrentRaidSummaryJson'
    ]).then(function (data) {
      var cfg = buildApiConfig(data.opendkpClientSlug);
      var raidIdRaw = data.opendkpCurrentRaidId;
      var raidId =
        raidIdRaw == null || raidIdRaw === '' || Number.isNaN(Number(raidIdRaw))
          ? null
          : Number(raidIdRaw);
      var summary = parseRaidSummary(data.opendkpCurrentRaidSummaryJson);
      return global.OpenDkpApi.getTokenMeta().then(function (meta) {
        return {
          cfg: cfg,
          raidId: raidId,
          summary: summary,
          sessionActive: !!(meta && meta.isActive)
        };
      });
    });
  }

  function resolveTickId(summary, slotIndex) {
    var ticks = summary && summary.ticks ? summary.ticks : [];
    if (slotIndex < 0 || slotIndex >= ticks.length) return null;
    var t = ticks[slotIndex];
    if (!t || t.id == null || t.id === '') return null;
    return t.id;
  }

  /**
   * @returns {Promise<{ slotIndex: number, fileName: string, nameCount: number, names: string[] }>}
   */
  function queueFileForSlot(slotIndex, fileText, fileName) {
    if (!global.RaidTickParse) {
      return Promise.reject(new Error('RaidTick parse module not loaded.'));
    }
    return readSessionContext().then(function (ctx) {
      if (!ctx.sessionActive) {
        throw new Error('API session expired — click refresh on the raid row, then try again.');
      }
      if (ctx.raidId == null) {
        throw new Error('Select a current raid first.');
      }
      var parsed = RaidTickParse.parseRaidTickFileContent(fileText);
      var names = RaidTickParse.dedupeCharacterNames(parsed.characterNames);
      if (!names.length) {
        throw new Error('No player names found in that file.');
      }
      return readTickDefs().then(function (defs) {
        if (slotIndex < 0 || slotIndex >= defs.length) {
          throw new Error('Invalid tick slot.');
        }
        var tickId = resolveTickId(ctx.summary, slotIndex);
        if (tickId == null) {
          throw new Error(
            'Tick #' +
              (slotIndex + 1) +
              ' is missing on the current raid — refresh the raid or recreate it with matching tick defs.'
          );
        }
        var hash = RaidTickParse.simpleHash(names.join('|'));
        return loadQueueDocument(ctx.raidId).then(function (doc) {
          doc.slots = doc.slots || {};
          doc.slots[String(slotIndex)] = {
            tickId: tickId,
            tickDescription: defs[slotIndex].description,
            fileName: fileName || '',
            names: names,
            hash: hash,
            queuedAt: new Date().toISOString()
          };
          doc.updatedAt = new Date().toISOString();
          return saveQueueDocument(ctx.raidId, doc).then(function () {
            return {
              slotIndex: slotIndex,
              fileName: fileName || '',
              nameCount: names.length,
              names: names,
              tickDescription: defs[slotIndex].description
            };
          });
        });
      });
    });
  }

  function getQueuedSlots(raidId, tickCount) {
    return loadQueueDocument(raidId).then(function (doc) {
      var slots = doc.slots || {};
      var out = [];
      for (var i = 0; i < tickCount; i++) {
        var s = slots[String(i)];
        out.push(
          s
            ? {
                filled: true,
                fileName: s.fileName || '',
                nameCount: (s.names || []).length,
                tickDescription: s.tickDescription || ''
              }
            : { filled: false, fileName: '', nameCount: 0, tickDescription: '' }
        );
      }
      return out;
    });
  }

  function clearQueueForRaid(raidId) {
    if (raidId == null) return Promise.resolve();
    return loadQueueDocument(raidId).then(function () {
      return storageLocalGet([QUEUE_STORAGE_KEY]).then(function (local) {
        var all = Object.assign({}, local[QUEUE_STORAGE_KEY] || {});
        delete all[queueStorageKey(raidId)];
        return storageLocalSet({ [QUEUE_STORAGE_KEY]: all });
      });
    });
  }

  function stageNamesForSlot(raidId, slotIndex, tickId, tickDescription, names, fileName) {
    if (raidId == null || raidId === '') {
      return Promise.reject(new Error('Raid id is required.'));
    }
    if (!names || !names.length) {
      return Promise.reject(new Error('No player names to stage.'));
    }
    var hash = global.RaidTickParse
      ? RaidTickParse.simpleHash(names.join('|'))
      : String(names.length);
    return loadQueueDocument(raidId).then(function (doc) {
      doc.slots = doc.slots || {};
      doc.slots[String(slotIndex)] = {
        tickId: tickId,
        tickDescription: tickDescription || '',
        fileName: fileName || '',
        names: names.slice(),
        hash: hash,
        queuedAt: new Date().toISOString()
      };
      doc.updatedAt = new Date().toISOString();
      return saveQueueDocument(raidId, doc);
    });
  }

  function hydrateStageByTickId(raidId, tickSummary) {
    return loadQueueDocument(raidId).then(function (doc) {
      var out = {};
      var slots = doc.slots || {};
      (tickSummary || []).forEach(function (t, index) {
        var slot = slots[String(index)];
        if (!slot || !slot.names || !slot.names.length || t.id == null) return;
        out[String(t.id)] = {
          fileName: slot.fileName || '',
          names: slot.names.slice()
        };
      });
      return out;
    });
  }

  function formatApiError(e) {
    if (!e) return 'Request failed';
    var parts = [];
    if (e.status) parts.push('HTTP ' + e.status);
    var bodyMsg =
      e.body &&
      typeof e.body === 'object' &&
      (e.body.ErrorMessage || e.body.message || e.body.Message);
    if (bodyMsg && (!e.message || String(e.message).indexOf(String(bodyMsg)) === -1)) {
      parts.push(String(bodyMsg));
    } else if (e.message) {
      parts.push(e.message);
    }
    return parts.join(' — ') || 'Request failed';
  }

  function resolveTickIdFromRaidTicks(ticks, slotIndex, fallbackTickId) {
    var list = ticks || [];
    var pathId = global.RaidTickParse && global.RaidTickParse.tickPathId;
    if (slotIndex >= 0 && slotIndex < list.length && pathId) {
      var fromRaid = pathId(list[slotIndex]);
      if (fromRaid != null && fromRaid !== '') return fromRaid;
    }
    return fallbackTickId;
  }

  /**
   * POST all queued tick rosters to the current raid in one request.
   */
  function applyAllQueued() {
    if (!global.OpenDkpApi || !global.RaidTickParse) {
      return Promise.reject(new Error('OpenDKP API modules not loaded. Reload the extension.'));
    }
    return readSessionContext().then(function (ctx) {
      if (!ctx.sessionActive) {
        throw new Error('API session expired — click refresh, then try again.');
      }
      if (ctx.raidId == null) {
        throw new Error('Select a current raid first.');
      }
      if (!ctx.cfg.clientSlug) {
        throw new Error('Set guild subdomain in Settings.');
      }
      return readTickDefs().then(function (defs) {
        if (!defs.length) {
          throw new Error('Add at least one raid tick in Settings → OpenDKP API.');
        }
        return loadQueueDocument(ctx.raidId).then(function (doc) {
          var slots = doc.slots || {};
          var missing = [];
          for (var i = 0; i < defs.length; i++) {
            if (!slots[String(i)]) missing.push(i + 1);
          }
          if (missing.length) {
            throw new Error('Queue log files for tick(s): ' + missing.join(', '));
          }
          // Roster cache is optional: OpenDKP creates missing characters on update.
          return readRosterForSlug(ctx.cfg.clientSlug).then(function (roster) {
            return global.OpenDkpApi.getRaid(ctx.cfg, ctx.raidId).then(function (full) {
              var guildClientId = global.OpenDkpApi.resolveGuildClientId(
                full,
                roster && roster.clientId
              );
              if (!guildClientId) {
                throw new Error(
                  'Guild ClientId is missing from the raid response. Refresh the current raid and try again.'
                );
              }
              var namesBySlotIndex = [];
              for (var k = 0; k < defs.length; k++) {
                var slotNames = slots[String(k)] && slots[String(k)].names;
                namesBySlotIndex[k] = slotNames && slotNames.length ? slotNames : null;
              }
              var postBody = RaidTickParse.buildRaidUpdateBodyForQueuedTickRosters(
                full,
                namesBySlotIndex,
                (roster && roster.map) || {},
                guildClientId
              );
              return global.OpenDkpApi.postRaidUpdate(ctx.cfg, ctx.raidId, postBody, {
                clientId: guildClientId
              }).then(function () {
                var applied = defs.map(function (def, slotIndex) {
                  var slot = slots[String(slotIndex)] || {};
                  return {
                    slotIndex: slotIndex,
                    tickId: resolveTickIdFromRaidTicks(
                      full.Ticks,
                      slotIndex,
                      slot.tickId != null ? slot.tickId : resolveTickId(ctx.summary, slotIndex)
                    ),
                    nameCount: (slot.names || []).length,
                    description: slot.tickDescription || def.description || 'tick ' + (slotIndex + 1)
                  };
                });
                return clearQueueForRaid(ctx.raidId).then(function () {
                  return {
                    raidId: ctx.raidId,
                    raidName: ctx.summary && ctx.summary.name ? ctx.summary.name : '',
                    applied: applied
                  };
                });
              });
            });
          });
        });
      });
    });
  }

  var popupUiInitialized = false;
  var hiddenFileInput = null;
  var popupRenderGeneration = 0;

  function countNamesOnTick(tick) {
    if (!tick) return 0;
    if (global.RaidTickParse && global.RaidTickParse.extractCharactersFromExistingTick) {
      return global.RaidTickParse.extractCharactersFromExistingTick(tick).length;
    }
    if (Array.isArray(tick.Characters)) return tick.Characters.length;
    if (Array.isArray(tick.Attendees)) return tick.Attendees.length;
    return 0;
  }

  function mapQueuedSlotStates(queuedStates, defs) {
    return queuedStates.map(function (qs, idx) {
      return {
        queued: !!qs.filled,
        onServer: false,
        nameCount: qs.nameCount || 0,
        serverNameCount: 0,
        fileName: qs.fileName || '',
        tickDescription: qs.tickDescription || (defs[idx] && defs[idx].description) || ''
      };
    });
  }

  function getSlotDisplayStates(ctx, defs) {
    return getQueuedSlots(ctx.raidId, defs.length).then(function (queuedStates) {
      if (!global.OpenDkpApi || !global.OpenDkpApi.getRaid || ctx.raidId == null) {
        return mapQueuedSlotStates(queuedStates, defs);
      }
      return global.OpenDkpApi.getRaid(ctx.cfg, ctx.raidId)
        .then(function (full) {
          var ticks = full.Ticks || [];
          return defs.map(function (def, idx) {
            var qs = queuedStates[idx] || { filled: false, nameCount: 0, fileName: '' };
            var serverCount = idx < ticks.length ? countNamesOnTick(ticks[idx]) : 0;
            if (qs.filled) {
              return {
                queued: true,
                onServer: serverCount > 0,
                nameCount: qs.nameCount || 0,
                serverNameCount: serverCount,
                fileName: qs.fileName || '',
                tickDescription: qs.tickDescription || def.description || ''
              };
            }
            return {
              queued: false,
              onServer: serverCount > 0,
              nameCount: serverCount,
              serverNameCount: serverCount,
              fileName: '',
              tickDescription: def.description || ''
            };
          });
        })
        .catch(function () {
          return mapQueuedSlotStates(queuedStates, defs);
        });
    });
  }

  function buildSlotButtonMarkup(primaryHtml, slotIndex) {
    return (
      '<span class="api-raidtick-slot-body">' +
      primaryHtml +
      '<span class="api-raidtick-slot-label">#' +
      (slotIndex + 1) +
      '</span></span>'
    );
  }

  function setSlotButtonDisplay(btn, slotIndex, state) {
    if (!btn) return;
    state = state || {};
    var num = slotIndex + 1;
    var count = state.queued ? state.nameCount || 0 : state.serverNameCount || state.nameCount || 0;
    btn.classList.remove('api-raidtick-slot-queued', 'api-raidtick-slot-uploaded');

    if (state.queued && count > 0) {
      btn.classList.add('api-raidtick-slot-queued');
      btn.innerHTML = buildSlotButtonMarkup(
        '<span class="api-raidtick-slot-count">' + count + '</span>',
        slotIndex
      );
      btn.setAttribute(
        'aria-label',
        'Tick ' + num + ', ' + count + ' names queued — click to replace'
      );
      return;
    }

    if (state.onServer && count > 0) {
      btn.classList.add('api-raidtick-slot-uploaded');
      btn.innerHTML = buildSlotButtonMarkup(
        '<span class="api-raidtick-slot-count">' + count + '</span>',
        slotIndex
      );
      btn.setAttribute(
        'aria-label',
        'Tick ' + num + ', ' + count + ' names on OpenDKP — click to replace'
      );
      return;
    }

    btn.innerHTML = buildSlotButtonMarkup(
      '<span class="api-raidtick-slot-icon">+</span>',
      slotIndex
    );
    btn.setAttribute('aria-label', 'Pick log file for tick ' + num);
  }

  function ensureHiddenFileInput() {
    if (hiddenFileInput) return hiddenFileInput;
    hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = '.txt,text/plain';
    hiddenFileInput.style.display = 'none';
    document.body.appendChild(hiddenFileInput);
    return hiddenFileInput;
  }

  function setSlotButtonQueued(btn, slotIndex, filled, nameCount) {
    setSlotButtonDisplay(btn, slotIndex, {
      queued: !!filled,
      onServer: false,
      nameCount: nameCount || 0,
      serverNameCount: 0
    });
  }

  function showQueueHint(message, isError) {
    var hint = document.getElementById('apiSessionHint');
    if (!hint) return;
    hint.textContent = message || '';
    hint.classList.toggle('api-session-hint-invalid', !!isError);
    hint.classList.toggle('api-session-hint-queued', !isError && !!message);
  }

  function showQueueSummaryHint(states) {
    if (!states || !states.length) return;
    var queued = states.filter(function (s) {
      return s.queued;
    });
    var onServer = states.filter(function (s) {
      return !s.queued && s.onServer && (s.serverNameCount || s.nameCount) > 0;
    });
    if (queued.length) {
      var total = states.length;
      var msg =
        queued.length === total
          ? 'All ' + total + ' tick logs queued — click ⬆️ to upload.'
          : queued.length + ' of ' + total + ' tick logs queued — finish the rest, then click ⬆️.';
      showQueueHint(msg, false);
      return;
    }
    if (onServer.length) {
      var parts = states
        .map(function (s, idx) {
          if (s.queued || !s.onServer) return null;
          var count = s.serverNameCount || s.nameCount || 0;
          if (!count) return null;
          var label = s.tickDescription || 'Tick ' + (idx + 1);
          return label + ': ' + count;
        })
        .filter(Boolean)
        .join(' · ');
      showQueueHint(
        onServer.length === states.length
          ? 'All ticks uploaded — ' + parts
          : parts,
        false
      );
    }
  }

  function markSlotQueuedOptimistic(slotIndex, nameCount) {
    var slotsEl = document.getElementById('apiRaidtickSlotButtons');
    if (!slotsEl || !slotsEl.children[slotIndex]) return;
    setSlotButtonQueued(slotsEl.children[slotIndex], slotIndex, true, nameCount);
    showQueueHint('Reading tick ' + (slotIndex + 1) + '…', false);
  }

  function isRaidtickUploadEnabled() {
    if (RAIDTICK_UPLOAD_SUNSET) return Promise.resolve(false);
    return storageSyncGet(['opendkpRaidtickUploadEnabled']).then(function (data) {
      return !!data.opendkpRaidtickUploadEnabled;
    });
  }

  function renderPopupQueueUi() {
    var row = document.getElementById('apiRaidtickQueueRow');
    var slotsEl = document.getElementById('apiRaidtickSlotButtons');
    var uploadBtn = document.getElementById('apiRaidtickUploadBtn');
    if (!row || !slotsEl) return Promise.resolve();

    var generation = ++popupRenderGeneration;

    return isRaidtickUploadEnabled()
      .then(function (uploadEnabled) {
        if (generation !== popupRenderGeneration) return;
        if (!uploadEnabled) {
          row.style.display = 'none';
          return;
        }
        return readSessionContext().then(function (ctx) {
          if (generation !== popupRenderGeneration) return;
          return readTickDefs().then(function (defs) {
            if (generation !== popupRenderGeneration) return;
            var show = ctx.sessionActive && ctx.raidId != null && defs.length > 0;
            row.style.display = show ? 'flex' : 'none';
            if (!show) return;

            slotsEl.textContent = '';
            return getSlotDisplayStates(ctx, defs).then(function (states) {
              if (generation !== popupRenderGeneration) return;
              var allQueued = states.every(function (s) {
                return s.queued;
              });
              if (uploadBtn) uploadBtn.disabled = !allQueued;

              defs.forEach(function (def, idx) {
                var st = states[idx] || {
                  queued: false,
                  onServer: false,
                  nameCount: 0,
                  serverNameCount: 0,
                  tickDescription: def.description || ''
                };
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'icon-btn api-session-btn api-raidtick-slot-btn';
                setSlotButtonDisplay(btn, idx, st);
                var count = st.queued ? st.nameCount || 0 : st.serverNameCount || st.nameCount || 0;
                var title = (st.tickDescription || def.description || 'Tick ' + (idx + 1)) + ' — ';
                if (st.queued && count > 0) {
                  title += count + ' names queued';
                  if (st.fileName) title += ' (' + st.fileName + ')';
                  title += '. Click to replace.';
                } else if (st.onServer && count > 0) {
                  title += count + ' names on OpenDKP. Click to replace.';
                } else {
                  title += 'click to pick log file';
                }
                btn.title = title;
                btn.addEventListener('click', function () {
                  pickFileForSlot(idx);
                });
                slotsEl.appendChild(btn);
              });
              showQueueSummaryHint(states);
            });
          });
        });
      })
      .catch(function () {
        if (row) row.style.display = 'none';
      });
  }

  function openInlineFilePicker(slotIndex) {
    var input = ensureHiddenFileInput();
    input.value = '';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        markSlotQueuedOptimistic(slotIndex);
        queueFileForSlot(slotIndex, reader.result || '', file.name)
          .then(function (result) {
            markSlotQueuedOptimistic(slotIndex, result.nameCount);
            renderPopupQueueUi();
            showQueueHint(
              '✓ Queued tick ' +
                (result.slotIndex + 1) +
                ' (' +
                result.nameCount +
                ' names) — ' +
                (result.fileName || 'file'),
              false
            );
          })
          .catch(function (e) {
            renderPopupQueueUi();
            showQueueHint('', false);
            showQueueHint(e && e.message ? e.message : String(e), true);
          });
      };
      reader.onerror = function () {
        showQueueHint('Could not read file.', true);
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function pickFileForSlot(slotIndex) {
    var api = getApi();
    if (api.windows && api.windows.create && api.runtime && api.runtime.getURL) {
      var url =
        api.runtime.getURL('raidtick-pick-window.html?slot=' + encodeURIComponent(slotIndex));
      showQueueHint('Pick a file in the picker window for tick ' + (slotIndex + 1) + '…', false);
      api.windows
        .create({
          url: url,
          type: 'popup',
          width: 420,
          height: 240
        })
        .catch(function () {
          openInlineFilePicker(slotIndex);
        });
      return;
    }
    openInlineFilePicker(slotIndex);
  }

  function initPopupUi() {
    if (popupUiInitialized) {
      renderPopupQueueUi();
      return;
    }
    popupUiInitialized = true;

    var uploadBtn = document.getElementById('apiRaidtickUploadBtn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', function () {
        if (uploadBtn.disabled) return;
        uploadBtn.disabled = true;
        uploadBtn.textContent = '⏳';
        applyAllQueued()
          .then(function (result) {
            var summaryParts = (result.applied || []).map(function (a) {
              var label = a.description || 'Tick ' + (a.slotIndex + 1);
              return label + ': ' + (a.nameCount || 0);
            });
            var hint = document.getElementById('apiSessionHint');
            if (hint) {
              hint.textContent =
                'Uploaded ' +
                result.applied.length +
                ' tick(s) to raid #' +
                result.raidId +
                (summaryParts.length ? ' — ' + summaryParts.join(' · ') : '');
              hint.classList.remove('api-session-hint-invalid');
              hint.classList.add('api-session-hint-queued');
            }
            if (global.PopupApiSession && PopupApiSession.refreshHint) {
              PopupApiSession.refreshHint(hint);
            }
          })
          .catch(function (e) {
            showQueueHint('Upload failed: ' + formatApiError(e), true);
          })
          .then(function () {
            uploadBtn.textContent = '⬆️';
            renderPopupQueueUi();
          });
      });
    }

    var api = getApi();
    if (api.storage && api.storage.onChanged) {
      api.storage.onChanged.addListener(function (changes, area) {
        if (
          area === 'sync' &&
          (changes.opendkpCurrentRaidId ||
            changes.opendkpRaidTickDefs ||
            changes.opendkpRaidtickUploadEnabled)
        ) {
          renderPopupQueueUi();
        }
        if (area === 'local' && changes[QUEUE_STORAGE_KEY]) {
          renderPopupQueueUi();
        }
      });
    }

    renderPopupQueueUi();
  }

  global.RaidTickQueue = {
    RAIDTICK_UPLOAD_SUNSET: RAIDTICK_UPLOAD_SUNSET,
    queueFileForSlot: queueFileForSlot,
    applyAllQueued: applyAllQueued,
    getQueuedSlots: getQueuedSlots,
    clearQueueForRaid: clearQueueForRaid,
    stageNamesForSlot: stageNamesForSlot,
    hydrateStageByTickId: hydrateStageByTickId,
    readSessionContext: readSessionContext,
    renderPopupQueueUi: renderPopupQueueUi,
    initPopupUi: initPopupUi
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
