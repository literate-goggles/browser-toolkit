try {
  importScripts("features.js");
} catch (error) {
  console.warn(
    "LiterateGoggles: unable to load shared feature metadata in background script.",
    error
  );
}

const LiterateGogglesRuntime = globalThis.LiterateGoggles || {};
const GLOBAL_STORAGE_KEY =
  LiterateGogglesRuntime.globalStorageKey || "literategoggles.globalEnabled";

function updateIcon(isEnabled) {
  const iconState = isEnabled ? "on" : "off";
  chrome.action.setIcon({
    path: {
      16: `icons/${iconState}.png`,
      48: `icons/${iconState}.png`,
      128: `icons/${iconState}.png`,
    },
  });
}

function refreshIconFromStorage() {
  chrome.storage.sync.get([GLOBAL_STORAGE_KEY], (result) => {
    const isEnabled = result[GLOBAL_STORAGE_KEY] !== false;
    updateIcon(isEnabled);
  });
}

chrome.runtime.onInstalled.addListener(refreshIconFromStorage);
if (
  chrome.runtime.onStartup &&
  typeof chrome.runtime.onStartup.addListener === "function"
) {
  chrome.runtime.onStartup.addListener(refreshIconFromStorage);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !(GLOBAL_STORAGE_KEY in changes)) {
    return;
  }
  updateIcon(changes[GLOBAL_STORAGE_KEY].newValue !== false);
});

refreshIconFromStorage();
