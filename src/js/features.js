const LITERATEGOGGLES_GLOBAL_STORAGE_KEY = 'literategoggles.globalEnabled';

const LITERATEGOGGLES_FEATURES = [
  {
    id: 'leetcodeDifficultyHider',
    name: 'Hide LeetCode difficulty badges',
    description: 'Keeps LeetCode problem difficulty labels out of sight until you ask for them.',
    storageKey: 'literategoggles.features.leetcodeDifficultyHider.enabled',
    defaultEnabled: true,
    appliesTo(location) {
      return /(^|\.)leetcode\.com$/i.test(location.hostname);
    },
    onEnable(context) {
      const targetDocument = context?.document;
      if (!targetDocument?.body) {
        return;
      }
      targetDocument.body.classList.add('lg-hide-leetcode-difficulty');
    },
    onDisable(context) {
      const targetDocument = context?.document;
      if (!targetDocument?.body) {
        return;
      }
      targetDocument.body.classList.remove('lg-hide-leetcode-difficulty');
    }
  }
];

if (!globalThis.LiterateGoggles) {
  globalThis.LiterateGoggles = {};
}

Object.assign(globalThis.LiterateGoggles, {
  features: LITERATEGOGGLES_FEATURES,
  globalStorageKey: LITERATEGOGGLES_GLOBAL_STORAGE_KEY,
  getFeatureById(featureId) {
    return LITERATEGOGGLES_FEATURES.find((feature) => feature.id === featureId) || null;
  }
});
