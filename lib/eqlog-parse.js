/**
 * EQ log loot line parsing — raid/party/say channels (standard EQ tell formats).
 */
(function (global) {
  'use strict';

  var STANDARD_CHANNEL_RE =
    /^\[[^\]]+\]\s.*?(?:tells the raid|told the raid|tell the raid|tell your raid|told your raid|tell your party|tells your party|told your party|say),\s*['\u2018\u2019](.*)['\u2018\u2019]\s*$/i;

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeLogLine(line) {
    return String(line || '')
      .replace(/\r/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .trim();
  }

  /**
   * @param {string} line
   * @returns {string|null}
   */
  function extractQuotedMessage(line) {
    var normalized = normalizeLogLine(line);
    if (!normalized) return null;
    var standard = normalized.match(STANDARD_CHANNEL_RE);
    if (standard) return standard[1];
    return null;
  }

  /**
   * Tag may lead or trail the quoted loot message as its own word.
   * e.g. "FG Sword of Truth" or "Jacinth | Nilitim's Grimoire Pg. 378 FG"
   * @param {string} quoted
   * @param {string} tag
   */
  function quotedHasLootTag(quoted, tag) {
    if (!quoted || !tag) return false;
    var escaped = escapeRegex(tag);
    return new RegExp('^\\s*' + escaped + '\\b', 'i').test(quoted)
      || new RegExp('\\b' + escaped + '\\s*$', 'i').test(quoted);
  }

  /**
   * Remove a leading or trailing loot tag from the quoted message body.
   * @param {string} quoted
   * @param {string} tag
   * @returns {string}
   */
  function stripLootTag(quoted, tag) {
    if (!quoted || !tag) return String(quoted || '').trim();
    var escaped = escapeRegex(tag);
    return String(quoted)
      .replace(new RegExp('^\\n?\\r?\\t?\\uFEFF?\\s*' + escaped + '\\s*', 'i'), '')
      .replace(new RegExp('\\s*' + escaped + '\\s*$', 'i'), '')
      .trim();
  }

  /**
   * @param {string} line
   * @param {string} tag
   */
  function detectLootLine(line, tag) {
    if (!tag || !line) return false;
    var quoted = extractQuotedMessage(line);
    return quoted ? quotedHasLootTag(quoted, tag) : false;
  }

  /**
   * Parse a loot token like "Bat Wing (2)" → { name, quantity }.
   * Trailing (n) is stack count for OpenDKP ItemQuantity, not part of the item name.
   * @param {string} raw
   * @returns {{ name: string, quantity: number }}
   */
  function parseItemToken(raw) {
    var trimmed = String(raw || '').trim();
    if (!trimmed) return { name: '', quantity: 1 };
    var m = trimmed.match(/^(.+?)\s*\((\d+)\)\s*$/);
    if (m) {
      var qty = parseInt(m[2], 10);
      return {
        name: m[1].trim(),
        quantity: Number.isNaN(qty) || qty < 1 ? 1 : qty
      };
    }
    return { name: trimmed, quantity: 1 };
  }

  /**
   * @param {string} line
   * @param {string} tag
   * @returns {string[]}
   */
  function extractItems(line, tag) {
    if (!line || !tag) return [];
    var quoted = extractQuotedMessage(line);
    if (!quoted || !quotedHasLootTag(quoted, tag)) return [];
    var after = stripLootTag(quoted, tag);
    if (!after) return [];
    var hasPipe = after.indexOf('|') !== -1;
    var hasComma = after.indexOf(',') !== -1;
    var items;
    if (!hasPipe && !hasComma) {
      items = [after];
    } else {
      items = after.split(hasPipe ? '|' : ',').map(function (s) {
        return s.trim();
      });
    }
    return items.filter(Boolean);
  }

  /**
   * Normalize stored/text exception rules to a string array.
   * @param {string|string[]|null|undefined} raw
   * @returns {string[]}
   */
  function normalizeExceptionRules(raw) {
    if (Array.isArray(raw)) {
      return raw
        .map(function (r) {
          return String(r || '').trim();
        })
        .filter(Boolean);
    }
    return String(raw || '')
      .split(/\r?\n/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }

  /**
   * @param {string} itemName raw loot token e.g. "Spell: X" or "Bat Wing (2)"
   * @param {string[]} rules
   */
  function itemMatchesException(itemName, rules) {
    var list = normalizeExceptionRules(rules);
    if (!list.length) return false;
    var parsed = parseItemToken(itemName);
    var name = parsed.name;
    if (!name) return false;
    var lower = name.toLowerCase();
    for (var i = 0; i < list.length; i++) {
      var rule = list[i];
      var ruleLower = rule.toLowerCase();
      if (rule.slice(-1) === ':') {
        if (lower.indexOf(ruleLower) === 0) return true;
      } else if (lower === ruleLower) {
        return true;
      }
    }
    return false;
  }

  /**
   * Remove items matching loot monitor exception rules.
   * @param {string[]} items
   * @param {string|string[]} rules
   * @returns {string[]}
   */
  function filterExcludedItems(items, rules) {
    var list = normalizeExceptionRules(rules);
    if (!list.length) return (items || []).slice();
    return (items || []).filter(function (item) {
      return !itemMatchesException(item, list);
    });
  }

  /**
   * @param {string} line
   * @param {string} tag
   * @param {string|string[]} [exceptions]
   * @returns {string[]}
   */
  function extractItemsFiltered(line, tag, exceptions) {
    return filterExcludedItems(extractItems(line, tag), exceptions);
  }

  /**
   * Loose hint for debug logging — line might be loot-related.
   * @param {string} line
   */
  function looksLikeLootChannel(line) {
    var normalized = normalizeLogLine(line);
    if (!normalized) return false;
    return /tells the raid|told the raid|tell the raid|tell your raid|told your raid|tell your party|tells your party|told your party|say,/i.test(
      normalized
    );
  }

  global.EqLogParse = {
    detectLootLine: detectLootLine,
    extractItems: extractItems,
    extractItemsFiltered: extractItemsFiltered,
    extractQuotedMessage: extractQuotedMessage,
    looksLikeLootChannel: looksLikeLootChannel,
    normalizeLogLine: normalizeLogLine,
    normalizeExceptionRules: normalizeExceptionRules,
    itemMatchesException: itemMatchesException,
    filterExcludedItems: filterExcludedItems,
    parseItemToken: parseItemToken,
    quotedHasLootTag: quotedHasLootTag,
    stripLootTag: stripLootTag
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);

