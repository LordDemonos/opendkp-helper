/**
 * Shared current-raid persistence for popup, background, and content scripts.
 */
(function (global) {
  'use strict';

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

  function persistCurrentRaid(id, summaryObj) {
    var payload = {
      opendkpCurrentRaidId: id == null ? null : Number(id),
      opendkpCurrentRaidSummaryJson: summaryObj ? JSON.stringify(summaryObj) : ''
    };
    return storageSyncGet(['opendkpClientSlug']).then(function (slugData) {
      return storageSyncSet(payload).then(function () {
        if (global.LootQueue && LootQueue.mirrorRaidContextToLocal) {
          return LootQueue.mirrorRaidContextToLocal(
            Object.assign({}, slugData, payload)
          );
        }
        return null;
      });
    }).then(function () {
      if (global.LootQueue && LootQueue.invalidateValidatedContextCache) {
        LootQueue.invalidateValidatedContextCache();
      }
    });
  }

  function formatRaidLabel(raid) {
    if (!raid) return '';
    var name =
      raid.Name != null ? String(raid.Name) : raid.name != null ? String(raid.name) : '';
    var id = raid.Id != null ? raid.Id : raid.id;
    if (name) return name;
    if (id != null) return 'Raid #' + id;
    return '';
  }

  global.RaidContext = {
    persistCurrentRaid: persistCurrentRaid,
    formatRaidLabel: formatRaidLabel
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
