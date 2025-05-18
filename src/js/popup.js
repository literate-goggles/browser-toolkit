document.addEventListener('DOMContentLoaded', function() {
  const toggleSwitch = document.getElementById('difficulty-toggle');
  const STORAGE_KEY = 'leetfocusEnabled';
  
  chrome.storage.sync.get([STORAGE_KEY], function(result) {
    const isEnabled = result[STORAGE_KEY] !== false;
    toggleSwitch.checked = isEnabled;
    
    updateUI(isEnabled);
  });
  function updateUI(isEnabled) {
    const label = document.querySelector('.toggle-text');
    label.textContent = isEnabled ? 
      'Hide Problem Difficulty' : 
      'Show Problem Difficulty';
    
    const stateIcon = document.getElementById('state-icon');
    stateIcon.src = isEnabled ? 'icons/on.png' : 'icons/off.png';
    stateIcon.alt = isEnabled ? 'Hiding Difficulty' : 'Showing Difficulty';
  }
  toggleSwitch.addEventListener('change', function() {
    const isEnabled = toggleSwitch.checked;
    chrome.storage.sync.set({ [STORAGE_KEY]: isEnabled });
    
    updateUI(isEnabled);
  });
});
