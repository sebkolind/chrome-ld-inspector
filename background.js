// Background service worker to intercept LaunchDarkly network requests

// Import configuration utilities
importScripts('config.js');

const DEBUG_KEY = 'ldext_debug';

// Check if debug mode is enabled
async function isDebugEnabled() {
  const result = await chrome.storage.local.get([DEBUG_KEY]);
  return result[DEBUG_KEY] === true;
}

// Store LD project info (will be populated from config or auto-detected)
let ldProjectKey = null;
let ldEnvironmentKey = null;

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'LD_FLAGS_CAPTURED') {
    // Load configuration
    const config = await getConfig();

    // Check if extension is configured
    if (!config.config.isConfigured) {
      const debugMode = await isDebugEnabled();
      if (debugMode) console.warn('[LD Extension] Extension not configured, skipping flag processing');
      return;
    }

    // Try to extract project/env from URL if not explicitly configured
    const url = message.url || '';
    const sdkUrlPattern = config.launchDarkly.sdkUrlPattern || '/sdk/evalx/';

    // Build regex pattern from configured SDK URL pattern
    // Example: /sdk/evalx/ -> /\/sdk\/evalx\/([^\/]+)\/([^\/]+)/
    const escapedPattern = sdkUrlPattern.replace(/\//g, '\\/');
    const regex = new RegExp(`${escapedPattern}([^\\/]+)\\/([^\\/]+)`);
    const match = url.match(regex);

    if (match && match.length >= 3) {
      // Auto-detected values
      const detectedProjectKey = match[1];
      const detectedEnvironmentKey = match[2];

      // Use explicitly configured values if available, otherwise use auto-detected
      ldProjectKey = config.launchDarkly.projectKey || detectedProjectKey;
      ldEnvironmentKey = config.launchDarkly.environmentKey || detectedEnvironmentKey;

      chrome.storage.local.set({ ldProjectKey, ldEnvironmentKey }).catch(async (error) => {
        const debugMode = await isDebugEnabled();
        if (debugMode) console.error('[LD Extension] Storage error:', error);
      });
    } else if (config.launchDarkly.projectKey) {
      // Use explicitly configured project key if URL extraction failed
      ldProjectKey = config.launchDarkly.projectKey;
      ldEnvironmentKey = config.launchDarkly.environmentKey;
    }

    processLaunchDarklyData(message.data, message.timestamp);
  }
});

// Process LaunchDarkly flag data
async function processLaunchDarklyData(data, timestamp) {
  const debugMode = await isDebugEnabled();

  try {
    if (debugMode) console.log('[LD Extension] Processing data:', data);
    const flags = [];

    // LaunchDarkly evalx responses can have various structures:
    // 1. Direct flags object: { "flagKey": { value: ..., version: ... }, ... }
    // 2. Nested under a property: { flags: { ... } }
    // 3. Array of flag objects: [{ key: ..., value: ... }, ...]

    let flagsData = data;

    // Check if flags are nested
    if (data.flags && typeof data.flags === 'object') {
      flagsData = data.flags;
      if (debugMode) console.log('[LD Extension] Found nested flags object');
    }

    // Get existing flags to track changes
    const existing = await chrome.storage.local.get(['ldFlags', 'flagTimestamps']);
    const existingFlags = existing.ldFlags || [];
    const flagTimestamps = existing.flagTimestamps || {};

    if (typeof flagsData === 'object' && flagsData !== null) {
      // Handle object with flag keys
      for (const [key, flagData] of Object.entries(flagsData)) {
        let flagObj = {
          key: key
        };

        if (flagData && typeof flagData === 'object') {
          // Full flag object with metadata
          if ('value' in flagData) {
            flagObj.value = flagData.value;
            flagObj.version = flagData.version;
            flagObj.variation = flagData.variation;
            flagObj.trackEvents = flagData.trackEvents;
          } else {
            // Try to extract value from other common structures
            flagObj.value = flagData.current || flagData.default || flagData;
          }
        } else {
          // Simple key-value pair: { "flagKey": value }
          flagObj.value = flagData;
        }

        // Check if value changed
        const existingFlag = existingFlags.find(f => f.key === key);
        if (!existingFlag || JSON.stringify(existingFlag.value) !== JSON.stringify(flagObj.value)) {
          // Value changed or new flag
          flagTimestamps[key] = timestamp;
        }

        flagObj.lastChanged = flagTimestamps[key] || timestamp;
        flags.push(flagObj);
      }
    } else if (Array.isArray(flagsData)) {
      // Handle array of flag objects
      flagsData.forEach(flag => {
        if (flag.key) {
          const flagObj = {
            key: flag.key,
            value: flag.value !== undefined ? flag.value : flag
          };

          // Check if value changed
          const existingFlag = existingFlags.find(f => f.key === flag.key);
          if (!existingFlag || JSON.stringify(existingFlag.value) !== JSON.stringify(flagObj.value)) {
            flagTimestamps[flag.key] = timestamp;
          }

          flagObj.lastChanged = flagTimestamps[flag.key] || timestamp;
          flags.push(flagObj);
        }
      });
    }

    if (debugMode) console.log('[LD Extension] Extracted flags:', flags);

    if (flags.length > 0) {
      try {
        // Store flags in chrome.storage
        await chrome.storage.local.set({
          ldFlags: flags,
          lastUpdated: timestamp,
          flagTimestamps: flagTimestamps
        });

        if (debugMode) console.log(`[LD Extension] Stored ${flags.length} LaunchDarkly flags`);

        // Notify popup if it's open
        chrome.runtime.sendMessage({ type: 'FLAGS_UPDATED' }).catch(() => {
          // Popup might not be open, ignore error
        });
      } catch (error) {
        if (debugMode) console.error('[LD Extension] Storage error:', error);

        // If quota exceeded, try to clear old data
        if (error.message && error.message.includes('QUOTA_EXCEEDED')) {
          if (debugMode) console.warn('[LD Extension] Storage quota exceeded, clearing old data');
          try {
            // Keep only the most recent 100 flags
            const limitedFlags = flags.slice(0, 100);
            await chrome.storage.local.set({
              ldFlags: limitedFlags,
              lastUpdated: timestamp,
              flagTimestamps: flagTimestamps
            });
          } catch (retryError) {
            // Even this failed, give up
            if (debugMode) console.error('[LD Extension] Failed to store even limited flags:', retryError);
          }
        }
      }
    } else {
      if (debugMode) console.warn('[LD Extension] No flags extracted from data structure');
    }
  } catch (error) {
    if (debugMode) console.error('[LD Extension] Error processing LaunchDarkly data:', error);
  }
}

// Inject content script into all tabs on extension load and handle installation
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Fresh install - set unconfigured state
    await chrome.storage.sync.set({
      config: {
        targetDomains: [],
        isConfigured: false,
        version: 1
      }
    });
  } else if (details.reason === 'update') {
    // Extension updated - preserve existing configuration
    const debugMode = await isDebugEnabled();
    if (debugMode) console.log(`[LD Extension] Updated from ${details.previousVersion} to ${chrome.runtime.getManifest().version}`);

    // Invalidate config cache to ensure fresh data is loaded
    invalidateCache();
  }

  // Inject content script into all existing tabs
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).catch(() => {
          // Ignore errors for restricted pages
        });
      }
    });
  });
});

// Inject content script when navigating to new pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).catch(() => {
      // Ignore errors for restricted pages
    });
  }
});
