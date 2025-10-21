const LiterateGogglesRuntime = globalThis.LiterateGoggles || {};
const GLOBAL_STORAGE_KEY = LiterateGogglesRuntime.globalStorageKey || 'literategoggles.globalEnabled';
const FEATURES = Array.isArray(LiterateGogglesRuntime.features) ? LiterateGogglesRuntime.features : [];

document.addEventListener('DOMContentLoaded', () => {
  const globalToggle = document.getElementById('global-toggle');
  const stateIcon = document.getElementById('state-icon');
  const globalStatus = document.getElementById('global-status');
  const featureList = document.getElementById('feature-list');

  const storageKeys = [GLOBAL_STORAGE_KEY, ...FEATURES.map((feature) => feature.storageKey)];
  const featureControls = new Map();
  const storageState = {};

  function ensureFeatureControl(feature) {
    if (featureControls.has(feature.id)) {
      return featureControls.get(feature.id);
    }

    const listItem = document.createElement('li');
    listItem.className = 'feature-item';
    listItem.dataset.featureId = feature.id;

    const label = document.createElement('label');
    label.className = 'feature-toggle';
    label.setAttribute('for', `feature-toggle-${feature.id}`);

    const infoContainer = document.createElement('div');
    infoContainer.className = 'feature-info';

    const title = document.createElement('span');
    title.className = 'feature-name';
    title.textContent = feature.name;

    const description = document.createElement('span');
    description.className = 'feature-description';
    description.textContent = feature.description;

    infoContainer.appendChild(title);
    infoContainer.appendChild(description);

    const switchContainer = document.createElement('div');
    switchContainer.className = 'toggle-switch';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `feature-toggle-${feature.id}`;
    checkbox.className = 'feature-checkbox';

    const slider = document.createElement('span');
    slider.className = 'slider';

    switchContainer.appendChild(checkbox);
    switchContainer.appendChild(slider);

    label.appendChild(infoContainer);
    label.appendChild(switchContainer);

    const status = document.createElement('span');
    status.className = 'feature-status';

    listItem.appendChild(label);
    listItem.appendChild(status);

    featureList.appendChild(listItem);

    checkbox.addEventListener('change', () => {
      chrome.storage.sync.set({ [feature.storageKey]: checkbox.checked });
    });

    const control = { checkbox, status, element: listItem };
    featureControls.set(feature.id, control);
    return control;
  }

  function describeFeatureState(featureEnabled, globalEnabled) {
    if (!featureEnabled) {
      return 'Disabled';
    }
    if (!globalEnabled) {
      return 'Waiting for global toggle';
    }
    return 'Active now';
  }

  function updateFeatureUI(feature, featureEnabled, globalEnabled) {
    const control = ensureFeatureControl(feature);
    control.checkbox.checked = featureEnabled;
    control.element.dataset.state = globalEnabled && featureEnabled ? 'active' : featureEnabled ? 'paused' : 'disabled';
    control.status.textContent = describeFeatureState(featureEnabled, globalEnabled);
  }

  function updateGlobalUI(isEnabled) {
    globalToggle.checked = isEnabled;
    stateIcon.src = `icons/${isEnabled ? 'on' : 'off'}.png`;
    stateIcon.alt = isEnabled ? 'Extension active' : 'Extension paused';
    globalStatus.textContent = isEnabled ? 'Active on supported pages' : 'Temporarily paused';
    document.body.dataset.extensionState = isEnabled ? 'enabled' : 'disabled';
  }

  function applyUI() {
    const globalEnabled = storageState[GLOBAL_STORAGE_KEY] !== false;
    updateGlobalUI(globalEnabled);

    FEATURES.forEach((feature) => {
      const storedValue = storageState[feature.storageKey];
      const featureEnabled = typeof storedValue === 'boolean' ? storedValue : feature.defaultEnabled !== false;
      updateFeatureUI(feature, featureEnabled, globalEnabled);
    });
  }

  chrome.storage.sync.get(storageKeys, (result) => {
    Object.assign(storageState, result);
    applyUI();
  });

  globalToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ [GLOBAL_STORAGE_KEY]: globalToggle.checked });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') {
      return;
    }

    let needsUpdate = false;
    Object.entries(changes).forEach(([key, change]) => {
      if (storageKeys.includes(key)) {
        storageState[key] = change.newValue;
        needsUpdate = true;
      }
    });

    if (needsUpdate) {
      applyUI();
    }
  });
});
