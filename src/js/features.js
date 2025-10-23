const LITERATEGOGGLES_GLOBAL_STORAGE_KEY = "literategoggles.globalEnabled";

const leetCodeDifficultyFeature = {
  id: "leetcodeDifficultyHider",
  name: "Hide LeetCode difficulty badges",
  description:
    "Keeps LeetCode problem difficulty labels out of sight until you ask for them.",
  storageKey: "literategoggles.features.leetcodeDifficultyHider.enabled",
  defaultEnabled: true,
  appliesTo(location) {
    return /(^|\.)leetcode\.com$/i.test(location.hostname);
  },
  onEnable(context) {
    const targetDocument = context?.document;
    if (!targetDocument?.body) {
      return;
    }
    targetDocument.body.classList.add("lg-hide-leetcode-difficulty");
  },
  onDisable(context) {
    const targetDocument = context?.document;
    if (!targetDocument?.body) {
      return;
    }
    targetDocument.body.classList.remove("lg-hide-leetcode-difficulty");
  },
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
      observer: null,
    };
    aimchessCoordinateState.set(doc, state);
  }
  return state;
}

const aimchessHideCoordinatesFeature = {
  id: "aimchessHideCoordinates",
  name: "Hide Aimchess board coordinates",
  description:
    "Removes rank/file labels on Aimchess boards so the geometry stays in focus.",
  storageKey: "literategoggles.features.aimchessHideCoordinates.enabled",
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
      if (!rootNode || typeof rootNode.querySelectorAll !== "function") {
        return;
      }
      const candidates = rootNode.querySelectorAll(
        "svg.cm-chessboard .coordinates"
      );
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
          nextSibling: node.nextSibling,
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
  },
};

const chessDailyLimitState = new WeakMap();

const CHESS_DAILY_LIMIT_QUOTES = [
  "Congratulations, Magnus Blundsen. You've proven once again that overthinking doesn't equal intelligence.",
  "You don't need more chess practice; you need a hobby that doesn't expose your IQ in public.",
  "Every move you make is a love letter to mediocrity.",
  "You're not playing chess--you're performing a slow, expensive brain autopsy.",
  "Even Stockfish closed the window in disgust.",
  "At this point, your queen resigns herself before you even move.",
  "You could've learned a new language by now, but instead you've learned 10,000 ways to lose slightly slower.",
  "Do yourself a favor: go outside, touch grass, and apologize to it for wasting oxygen indoors.",
  "You don't need more openings; you need closure.",
  "The only thing you're mastering is how to emotionally recover from blunders.",
  "Mild Brain Damage Detected.",
  "Your knight just moved like it's drunk and homesick.",
  'Stop calling it a "strategy." It\'s just panic with extra steps.',
  "You play chess like your mouse has trust issues.",
  "I've seen better board control from toddlers with checkers.",
  "You think you're being unpredictable, but so does your prefrontal cortex.",
  "You've blundered so many times the pieces are filing HR complaints.",
  "Your Elo isn't low, it's subterranean.",
  "You just sacrificed your queen and your dignity.",
  "The only fork you're good at involves spaghetti.",
  'Imagine losing to someone named "HorseyLover420"--oh wait, you did.',
  "You're not in a chess game. You're in a live demonstration of self-sabotage.",
  "Even the pawns pity you now.",
  "At this point, losing gracefully is your only opening.",
  "Somewhere, a grandmaster just woke up in a cold sweat and doesn't know why.",
  "Every move you make lowers humanity's collective IQ by one point.",
  "Uninstall. Reinstall. Then uninstall again. For everyone's sake.",
  "You've turned a game of logic into interpretive dance.",
  "If this was war, your own troops would defect out of mercy.",
  "Your brain's connection timed out three moves ago.",
];

function getChessDailyLimitState(doc) {
  if (!doc) {
    return null;
  }
  let state = chessDailyLimitState.get(doc);
  if (!state) {
    state = {
      overlay: null,
      requestToken: 0,
      aborted: false,
      bodyReadyHandler: null,
    };
    chessDailyLimitState.set(doc, state);
  }
  return state;
}

function detachChessOverlay(document, state) {
  if (!state) {
    return;
  }
  if (state.bodyReadyHandler) {
    document.removeEventListener("DOMContentLoaded", state.bodyReadyHandler);
    state.bodyReadyHandler = null;
  }
  if (state.overlay && state.overlay.isConnected) {
    state.overlay.remove();
    console.info("LiterateGoggles: Chess daily limit overlay removed.");
  }
  state.overlay = null;
}

function ensureChessOverlay(document, state) {
  if (!document || !state || state.aborted) {
    return;
  }

  const attach = () => {
    if (state.aborted) {
      return;
    }
    if (state.overlay && state.overlay.isConnected) {
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "lg-chess-daily-limit";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.backgroundColor = "#000";
    overlay.style.color = "#fff";
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "2rem";
    overlay.style.textAlign = "center";
    overlay.style.fontFamily =
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    overlay.style.fontSize = "clamp(1.5rem, 4vw, 2.75rem)";
    overlay.style.lineHeight = "1.4";
    overlay.style.gap = "1.5rem";

    const headline = document.createElement("h1");
    const quoteIndex = Math.floor(
      Math.random() * CHESS_DAILY_LIMIT_QUOTES.length
    );
    const quote =
      CHESS_DAILY_LIMIT_QUOTES[Number.isNaN(quoteIndex) ? 0 : quoteIndex] ||
      "Stop playing. Go do nice things / studying.";
    headline.textContent = quote;
    headline.style.margin = "0";
    headline.style.fontSize = "inherit";
    headline.style.fontWeight = "600";

    const subline = document.createElement("p");
    subline.textContent =
      "You have already played more than three games today on Chess.com.";
    subline.style.margin = "0";
    subline.style.fontSize = "1rem";
    subline.style.opacity = "0.8";

    overlay.appendChild(headline);
    overlay.appendChild(subline);

    document.body.appendChild(overlay);
    console.info("LiterateGoggles: Chess daily limit overlay attached.", {
      quote,
    });
    state.overlay = overlay;
  };

  if (document.body) {
    attach();
    return;
  }

  const handler = () => {
    document.removeEventListener("DOMContentLoaded", handler);
    state.bodyReadyHandler = null;
    attach();
  };

  state.bodyReadyHandler = handler;
  document.addEventListener("DOMContentLoaded", handler, { once: true });
}

async function checkChessDailyLimit(document, win, state) {
  if (!document || !win || !state) {
    return;
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthSegment = month.toString().padStart(2, "0");
  const url = `https://api.chess.com/pub/player/unlimited_bezdarnost/games/${year}/${monthSegment}`;

  console.info("LiterateGoggles: Checking Chess.com daily limit.", {
    url,
    nextRequestToken: state.requestToken + 1,
  });

  const requestToken = ++state.requestToken;

  try {
    const response = await win.fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Unexpected response status ${response.status}`);
    }
    const payload = await response.json();
    if (state.aborted || state.requestToken !== requestToken) {
      console.info(
        "LiterateGoggles: Chess daily limit check aborted or superseded.",
        {
          aborted: state.aborted,
          activeToken: state.requestToken,
          completedToken: requestToken,
        }
      );
      return;
    }
    const games = Array.isArray(payload?.games) ? payload.games : [];
    console.info("LiterateGoggles: Chess daily limit response received.", {
      totalGamesInMonth: games.length,
    });
    const todayYear = now.getFullYear();
    const todayMonth = now.getMonth();
    const todayDate = now.getDate();

    let gamesToday = 0;
    games.forEach((game) => {
      if (!game) {
        return;
      }
      let gameDate = null;
      if (typeof game.end_time === "number" && Number.isFinite(game.end_time)) {
        gameDate = new Date(game.end_time * 1000);
      } else if (typeof game.end_time === "string") {
        const parsed = Number.parseInt(game.end_time, 10);
        if (!Number.isNaN(parsed)) {
          gameDate = new Date(parsed * 1000);
        }
      }

      if (!gameDate && typeof game.pgn === "string") {
        const dateMatch = game.pgn.match(
          /\[Date\s+"(\d{4})\.(\d{2})\.(\d{2})"\]/
        );
        if (dateMatch) {
          const [, yearText, monthText, dayText] = dateMatch;
          const parsedYear = Number.parseInt(yearText, 10);
          const parsedMonth = Number.parseInt(monthText, 10);
          const parsedDay = Number.parseInt(dayText, 10);
          if (
            !Number.isNaN(parsedYear) &&
            !Number.isNaN(parsedMonth) &&
            !Number.isNaN(parsedDay)
          ) {
            gameDate = new Date(parsedYear, parsedMonth - 1, parsedDay);
          }
        }
      }

      if (!gameDate) {
        return;
      }

      if (
        gameDate.getFullYear() === todayYear &&
        gameDate.getMonth() === todayMonth &&
        gameDate.getDate() === todayDate
      ) {
        gamesToday += 1;
      }
    });

    if (gamesToday > 3) {
      console.warn("LiterateGoggles: Chess daily limit reached.", {
        gamesToday,
      });
      ensureChessOverlay(document, state);
    } else {
      console.info("LiterateGoggles: Chess daily limit not reached.", {
        gamesToday,
      });
      detachChessOverlay(document, state);
    }
  } catch (error) {
    console.warn(
      "LiterateGoggles: failed to enforce Chess.com daily limit.",
      error
    );
  }
}

const chessDailyLimitFeature = {
  id: "chessDailyLimit",
  name: "Chess.com daily limiter",
  description:
    "Blocks Chess.com with a black overlay if you already played more than three games today.",
  storageKey: "literategoggles.features.chessDailyLimit.enabled",
  defaultEnabled: true,
  appliesTo(location) {
    return /(^|\.)chess\.com$/i.test(location.hostname);
  },
  onEnable({ document, window }) {
    const state = getChessDailyLimitState(document);
    if (!state) {
      return;
    }
    state.aborted = false;
    console.info("LiterateGoggles: Chess daily limit feature enabled.");
    checkChessDailyLimit(document, window, state);
  },
  onDisable({ document }) {
    const state = chessDailyLimitState.get(document);
    if (!state) {
      return;
    }
    state.aborted = true;
    console.info("LiterateGoggles: Chess daily limit feature disabled.");
    detachChessOverlay(document, state);
  },
};

const LITERATEGOGGLES_FEATURES = [
  leetCodeDifficultyFeature,
  aimchessHideCoordinatesFeature,
  chessDailyLimitFeature,
];

if (!globalThis.LiterateGoggles) {
  globalThis.LiterateGoggles = {};
}

Object.assign(globalThis.LiterateGoggles, {
  features: LITERATEGOGGLES_FEATURES,
  globalStorageKey: LITERATEGOGGLES_GLOBAL_STORAGE_KEY,
  getFeatureById(featureId) {
    return (
      LITERATEGOGGLES_FEATURES.find((feature) => feature.id === featureId) ||
      null
    );
  },
});
