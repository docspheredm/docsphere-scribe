// MV3 service worker: open the side panel when the toolbar icon is clicked.
// No first-run redirect to Settings: the server URL and access code are baked
// into the build (see services/extensionConfig.ts), so install-and-go works
// like any consumer extension. Settings is still reachable from the gear icon
// for anyone who needs to point at a different server.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set side panel behavior:', error));
