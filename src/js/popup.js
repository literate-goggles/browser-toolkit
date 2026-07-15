const LiterateGogglesRuntime = globalThis.LiterateGoggles || {};
const GLOBAL_STORAGE_KEY =
  LiterateGogglesRuntime.globalStorageKey || "literategoggles.globalEnabled";
const CHESS_MANUAL_BLOCK_KEY =
  "literategoggles.features.chessDailyLimit.manualBlockUntil";
const VOCAB_SOURCES = Array.isArray(LiterateGogglesRuntime.vocabSources)
  ? LiterateGogglesRuntime.vocabSources.filter(
      (s) => s && typeof s.id === "string" && Array.isArray(s.items) && s.items.length,
    )
  : [];
const VOCAB_HAS_ITEMS = VOCAB_SOURCES.length > 0
  || (Array.isArray(LiterateGogglesRuntime.vocab) && LiterateGogglesRuntime.vocab.length > 0);
const FEATURES = Array.isArray(LiterateGogglesRuntime.features)
  ? LiterateGogglesRuntime.features
  : [];

function getEndOfDayTimestamp(now = new Date()) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function formatAvailability(timestamp) {
  if (typeof timestamp !== "number" || Number.isNaN(timestamp)) {
    return "";
  }
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const day = date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${time} (${day})`;
}

function openQuizTab(mode, sourceId) {
  const params = new URLSearchParams({ mode });
  if (sourceId) params.set("source", sourceId);
  const url = chrome.runtime.getURL(`quiz.html?${params.toString()}`);
  chrome.tabs.create({ url });
  window.close();
}

document.addEventListener("DOMContentLoaded", () => {
  const globalToggle = document.getElementById("global-toggle");
  const stateIcon = document.getElementById("state-icon");
  const globalStatus = document.getElementById("global-status");
  const featureList = document.getElementById("feature-list");

  const storageKeys = [
    GLOBAL_STORAGE_KEY,
    CHESS_MANUAL_BLOCK_KEY,
    ...FEATURES.map((feature) => feature.storageKey),
  ];
  const featureControls = new Map();
  const storageState = {};

  const copyTabsControl = createCopyTabsCard();
  featureList.appendChild(copyTabsControl.element);
  copyTabsControl.refreshCount();

  function ensureFeatureControl(feature) {
    if (featureControls.has(feature.id)) {
      return featureControls.get(feature.id);
    }

    const listItem = document.createElement("li");
    listItem.className = "feature-item";
    listItem.dataset.featureId = feature.id;

    const label = document.createElement("label");
    label.className = "feature-toggle";
    label.setAttribute("for", `feature-toggle-${feature.id}`);

    const infoContainer = document.createElement("div");
    infoContainer.className = "feature-info";

    const title = document.createElement("span");
    title.className = "feature-name";
    title.textContent = feature.name;

    const description = document.createElement("span");
    description.className = "feature-description";
    description.textContent = feature.description;

    infoContainer.appendChild(title);
    infoContainer.appendChild(description);

    const switchContainer = document.createElement("div");
    switchContainer.className = "toggle-switch";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `feature-toggle-${feature.id}`;
    checkbox.className = "feature-checkbox";

    const slider = document.createElement("span");
    slider.className = "slider";

    switchContainer.appendChild(checkbox);
    switchContainer.appendChild(slider);

    label.appendChild(infoContainer);
    label.appendChild(switchContainer);

    const status = document.createElement("span");
    status.className = "feature-status";

    listItem.appendChild(label);
    listItem.appendChild(status);

    let filthLatchButton = null;
    let filthLatchNote = null;
    if (feature.id === "chessDailyLimit") {
      const actions = document.createElement("div");
      actions.className = "feature-actions";

      filthLatchButton = document.createElement("button");
      filthLatchButton.type = "button";
      filthLatchButton.className = "filthlatch-button";
      filthLatchButton.textContent = "FilthLatch";
      filthLatchButton.title =
        "Trigger the FilthLatch lock and block Chess.com for the rest of today.";

      filthLatchNote = document.createElement("span");
      filthLatchNote.className = "filthlatch-note";
      filthLatchNote.textContent =
        "FilthLatch keeps Chess.com closed until tonight.";

      actions.appendChild(filthLatchButton);
      actions.appendChild(filthLatchNote);

      filthLatchButton.addEventListener("click", () => {
        const until = getEndOfDayTimestamp();
        chrome.storage.sync.set({ [CHESS_MANUAL_BLOCK_KEY]: until });
      });

      listItem.appendChild(actions);
    }

    if (feature.id === "englishVocab") {
      const actions = document.createElement("div");
      actions.className = "feature-actions feature-actions--stacked";

      let sourceSelect = null;
      if (VOCAB_SOURCES.length > 1) {
        sourceSelect = document.createElement("select");
        sourceSelect.className = "vocab-source-select";
        sourceSelect.setAttribute("aria-label", "Vocab source");
        VOCAB_SOURCES.forEach((src) => {
          const opt = document.createElement("option");
          opt.value = src.id;
          opt.textContent = `${src.name} (${src.items.length})`;
          sourceSelect.appendChild(opt);
        });
        actions.appendChild(sourceSelect);
      } else if (VOCAB_SOURCES.length === 1) {
        const singleLabel = document.createElement("div");
        singleLabel.className = "vocab-source-label";
        singleLabel.textContent = `${VOCAB_SOURCES[0].name} · ${VOCAB_SOURCES[0].items.length} words`;
        actions.appendChild(singleLabel);
      }

      function currentSourceId() {
        if (sourceSelect) return sourceSelect.value;
        return VOCAB_SOURCES[0] ? VOCAB_SOURCES[0].id : "";
      }

      const singleBtn = document.createElement("button");
      singleBtn.type = "button";
      singleBtn.className = "vocab-action-button vocab-action-button--primary";
      singleBtn.textContent = "Show me a word";
      singleBtn.addEventListener("click", () => openQuizTab("single", currentSourceId()));

      const sessionBtn = document.createElement("button");
      sessionBtn.type = "button";
      sessionBtn.className = "vocab-action-button vocab-action-button--session";
      sessionBtn.textContent = "Study all words";
      sessionBtn.addEventListener("click", () => openQuizTab("session", currentSourceId()));

      if (!VOCAB_HAS_ITEMS) {
        singleBtn.disabled = true;
        sessionBtn.disabled = true;
        singleBtn.title = "Run scripts/vocab_builder.py to generate a list.";
        sessionBtn.title = singleBtn.title;
      }

      actions.appendChild(singleBtn);
      actions.appendChild(sessionBtn);
      listItem.appendChild(actions);
    }

    if (feature.id === "chessDailyLimit") {
      switchContainer.style.display = "none";
      checkbox.disabled = true;
      label.removeAttribute("for");
      label.style.cursor = "default";
    }

    featureList.appendChild(listItem);

    checkbox.addEventListener("change", () => {
      chrome.storage.sync.set({ [feature.storageKey]: checkbox.checked });
    });

    const control = {
      checkbox,
      status,
      element: listItem,
      filthLatchButton,
      filthLatchNote,
    };
    featureControls.set(feature.id, control);
    return control;
  }

  function describeFeatureState(featureEnabled, globalEnabled) {
    if (!featureEnabled) {
      return "Disabled";
    }
    if (!globalEnabled) {
      return "Waiting for global toggle";
    }
    return "Active now";
  }

  function updateFeatureUI(feature, featureEnabled, globalEnabled) {
    const control = ensureFeatureControl(feature);
    control.checkbox.checked = featureEnabled;
    control.element.dataset.state =
      globalEnabled && featureEnabled
        ? "active"
        : featureEnabled
          ? "paused"
          : "disabled";
    control.status.textContent = describeFeatureState(
      featureEnabled,
      globalEnabled
    );

    if (feature.id === "chessDailyLimit") {
      const blockUntil = normalizeTimestamp(storageState[CHESS_MANUAL_BLOCK_KEY]);
      const now = Date.now();
      const isBlocked = blockUntil && blockUntil > now;

      if (control.filthLatchButton) {
        control.filthLatchButton.disabled = Boolean(isBlocked);
      }

      if (control.filthLatchNote) {
        if (isBlocked) {
          control.filthLatchNote.textContent = `FilthLatch active until ${formatAvailability(blockUntil)}.`;
          control.element.dataset.filthLatchState = "armed";
        } else {
          control.filthLatchNote.textContent =
            "Go FilthLatch to block Chess.com for the rest of today.";
          control.element.dataset.filthLatchState = "idle";
        }
      }
    }
  }

  function updateGlobalUI(isEnabled) {
    globalToggle.checked = isEnabled;
    stateIcon.src = `icons/${isEnabled ? "on" : "off"}.png`;
    stateIcon.alt = isEnabled ? "Extension active" : "Extension paused";
    globalStatus.textContent = isEnabled
      ? "Active on supported pages"
      : "Temporarily paused";
    document.body.dataset.extensionState = isEnabled ? "enabled" : "disabled";
  }

  function applyUI() {
    const globalEnabled = storageState[GLOBAL_STORAGE_KEY] !== false;
    updateGlobalUI(globalEnabled);

    FEATURES.forEach((feature) => {
      const storedValue = storageState[feature.storageKey];
      const featureEnabled =
        typeof storedValue === "boolean"
          ? storedValue
          : feature.defaultEnabled !== false;
      updateFeatureUI(feature, featureEnabled, globalEnabled);
    });
  }

  chrome.storage.sync.get(storageKeys, (result) => {
    Object.assign(storageState, result);
    const chessFeature = FEATURES.find((f) => f.id === "chessDailyLimit");
    if (chessFeature && storageState[chessFeature.storageKey] === false) {
      storageState[chessFeature.storageKey] = true;
      chrome.storage.sync.set({ [chessFeature.storageKey]: true });
    }
    applyUI();
  });

  globalToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ [GLOBAL_STORAGE_KEY]: globalToggle.checked });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") {
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

function isCopyableTab(tab) {
  if (!tab || !tab.url) {
    return false;
  }
  if (tab.groupId !== undefined && tab.groupId !== -1) {
    return false;
  }
  return (
    !tab.url.startsWith("chrome://") &&
    !tab.url.startsWith("chrome-extension://")
  );
}

async function getCurrentWindowCopyableTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.filter(isCopyableTab);
}

function createCopyTabsCard() {
  const listItem = document.createElement("li");
  listItem.className = "feature-item feature-item--action";
  listItem.dataset.featureId = "copyTabs";

  const info = document.createElement("div");
  info.className = "feature-info";

  const title = document.createElement("span");
  title.className = "feature-name";
  title.textContent = "Copy tab URLs";

  const description = document.createElement("span");
  description.className = "feature-description";
  description.textContent =
    "Copies URLs from the current window. Grouped and chrome:// tabs are skipped.";

  info.appendChild(title);
  info.appendChild(description);

  const actions = document.createElement("div");
  actions.className = "feature-actions";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-tabs-button";

  const buttonLabel = document.createElement("span");
  buttonLabel.className = "copy-tabs-label";
  buttonLabel.textContent = "Copy all tab URLs";

  const countBadge = document.createElement("span");
  countBadge.className = "copy-tabs-count";
  countBadge.hidden = true;
  countBadge.textContent = "0";

  button.appendChild(buttonLabel);
  button.appendChild(countBadge);
  actions.appendChild(button);

  listItem.appendChild(info);
  listItem.appendChild(actions);

  function setLabel(text) {
    buttonLabel.textContent = text;
  }

  function setCount(value) {
    if (typeof value !== "number") {
      countBadge.hidden = true;
      return;
    }
    countBadge.textContent = String(value);
    countBadge.hidden = false;
  }

  async function refreshCount() {
    try {
      const tabs = await getCurrentWindowCopyableTabs();
      setCount(tabs.length);
    } catch (error) {
      console.warn("LiterateGoggles: Failed to count tabs.", error);
      setCount(null);
    }
  }

  button.addEventListener("click", async () => {
    try {
      const tabs = await getCurrentWindowCopyableTabs();
      const urls = tabs.map((tab) => decodeURI(tab.url)).join("\n");
      await navigator.clipboard.writeText(urls);
      setCount(tabs.length);
      setLabel("Copied!");
      setTimeout(() => setLabel("Copy all tab URLs"), 1500);
    } catch (error) {
      console.warn("LiterateGoggles: Failed to copy tab URLs.", error);
      setLabel("Failed");
      setTimeout(() => setLabel("Copy all tab URLs"), 1500);
    }
  });

  return { element: listItem, refreshCount };
}
