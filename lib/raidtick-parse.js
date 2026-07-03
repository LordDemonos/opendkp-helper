/**
 * RaidTick .txt helpers: parse local file content and build POST /raids/{id} bodies.
 * No network I/O. Update payload matches InsertOrUpdateRaid/Function.cs (not Postman).
 */
(function (global) {
  'use strict';

  function isRaidTickHeaderLine(line) {
    var words = String(line || '')
      .trim()
      .split(/\s+/)
      .map(function (w) {
        return w.toLowerCase();
      });
    return (
      words.length >= 5 &&
      words[0] === 'player' &&
      words[1] === 'level' &&
      words[2] === 'class' &&
      words[3] === 'timestamp' &&
      words[4] === 'points'
    );
  }

  function isRaidTickMetadataLine(line) {
    var t = String(line || '').trim();
    if (!t) return true;
    if (/^raidtick/i.test(t)) return true;
    if (/^date:/i.test(t)) return true;
    if (/^time:/i.test(t)) return true;
    return false;
  }

  /**
   * Zeal /outputfile raidlist lines are tab-separated:
   * Player\tLevel\tClass\tTimestamp\tPoints
   * Older/simple files may be one character name per line.
   * @param {string} line
   * @returns {string} player name, or '' if header/metadata/empty
   */
  function extractPlayerNameFromLine(line) {
    var trimmed = String(line || '').replace(/^\uFEFF/, '').trim();
    if (!trimmed || isRaidTickMetadataLine(trimmed) || isRaidTickHeaderLine(trimmed)) {
      return '';
    }
    var cols = trimmed.split('\t');
    if (cols.length > 1) {
      return cols[0].trim();
    }
    return trimmed;
  }

  /**
   * @param {string} text — full file contents
   * @returns {{ lines: string[], characterNames: string[] }}
   */
  function parseRaidTickFileContent(text) {
    var raw = String(text || '');
    var lines = raw
      .split(/\r?\n/)
      .map(function (l) {
        return l.replace(/^\uFEFF/, '');
      })
      .filter(function (l) {
        return l.trim().length > 0;
      });
    var characterNames = [];
    lines.forEach(function (line) {
      var name = extractPlayerNameFromLine(line);
      if (name) characterNames.push(name);
    });
    return { lines: lines.slice(), characterNames: characterNames };
  }

  function tickPathId(t) {
    if (t == null) return '';
    if (t.TickId != null) return t.TickId;
    if (t.Id != null) return t.Id;
    return '';
  }

  function coerceCharacterId(id) {
    if (id == null || id === '') return 0;
    var n = typeof id === 'number' ? id : parseInt(String(id), 10);
    return !isNaN(n) && n > 0 ? n : 0;
  }

  /**
   * Map character name (from tick file) to OpenDKP roster id.
   * @param {string} name
   * @param {Record<string, number|string>} map — lowercased name -> CharacterId
   */
  function rosterMapEntryId(entry) {
    if (entry == null) return 0;
    if (typeof entry === 'object') return coerceCharacterId(entry.id != null ? entry.id : entry.CharacterId);
    return coerceCharacterId(entry);
  }

  function rosterMapEntryName(entry, fallbackName) {
    if (entry && typeof entry === 'object') {
      var canonical = entry.name != null ? entry.name : entry.Name;
      if (canonical != null && String(canonical).trim()) return String(canonical).trim();
    }
    return String(fallbackName || '').trim();
  }

  function resolveCharacterId(name, map) {
    if (!name || !map) return 0;
    var key = String(name).trim().toLowerCase();
    return rosterMapEntryId(map[key]);
  }

  function resolveCharacterName(name, map) {
    if (!name || !map) return String(name || '').trim();
    var key = String(name).trim().toLowerCase();
    return rosterMapEntryName(map[key], name);
  }

  /**
   * @param {string[]} characterNames
   * @param {Record<string, number|string>} nameToId
   * @returns {{ mapped: Array<{name: string, characterId: number}>, unmapped: string[] }}
   */
  function auditRosterMapping(characterNames, nameToId) {
    nameToId = nameToId || {};
    var mapped = [];
    var unmapped = [];
    (characterNames || []).forEach(function (nm) {
      var trimmed = String(nm).trim();
      var id = resolveCharacterId(trimmed, nameToId);
      if (id > 0) mapped.push({ name: trimmed, characterId: id });
      else if (trimmed) unmapped.push(trimmed);
    });
    return { mapped: mapped, unmapped: unmapped };
  }

  function coerceTickValue(value) {
    if (value == null || value === '') return value;
    var n = parseFloat(String(value));
    return isNaN(n) ? value : n;
  }

  function dedupeCharacterNames(names) {
    var seen = {};
    var out = [];
    (names || []).forEach(function (nm) {
      var trimmed = String(nm).trim();
      var key = trimmed.toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(trimmed);
    });
    return out;
  }

  function normalizeItemsForServerPost(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map(function (item) {
        if (!item || typeof item !== 'object') return null;
        var characterName = String(item.CharacterName || item.Name || '').trim();
        var itemName = String(item.ItemName || '').trim();
        if (!characterName || !itemName) return null;
        var itemId = item.ItemID != null ? item.ItemID : item.ItemId != null ? item.ItemId : null;
        var row = {
          CharacterName: characterName,
          ItemName: itemName,
          DkpValue: item.DkpValue != null ? item.DkpValue : item.Dkp != null ? item.Dkp : 0
        };
        if (itemId != null) row.ItemID = coerceCharacterId(itemId);
        return row;
      })
      .filter(Boolean);
  }

  function buildAttendeeNameStrings(characterNames, nameToId) {
    var invalid = [];
    var attendees = dedupeCharacterNames(characterNames).map(function (nm) {
      var characterId = resolveCharacterId(nm, nameToId);
      if (!characterId) invalid.push(nm);
      return String(resolveCharacterName(nm, nameToId)).trim().toLowerCase();
    });
    if (invalid.length) {
      throw new Error(
        invalid.length +
          ' name(s) have no CharacterId after roster lookup: ' +
          invalid.slice(0, 6).join(', ') +
          (invalid.length > 6 ? '…' : '')
      );
    }
    if (!attendees.length) {
      throw new Error('Tick roster is empty after parsing the log file.');
    }
    return attendees;
  }

  function extractAttendeesFromExistingTick(tick) {
    if (!tick || typeof tick !== 'object') return [];
    if (Array.isArray(tick.Attendees)) {
      return tick.Attendees.map(function (name) {
        return String(name || '').trim();
      }).filter(Boolean);
    }
    if (Array.isArray(tick.Characters)) {
      return tick.Characters.map(function (c) {
        return String((c && (c.Name != null ? c.Name : c.name)) || '').trim();
      }).filter(Boolean);
    }
    return [];
  }

  function validateRaidUpdatePostBody(body) {
    if (!body || typeof body !== 'object') {
      throw new Error('Update raid POST body is missing.');
    }
    if (!coerceCharacterId(body.IdRaid)) {
      throw new Error('Update raid POST body is missing IdRaid.');
    }
    if (!body.Pool || !coerceCharacterId(body.Pool.IdPool)) {
      throw new Error('Update raid POST body is missing Pool.IdPool.');
    }
    var ticks = body.Ticks || [];
    if (!ticks.length) {
      throw new Error('Update raid POST body must include all raid ticks.');
    }
    ticks.forEach(function (tick, tickIdx) {
      if (!coerceCharacterId(tick.TickId != null ? tick.TickId : tick.Id)) {
        throw new Error('Tick #' + (tickIdx + 1) + ' is missing TickId.');
      }
      if (!Array.isArray(tick.Attendees)) {
        throw new Error('Tick #' + (tickIdx + 1) + ' is missing Attendees.');
      }
      if (!tick.Attendees.length) {
        var label = tick.Description || 'Tick #' + (tickIdx + 1);
        throw new Error(
          label +
            ' has no attendees. OpenDKP requires every tick on the raid to have a roster — queue all tick logs before uploading, or fill the other ticks on OpenDKP first.'
        );
      }
    });
    return body;
  }

  function buildTickPostEntryForServerUpdate(existingTick, attendeeNames) {
    var tid = tickPathId(existingTick);
    return {
      TickId: coerceCharacterId(tid) || tid,
      Value: String(coerceTickValue(existingTick.Value != null ? existingTick.Value : 1)),
      Description: existingRaidDescription(existingTick),
      Attendees: attendeeNames || []
    };
  }

  function existingRaidDescription(tick) {
    return tick && tick.Description != null ? String(tick.Description) : '';
  }

  function normalizeRaidTimestamp(timestamp) {
    if (!timestamp) return new Date().toISOString();
    // Round-trip the raid timestamp from GET unchanged; mutating timezone suffixes can 500.
    return String(timestamp).trim();
  }

  function normalizePoolForServerPost(pool) {
    pool = pool || {};
    return {
      Name: pool.Name || '',
      Description: pool.Description || '',
      IdPool: coerceCharacterId(
        pool.IdPool != null ? pool.IdPool : pool.PoolId != null ? pool.PoolId : pool.Id
      ),
      Order: pool.Order != null ? pool.Order : 0
    };
  }

  function resolveRaidId(existingRaid) {
    if (!existingRaid || typeof existingRaid !== 'object') return 0;
    return coerceCharacterId(
      existingRaid.IdRaid != null
        ? existingRaid.IdRaid
        : existingRaid.Id != null
          ? existingRaid.Id
          : existingRaid.RaidId
    );
  }

  function resolveUpdatedBy(existingRaid, updatedByFallback) {
    var updatedBy = String(updatedByFallback || existingRaid.UpdatedBy || '').trim();
    if (!updatedBy) {
      throw new Error('UpdatedBy is missing — sign in to OpenDKP API and try again.');
    }
    return updatedBy;
  }

  function assembleRaidUpdateBody(existingRaid, allTicks, updatedByFallback) {
    var pool = normalizePoolForServerPost(existingRaid.Pool);
    if (!pool.IdPool) {
      throw new Error('Raid pool is missing IdPool; refresh the current raid and try again.');
    }

    var raidId = resolveRaidId(existingRaid);
    if (!raidId) {
      throw new Error('Raid is missing IdRaid; refresh the current raid and try again.');
    }

    var body = {
      IdRaid: raidId,
      Name: existingRaid.Name || '',
      Timestamp: normalizeRaidTimestamp(existingRaid.Timestamp),
      UpdatedBy: resolveUpdatedBy(existingRaid, updatedByFallback),
      UpdatedTimestamp: new Date().toISOString(),
      Pool: pool,
      Items: normalizeItemsForServerPost(existingRaid.Items || []),
      Ticks: allTicks
    };
    if (existingRaid.Attendance != null) {
      body.Attendance = Number(existingRaid.Attendance) === 0 ? 0 : 1;
    }
    return validateRaidUpdatePostBody(body);
  }

  function attendeeStringsFromExistingTick(tick) {
    return extractAttendeesFromExistingTick(tick).map(function (name) {
      return String(name).trim().toLowerCase();
    });
  }

  /**
   * Build POST body updating all tick rosters from queued slot files (one POST for the whole raid).
   * @param {object} existingRaid
   * @param {string[][]} namesBySlotIndex — parallel to existingRaid.Ticks / queue slots
   * @param {Record<string, number|string>} [nameToId]
   * @param {string} [updatedByFallback]
   */
  function buildRaidUpdateBodyForQueuedTickRosters(
    existingRaid,
    namesBySlotIndex,
    nameToId,
    updatedByFallback
  ) {
    nameToId = nameToId || {};
    namesBySlotIndex = namesBySlotIndex || [];
    var ticks = existingRaid.Ticks || [];
    if (!ticks.length) {
      throw new Error('Current raid has no ticks to update.');
    }

    var allTicks = ticks.map(function (tick, index) {
      var queuedNames = namesBySlotIndex[index];
      var attendees =
        queuedNames && queuedNames.length
          ? buildAttendeeNameStrings(queuedNames, nameToId)
          : attendeeStringsFromExistingTick(tick);
      return buildTickPostEntryForServerUpdate(tick, attendees);
    });

    return assembleRaidUpdateBody(existingRaid, allTicks, updatedByFallback);
  }

  /**
   * Build POST body for Update Raid, replacing one tick's roster from parsed names.
   * Server requires all ticks on the raid; omitted ticks are deleted.
   * @param {object} existingRaid — GET raid by id response
   * @param {string|number} targetTickId
   * @param {string[]} characterNames — one name per line from file
   * @param {Record<string, number|string>} [nameToId] — optional roster map
   * @param {string} [updatedByFallback] — Cognito username for UpdatedBy
   */
  function buildRaidUpdateBodyForTickRoster(
    existingRaid,
    targetTickId,
    characterNames,
    nameToId,
    updatedByFallback
  ) {
    nameToId = nameToId || {};
    var ticks = existingRaid.Ticks || [];
    var existingTarget = null;
    for (var i = 0; i < ticks.length; i++) {
      if (String(tickPathId(ticks[i])) === String(targetTickId)) {
        existingTarget = ticks[i];
        break;
      }
    }
    if (!existingTarget) {
      throw new Error('Target tick ' + targetTickId + ' was not found on the current raid.');
    }

    var targetAttendees = buildAttendeeNameStrings(characterNames, nameToId);
    var allTicks = ticks.map(function (tick) {
      var tid = tickPathId(tick);
      var attendees =
        String(tid) === String(targetTickId)
          ? targetAttendees
          : attendeeStringsFromExistingTick(tick);
      return buildTickPostEntryForServerUpdate(tick, attendees);
    });

    return assembleRaidUpdateBody(existingRaid, allTicks, updatedByFallback);
  }

  /**
   * Parse RaidTick-YYYY-MM-DD_HH-mm-ss from filename (Phase 3 auto-match).
   * @param {string} filename
   * @returns {{ date: Date | null, key: string | null }}
   */
  function parseRaidTickFilenameTimestamp(filename) {
    var base = String(filename || '').replace(/^.*[\\/]/, '');
    var m = base.match(/RaidTick-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/i);
    if (!m) return { date: null, key: null };
    var y = parseInt(m[1], 10);
    var mon = parseInt(m[2], 10) - 1;
    var d = parseInt(m[3], 10);
    var h = parseInt(m[4], 10);
    var min = parseInt(m[5], 10);
    var s = parseInt(m[6], 10);
    var date = new Date(Date.UTC(y, mon, d, h, min, s));
    if (isNaN(date.getTime())) return { date: null, key: null };
    return { date: date, key: m[0] };
  }

  /**
   * Stable hash for idempotency (extension-only; not cryptographic).
   * @param {string} s
   */
  function simpleHash(s) {
    var h = 5381;
    var str = String(s || '');
    for (var i = 0; i < str.length; i++) {
      h = (h * 33) ^ str.charCodeAt(i);
    }
    return String(h >>> 0);
  }

  global.RaidTickParse = {
    parseRaidTickFileContent: parseRaidTickFileContent,
    buildRaidUpdateBodyForTickRoster: buildRaidUpdateBodyForTickRoster,
    buildRaidUpdateBodyForQueuedTickRosters: buildRaidUpdateBodyForQueuedTickRosters,
    parseRaidTickFilenameTimestamp: parseRaidTickFilenameTimestamp,
    simpleHash: simpleHash,
    tickPathId: tickPathId,
    auditRosterMapping: auditRosterMapping,
    validateRaidUpdatePostBody: validateRaidUpdatePostBody,
    extractAttendeesFromExistingTick: extractAttendeesFromExistingTick,
    resolveCharacterName: resolveCharacterName,
    coerceCharacterId: coerceCharacterId,
    dedupeCharacterNames: dedupeCharacterNames,
    extractPlayerNameFromLine: extractPlayerNameFromLine,
    isRaidTickHeaderLine: isRaidTickHeaderLine
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
