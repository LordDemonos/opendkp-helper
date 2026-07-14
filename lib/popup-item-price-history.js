/**
 * Popup panel: past win history + SVG price chart for active auctions / item search.
 */
(function (global) {
  'use strict';

  var OPEN_DKP_COGNITO_CLIENT_ID = '2sq61k8dj39e309tnh5tm70dd4';
  var selectedKey = '';

  function getApi() {
    return typeof browser !== 'undefined' ? browser : chrome;
  }

  function $(id) {
    return document.getElementById(id);
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

  function itemKey(item) {
    if (!item) return '';
    if (item.auctionId != null) return 'a:' + item.auctionId;
    return 'n:' + String(item.itemName || '').toLowerCase();
  }

  function pickDefaultItem(items) {
    if (!items || !items.length) return null;
    var withEnd = items.filter(function (i) {
      return i.endTimestamp && !Number.isNaN(Date.parse(i.endTimestamp));
    });
    if (withEnd.length) {
      withEnd.sort(function (a, b) {
        return Date.parse(a.endTimestamp) - Date.parse(b.endTimestamp);
      });
      return withEnd[0];
    }
    return items[0];
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDkp(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return String(Math.round(n));
  }

  function formatTodayKey() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function mergeItemLists(lists) {
    var byKey = {};
    (lists || []).forEach(function (list) {
      (list || []).forEach(function (item) {
        if (!item || !item.itemName) return;
        var key = itemKey(item);
        if (!key) return;
        var prev = byKey[key];
        // Prefer bidding sources over loot-only when merging same item
        if (!prev) {
          byKey[key] = item;
          return;
        }
        var rank = { 'auto-bid': 3, 'active-api': 3, 'manual-dom': 2, loot: 1 };
        var prevRank = rank[prev.source] || 0;
        var nextRank = rank[item.source] || 0;
        if (nextRank >= prevRank) byKey[key] = Object.assign({}, prev, item);
      });
    });
    return Object.keys(byKey).map(function (k) {
      return byKey[k];
    });
  }

  function loadCharacterIdsAndNames() {
    return new Promise(function (resolve) {
      var api = getApi();
      if (!api.storage || !api.storage.local) return resolve({ ids: {}, names: [] });
      api.storage.local.get(['autoBidCharactersCache'], function (r) {
        var ids = {};
        var names = [];
        var cache = r && r.autoBidCharactersCache;
        if (cache && Array.isArray(cache.characters)) {
          cache.characters.forEach(function (c) {
            if (!c) return;
            if (c.id != null) ids[String(c.id)] = true;
            if (c.name) names.push(String(c.name).trim());
          });
        }
        resolve({ ids: ids, names: names });
      });
    }).then(function (roster) {
      if (roster.names.length || Object.keys(roster.ids).length) return roster;
      // Fall back to account characters via API if cache is empty
      return storageSyncGet(['opendkpClientSlug']).then(function (settings) {
        var slug = String(settings.opendkpClientSlug || '')
          .trim()
          .toLowerCase();
        if (!slug || !global.OpenDkpApi || !global.OpenDkpApi.getAccountCharacters) {
          return roster;
        }
        var cfg = ItemPriceHistory.buildApiConfig(slug);
        return global.OpenDkpApi.getAccountCharacters(cfg)
          .then(function (chars) {
            var list = Array.isArray(chars) ? chars : [];
            list.forEach(function (c) {
              if (!c) return;
              var id = c.Id != null ? c.Id : c.id != null ? c.id : c.CharacterId;
              var name = c.Name || c.name || c.CharacterName;
              if (id != null) roster.ids[String(id)] = true;
              if (name) roster.names.push(String(name).trim());
            });
            return roster;
          })
          .catch(function () {
            return roster;
          });
      });
    });
  }

  /**
   * All active auctions from the API (for the price-history dropdown).
   */
  function discoverFromActiveAuctions(clientSlug) {
    if (!clientSlug || !global.OpenDkpApi || !global.OpenDkpApi.getActiveAuctions) {
      return Promise.resolve([]);
    }
    var cfg = ItemPriceHistory.buildApiConfig(clientSlug);
    return loadCharacterIdsAndNames().then(function (roster) {
      return global.OpenDkpApi.getActiveAuctions(cfg)
        .then(function (body) {
          var auctions = [];
          if (Array.isArray(body)) auctions = body;
          else if (body && Array.isArray(body.Models)) auctions = body.Models;
          else if (body && Array.isArray(body.Auctions)) auctions = body.Auctions;
          else if (body && Array.isArray(body.BidResults)) auctions = body.BidResults;

          var nameSet = {};
          (roster.names || []).forEach(function (n) {
            nameSet[String(n).toLowerCase()] = true;
          });

          var found = [];
          auctions.forEach(function (auction) {
            if (!auction || typeof auction !== 'object') return;
            var itemName =
              (auction.Item && auction.Item.Name) ||
              auction.ItemName ||
              auction.Name ||
              '';
            itemName = ItemPriceHistory.sanitizeLookupItemName
              ? ItemPriceHistory.sanitizeLookupItemName(itemName)
              : String(itemName).trim();
            if (!itemName) return;

            var entry = {
              itemName: itemName,
              source: 'active-api'
            };
            var iid =
              auction.Item &&
              (auction.Item.ItemId != null ? auction.Item.ItemId : auction.Item.ItemID);
            if (iid != null) {
              var n = parseInt(String(iid), 10);
              if (!Number.isNaN(n) && n > 0) entry.itemId = n;
            }
            var aid = auction.AuctionId != null ? parseInt(String(auction.AuctionId), 10) : null;
            if (aid && !Number.isNaN(aid)) entry.auctionId = aid;
            if (auction.EndTimestamp) entry.endTimestamp = String(auction.EndTimestamp);

            var bids = Array.isArray(auction.Bids) ? auction.Bids : [];
            var myHigh = null;
            var myName = '';
            bids.forEach(function (bid) {
              if (!bid) return;
              var cid = bid.CharacterId != null ? String(bid.CharacterId) : '';
              var cname = String(bid.CharacterName || bid.Name || '').trim();
              var isMine =
                (cid && roster.ids[cid]) || (cname && nameSet[cname.toLowerCase()]);
              if (!isMine) return;
              var value = parseInt(String(bid.Value != null ? bid.Value : ''), 10);
              if (myHigh == null || (!Number.isNaN(value) && value > myHigh)) {
                myHigh = Number.isNaN(value) ? myHigh : value;
                myName = cname || myName;
              }
            });
            if (myName) {
              entry.characterName = myName;
              if (myHigh != null) entry.myHighBid = myHigh;
            }
            found.push(entry);
          });

          if (found.length && global.BidParticipation && BidParticipation.writeParticipation) {
            var mineOnly = found.filter(function (f) {
              return f.characterName;
            });
            if (mineOnly.length) {
              return BidParticipation.writeParticipation({
                clientSlug: clientSlug,
                items: mineOnly,
                replaceSource: 'active-api'
              })
                .catch(function () {})
                .then(function () {
                  return found;
                });
            }
          }
          return found;
        })
        .catch(function () {
          return [];
        });
    });
  }

  /**
   * Today's loot parser items — so raid leaders can check comps before queueing.
   */
  function discoverFromTodaysLoot() {
    return new Promise(function (resolve) {
      var api = getApi();
      if (!api.storage || !api.storage.sync) return resolve([]);
      api.storage.sync.get(['eqLogEvents'], function (r) {
        var events = (r && Array.isArray(r.eqLogEvents) ? r.eqLogEvents : []) || [];
        var today = formatTodayKey();
        // Also accept locale-ish dates used by the loot UI (formatDate in popup)
        var found = [];
        var seen = {};
        events.forEach(function (event) {
          if (!event) return;
          var dateOk =
            event.date === today ||
            (event.timestamp && String(event.timestamp).indexOf(String(new Date().getFullYear())) !== -1);
          // Prefer explicit today match when date field exists
          if (event.date && event.date !== today) {
            // popup formatDate may be YYYY-MM-DD — if not matching, skip
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(event.date))) {
              // Non-ISO date: include if timestamp is from today
              var ts = event.timestamp ? Date.parse(event.timestamp) : NaN;
              if (Number.isNaN(ts)) return;
              var td = new Date();
              var ed = new Date(ts);
              if (
                ed.getFullYear() !== td.getFullYear() ||
                ed.getMonth() !== td.getMonth() ||
                ed.getDate() !== td.getDate()
              ) {
                return;
              }
            } else {
              return;
            }
          }
          var items = Array.isArray(event.items) ? event.items : [];
          items.forEach(function (raw) {
            var name = String(raw || '').trim();
            if (ItemPriceHistory.sanitizeLookupItemName) {
              name = ItemPriceHistory.sanitizeLookupItemName(name);
            }
            if (!name || name.length < 2) return;
            var key = name.toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            found.push({ itemName: name, source: 'loot' });
          });
        });
        resolve(found);
      });
    });
  }

  function gatherCandidateItems(clientSlug, signedIn) {
    return BidParticipation.getActiveParticipation().then(function (snap) {
      var fromSnap = (snap && snap.items) || [];
      var apiPromise =
        signedIn && clientSlug ? discoverFromActiveAuctions(clientSlug) : Promise.resolve([]);
      return Promise.all([apiPromise, discoverFromTodaysLoot()]).then(function (parts) {
        return {
          items: mergeItemLists([fromSnap, parts[0], parts[1]]),
          clientSlug: (snap && snap.clientSlug) || clientSlug || ''
        };
      });
    });
  }

  /**
   * Compact SVG line chart of bid amounts over time (oldest → newest for left→right).
   * @param {HTMLElement} container
   * @param {object[]} wins newest-first
   * @param {number|null} estimate
   */
  function renderChart(container, wins, estimate) {
    if (!container) return;
    container.innerHTML = '';
    if (!wins || wins.length < 2) {
      container.hidden = true;
      return;
    }
    container.hidden = false;

    var chronological = wins.slice().reverse();
    var amounts = chronological.map(function (w) {
      return w.bidAmount;
    });
    var minY = Math.min.apply(null, amounts);
    var maxY = Math.max.apply(null, amounts);
    if (estimate != null) {
      minY = Math.min(minY, estimate);
      maxY = Math.max(maxY, estimate);
    }
    if (minY === maxY) {
      minY = Math.max(0, minY - 10);
      maxY = maxY + 10;
    }

    var width = 280;
    var height = 120;
    var padL = 28;
    var padR = 8;
    var padT = 10;
    var padB = 22;
    var plotW = width - padL - padR;
    var plotH = height - padT - padB;

    function xAt(i) {
      if (chronological.length === 1) return padL + plotW / 2;
      return padL + (i / (chronological.length - 1)) * plotW;
    }
    function yAt(v) {
      return padT + plotH - ((v - minY) / (maxY - minY)) * plotH;
    }

    /** Color vs estimate: below = low, near = mid, above = high. */
    function dotTone(amount) {
      if (estimate == null || Number.isNaN(estimate)) return 'mid';
      var band = Math.max(5, Math.round(estimate * 0.15));
      if (amount < estimate - band) return 'low';
      if (amount > estimate + band) return 'high';
      return 'mid';
    }

    var points = chronological
      .map(function (w, i) {
        return xAt(i).toFixed(1) + ',' + yAt(w.bidAmount).toFixed(1);
      })
      .join(' ');

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(height));
    svg.setAttribute('class', 'iph-chart-svg');
    svg.setAttribute('aria-hidden', 'true');

    if (estimate != null) {
      var guide = document.createElementNS(svgNS, 'line');
      guide.setAttribute('x1', String(padL));
      guide.setAttribute('x2', String(width - padR));
      guide.setAttribute('y1', yAt(estimate).toFixed(1));
      guide.setAttribute('y2', yAt(estimate).toFixed(1));
      guide.setAttribute('class', 'iph-chart-guide');
      svg.appendChild(guide);
    }

    var poly = document.createElementNS(svgNS, 'polyline');
    poly.setAttribute('points', points);
    poly.setAttribute('class', 'iph-chart-line');
    poly.setAttribute('fill', 'none');
    svg.appendChild(poly);

    chronological.forEach(function (w, i) {
      var c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', xAt(i).toFixed(1));
      c.setAttribute('cy', yAt(w.bidAmount).toFixed(1));
      c.setAttribute('r', '3.5');
      c.setAttribute('class', 'iph-chart-dot iph-chart-dot--' + dotTone(w.bidAmount));
      svg.appendChild(c);
    });

    var labelMin = document.createElementNS(svgNS, 'text');
    labelMin.setAttribute('x', '2');
    labelMin.setAttribute('y', String(yAt(minY) + 3));
    labelMin.setAttribute('class', 'iph-chart-axis');
    labelMin.textContent = String(Math.round(minY));
    svg.appendChild(labelMin);

    var labelMax = document.createElementNS(svgNS, 'text');
    labelMax.setAttribute('x', '2');
    labelMax.setAttribute('y', String(yAt(maxY) + 3));
    labelMax.setAttribute('class', 'iph-chart-axis');
    labelMax.textContent = String(Math.round(maxY));
    svg.appendChild(labelMax);

    var first = chronological[0];
    var last = chronological[chronological.length - 1];
    if (first && first.date) {
      var t0 = document.createElementNS(svgNS, 'text');
      t0.setAttribute('x', String(padL));
      t0.setAttribute('y', String(height - 4));
      t0.setAttribute('class', 'iph-chart-axis');
      t0.textContent = first.date;
      svg.appendChild(t0);
    }
    if (last && last.date && chronological.length > 1) {
      var t1 = document.createElementNS(svgNS, 'text');
      t1.setAttribute('x', String(width - padR));
      t1.setAttribute('y', String(height - 4));
      t1.setAttribute('text-anchor', 'end');
      t1.setAttribute('class', 'iph-chart-axis');
      t1.textContent = last.date;
      svg.appendChild(t1);
    }

    container.appendChild(svg);
  }

  function renderList(container, wins) {
    if (!container) return;
    if (!wins || !wins.length) {
      container.innerHTML = '<div class="iph-empty">No past wins found for this item.</div>';
      return;
    }
    var html = wins
      .map(function (w) {
        return (
          '<div class="iph-row">' +
          '<span class="iph-date">' +
          escapeHtml(w.date || '') +
          '</span>' +
          '<span class="iph-winner">' +
          escapeHtml(w.winnerName || '') +
          '</span>' +
          '<span class="iph-amount">' +
          escapeHtml(formatDkp(w.bidAmount)) +
          '</span>' +
          '</div>'
        );
      })
      .join('');
    container.innerHTML = html;
  }

  function hideSection() {
    var section = $('itemPriceHistorySection');
    if (section) section.style.display = 'none';
  }

  function showSection() {
    var section = $('itemPriceHistorySection');
    if (section) section.style.display = 'block';
  }

  function setHint(text, isError) {
    var hint = $('itemPriceHistoryHint');
    if (!hint) return;
    hint.textContent = text || '';
    hint.className = 'api-session-hint' + (isError ? ' api-session-hint-invalid' : '');
  }

  var SEARCH_VALUE = '__search__';

  function showSearchUi(show) {
    var row = $('itemPriceHistorySearchRow');
    if (!row) return;
    if (show) row.removeAttribute('hidden');
    else row.setAttribute('hidden', '');
  }

  function clearHistoryPanels(message) {
    var title = $('itemPriceHistoryTitle');
    var statsEl = $('itemPriceHistoryStats');
    var chartEl = $('itemPriceHistoryChart');
    var listEl = $('itemPriceHistoryList');
    if (title) title.textContent = '';
    if (statsEl) statsEl.innerHTML = '';
    if (chartEl) {
      chartEl.innerHTML = '';
      chartEl.hidden = true;
    }
    if (listEl) {
      listEl.innerHTML = message
        ? '<div class="iph-empty">' + escapeHtml(message) + '</div>'
        : '';
    }
  }

  function populateSwitcher(items, selectedKeyValue) {
    var wrap = $('itemPriceHistorySwitcher');
    var select = $('itemPriceHistorySelect');
    if (!wrap || !select) return;
    wrap.hidden = false;

    var opts = [];
    opts.push(
      '<option value="' +
        SEARCH_VALUE +
        '"' +
        (selectedKeyValue === SEARCH_VALUE ? ' selected' : '') +
        '>Search…</option>'
    );

    if (!items || !items.length) {
      opts.push('<option value="" disabled>— No active auctions —</option>');
    } else {
      items.forEach(function (item) {
        var key = itemKey(item);
        var clean =
          (ItemPriceHistory.sanitizeLookupItemName &&
            ItemPriceHistory.sanitizeLookupItemName(item.itemName)) ||
          item.itemName;
        var label = clean;
        if (item.characterName) label += ' (' + item.characterName + ')';
        opts.push(
          '<option value="' +
            escapeHtml(key) +
            '"' +
            (key === selectedKeyValue ? ' selected' : '') +
            '>' +
            escapeHtml(label) +
            '</option>'
        );
      });
    }
    select.innerHTML = opts.join('');
    if (selectedKeyValue === SEARCH_VALUE) select.value = SEARCH_VALUE;
    else if (selectedKeyValue) select.value = selectedKeyValue;
  }

  function resolveSearchQuery(cfg, rawQuery) {
    var clean =
      (ItemPriceHistory.sanitizeLookupItemName &&
        ItemPriceHistory.sanitizeLookupItemName(rawQuery)) ||
      String(rawQuery || '').trim();
    if (!clean) return Promise.reject(new Error('Enter an item name'));
    if (!global.OpenDkpApi || !global.OpenDkpApi.searchItemAutocomplete) {
      return Promise.resolve({ itemName: clean, itemId: undefined });
    }
    return global.OpenDkpApi.searchItemAutocomplete(cfg, clean, 8)
      .then(function (body) {
        var results = Array.isArray(body) ? body : body && Array.isArray(body.Models) ? body.Models : [];
        if (!results.length) return { itemName: clean, itemId: undefined };
        var needle = clean.toLowerCase();
        var best = null;
        for (var i = 0; i < results.length; i++) {
          var n = String(results[i].ItemName || results[i].Name || '').trim();
          if (n.toLowerCase() === needle) {
            best = results[i];
            break;
          }
        }
        if (!best) best = results[0];
        var name = String(best.ItemName || best.Name || clean).trim();
        var idRaw = best.ItemID != null ? best.ItemID : best.ItemId;
        var itemId = idRaw != null ? parseInt(String(idRaw), 10) : NaN;
        return {
          itemName: ItemPriceHistory.sanitizeLookupItemName
            ? ItemPriceHistory.sanitizeLookupItemName(name)
            : name,
          itemId: !Number.isNaN(itemId) && itemId > 0 ? itemId : undefined
        };
      })
      .catch(function () {
        return { itemName: clean, itemId: undefined };
      });
  }

  function renderHistoryForItem(item, clientSlug) {
    var title = $('itemPriceHistoryTitle');
    var statsEl = $('itemPriceHistoryStats');
    var chartEl = $('itemPriceHistoryChart');
    var listEl = $('itemPriceHistoryList');
    var cleanName =
      (ItemPriceHistory.sanitizeLookupItemName &&
        ItemPriceHistory.sanitizeLookupItemName(item.itemName)) ||
      item.itemName ||
      'Item';
    if (title) title.textContent = cleanName;
    setHint('Loading history…', false);
    if (listEl) listEl.innerHTML = '<div class="iph-empty">Loading…</div>';
    if (chartEl) {
      chartEl.innerHTML = '';
      chartEl.hidden = true;
    }
    if (statsEl) statsEl.textContent = '';

    var cfg = ItemPriceHistory.buildApiConfig(clientSlug);
    cfg.cognitoClientId = OPEN_DKP_COGNITO_CLIENT_ID;

    return ItemPriceHistory.fetchItemWinHistory(cfg, cleanName, {
      itemId: item.itemId,
      forceRefresh: cleanName !== String(item.itemName || '').trim()
    })
      .then(function (result) {
        var stats = result.stats || ItemPriceHistory.computeStats(result.wins || []);
        setHint(
          (result.meta && result.meta.fromCache ? 'Cached · ' : '') +
            stats.count +
            ' past win' +
            (stats.count === 1 ? '' : 's'),
          false
        );
        if (statsEl) {
          statsEl.innerHTML =
            '<span class="iph-est">Est. ~' +
            escapeHtml(formatDkp(stats.estimate)) +
            ' DKP</span>' +
            '<span class="iph-stat-sec">Last ' +
            escapeHtml(formatDkp(stats.last)) +
            ' · Med ' +
            escapeHtml(formatDkp(stats.median)) +
            ' · High ' +
            escapeHtml(formatDkp(stats.high)) +
            '</span>';
        }
        if (stats.count < 2) {
          if (chartEl) {
            chartEl.hidden = true;
            chartEl.innerHTML = '';
          }
          setHint(
            stats.count === 0
              ? 'No past wins found.'
              : 'Not enough history for a chart (need 2+ wins).',
            false
          );
        } else {
          renderChart(chartEl, result.wins, stats.estimate);
        }
        renderList(listEl, result.wins);
      })
      .catch(function (err) {
        setHint(err && err.message ? err.message : String(err), true);
        if (listEl) listEl.innerHTML = '<div class="iph-empty">Could not load history.</div>';
      });
  }

  function enterSearchMode(prompt) {
    selectedKey = SEARCH_VALUE;
    showSearchUi(true);
    clearHistoryPanels(prompt || 'Type an item name and press Search.');
    setHint('', false);
    var input = $('itemPriceHistorySearchInput');
    if (input) {
      setTimeout(function () {
        try {
          input.focus();
        } catch (_) {}
      }, 0);
    }
  }

  function runItemSearch(clientSlug) {
    var input = $('itemPriceHistorySearchInput');
    var raw = input ? String(input.value || '').trim() : '';
    if (!raw) {
      setHint('Enter an item name to search.', true);
      return Promise.resolve();
    }
    if (!clientSlug) {
      setHint('Set your guild subdomain in Settings.', true);
      return Promise.resolve();
    }
    selectedKey = SEARCH_VALUE;
    var cfg = ItemPriceHistory.buildApiConfig(clientSlug);
    cfg.cognitoClientId = OPEN_DKP_COGNITO_CLIENT_ID;
    setHint('Searching…', false);
    return resolveSearchQuery(cfg, raw).then(function (resolved) {
      return renderHistoryForItem(
        { itemName: resolved.itemName, itemId: resolved.itemId, source: 'search' },
        clientSlug
      );
    });
  }

  function refresh() {
    var section = $('itemPriceHistorySection');
    if (!section) return Promise.resolve();

    return storageSyncGet(['itemPriceHistoryEnabled', 'opendkpClientSlug']).then(function (settings) {
      if (settings.itemPriceHistoryEnabled === false) {
        hideSection();
        return;
      }
      if (!global.BidParticipation || !global.ItemPriceHistory) {
        hideSection();
        return;
      }

      var clientSlug = String(settings.opendkpClientSlug || '')
        .trim()
        .toLowerCase();

      return ItemPriceHistory.hasAuthToken().then(function (signedIn) {
        return gatherCandidateItems(clientSlug, signedIn).then(function (gathered) {
          var items = (gathered && gathered.items) || [];
          var slug = (gathered && gathered.clientSlug) || clientSlug;

          showSection();
          showSearchUi(selectedKey === SEARCH_VALUE);

          if (!signedIn) {
            populateSwitcher(items, selectedKey === SEARCH_VALUE ? SEARCH_VALUE : itemKey(items[0]));
            setHint('Sign in under Settings → Bidding to load price history.', true);
            clearHistoryPanels('');
            if (selectedKey === SEARCH_VALUE) showSearchUi(true);
            return;
          }

          if (!slug) {
            populateSwitcher(items, SEARCH_VALUE);
            enterSearchMode('Set your guild subdomain in Settings to load history.');
            setHint('Set your guild subdomain in Settings to load history.', true);
            return;
          }

          if (selectedKey === SEARCH_VALUE) {
            populateSwitcher(items, SEARCH_VALUE);
            showSearchUi(true);
            // Keep current results if any; otherwise prompt
            var title = $('itemPriceHistoryTitle');
            if (!title || !title.textContent) {
              clearHistoryPanels('Type an item name and press Search.');
            }
            return;
          }

          var selected =
            items.find(function (i) {
              return itemKey(i) === selectedKey;
            }) || pickDefaultItem(items);

          if (!selected) {
            populateSwitcher(items, SEARCH_VALUE);
            enterSearchMode('No active auctions — search for any item.');
            return;
          }

          selectedKey = itemKey(selected);
          showSearchUi(false);
          populateSwitcher(items, selectedKey);
          return renderHistoryForItem(selected, slug);
        });
      });
    });
  }

  function init() {
    var select = $('itemPriceHistorySelect');
    if (select && !select.dataset.iphWired) {
      select.dataset.iphWired = '1';
      select.addEventListener('change', function () {
        selectedKey = select.value || '';
        if (selectedKey === SEARCH_VALUE) {
          enterSearchMode('Type an item name and press Search.');
          refresh();
          return;
        }
        showSearchUi(false);
        refresh();
      });
    }

    var searchBtn = $('itemPriceHistorySearchBtn');
    var searchInput = $('itemPriceHistorySearchInput');
    if (searchBtn && !searchBtn.dataset.iphWired) {
      searchBtn.dataset.iphWired = '1';
      searchBtn.addEventListener('click', function () {
        storageSyncGet(['opendkpClientSlug']).then(function (settings) {
          var slug = String(settings.opendkpClientSlug || '')
            .trim()
            .toLowerCase();
          return runItemSearch(slug);
        });
      });
    }
    if (searchInput && !searchInput.dataset.iphWired) {
      searchInput.dataset.iphWired = '1';
      searchInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        storageSyncGet(['opendkpClientSlug']).then(function (settings) {
          var slug = String(settings.opendkpClientSlug || '')
            .trim()
            .toLowerCase();
          return runItemSearch(slug);
        });
      });
    }

    return refresh();
  }

  global.PopupItemPriceHistory = {
    init: init,
    refresh: refresh
  };
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
