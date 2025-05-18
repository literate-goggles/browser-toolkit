const CONFIG = {
  storageKey: 'leetfocusEnabled'
};
function updateIcon(isEnabled) {
  chrome.action.setIcon({
    path: {
      16: `icons/${isEnabled ? 'on' : 'off'}.png`,
      48: `icons/${isEnabled ? 'on' : 'off'}.png`,
      128: `icons/${isEnabled ? 'on' : 'off'}.png`
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get([CONFIG.storageKey], (result) => {
    const isEnabled = result[CONFIG.storageKey] !== false;
    updateIcon(isEnabled);
  });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && CONFIG.storageKey in changes) {
    updateIcon(changes[CONFIG.storageKey].newValue);
  }
});
