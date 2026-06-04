// LaunchDarkly Inspector - shadcn/ui styled

let allFlags = [];
let currentTheme = 'light';
let debugMode = false;
let extensionConfig = null;

// Initialize
async function init() {
  // Check if extension is configured
  const config = await chrome.storage.sync.get(['config']);

  if (!config.config || !config.config.isConfigured) {
    // Show setup screen
    showSetupScreen();
    return;
  }

  // Load full configuration
  extensionConfig = await chrome.storage.sync.get(['config', 'launchDarkly']);

  await initTheme();
  await initDebugMode();
  await loadFlags();
  setupEventListeners();
  startAutoRefresh();
}

// Show setup screen for first-run
function showSetupScreen() {
  const container = document.getElementById('content');

  // Hide header completely (removes title, settings gear, search, stats)
  document.querySelector('.header').style.display = 'none';

  // Make content container full height and centered
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.height = '100%';
  container.style.padding = '0';

  container.innerHTML = `
    <div class="empty" style="text-align: center; max-width: 350px; padding: 1rem;">
      <div style="font-size: 3rem; margin-bottom: 1rem;">👋</div>
      <div class="empty-title" style="margin-bottom: 0.5rem; font-size: 1.25rem;">Welcome!</div>
      <div class="empty-description" style="margin-bottom: 1.5rem;">
        Configure the extension to get started.<br>
        Specify which domains to monitor for LaunchDarkly flags.
      </div>
      <button id="openConfigBtn" class="btn btn-primary" style="padding: 0.5rem 1rem;">
        Open Configuration
      </button>
    </div>
  `;

  document.getElementById('openConfigBtn').addEventListener('click', () => {
    // Use chrome.tabs.create for better reliability
    chrome.tabs.create({
      url: chrome.runtime.getURL('options.html')
    });
  });
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

  settingsToggle.addEventListener('click', (e) => {
    e.stopPropagation();
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

  // Configure toggle (if it exists)
  const configureToggle = document.getElementById('configureToggle');
  if (configureToggle) {
    configureToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.create({
        url: chrome.runtime.getURL('options.html')
      });
    });
  }

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
