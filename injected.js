// This script runs in the main page context to intercept fetch/XHR
(function() {
  // Read debug flag from data attribute set by content script
  const DEBUG = document.documentElement.getAttribute('data-ld-debug') === '1';

  if (DEBUG) console.log('[LD Extension] Injected script loaded');

  // Read URL detection patterns from data attribute
  let urlPatterns = ['launchdarkly', 'app.ld.', 'clientstream.launchdarkly']; // Default fallback
  try {
    const patternsAttr = document.documentElement.getAttribute('data-ld-patterns');
    if (patternsAttr) {
      urlPatterns = JSON.parse(patternsAttr);
      if (DEBUG) console.log('[LD Extension] Loaded URL patterns:', urlPatterns);
    }
  } catch (e) {
    if (DEBUG) console.warn('[LD Extension] Failed to parse URL patterns, using defaults');
  }

  // Helper function to check if URL is LaunchDarkly
  function isLaunchDarklyUrl(url) {
    if (!url) return false;
    return urlPatterns.some(pattern => url.includes(pattern));
  }

  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

    if (url && isLaunchDarklyUrl(url)) {
      if (DEBUG) console.log('[LD Extension] 🎯 Intercepted LaunchDarkly fetch:', url);
    }

    const response = await originalFetch.apply(this, args);

    if (url && isLaunchDarklyUrl(url)) {
      // Add status validation
      if (!response.ok) {
        if (DEBUG) console.log('[LD Extension] Skipping error response:', response.status);
        return response;
      }

      // Add Content-Type validation
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        if (DEBUG) console.log('[LD Extension] Skipping non-JSON response');
        return response;
      }

      const clonedResponse = response.clone();

      try {
        const data = await clonedResponse.json();
        if (DEBUG) console.log('[LD Extension] Captured data:', data);

        // Send to content script via custom event
        window.postMessage({
          type: 'LD_FLAGS_FROM_PAGE',
          data: data,
          url: url,
          timestamp: Date.now()
        }, '*');
      } catch (error) {
        if (DEBUG) console.error('[LD Extension] Error parsing response:', error);
      }
    }

    return response;
  };

  // Intercept XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._url = url;
    this._method = method;

    if (url && isLaunchDarklyUrl(url)) {
      if (DEBUG) console.log('[LD Extension] 🎯 Intercepted LaunchDarkly XHR:', method, url);
    }

    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (this._url && isLaunchDarklyUrl(this._url)) {
      const handleResponse = function() {
        if (DEBUG) console.log('[LD Extension] XHR loaded:', this.status);

        // Status validation (200-299 range)
        if (this.status < 200 || this.status >= 300) {
          if (DEBUG) console.log('[LD Extension] Skipping error response:', this.status);
          return;
        }

        // Content-Type validation
        const contentType = this.getResponseHeader('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          if (DEBUG) console.log('[LD Extension] Skipping non-JSON response');
          return;
        }

        // Skip empty responses
        if (!this.responseText || this.responseText.trim().length === 0) {
          if (DEBUG) console.log('[LD Extension] Skipping empty XHR response');
          return;
        }

        try {
          const data = JSON.parse(this.responseText);
          if (DEBUG) console.log('[LD Extension] Captured XHR data:', data);

          // Send to content script via custom event
          window.postMessage({
            type: 'LD_FLAGS_FROM_PAGE',
            data: data,
            url: this._url,
            timestamp: Date.now()
          }, '*');
        } catch (error) {
          if (DEBUG) console.log('[LD Extension] Skipping non-JSON XHR response');
        }
      };

      // Use {once: true} to auto-remove listener after firing
      this.addEventListener('load', handleResponse, {once: true});
      this.addEventListener('error', function() {
        if (DEBUG) console.log('[LD Extension] XHR error');
      }, {once: true});
      this.addEventListener('abort', function() {
        if (DEBUG) console.log('[LD Extension] XHR aborted');
      }, {once: true});
    }

    return originalSend.apply(this, args);
  };

  if (DEBUG) console.log('[LD Extension] Injection complete - monitoring LaunchDarkly calls');
})();
