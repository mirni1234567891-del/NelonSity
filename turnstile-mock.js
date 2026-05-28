// Mock Cloudflare Turnstile for offline use
// Must run BEFORE the main bundle
(function () {
  const FAKE_TOKEN = 'offline-mock-token-bypass';

  // Map to store callbacks registered by react-turnstile per container id
  var pendingCallbacks = {};

  // Override turnstile global — react-turnstile calls window.turnstile.render()
  window.turnstile = {
    render: function (container, params) {
      // Hide the widget container
      var el = typeof container === 'string'
        ? document.querySelector(container)
        : container;
      if (el) {
        el.style.display = 'none';
        el.style.height = '0';
        el.style.overflow = 'hidden';
      }
      // Call the success callback immediately with a fake token
      if (params && typeof params.callback === 'function') {
        setTimeout(function () { params.callback(FAKE_TOKEN); }, 50);
      }
      return 'mock-widget-id';
    },
    reset: function (widgetId) {},
    remove: function (widgetId) {},
    getResponse: function () { return FAKE_TOKEN; },
    isExpired: function () { return false; },
    execute: function (container, params) {
      if (params && typeof params.callback === 'function') {
        setTimeout(function () { params.callback(FAKE_TOKEN); }, 50);
      }
    },
  };

  // Suppress the Cloudflare script load
  window.onloadTurnstileCallback = function () {};

  // Block dynamic <script> tags pointing to Cloudflare challenges
  var _origCreateElement = document.createElement.bind(document);
  document.createElement = function (tag) {
    var el = _origCreateElement(tag);
    if (tag.toLowerCase() === 'script') {
      var srcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      Object.defineProperty(el, 'src', {
        configurable: true,
        set: function (val) {
          if (typeof val === 'string' && val.includes('challenges.cloudflare.com')) {
            // Don't load — just fire the onload callback after a tick
            setTimeout(function () {
              if (typeof window.onloadTurnstileCallback === 'function') {
                window.onloadTurnstileCallback();
              }
            }, 50);
            return;
          }
          srcDescriptor.set.call(this, val);
        },
        get: function () {
          return srcDescriptor.get.call(this);
        }
      });
    }
    return el;
  };

  // MutationObserver: watch for Turnstile widget divs being added to DOM
  // react-turnstile creates a div with data-sitekey attribute
  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        // Check the node itself and its children for turnstile containers
        var candidates = [node].concat(Array.from(node.querySelectorAll ? node.querySelectorAll('[data-sitekey]') : []));
        candidates.forEach(function (el) {
          if (el.getAttribute && el.getAttribute('data-sitekey')) {
            // This is a turnstile widget container — hide it
            el.style.display = 'none';
            el.style.height = '0';
            el.style.overflow = 'hidden';
          }
        });
      });
    });
  });

  // Start observing once DOM is ready
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
})();
