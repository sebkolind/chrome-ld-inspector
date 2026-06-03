# LaunchDarkly Flag Viewer

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

## Setup

### 1. Install the Extension

1. Navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select this extension directory

## Usage

1. Navigate to a configured domain that uses LaunchDarkly
2. Click the extension icon
3. View all captured flags
4. Use the search box to filter by flag name
5. Click "Open" to view a flag in the LaunchDarkly dashboard
6. Click "Copy" to copy the flag key

## Privacy

All flag data is stored locally in your browser using Chrome's storage API. Nothing is sent to external servers. The extension only monitors domains you explicitly configure.

## Permissions

- `storage`: Store configuration and flag data locally
- `webRequest`: Monitor network requests on configured domains
- `scripting`: Inject scripts to intercept LaunchDarkly calls
- `tabs`: Access current tab information
- `*://*/*`: Required by Chrome Manifest v3 for network monitoring (filtered by your domain configuration)
