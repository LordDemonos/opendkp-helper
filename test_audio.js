// Test audio script - moved from inline script in test_audio.html

document.addEventListener('DOMContentLoaded', function() {
  const testBtn = document.getElementById('testBtn');
  const status = document.getElementById('status');
  
  if (testBtn && status) {
    testBtn.addEventListener('click', testAudio);
  }
  
  function testAudio() {
    if (!status) return;
    status.innerHTML = 'Note: This test file is obsolete. Use the test buttons in the options page instead.';
    
    // Old test code for chime.wav/chime.mp3 removed - these files no longer exist
    // The "chime" sound key now maps to hotel.mp3
    // Use the options page test buttons to test sounds
  }
});

