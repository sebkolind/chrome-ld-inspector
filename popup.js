// LaunchDarkly Inspector - shadcn/ui styled

let allFlags = [];
let currentTheme = 'light';
let debugMode = false;
let extensionConfig = null;

// Initialize
async function init() {
  // Load full configuration
  extensionConfig = await chrome.storage.sync.get(['config', 'launchDarkly']);

  await initTheme();
  await initDebugMode();

  // Check banner and get whether domain is tracked
  const isDomainTracked = await checkAndShowTrackingBanner();

  // Only load flags if domain is tracked
  if (isDomainTracked) {
    await loadFlags();
  }

  setupEventListeners();
  startAutoRefresh();
}

// Check if current domain needs tracking banner
async function checkAndShowTrackingBanner() {
  try {
    // Get current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return false;

    const currentTab = tabs[0];
    if (!currentTab.url) return false;

    // Skip chrome:// and extension pages
    if (currentTab.url.startsWith('chrome://') || currentTab.url.startsWith('chrome-extension://')) {
      return false;
    }

    const url = new URL(currentTab.url);
    const hostname = url.hostname;

    // Get current config
    const config = await chrome.storage.sync.get(['config', 'launchDarkly']);
    const trackedDomains = config.config?.trackedDomains || [];

    // Check if domain is already tracked
    if (trackedDomains.includes(hostname)) {
      // Domain is tracked, show search/stats
      document.querySelector('.input-wrapper').style.display = '';
      document.querySelector('.stats').style.display = '';
      return true; // Domain IS tracked
    }

    // Domain is not tracked, show tracking prompt
    // Hide search and stats sections
    document.querySelector('.input-wrapper').style.display = 'none';
    document.querySelector('.stats').style.display = 'none';

    // Show tracking prompt in content area
    allFlags = [];
    document.getElementById('content').innerHTML = `
      <div class="tracking-prompt">
        <div class="tracking-prompt-text">
          Current domain is not tracked. Would you like to start tracking? The page will reload after clicking "Allow".
        </div>
        <div class="tracking-prompt-actions">
          <button id="allowDomainBtn" class="btn btn-sm btn-primary">Allow</button>
          <button id="denyDomainBtn" class="btn btn-sm btn-secondary">Deny</button>
        </div>
      </div>
    `;
    updateStats([]);

    // Re-attach event listeners since we replaced the HTML
    document.getElementById('allowDomainBtn').addEventListener('click', handleAllowDomain);
    document.getElementById('denyDomainBtn').addEventListener('click', handleDenyDomain);

    // Store current hostname for later use
    window.currentHostname = hostname;

    return false; // Domain is NOT tracked

  } catch (error) {
    console.error('Error checking tracking banner:', error);
    return false;
  }
}

// Handle "Allow" button click
async function handleAllowDomain() {
  if (!window.currentHostname) return;

  try {
    const config = await chrome.storage.sync.get(['config', 'launchDarkly']);
    const trackedDomains = config.config?.trackedDomains || [];

    // Add domain if not already present
    if (!trackedDomains.includes(window.currentHostname)) {
      trackedDomains.push(window.currentHostname);

      // Save config while preserving launchDarkly settings
      await chrome.storage.sync.set({
        config: {
          trackedDomains: trackedDomains,
          version: 2
        },
        launchDarkly: config.launchDarkly
      });

      showToast('Domain added - reloading page...');

      // Reload the page to inject content script
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) {
        await chrome.tabs.reload(tabs[0].id);
      }
    }
  } catch (error) {
    console.error('Error adding domain:', error);
    showToast('Failed to add domain');
  }
}

// Handle "Deny" button click
function handleDenyDomain() {
  // Close the popup
  window.close();
}

// Populate tracked domains list in settings dropdown
async function populateTrackedDomainsList() {
  const config = await chrome.storage.sync.get(['config', 'launchDarkly']);
  const trackedDomains = config.config?.trackedDomains || [];
  const container = document.getElementById('trackedDomainsList');

  if (trackedDomains.length === 0) {
    container.innerHTML = '<div class="empty-domains-message">No domains tracked</div>';
    return;
  }

  container.innerHTML = trackedDomains.map(domain => `
    <div class="tracked-domain-item">
      <span class="tracked-domain-name" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
      <button class="btn-remove-domain" data-domain="${escapeHtml(domain)}">×</button>
    </div>
  `).join('');

  // Add event listeners for remove buttons
  container.querySelectorAll('.btn-remove-domain').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const domain = btn.dataset.domain;
      await removeDomain(domain);
    });
  });
}

// Remove a tracked domain
async function removeDomain(domain) {
  try {
    const config = await chrome.storage.sync.get(['config', 'launchDarkly']);
    const trackedDomains = config.config?.trackedDomains || [];

    // Remove domain from array
    const updatedDomains = trackedDomains.filter(d => d !== domain);

    // Save config while preserving launchDarkly settings
    await chrome.storage.sync.set({
      config: {
        trackedDomains: updatedDomains,
        version: 2
      },
      launchDarkly: config.launchDarkly
    });

    showToast('Domain removed');

    // Refresh the list
    await populateTrackedDomainsList();

    // Re-check banner visibility
    await checkAndShowTrackingBanner();
  } catch (error) {
    console.error('Error removing domain:', error);
    showToast('Failed to remove domain');
  }
}

// Load project key into input
async function loadProjectKey() {
  const config = await chrome.storage.sync.get(['config', 'launchDarkly']);
  const projectKey = config.launchDarkly?.projectKey || '';
  document.getElementById('projectKeyInput').value = projectKey;
}

// Save project key
async function saveProjectKey() {
  try {
    const projectKey = document.getElementById('projectKeyInput').value.trim();

    if (!projectKey) {
      showToast('Project key cannot be empty');
      return;
    }

    const config = await chrome.storage.sync.get(['config', 'launchDarkly']);

    await chrome.storage.sync.set({
      launchDarkly: {
        ...config.launchDarkly,
        projectKey: projectKey
      }
    });

    showToast('Project key saved');
  } catch (error) {
    console.error('Error saving project key:', error);
    showToast('Failed to save project key');
  }
}

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Set default theme to dark on first load to prevent flash
(function() {
  chrome.storage.local.get(['theme'], (result) => {
    if (!result.theme) {
      // No theme preference set, default to dark
      document.documentElement.classList.add('dark');
    }
  });
})();

// Theme
async function initTheme() {
  const result = await chrome.storage.local.get(['theme']);

  if (result.theme) {
    currentTheme = result.theme;
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    currentTheme = prefersDark ? 'dark' : 'light';
  }

  applyTheme(currentTheme);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (e) => {
    const result = await chrome.storage.local.get(['theme']);
    if (!result.theme) {
      currentTheme = e.matches ? 'dark' : 'light';
      applyTheme(currentTheme);
    }
  });
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  const switchEl = document.getElementById('themeSwitch');
  if (switchEl) {
    if (theme === 'dark') {
      switchEl.classList.add('checked');
    } else {
      switchEl.classList.remove('checked');
    }
  }
}

async function toggleTheme() {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(currentTheme);
  await chrome.storage.local.set({ theme: currentTheme });
}

// Debug mode management
async function initDebugMode() {
  const result = await chrome.storage.local.get(['ldext_debug']);
  debugMode = result.ldext_debug === true;
  applyDebugMode(debugMode);
}

function applyDebugMode(enabled) {
  debugMode = enabled;
  const switchEl = document.getElementById('debugSwitch');
  if (enabled) {
    switchEl.classList.add('checked');
  } else {
    switchEl.classList.remove('checked');
  }
}

async function toggleDebugMode() {
  debugMode = !debugMode;
  applyDebugMode(debugMode);
  await chrome.storage.local.set({ ldext_debug: debugMode });

  // Show toast
  showToast(debugMode ? 'Debug mode enabled' : 'Debug mode disabled');
}

// Load flags
async function loadFlags() {
  const result = await chrome.storage.local.get(['ldFlags', 'lastUpdated', 'ldProjectKey', 'ldEnvironmentKey']);

  if (result.ldFlags && result.ldFlags.length > 0) {
    allFlags = result.ldFlags;
    window.ldProjectKey = result.ldProjectKey;
    window.ldEnvironmentKey = result.ldEnvironmentKey;

    renderFlags(allFlags);
    updateStats(allFlags);

    if (result.lastUpdated) {
      updateLastUpdatedTime(result.lastUpdated);
    }
  } else {
    allFlags = [];
    renderEmpty();
    updateStats([]);
  }
}

// Render
function renderFlags(flags) {
  const container = document.getElementById('content');

  if (!flags || flags.length === 0) {
    renderEmpty();
    return;
  }

  // Get the configured project key
  const projectKey = extensionConfig?.launchDarkly?.projectKey;

  // Project badge HTML (only show if we have a project key configured)
  const projectBadgeHtml = projectKey ? `
    <div style="margin-bottom: 1rem; padding: 0.5rem 0.75rem; background: hsl(var(--muted)); border-radius: 0.375rem; text-align: center; font-size: 0.75rem;">
      <span style="color: hsl(var(--muted-foreground));">Project:</span>
      <strong style="margin-left: 0.25rem;">${escapeHtml(projectKey)}</strong>
    </div>
  ` : '';

  const html = `
    ${projectBadgeHtml}
    <div class="space-y-3">
      ${flags.map(flag => createFlagCard(flag)).join('')}
    </div>
  `;

  container.innerHTML = html;

  // Add event listeners
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      copyToClipboard(key);
    });
  });

  document.querySelectorAll('.btn-open').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const url = btn.dataset.url;
      window.open(url, '_blank');
    });
  });
}

function createFlagCard(flag) {
  const value = flag.value;
  const isEnabled = value === true || value === 'true';
  const isDisabled = value === false || value === 'false';

  let badgeClass = 'badge-outline';
  let badgeText = 'unknown';

  if (isEnabled) {
    badgeClass = 'badge-success';
    badgeText = 'enabled';
  } else if (isDisabled) {
    badgeClass = 'badge-secondary';
    badgeText = 'disabled';
  } else {
    // Handle non-boolean values
    if (typeof value === 'object' && value !== null) {
      // For objects, try to get a meaningful string
      badgeText = JSON.stringify(value).substring(0, 30);
      if (badgeText.length >= 30) badgeText += '...';
    } else {
      badgeText = String(value).substring(0, 20);
    }
  }

  // LaunchDarkly dashboard URL format (use configured URL)
  const dashboardUrl = extensionConfig?.launchDarkly?.dashboardUrl || 'https://app.launchdarkly.com';
  const projectKey = extensionConfig?.launchDarkly?.projectKey;

  // Only generate URL and show Open button if we have a configured project key
  let openButtonHtml = '';
  if (projectKey) {
    const ldUrl = `${dashboardUrl}/projects/${projectKey}/flags/${encodeURIComponent(flag.key)}`;
    openButtonHtml = `
      <button class="btn btn-sm btn-outline btn-open" data-url="${escapeHtmlAttribute(ldUrl)}">
        Open
      </button>
    `;
  }

  return `
    <div class="card flag-card">
      <div class="card-content">
        <div class="flag-header">
          <div class="flag-name">${escapeHtml(flag.key)}</div>
          <span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span>
        </div>

        <div class="flag-actions">
          <button class="btn btn-sm btn-secondary btn-copy" data-key="${escapeHtmlAttribute(flag.key)}">
            Copy
          </button>
          ${openButtonHtml}
        </div>
      </div>
    </div>
  `;
}

function renderEmpty() {
  const container = document.getElementById('content');
  container.innerHTML = `
    <div class="empty">
      <div class="empty-title">No flags yet</div>
      <div class="empty-description">
        Navigate to a page with LaunchDarkly to see feature flags
      </div>
    </div>
  `;
}

// Stats
function updateStats(flags) {
  const total = flags.length;
  const enabled = flags.filter(f => f.value === true || f.value === 'true').length;

  document.getElementById('totalCount').textContent = total;
  document.getElementById('enabledCount').textContent = enabled;
}

function updateLastUpdatedTime(timestamp) {
  const timeAgo = formatTimeAgo(timestamp);
  document.getElementById('lastUpdated').textContent = timeAgo;
}

// Search
function handleSearch(searchTerm) {
  if (!searchTerm) {
    renderFlags(allFlags);
    updateStats(allFlags);
    return;
  }

  const filtered = allFlags.filter(flag =>
    flag.key.toLowerCase().includes(searchTerm.toLowerCase())
  );

  renderFlags(filtered);
  updateStats(filtered);
}

// Utils
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeHtmlAttribute(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied!');
  }).catch(err => {
    console.error('Copy failed:', err);
    showToast('Failed to copy');
  });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

// Events
function setupEventListeners() {
  document.getElementById('searchInput').addEventListener('input', (e) => {
    handleSearch(e.target.value);
  });

  // Settings dropdown
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsDropdown = document.getElementById('settingsDropdown');

  settingsToggle.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isShowing = settingsDropdown.classList.contains('show');

    if (!isShowing) {
      // Populate data before showing
      await loadProjectKey();
      await populateTrackedDomainsList();
    }

    settingsDropdown.classList.toggle('show');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!settingsToggle.contains(e.target) && !settingsDropdown.contains(e.target)) {
      settingsDropdown.classList.remove('show');
    }
  });

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTheme();
  });

  // Debug toggle
  document.getElementById('debugToggle').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDebugMode();
  });

  // Project key save button
  document.getElementById('saveProjectKeyBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    saveProjectKey();
  });

  // Note: Tracking prompt buttons are attached dynamically in checkAndShowTrackingBanner()

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'FLAGS_UPDATED') {
      loadFlags();
    }
  });
}

function startAutoRefresh() {
  setInterval(async () => {
    const result = await chrome.storage.local.get(['lastUpdated']);
    if (result.lastUpdated) {
      updateLastUpdatedTime(result.lastUpdated);
    }
  }, 10000);
}

// Start
init();
