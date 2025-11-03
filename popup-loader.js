// Load the appropriate popup script based on browser
// The loaded script will handle initialization (checking if DOM is ready)

(function() {
  const scriptSrc = typeof browser !== 'undefined' ? 'popup-firefox.js' : 'popup.js';
  
  const script = document.createElement('script');
  script.src = scriptSrc;
  document.body.appendChild(script);
})();

