import { Chess } from "chess.js";


const ENGINE_URL = "/stockfish/stockfish-18-lite-single.js";
const ENGINE_DEPTH = 15;
const MULTI_PV = 3;

function valueAfter(tokens, name) {
  const index = tokens.indexOf(name);
  return index >= 0 ? tokens[index + 1] : undefined;
}

function parseInfo(line) {
  const tokens = line.trim().split(/\s+/);
  const pvIndex = tokens.indexOf("pv");
  const scoreIndex = tokens.indexOf("score");
  if (tokens[0] !== "info" || pvIndex < 0 || scoreIndex < 0) {
    return null;
  }
  const scoreType = tokens[scoreIndex + 1];
  const scoreValue = Number.parseInt(tokens[scoreIndex + 2], 10);
  const depth = Number.parseInt(valueAfter(tokens, "depth") || "0", 10);
  const multipv = Number.parseInt(valueAfter(tokens, "multipv") || "1", 10);
  if (
    !["cp", "mate"].includes(scoreType) ||
    Number.isNaN(scoreValue) ||
    Number.isNaN(depth) ||
    Number.isNaN(multipv)
  ) {
    return null;
  }
  return {
    depth,
    multipv,
    scoreType,
    scoreValue,
    moves: tokens.slice(pvIndex + 1),
  };
}

export function uciMoveParts(uci) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

export function lineToSan(fen, moves, limit = 6) {
  const game = new Chess(fen);
  const sanMoves = [];
  for (const uci of moves.slice(0, limit)) {
    try {
      const move = game.move(uciMoveParts(uci));
      if (!move) break;
      sanMoves.push(move.san);
    } catch {
      break;
    }
  }
  return sanMoves.join(" ");
}

export function moveToSan(fen, uci) {
  return lineToSan(fen, [uci], 1) || uci;
}

export function formatEngineScore(line) {
  if (!line) return "No evaluation";
  if (line.scoreType === "mate") {
    if (line.scoreValue === 0) return "Checkmate";
    return line.scoreValue > 0
      ? `Mate in ${line.scoreValue}`
      : `Mated in ${Math.abs(line.scoreValue)}`;
  }
  const pawns = line.scoreValue / 100;
  const sign = pawns > 0 ? "+" : "";
  return `${sign}${pawns.toFixed(2)}`;
}

export class StockfishClient {
  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.ready = false;
    this.current = null;
    this.lines = new Map();
    this.queue = Promise.resolve();
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.addEventListener("message", (event) => {
      this.handleLine(String(event.data || ""));
    });
    this.worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "Stockfish worker failed");
      this.rejectReady?.(error);
      this.rejectCurrent(error);
    });
    this.worker.postMessage("uci");
  }

  handleLine(rawLine) {
    for (const line of rawLine.split("\n")) {
      if (line === "uciok") {
        this.worker.postMessage(`setoption name MultiPV value ${MULTI_PV}`);
        this.worker.postMessage("isready");
        continue;
      }
      if (line === "readyok" && !this.ready) {
        this.ready = true;
        this.resolveReady();
        continue;
      }
      if (!this.current) continue;
      if (line.startsWith("info ")) {
        const info = parseInfo(line);
        if (info && info.moves.length) {
          const previous = this.lines.get(info.multipv);
          if (!previous || info.depth >= previous.depth) {
            this.lines.set(info.multipv, info);
          }
        }
        continue;
      }
      if (line.startsWith("bestmove ")) {
        const bestMove = line.split(/\s+/)[1];
        const analysisLines = [...this.lines.values()].sort(
          (left, right) => left.multipv - right.multipv,
        );
        const resolve = this.current.resolve;
        window.clearTimeout(this.current.timeout);
        this.current = null;
        resolve({
          bestMove,
          depth: analysisLines[0]?.depth || ENGINE_DEPTH,
          lines: analysisLines,
        });
      }
    }
  }

  rejectCurrent(error) {
    if (!this.current) return;
    window.clearTimeout(this.current.timeout);
    const reject = this.current.reject;
    this.current = null;
    reject(error);
  }

  analyze(fen) {
    const run = async () => {
      await this.readyPromise;
      return new Promise((resolve, reject) => {
        this.lines = new Map();
        const timeout = window.setTimeout(() => {
          this.worker.postMessage("stop");
          this.rejectCurrent(new Error("Stockfish analysis timed out"));
        }, 30000);
        this.current = { resolve, reject, timeout };
        this.worker.postMessage("ucinewgame");
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go depth ${ENGINE_DEPTH}`);
      });
    };
    const result = this.queue.catch(() => undefined).then(run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  terminate() {
    this.rejectCurrent(new Error("Stockfish was stopped"));
    this.worker.postMessage("quit");
    this.worker.terminate();
  }
}
