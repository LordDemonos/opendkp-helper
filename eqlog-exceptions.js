(function () {
  'use strict';

  var api = typeof browser !== 'undefined' ? browser : chrome;

  var DEFAULT_RULES = ['Spell:', 'A Glowing Orb of Luclinite'];

  function parseRules(text) {
    if (window.EqLogParse && EqLogParse.normalizeExceptionRules) {
      return EqLogParse.normalizeExceptionRules(text);
    }
    return String(text || '')
      .split(/\r?\n/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }

  function rulesToText(rules) {
    return (rules || []).join('\n');
  }

  async function loadRules() {
    var data = await api.storage.sync.get(['eqLogLootExceptions']);
    var rules = Array.isArray(data.eqLogLootExceptions) ? data.eqLogLootExceptions : DEFAULT_RULES.slice();
    var input = document.getElementById('rulesInput');
    if (input) input.value = rulesToText(rules);
  }

  function setStatus(msg) {
    var el = document.getElementById('status');
    if (el) el.textContent = msg || '';
  }

  async function saveRules() {
    var input = document.getElementById('rulesInput');
    var rules = parseRules(input ? input.value : '');
    await api.storage.sync.set({ eqLogLootExceptions: rules });
    setStatus('Saved ' + rules.length + ' rule(s).');
    setTimeout(function () {
      setStatus('');
    }, 2500);
  }

  function init() {
    loadRules();
    var saveBtn = document.getElementById('saveRules');
    if (saveBtn) saveBtn.addEventListener('click', saveRules);
    var resetBtn = document.getElementById('resetDefaults');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        var input = document.getElementById('rulesInput');
        if (input) input.value = rulesToText(DEFAULT_RULES);
        setStatus('Defaults loaded — click Save to apply.');
      });
    }
    api.storage.onChanged.addListener(function (changes, area) {
      if (area === 'sync' && changes.eqLogLootExceptions) {
        var input = document.getElementById('rulesInput');
        if (input) {
          input.value = rulesToText(changes.eqLogLootExceptions.newValue || []);
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
