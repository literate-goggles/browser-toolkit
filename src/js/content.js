const LiterateGogglesRuntime = globalThis.LiterateGoggles || {};
const GLOBAL_STORAGE_KEY = LiterateGogglesRuntime.globalStorageKey || 'literategoggles.globalEnabled';
const REGISTERED_FEATURES = Array.isArray(LiterateGogglesRuntime.features) ? LiterateGogglesRuntime.features : [];

const storageState = {};
const featureStates = new Map();

const bodyReady = new Promise((resolve) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => resolve(document.body), { once: true });
  } else {
    resolve(document.body);
  }
});

function isGlobalEnabled() {
  if (typeof storageState[GLOBAL_STORAGE_KEY] === 'boolean') {
    return storageState[GLOBAL_STORAGE_KEY];
  }
  return true;
}

function readFeatureState(feature) {
  if (feature && typeof storageState[feature.storageKey] === 'boolean') {
    return storageState[feature.storageKey];
  }
  return feature?.defaultEnabled !== false;
}

function isFeatureApplicable(feature) {
  if (!feature) {
    return false;
  }
  if (typeof feature.appliesTo === 'function') {
    try {
      return feature.appliesTo(window.location);
    } catch (err) {
      console.warn('Literategoggles feature applicability check failed:', err);
      return false;
    }
  }
  return true;
}

function applyFeature(feature, shouldEnable) {
  bodyReady.then((body) => {
    if (!body || !feature) {
      return;
    }

    const previousState = featureStates.get(feature.id);
    if (previousState === shouldEnable) {
      return;
    }

    if (shouldEnable) {
      if (typeof feature.onEnable === 'function') {
        feature.onEnable({ document, window });
      }
    } else if (typeof feature.onDisable === 'function') {
      feature.onDisable({ document, window });
    }

    featureStates.set(feature.id, shouldEnable);
  });
}

function applyFeatures() {
  const globalEnabled = isGlobalEnabled();

  REGISTERED_FEATURES.forEach((feature) => {
    if (!isFeatureApplicable(feature)) {
      return;
    }

    const featureEnabled = globalEnabled && readFeatureState(feature);
    applyFeature(feature, featureEnabled);
  });
}

function primeState() {
  const keysToRead = [GLOBAL_STORAGE_KEY, ...REGISTERED_FEATURES.map((feature) => feature.storageKey)];

  chrome.storage.sync.get(keysToRead, (result) => {
    Object.assign(storageState, result);
    applyFeatures();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') {
    return;
  }

  let shouldApply = false;

  Object.entries(changes).forEach(([storageKey, change]) => {
    if (storageKey === GLOBAL_STORAGE_KEY || REGISTERED_FEATURES.some((feature) => feature.storageKey === storageKey)) {
      storageState[storageKey] = change.newValue;
      shouldApply = true;
    }
  });

  if (shouldApply) {
    applyFeatures();
  }
});

primeState();
