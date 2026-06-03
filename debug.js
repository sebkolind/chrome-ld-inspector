// Debug utility - centralized logging control
const DEBUG_KEY = 'ldext_debug';

// Check if debug mode is enabled
async function isDebugEnabled() {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const result = await chrome.storage.local.get([DEBUG_KEY]);
    return result[DEBUG_KEY] === true;
  }
  return false;
}

// Log only if debug is enabled
async function debugLog(...args) {
  if (await isDebugEnabled()) {
    console.log(...args);
  }
}

// For inline/injected scripts that can't use async chrome.storage
function debugLogSync(storageKey, ...args) {
  // Will be replaced at injection time with actual value
  if (window.__LD_DEBUG_MODE__) {
    console.log(...args);
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { debugLog, isDebugEnabled };
}
