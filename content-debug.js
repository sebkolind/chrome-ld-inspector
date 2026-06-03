// Debug version of content script with extensive logging
(function() {
  console.log('[LD Extension DEBUG] Content script loaded at:', new Date().toISOString());
  console.log('[LD Extension DEBUG] Current URL:', window.location.href);

  let fetchCount = 0;
  let xhrCount = 0;

  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    fetchCount++;
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

    // Log ALL fetches for debugging
    console.log(`[LD Extension DEBUG] Fetch #${fetchCount}:`, url?.substring(0, 100));

    if (url && (url.includes('launchdarkly') || url.includes('ld.com'))) {
      console.log('[LD Extension DEBUG] 🎯 LAUNCHDARKLY FETCH DETECTED!', {
        url: url,
        args: args
      });
    }

    const response = await originalFetch.apply(this, args);

    if (url && (url.includes('launchdarkly') || url.includes('ld.com'))) {
      console.log('[LD Extension DEBUG] LaunchDarkly response received:', {
        status: response.status,
        statusText: response.statusText,
        url: url
      });

      const clonedResponse = response.clone();

      try {
        const data = await clonedResponse.json();
        console.log('[LD Extension DEBUG] LaunchDarkly response JSON:', data);

        // Send to background script
        chrome.runtime.sendMessage({
          type: 'LD_FLAGS_CAPTURED',
          data: data,
          url: url,
          timestamp: Date.now()
        }).then(() => {
          console.log('[LD Extension DEBUG] Message sent to background successfully');
        }).catch(err => {
          console.error('[LD Extension DEBUG] Error sending message:', err);
        });
      } catch (error) {
        console.error('[LD Extension DEBUG] Error parsing JSON:', error);
        console.log('[LD Extension DEBUG] Response text:', await clonedResponse.text());
      }
    }

    return response;
  };

  // Intercept XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    xhrCount++;
    this._url = url;
    this._method = method;

    console.log(`[LD Extension DEBUG] XHR #${xhrCount} open:`, method, url?.substring(0, 100));

    if (url && (url.includes('launchdarkly') || url.includes('ld.com'))) {
      console.log('[LD Extension DEBUG] 🎯 LAUNCHDARKLY XHR DETECTED!', {
        method: method,
        url: url
      });
    }

    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (this._url && (this._url.includes('launchdarkly') || this._url.includes('ld.com'))) {
      this.addEventListener('load', function() {
        console.log('[LD Extension DEBUG] LaunchDarkly XHR loaded:', {
          status: this.status,
          url: this._url
        });

        try {
          const data = JSON.parse(this.responseText);
          console.log('[LD Extension DEBUG] LaunchDarkly XHR response JSON:', data);

          chrome.runtime.sendMessage({
            type: 'LD_FLAGS_CAPTURED',
            data: data,
            url: this._url,
            timestamp: Date.now()
          }).then(() => {
            console.log('[LD Extension DEBUG] Message sent to background successfully');
          }).catch(err => {
            console.error('[LD Extension DEBUG] Error sending message:', err);
          });
        } catch (error) {
          console.error('[LD Extension DEBUG] Error parsing XHR JSON:', error);
          console.log('[LD Extension DEBUG] Response text:', this.responseText?.substring(0, 500));
        }
      });
    }

    return originalSend.apply(this, args);
  };

  console.log('[LD Extension DEBUG] Interception setup complete');
  console.log('[LD Extension DEBUG] Monitoring all fetch and XHR requests');

  // Log summary every 5 seconds
  setInterval(() => {
    console.log(`[LD Extension DEBUG] Summary - Fetch: ${fetchCount}, XHR: ${xhrCount}`);
  }, 5000);
})();
