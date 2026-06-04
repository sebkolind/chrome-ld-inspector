# LaunchDarkly Inspector

A Chrome extension that captures and displays LaunchDarkly feature flags from configured domains in a searchable interface.

## What It Does

- Captures LaunchDarkly feature flags from network requests on domains you configure
- Displays all captured flags in a searchable popup interface
- Shows flag keys and their current values (enabled/disabled)
- Links directly to the LaunchDarkly dashboard for each flag

## What It Accesses

The extension requires broad permissions (`*://*/*`) to monitor network requests, but:
- Only processes requests from domains you explicitly configure
- All data stays local in your browser (Chrome's storage API)
- No data is sent to external servers
- You control exactly which sites it monitors

## Installation

### Option 1: Install from Tag (Recommended)

1. Download the latest version from the [Tags page](https://github.com/sebkolind/chrome-ld-inspector/tags)
2. Click on the zip icon for the desired version to download the source code
3. Extract the zip file to a permanent location on your computer
4. Navigate to `chrome://extensions/`
5. Enable "Developer mode" (toggle in top right)
6. Click "Load unpacked"
7. Select the extracted extension directory

### Option 2: Install from Source

1. Clone this repository
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the cloned repository directory

## Configuration

After installation, you'll need to configure:
1. **Target domains** - Which domains to monitor for LaunchDarkly flags
2. **Project key** - Your LaunchDarkly project key (required for the "Open" button)

Find your project key at: https://app.launchdarkly.com/settings/projects

**Note:** The "Open" button (to view flags in the LaunchDarkly dashboard) will only appear if you've configured your project key.

## Privacy

All flag data is stored locally in your browser using Chrome's storage API. Nothing is sent to external servers. The extension only monitors domains you explicitly configure.

## Permissions

- `storage`: Store configuration and flag data locally
- `webRequest`: Monitor network requests on configured domains
- `scripting`: Inject scripts to intercept LaunchDarkly calls
- `tabs`: Access current tab information
- `*://*/*`: Required by Chrome Manifest v3 for network monitoring (filtered by your domain configuration)
