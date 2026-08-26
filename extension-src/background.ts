// MV3 service worker: open the side panel when the toolbar icon is clicked.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set side panel behavior:', error));

// First install: send doctors straight to settings so they can enter their
// organization's server URL and access code before recording anything.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});
