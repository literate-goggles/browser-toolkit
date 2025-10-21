const LITERATEGOGGLES_GLOBAL_STORAGE_KEY = 'literategoggles.globalEnabled';

const leetCodeDifficultyFeature = {
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
};

const aimchessCoordinateState = new WeakMap();

function getAimchessState(doc) {
  if (!doc) {
    return null;
  }
  let state = aimchessCoordinateState.get(doc);
  if (!state) {
    state = {
      removedNodes: [],
      observer: null
    };
    aimchessCoordinateState.set(doc, state);
  }
  return state;
}

const aimchessHideCoordinatesFeature = {
  id: 'aimchessHideCoordinates',
  name: 'Hide Aimchess board coordinates',
  description: 'Removes rank/file labels on Aimchess boards so the geometry stays in focus.',
  storageKey: 'literategoggles.features.aimchessHideCoordinates.enabled',
  defaultEnabled: false,
  appliesTo(location) {
    return /(^|\.)aimchess\.com$/i.test(location.hostname);
  },
  onEnable({ document }) {
    const body = document?.body;
    if (!body) {
      return;
    }

    const state = getAimchessState(document);

    const removeCoordinates = (rootNode = document) => {
      if (!rootNode || typeof rootNode.querySelectorAll !== 'function') {
        return;
      }
      const candidates = rootNode.querySelectorAll('svg.cm-chessboard .coordinates');
      candidates.forEach((node) => {
        if (!node || !node.isConnected) {
          return;
        }
        const parent = node.parentNode;
        if (!parent) {
          return;
        }
        state.removedNodes.push({
          parent,
          node,
          nextSibling: node.nextSibling
        });
        parent.removeChild(node);
      });
    };

    state.removeCoordinates = removeCoordinates;

    removeCoordinates(document);

    if (state.observer) {
      state.observer.disconnect();
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((addedNode) => {
          if (addedNode.nodeType !== Node.ELEMENT_NODE) {
            return;
          }
          removeCoordinates(addedNode);
        });
      });
    });

    observer.observe(body, { childList: true, subtree: true });
    state.observer = observer;
  },
  onDisable({ document }) {
    const state = aimchessCoordinateState.get(document);
    if (!state) {
      return;
    }

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    state.removedNodes.forEach((entry) => {
      const { parent, node, nextSibling } = entry;
      if (!parent || !node) {
        return;
      }
      if (node.isConnected) {
        return;
      }
      try {
        if (nextSibling && nextSibling.parentNode === parent) {
          parent.insertBefore(node, nextSibling);
        } else {
          parent.appendChild(node);
        }
      } catch {
        // If reinsertion fails we silently ignore; the user can refresh the page.
      }
    });
    state.removedNodes = [];
    delete state.removeCoordinates;
  }
};

const LITERATEGOGGLES_FEATURES = [
  leetCodeDifficultyFeature,
  aimchessHideCoordinatesFeature
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
