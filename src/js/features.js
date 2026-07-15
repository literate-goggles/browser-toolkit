const LITERATEGOGGLES_GLOBAL_STORAGE_KEY = "literategoggles.globalEnabled";

const LITERATEGOGGLES_CONFIG =
  globalThis.LiterateGogglesConfig || Object.create(null);
const LITERATEGOGGLES_DEFAULT_CONFIG =
  globalThis.LiterateGogglesDefaultConfig || Object.create(null);

const CHESS_DAILY_GAME_LIMIT =
  typeof LITERATEGOGGLES_CONFIG.chessDailyGameLimit === "number" &&
  Number.isFinite(LITERATEGOGGLES_CONFIG.chessDailyGameLimit)
    ? LITERATEGOGGLES_CONFIG.chessDailyGameLimit
    : LITERATEGOGGLES_DEFAULT_CONFIG.chessDailyGameLimit;

const CHESS_MANUAL_BLOCK_STORAGE_KEY =
  "literategoggles.features.chessDailyLimit.manualBlockUntil";

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

function getEndOfDayTimestamp(now = new Date()) {
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay.getTime();
}

function formatAvailability(timestamp) {
  if (typeof timestamp !== "number" || Number.isNaN(timestamp)) {
    return "tomorrow";
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

function getChessDailyGameLimit() {
  if (
    typeof CHESS_DAILY_GAME_LIMIT === "number" &&
    Number.isFinite(CHESS_DAILY_GAME_LIMIT)
  ) {
    return CHESS_DAILY_GAME_LIMIT;
  }
  const fallback = LITERATEGOGGLES_DEFAULT_CONFIG.chessDailyGameLimit;
  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return fallback;
  }
  return null;
}

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

const stepchessCoordinateState = new WeakMap();

function getStepchessState(doc) {
  if (!doc) {
    return null;
  }
  let state = stepchessCoordinateState.get(doc);
  if (!state) {
    state = {
      removedNodes: [],
      observer: null,
    };
    stepchessCoordinateState.set(doc, state);
  }
  return state;
}

const stepchessHideCoordinatesFeature = {
  id: "stepchessHideCoordinates",
  name: "Hide StepChess board coordinates",
  description:
    "Removes rank/file labels on StepChess boards to keep you focused on structure.",
  storageKey: "literategoggles.features.stepchessHideCoordinates.enabled",
  defaultEnabled: false,
  appliesTo(location) {
    return /(^|\.)stepchess\.ru$/i.test(location.hostname);
  },
  onEnable({ document }) {
    const body = document?.body;
    if (!body) {
      return;
    }

    const state = getStepchessState(document);
    if (!state) {
      return;
    }

    state.removedNodes = [];

    const removeCoordinates = (rootNode = document) => {
      if (!rootNode || typeof rootNode.querySelectorAll !== "function") {
        return;
      }
      ["coords.ranks", "coords.files"].forEach((selector) => {
        rootNode.querySelectorAll(selector).forEach((node) => {
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
    const state = stepchessCoordinateState.get(document);
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
  "Your opening theory peaked at 'I move pawn forward, yes?'",
  "Bobby Fischer is spinning in his grave hard enough to power a small village.",
  "You blundered so loudly the neighbors complained.",
  "Even your bishop is having a crisis of faith.",
  "If chess.com had a refund policy for your dignity, you'd be rich.",
  "Your rating graph looks like a stock right before bankruptcy.",
  "You're not stuck in a losing streak; you're its founding member.",
  "The engine evaluation just sighed and asked for a smoke break.",
  "Your endgame technique is mostly hoping the other player has a stroke.",
  "Touching grass would be a tactical improvement.",
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
      overlayObserver: null,
      manualBlockUntil: null,
      storageListener: null,
      currentBlockInfo: null,
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
  if (state.overlayObserver) {
    state.overlayObserver.disconnect();
    state.overlayObserver = null;
  }
  if (state.overlay && state.overlay.isConnected) {
    state.overlay.remove();
    console.info("LiterateGoggles: Chess daily limit overlay removed.");
  }
  state.overlay = null;
  state.overlayParts = null;
  state.currentBlockInfo = null;
}

function ensureChessOverlayPersistence(document, state) {
  if (!document || !state || state.overlayObserver || !state.overlay) {
    return;
  }

  const root = document.documentElement || document;
  if (!root) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (!state.overlay || state.aborted) {
      return;
    }
    const body = document.body;
    if (!body || body.contains(state.overlay)) {
      return;
    }
    try {
      body.appendChild(state.overlay);
      const quote = state.overlay.dataset?.lgChessQuote;
      if (quote) {
        console.info(
          "LiterateGoggles: Chess daily limit overlay automatically reinserted after DOM mutation.",
          { quote }
        );
      } else {
        console.info(
          "LiterateGoggles: Chess daily limit overlay automatically reinserted after DOM mutation."
        );
      }
    } catch (error) {
      console.log(
        "LiterateGoggles: Failed to reinsert Chess daily limit overlay after DOM mutation.",
        error
      );
    }
  });

  observer.observe(root, { childList: true, subtree: true });
  state.overlayObserver = observer;
}

function ensureChessOverlay(document, state, blockInfo) {
  if (!document || !state || state.aborted || !blockInfo) {
    return;
  }

  state.currentBlockInfo = blockInfo;

  const attach = () => {
    if (state.aborted) {
      return;
    }

    const body = document.body;
    if (!body) {
      return;
    }

    let overlay = state.overlay;
    let overlayCreated = false;

    if (!overlay) {
      overlayCreated = true;
      overlay = document.createElement("div");
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
      overlay.style.gap = "1rem";

      const headline = document.createElement("h1");
      headline.className = "lg-chess-headline";
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
      subline.className = "lg-chess-subline";
      subline.style.margin = "0";
      subline.style.fontSize = "1rem";
      subline.style.opacity = "0.85";

      const availability = document.createElement("p");
      availability.className = "lg-chess-availability";
      availability.style.margin = "0";
      availability.style.fontSize = "0.95rem";
      availability.style.opacity = "0.75";

      overlay.appendChild(headline);
      overlay.appendChild(subline);
      overlay.appendChild(availability);
      overlay.dataset.lgChessQuote = quote;
      state.overlayParts = { headline, subline, availability };

      state.overlay = overlay;
    }

    const { headline, subline, availability } = state.overlayParts || {};
    const overlayWasConnected = overlay.isConnected;

    const limitValue = getChessDailyGameLimit();
    const limitNumeric =
      typeof limitValue === "number" && Number.isFinite(limitValue)
        ? limitValue
        : null;
    const limitText = limitNumeric === null ? "a few" : `${limitNumeric}`;
    const gameWord = limitNumeric === 1 ? "game" : "games";
    const reachedText =
      limitNumeric === null ? "the daily limit" : `${limitText} ${gameWord}`;

    const availabilityText = blockInfo.availableAt
      ? `This site unlocks at ${formatAvailability(blockInfo.availableAt)}.`
      : "This site unlocks tomorrow.";

    if (subline) {
      if (blockInfo.reason === "manual") {
        subline.textContent =
          "FilthLatch engaged. You volunteered to wall off Chess.com for the rest of today.";
      } else if (blockInfo.reason === "afternoon") {
        subline.textContent =
          "It's past noon. Afternoons are for real work — chess.com and taketaketake.com stay locked until tomorrow.";
      } else {
        const gamesText =
          typeof blockInfo.gamesToday === "number" &&
          Number.isFinite(blockInfo.gamesToday)
            ? `${blockInfo.gamesToday} ${gameWord}`
            : reachedText;
        subline.textContent = `You have already played ${gamesText} today on Chess.com. Once you reach ${reachedText}, the site pauses until tomorrow.`;
      }
    }

    if (availability) {
      availability.textContent = availabilityText;
    }

    overlay.dataset.lgChessReason = blockInfo.reason || "";
    overlay.dataset.lgChessAvailableAt =
      typeof blockInfo.availableAt === "number" && Number.isFinite(blockInfo.availableAt)
        ? String(blockInfo.availableAt)
        : "";

    if (!body.contains(overlay)) {
      body.appendChild(overlay);
      const quoteForLog = overlay.dataset?.lgChessQuote || null;
      if (overlayCreated) {
        if (quoteForLog) {
          console.info("LiterateGoggles: Chess daily limit overlay attached.", {
            quote: quoteForLog,
          });
        } else {
          console.info("LiterateGoggles: Chess daily limit overlay attached.");
        }
      } else if (!overlayWasConnected) {
        if (quoteForLog) {
          console.info(
            "LiterateGoggles: Chess daily limit overlay reattached.",
            { quote: quoteForLog }
          );
        } else {
          console.info(
            "LiterateGoggles: Chess daily limit overlay reattached."
          );
        }
      }
    }

    ensureChessOverlayPersistence(document, state);
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

function setChessBlock(document, state, blockInfo) {
  if (blockInfo) {
    ensureChessOverlay(document, state, blockInfo);
  } else {
    detachChessOverlay(document, state);
  }
}

async function checkChessDailyLimit(document, win, state) {
  if (!document || !win || !state) {
    return;
  }

  const manualUntil = normalizeTimestamp(state.manualBlockUntil);
  if (manualUntil && manualUntil > Date.now()) {
    setChessBlock(document, state, {
      reason: "manual",
      availableAt: manualUntil,
    });
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

    const limitValue = getChessDailyGameLimit();
    const limitNumeric =
      typeof limitValue === "number" && Number.isFinite(limitValue)
        ? limitValue
        : null;

    const manualNow = normalizeTimestamp(state.manualBlockUntil);
    if (manualNow && manualNow > Date.now()) {
      setChessBlock(document, state, {
        reason: "manual",
        availableAt: manualNow,
      });
      return;
    }

    if (limitNumeric === null) {
      console.info(
        "LiterateGoggles: Chess daily limit configuration missing or invalid. Skipping enforcement.",
        { gamesToday, limitValue }
      );
      setChessBlock(document, state, null);
      return;
    }

    const availableAt = getEndOfDayTimestamp(now);

    if (gamesToday >= limitNumeric) {
      console.log("LiterateGoggles: Chess daily limit reached.", {
        gamesToday,
        limit: limitNumeric,
      });
      setChessBlock(document, state, {
        reason: "limit",
        gamesToday,
        limit: limitNumeric,
        availableAt,
      });
    } else {
      console.info("LiterateGoggles: Chess daily limit not reached.", {
        gamesToday,
        limit: limitNumeric,
      });
      setChessBlock(document, state, null);
    }
  } catch (error) {
    console.log(
      "LiterateGoggles: failed to enforce Chess.com daily limit.",
      error
    );
  }
}

async function evaluateChessBlock(document, win, state) {
  if (!document || !win || !state || state.aborted) {
    return;
  }

  const nowDate = new Date();
  if (nowDate.getHours() >= 12) {
    setChessBlock(document, state, {
      reason: "afternoon",
      availableAt: getEndOfDayTimestamp(nowDate),
    });
    return;
  }

  const isChessCom = /(^|\.)chess\.com$/i.test(win.location.hostname);
  if (!isChessCom) {
    setChessBlock(document, state, null);
    return;
  }

  const manualUntil = normalizeTimestamp(state.manualBlockUntil);
  const now = Date.now();

  if (manualUntil && manualUntil > now) {
    setChessBlock(document, state, {
      reason: "manual",
      availableAt: manualUntil,
    });
    return;
  }

  if (manualUntil && manualUntil <= now) {
    state.manualBlockUntil = null;
    try {
      chrome.storage.sync.remove(CHESS_MANUAL_BLOCK_STORAGE_KEY);
    } catch (error) {
      console.log(
        "LiterateGoggles: Failed to clear expired manual Chess.com block.",
        error
      );
    }
  }

  await checkChessDailyLimit(document, win, state);
}

const CHESS_DAILY_LIMIT_IGNORED_URL_PREFIXES = [
  "https://www.chess.com/puzzles",
  "https://www.chess.com/daily",
  "https://www.chess.com/analysis",
  "https://www.chess.com/library",
  "https://www.chess.com/news/view",
];

const chessDailyLimitFeature = {
  id: "chessDailyLimit",
  name: "Chess.com daily limiter",
  description:
    "Blocks Chess.com with a black overlay after three games and offers a FilthLatch manual lock for the rest of the day.",
  storageKey: "literategoggles.features.chessDailyLimit.enabled",
  defaultEnabled: true,
  bypassGlobal: true,
  appliesTo(location) {
    if (!location) {
      return false;
    }
    if (/(^|\.)taketaketake\.com$/i.test(location.hostname)) {
      return true;
    }
    if (!/(^|\.)chess\.com$/i.test(location.hostname)) {
      return false;
    }

    const href = typeof location.href === "string" ? location.href : "";
    const shouldIgnore = CHESS_DAILY_LIMIT_IGNORED_URL_PREFIXES.some((prefix) =>
      href.startsWith(prefix)
    );
    return !shouldIgnore;
  },
  onEnable({ document, window }) {
    const state = getChessDailyLimitState(document);
    if (!state) {
      return;
    }
    state.aborted = false;
    console.info("LiterateGoggles: Chess daily limit feature enabled.");

    const applyManualBlock = (value) => {
      state.manualBlockUntil = normalizeTimestamp(value);
      evaluateChessBlock(document, window, state);
    };

    try {
      chrome.storage.sync.get(CHESS_MANUAL_BLOCK_STORAGE_KEY, (result) => {
        if (state.aborted) {
          return;
        }
        applyManualBlock(result?.[CHESS_MANUAL_BLOCK_STORAGE_KEY]);
      });
    } catch (error) {
      console.log(
        "LiterateGoggles: Failed to read manual Chess.com block state.",
        error
      );
      evaluateChessBlock(document, window, state);
    }

    const handleStorageChange = (changes, area) => {
      if (area !== "sync") {
        return;
      }
      if (CHESS_MANUAL_BLOCK_STORAGE_KEY in changes) {
        applyManualBlock(changes[CHESS_MANUAL_BLOCK_STORAGE_KEY].newValue);
      }
    };

    state.storageListener = handleStorageChange;
    chrome.storage.onChanged.addListener(handleStorageChange);
  },
  onDisable({ document }) {
    const state = chessDailyLimitState.get(document);
    if (!state) {
      return;
    }
    state.aborted = true;
    console.info("LiterateGoggles: Chess daily limit feature disabled.");
    if (state.storageListener) {
      chrome.storage.onChanged.removeListener(state.storageListener);
      state.storageListener = null;
    }
    detachChessOverlay(document, state);
  },
};

const englishVocabFeature = {
  id: "englishVocab",
  name: "English vocab quiz",
  description:
    "Every 15 minutes, a Chrome notification serves a new word from the book you're reading. Also available on demand from the popup.",
  storageKey: "literategoggles.features.englishVocab.enabled",
  defaultEnabled: true,
  appliesTo() {
    return false;
  },
};

const LITERATEGOGGLES_FEATURES = [
  leetCodeDifficultyFeature,
  aimchessHideCoordinatesFeature,
  stepchessHideCoordinatesFeature,
  chessDailyLimitFeature,
  englishVocabFeature,
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
