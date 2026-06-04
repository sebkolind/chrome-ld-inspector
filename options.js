// Options page script - handles configuration UI

let currentConfig = null;

// Initialize the options page
async function init() {
  await loadConfiguration();
  setupEventListeners();
}

// Load current configuration and populate form
async function loadConfiguration() {
  try {
    currentConfig = await getConfig();

    // Populate domain patterns
    if (currentConfig.config.targetDomains && currentConfig.config.targetDomains.length > 0) {
      document.getElementById('targetDomains').value = currentConfig.config.targetDomains.join('\n');
    }

    // Populate LaunchDarkly settings
    document.getElementById('projectKey').value = currentConfig.launchDarkly.projectKey || '';
    document.getElementById('environmentKey').value = currentConfig.launchDarkly.environmentKey || '';
    document.getElementById('dashboardUrl').value = currentConfig.launchDarkly.dashboardUrl || 'https://app.launchdarkly.com';
    document.getElementById('sdkUrlPattern').value = currentConfig.launchDarkly.sdkUrlPattern || '/sdk/evalx/';
    document.getElementById('urlDetectionPatterns').value = (currentConfig.launchDarkly.urlDetectionPatterns || []).join(', ');

  } catch (error) {
    showError('Failed to load configuration: ' + error.message);
  }
}

// Setup event listeners
function setupEventListeners() {
  document.getElementById('saveBtn').addEventListener('click', handleSave);
  document.getElementById('cancelBtn').addEventListener('click', handleCancel);
  document.getElementById('advancedToggle').addEventListener('click', toggleAdvanced);
}

// Toggle advanced settings
function toggleAdvanced() {
  const content = document.getElementById('advancedContent');
  const toggle = document.getElementById('advancedToggle');

  if (content.classList.contains('show')) {
    content.classList.remove('show');
    toggle.textContent = '▶ Advanced Settings';
  } else {
    content.classList.add('show');
    toggle.textContent = '▼ Advanced Settings';
  }
}

// Handle save button click
async function handleSave() {
  hideAlerts();

  try {
    // Parse form values
    const domainPatternsText = document.getElementById('targetDomains').value;
    const targetDomains = domainPatternsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    // Validate at least one domain is provided
    if (targetDomains.length === 0) {
      showError('Please enter at least one target domain pattern.');
      return;
    }

    const projectKey = document.getElementById('projectKey').value.trim();
    const environmentKey = document.getElementById('environmentKey').value.trim() || null;

    // Validate project key is provided
    if (!projectKey) {
      showError('Project key is required. Please enter your LaunchDarkly project key.');
      return;
    }
    let dashboardUrl = document.getElementById('dashboardUrl').value.trim();
    if (!dashboardUrl) {
      dashboardUrl = 'https://app.launchdarkly.com';
    }
    const sdkUrlPattern = document.getElementById('sdkUrlPattern').value.trim() || '/sdk/evalx/';

    const urlDetectionPatternsText = document.getElementById('urlDetectionPatterns').value;
    let urlDetectionPatterns = urlDetectionPatternsText
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (urlDetectionPatterns.length === 0) {
      urlDetectionPatterns = ['launchdarkly', 'app.ld.', 'clientstream.launchdarkly'];
    }

    // Build configuration object
    const newConfig = {
      config: {
        targetDomains: targetDomains,
        isConfigured: true,
        version: 1
      },
      launchDarkly: {
        projectKey: projectKey,
        environmentKey: environmentKey,
        dashboardUrl: dashboardUrl,
        sdkUrlPattern: sdkUrlPattern,
        urlDetectionPatterns: urlDetectionPatterns
      }
    };

    // Validate configuration
    const validation = validateConfig(newConfig);
    if (!validation.valid) {
      showError('Configuration is invalid:\n' + validation.errors.join('\n'));
      return;
    }

    // Save configuration
    await saveConfig(newConfig);
    currentConfig = newConfig;

    showSuccess('Configuration saved successfully!');

    // Close options page after a delay
    setTimeout(() => {
      window.close();
    }, 1500);

  } catch (error) {
    showError('Failed to save configuration: ' + error.message);
  }
}

// Handle cancel button click
function handleCancel() {
  window.close();
}

// Show success message
function showSuccess(message) {
  const alert = document.getElementById('successAlert');
  alert.textContent = message;
  alert.classList.remove('hidden');

  // Scroll to top
  window.scrollTo(0, 0);
}

// Show error message
function showError(message) {
  const alert = document.getElementById('errorAlert');
  alert.textContent = message;
  alert.classList.remove('hidden');

  // Scroll to top
  window.scrollTo(0, 0);
}

// Hide all alerts
function hideAlerts() {
  document.getElementById('successAlert').classList.add('hidden');
  document.getElementById('errorAlert').classList.add('hidden');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
