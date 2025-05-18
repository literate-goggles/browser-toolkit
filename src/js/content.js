const CONFIG = {
  storageKey: 'leetfocusEnabled',
  bodyClassName: 'leetfocus-enabled'
};

function applyInitialState() {
  document.body.classList.add(CONFIG.bodyClassName);
}

function toggleDifficultyVisibility(hide) {
  if (hide) {
    document.body.classList.add(CONFIG.bodyClassName);
  } else {
    document.body.classList.remove(CONFIG.bodyClassName);
  }
}


function initialize() {
  chrome.storage.sync.get([CONFIG.storageKey], (result) => {
    const isEnabled = result[CONFIG.storageKey] !== false;
    
    if (!isEnabled) {
      document.body.classList.remove(CONFIG.bodyClassName);
    }
  });
  
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[CONFIG.storageKey]) {
      toggleDifficultyVisibility(changes[CONFIG.storageKey].newValue);
    }
  });
}


function setupObserver() {
  const observer = new MutationObserver(() => {
    chrome.storage.sync.get([CONFIG.storageKey], ({ leetfocusEnabled }) => {
      const isEnabled = leetfocusEnabled !== false;
      
      if (document.body && !isEnabled) {
        document.body.classList.remove(CONFIG.bodyClassName);
      }
    });
  });
  
  observer.observe(document.body, { 
    childList: true, 
    subtree: true 
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.body) {
    applyInitialState();
  }
  initialize();
  setupObserver();
});

if (document.body) {
  applyInitialState();
}
initialize();
setupObserver();
