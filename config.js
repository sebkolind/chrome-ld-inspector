// Configuration management utilities for the extension

// Default configuration schema
const DEFAULT_CONFIG = {
  config: {
    trackedDomains: [],         // Array of exact hostnames that are allowed to be tracked
    version: 2
  },
  launchDarkly: {
    projectKey: null,           // Required: user must configure their LD project key
    environmentKey: null,       // Optional: environment key for reference
    dashboardUrl: 'https://app.launchdarkly.com',
    sdkUrlPattern: '/sdk/evalx/',
    urlDetectionPatterns: [
      'launchdarkly',
      'app.ld.',
      'clientstream.launchdarkly'
    ]
  }
};

// Configuration cache
let configCache = null;

// Get configuration from storage (with caching)
async function getConfig() {
  if (configCache) {
    return configCache;
  }

  const stored = await chrome.storage.sync.get(['config', 'launchDarkly']);

  configCache = {
    config: stored.config || DEFAULT_CONFIG.config,
    launchDarkly: stored.launchDarkly || DEFAULT_CONFIG.launchDarkly
  };

  return configCache;
}

// Invalidate cache (call when configuration changes)
function invalidateCache() {
  configCache = null;
}

// Save configuration to storage
async function saveConfig(newConfig) {
  // Validate before saving
  const validation = validateConfig(newConfig);
  if (!validation.valid) {
    throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
  }

  await chrome.storage.sync.set({
    config: newConfig.config,
    launchDarkly: newConfig.launchDarkly
  });

  invalidateCache();
  return true;
}

// Check if a domain is tracked (exact match)
function isDomainTracked(hostname, trackedDomains) {
  if (!trackedDomains || trackedDomains.length === 0) {
    return false;
  }
  return trackedDomains.includes(hostname);
}

// Get default configuration
function getDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

// Validate configuration
function validateConfig(config) {
  const errors = [];

  // Validate config section
  if (!config.config) {
    errors.push('Missing config section');
  } else {
    // Validate trackedDomains
    if (!Array.isArray(config.config.trackedDomains)) {
      errors.push('trackedDomains must be an array');
    } else {
      // Validate each domain (should be exact hostname, no wildcards)
      config.config.trackedDomains.forEach((domain, index) => {
        if (typeof domain !== 'string' || domain.trim().length === 0) {
          errors.push(`Domain at index ${index} is invalid`);
        } else if (domain.includes('*')) {
          errors.push(`Domain at index ${index} contains wildcards (not supported in v2)`);
        }
      });
    }
  }

  // Validate launchDarkly section
  if (!config.launchDarkly) {
    errors.push('Missing launchDarkly section');
  } else {
    // Validate dashboardUrl
    if (config.launchDarkly.dashboardUrl) {
      try {
        const url = new URL(config.launchDarkly.dashboardUrl);
        if (url.protocol !== 'https:') {
          errors.push('Dashboard URL must use HTTPS');
        }
      } catch (e) {
        errors.push('Dashboard URL is not a valid URL');
      }
    }

    // Validate sdkUrlPattern
    if (config.launchDarkly.sdkUrlPattern && typeof config.launchDarkly.sdkUrlPattern !== 'string') {
      errors.push('sdkUrlPattern must be a string');
    }

    // Validate urlDetectionPatterns
    if (!Array.isArray(config.launchDarkly.urlDetectionPatterns)) {
      errors.push('urlDetectionPatterns must be an array');
    } else if (config.launchDarkly.urlDetectionPatterns.length === 0) {
      errors.push('At least one URL detection pattern is required');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}


// Check if a URL is a LaunchDarkly URL based on configured patterns
function isLaunchDarklyUrl(url, patterns) {
  if (!url || !patterns) {
    return false;
  }

  return patterns.some(pattern => url.includes(pattern));
}

// Listen for configuration changes and invalidate cache
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && (changes.config || changes.launchDarkly)) {
      invalidateCache();
    }
  });
}

// Export functions (for use in other scripts)
if (typeof module !== 'undefined' && module.exports) {
  // Node.js environment (for testing)
  module.exports = {
    getConfig,
    saveConfig,
    isDomainTracked,
    getDefaultConfig,
    validateConfig,
    isLaunchDarklyUrl,
    invalidateCache
  };
}
