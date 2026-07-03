(function () {
  'use strict';

  function getSlotIndex() {
    var params = new URLSearchParams(window.location.search);
    var slot = parseInt(params.get('slot') || '0', 10);
    return isNaN(slot) || slot < 0 ? 0 : slot;
  }

  function setStatus(msg) {
    var el = document.getElementById('status');
    if (el) el.textContent = msg;
  }

  function closeSoon(ms) {
    setTimeout(function () {
      window.close();
    }, ms);
  }

  function handleFiles(files) {
    var slotIndex = getSlotIndex();
    var file = files && files[0];
    if (!file) {
      setStatus('No file selected. Closing...');
      closeSoon(800);
      return;
    }
    if (!window.RaidTickQueue || !window.RaidTickQueue.queueFileForSlot) {
      setStatus('Queue module not loaded. Reload the extension and try again.');
      return;
    }

    setStatus('Reading ' + file.name + '...');
    var reader = new FileReader();
    reader.onload = function () {
      window.RaidTickQueue.queueFileForSlot(slotIndex, reader.result || '', file.name)
        .then(function (result) {
          setStatus(
            '✓ Queued tick ' +
              (result.slotIndex + 1) +
              ' (' +
              result.nameCount +
              ' names).\nReopen the extension popup to upload.'
          );
          closeSoon(1400);
        })
        .catch(function (e) {
          setStatus('❌ ' + (e && e.message ? e.message : String(e)));
        });
    };
    reader.onerror = function () {
      setStatus('❌ Could not read file.');
    };
    reader.readAsText(file);
  }

  function init() {
    var slotIndex = getSlotIndex();
    var titleEl = document.getElementById('title');
    if (titleEl) {
      titleEl.textContent = 'Queue RaidTick log for tick ' + (slotIndex + 1);
    }

    var pickBtn = document.getElementById('pick');
    var inputEl = document.getElementById('fileInput');
    if (pickBtn && inputEl) {
      pickBtn.addEventListener('click', function () {
        inputEl.click();
      });
      inputEl.addEventListener('change', function () {
        handleFiles(inputEl.files);
      });
    }

    setTimeout(function () {
      if (inputEl) inputEl.click();
    }, 50);
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    setTimeout(function () {
      window.close();
    }, 120000);
  });
})();
