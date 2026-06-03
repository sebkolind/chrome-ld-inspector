// Content script - injects script into main world and listens for messages
(async function() {
  const DEBUG_KEY = 'ldext_debug';

  // Check if debug mode is enabled
  async function isDebugEnabled() {
    const result = await chrome.storage.local.get([DEBUG_KEY]);
    return result[DEBUG_KEY] === true;
  }

  const debugMode = await isDebugEnabled();

  if (debugMode) {
    console.log('[LD Extension] Content script loaded');
  }

  // Load configuration to check if we should monitor this domain
  const config = await chrome.storage.sync.get(['config', 'launchDarkly']);

  // Check if extension is configured
  if (!config.config || !config.config.isConfigured) {
    if (debugMode) console.log('[LD Extension] Extension not configured, skipping');
    return;
  }

  // Check if current domain matches any configured patterns
  const currentUrl = window.location.href;
  const currentHostname = window.location.hostname;
  const targetDomains = config.config.targetDomains || [];

  const shouldMonitor = targetDomains.some(pattern => {
    // Convert wildcard pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')  // Escape dots
      .replace(/\*/g, '.*');  // Convert * to .*

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(currentHostname) || regex.test(currentUrl);
  });

  if (!shouldMonitor) {
    if (debugMode) console.log('[LD Extension] Current domain not in configured patterns, skipping');
    return;
  }

  if (debugMode) {
    console.log('[LD Extension] Monitoring domain:', currentHostname);
  }

  // Get LaunchDarkly URL detection patterns from config
  const urlDetectionPatterns = config.launchDarkly?.urlDetectionPatterns || ['launchdarkly', 'app.ld.', 'clientstream.launchdarkly'];

  // Check if chrome.runtime is available
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) {
    if (debugMode) console.warn('[LD Extension] Chrome runtime not fully available, using inline injection');
    injectInline(debugMode);
    setupMessageListener(debugMode);
    return;
  }

  try {
    // Pass debug flag and URL detection patterns via data attributes (works with strict CSP)
    document.documentElement.setAttribute('data-ld-debug', debugMode ? '1' : '0');
    document.documentElement.setAttribute('data-ld-patterns', JSON.stringify(urlDetectionPatterns));

    // Inject the main script
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
      if (debugMode) console.log('[LD Extension] Injected script loaded into page');
      this.remove();
    };
    script.onerror = function() {
      if (debugMode) console.error('[LD Extension] Failed to load injected script');
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (error) {
    if (debugMode) console.error('[LD Extension] Error injecting script:', error);
  }

  setupMessageListener(debugMode);

  // Inline injection fallback
  function injectInline(debugMode) {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        const DEBUG = ${debugMode};
        if (DEBUG) console.log('[LD Extension] Inline injected script loaded');

        // Read URL detection patterns from data attribute
        let urlPatterns = ${JSON.stringify(urlDetectionPatterns)};
        try {
          const patternsAttr = document.documentElement.getAttribute('data-ld-patterns');
          if (patternsAttr) {
            urlPatterns = JSON.parse(patternsAttr);
          }
        } catch (e) {
          // Use default if parsing fails
        }

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
            if (!response.ok) {
              if (DEBUG) console.log('[LD Extension] Skipping error response:', response.status);
              return response;
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              if (DEBUG) console.log('[LD Extension] Skipping non-JSON response');
              return response;
            }

            const clonedResponse = response.clone();

            try {
              const data = await clonedResponse.json();
              if (DEBUG) console.log('[LD Extension] Captured data:', data);

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

              if (this.status < 200 || this.status >= 300) {
                if (DEBUG) console.log('[LD Extension] Skipping error response:', this.status);
                return;
              }

              const contentType = this.getResponseHeader('content-type');
              if (!contentType || !contentType.includes('application/json')) {
                if (DEBUG) console.log('[LD Extension] Skipping non-JSON response');
                return;
              }

              if (!this.responseText || this.responseText.trim().length === 0) {
                if (DEBUG) console.log('[LD Extension] Skipping empty XHR response');
                return;
              }

              try {
                const data = JSON.parse(this.responseText);
                if (DEBUG) console.log('[LD Extension] Captured XHR data:', data);

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
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  function setupMessageListener(debugMode) {
    // Listen for messages from injected script
    window.addEventListener('message', function(event) {
      // Only accept messages from same origin
      if (event.source !== window) return;

      // Validate message structure
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type !== 'LD_FLAGS_FROM_PAGE') return;

      // Validate required fields exist and have correct types
      if (!event.data.data || typeof event.data.data !== 'object') return;
      if (typeof event.data.url !== 'string') return;
      if (typeof event.data.timestamp !== 'number') return;

      // Validate timestamp is reasonable (within last hour)
      const ageMs = Date.now() - event.data.timestamp;
      if (ageMs < 0 || ageMs > 3600000) return;

      if (debugMode) console.log('[LD Extension] Received flags from page:', event.data);

      // Forward to background script
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'LD_FLAGS_CAPTURED',
          data: event.data.data,
          url: event.data.url,
          timestamp: event.data.timestamp
        }).catch(() => {
          // Silently ignore errors
        });
      }
    });

    if (debugMode) console.log('[LD Extension] Listening for LaunchDarkly data');
  }
})();
