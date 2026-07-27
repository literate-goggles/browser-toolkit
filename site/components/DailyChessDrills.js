"use client";

import { Chess } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import {
  formatEngineScore,
  lineToSan,
  moveToSan,
  StockfishClient,
} from "@/lib/stockfish";


const MAX_WRONG_TRIES = 3;

async function responseError(response) {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
  } catch {
    // Use the status fallback.
  }
  return `Request failed (${response.status})`;
}

function loadProgress(storageKey) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveProgress(storageKey, progress) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(progress));
  } catch {
    // Practice still works if local storage is unavailable.
  }
}

function resultLabel(result) {
  if (result === "Win") return "won";
  if (result === "Loss") return "lost";
  if (result === "Draw") return "drew";
  return result.toLowerCase();
}

function acceptedMove(drill, uci) {
  return drill.acceptedMoves.find((move) => move.uci === uci);
}

function acceptedMoveNames(drill) {
  return drill.acceptedMoves.map((move) => move.san).join(" or ");
}

function VariationList({ drill, analysis }) {
  if (!analysis?.lines?.length) return null;
  return (
    <div className="chess-variation-list">
      <span>Stockfish comparison</span>
      {analysis.lines.map((line) => (
        <div key={`${line.multipv}-${line.moves[0]}`}>
          <strong>{formatEngineScore(line)}</strong>
          <code>{lineToSan(drill.fen, line.moves)}</code>
        </div>
      ))}
      <small>
        Evaluation is from the side-to-move perspective. The engine explains
        the position; it does not override an accepted repertoire move.
      </small>
    </div>
  );
}

function BookContinuations({ drill }) {
  return (
    <div className="chess-book-lines">
      <span>Accepted repertoire continuation</span>
      {drill.acceptedMoves.map((move) => (
        <div key={move.uci}>
          <strong>{move.san}</strong>
          <p>{move.continuation}</p>
          <small>{move.lineLabels.join(" / ")}</small>
        </div>
      ))}
    </div>
  );
}

export default function DailyChessDrills() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [progress, setProgress] = useState({});
  const [boardPosition, setBoardPosition] = useState("");
  const [feedback, setFeedback] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [engineError, setEngineError] = useState("");
  const [engineClient, setEngineClient] = useState(null);
  const [analysisNonce, setAnalysisNonce] = useState(0);
  const [selectedSquare, setSelectedSquare] = useState("");
  const analysisCache = useRef(new Map());

  const loadDrills = useCallback(async ({ refresh = false } = {}) => {
    setError("");
    if (refresh) setRefreshing(true);
    try {
      const suffix = refresh ? "?refresh=true" : "";
      const response = await fetch(`/api/daily/chess${suffix}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const next = await response.json();
      setPayload(next);
      setActiveIndex(0);
      if (refresh) analysisCache.current.clear();
    } catch (loadError) {
      setError(loadError.message || "Could not load chess drills.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDrills();
  }, [loadDrills]);

  useEffect(() => {
    const client = new StockfishClient();
    setEngineClient(client);
    return () => client.terminate();
  }, []);

  const digest = payload?.digest;
  const drills = digest?.drills || [];
  const drill = drills[activeIndex];
  const storageKey = digest
    ? `daily-chess-repertoire:${digest.date}:${digest.username}:v2`
    : "";

  useEffect(() => {
    if (!storageKey) return;
    setProgress(loadProgress(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (!drill) return;
    setBoardPosition(drill.fen);
    setFeedback("");
    setEngineError("");
    setSelectedSquare("");
    const cached = analysisCache.current.get(drill.positionKey);
    if (cached) {
      setAnalysis(cached);
      return;
    }
    setAnalysis(null);
    if (!engineClient) return;
    let cancelled = false;
    void engineClient
      .analyze(drill.fen)
      .then((result) => {
        analysisCache.current.set(drill.positionKey, result);
        if (!cancelled) setAnalysis(result);
      })
      .catch((analysisError) => {
        if (!cancelled) {
          setEngineError(
            analysisError.message || "Stockfish could not analyze this position.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [analysisNonce, drill, engineClient]);

  const activeProgress = drill ? progress[drill.id] : null;
  const wrongMoves = activeProgress?.wrongMoves || [];
  const triesLeft = Math.max(0, MAX_WRONG_TRIES - wrongMoves.length);
  const finished = Boolean(activeProgress?.status);
  const solvedCorrectly = activeProgress?.status === "correct";

  const writeProgress = useCallback(
    (drillId, entry) => {
      setProgress((current) => {
        const next = { ...current, [drillId]: entry };
        if (storageKey) saveProgress(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const submitMove = useCallback(
    ({ sourceSquare, targetSquare }) => {
      if (!drill || finished || !targetSquare) return false;
      const game = new Chess(drill.fen);
      let move;
      try {
        move = game.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: "q",
        });
      } catch {
        setFeedback("That move is not legal. It does not use a try.");
        return false;
      }
      if (!move) {
        setFeedback("That move is not legal. It does not use a try.");
        return false;
      }

      const uci = `${move.from}${move.to}${move.promotion || ""}`;
      const bookMove = acceptedMove(drill, uci);
      if (bookMove) {
        writeProgress(drill.id, {
          status: "correct",
          wrongMoves,
          solvedMove: uci,
        });
        setBoardPosition(game.fen());
        const engineComparison = analysis?.bestMove
          ? analysis.bestMove === uci
            ? " Stockfish also ranks it first."
            : ` Stockfish prefers ${moveToSan(drill.fen, analysis.bestMove)}, but your book move is fully accepted.`
          : "";
        setFeedback(
          `Correct repertoire move: ${move.san}.${engineComparison}`,
        );
        return true;
      }

      const nextWrongMoves = [...wrongMoves, { uci, san: move.san }];
      const exhausted = nextWrongMoves.length >= MAX_WRONG_TRIES;
      writeProgress(drill.id, {
        status: exhausted ? "failed" : "",
        wrongMoves: nextWrongMoves,
        solvedMove: "",
      });
      setFeedback(
        exhausted
          ? `Three tries used. Your repertoire move is ${acceptedMoveNames(drill)}.`
          : `${move.san} is legal, but it is not in your repertoire here. ${
              MAX_WRONG_TRIES - nextWrongMoves.length
            } ${nextWrongMoves.length === 2 ? "try" : "tries"} left.`,
      );
      return false;
    },
    [analysis, drill, finished, writeProgress, wrongMoves],
  );

  const reveal = useCallback(() => {
    if (!drill || finished) return;
    writeProgress(drill.id, {
      status: "failed",
      wrongMoves,
      solvedMove: "",
    });
    setFeedback(`Revealed: play ${acceptedMoveNames(drill)}.`);
  }, [drill, finished, writeProgress, wrongMoves]);

  const selectOrMove = useCallback(
    ({ piece, square }) => {
      if (!drill || finished) return;
      if (selectedSquare) {
        if (selectedSquare !== square) {
          submitMove({
            sourceSquare: selectedSquare,
            targetSquare: square,
          });
        }
        setSelectedSquare("");
        return;
      }
      const expectedPrefix = drill.sideToMove === "white" ? "w" : "b";
      if (piece?.pieceType?.startsWith(expectedPrefix)) {
        setSelectedSquare(square);
        setFeedback(`Selected ${square}. Choose its destination square.`);
      }
    },
    [drill, finished, selectedSquare, submitMove],
  );

  const answerArrow = useMemo(() => {
    if (!drill || !finished) return [];
    const uci = activeProgress?.solvedMove || drill.primaryMoveUci;
    return [
      {
        startSquare: uci.slice(0, 2),
        endSquare: uci.slice(2, 4),
        color: "rgba(204, 92, 56, 0.82)",
      },
    ];
  }, [activeProgress?.solvedMove, drill, finished]);

  const boardOptions = useMemo(
    () => ({
      id: drill ? `daily-opening-${drill.id}` : "daily-opening-board",
      position: boardPosition || drill?.fen,
      boardOrientation: drill?.orientation || "white",
      allowDragging: Boolean(drill && !finished && triesLeft > 0),
      showNotation: true,
      animationDurationInMs: 180,
      onPieceDrop: submitMove,
      onSquareClick: selectOrMove,
      arrows: answerArrow,
      squareStyles: selectedSquare
        ? {
            [selectedSquare]: {
              boxShadow: "inset 0 0 0 4px rgba(204, 92, 56, 0.82)",
            },
          }
        : {},
      lightSquareStyle: { backgroundColor: "#e8e2d4" },
      darkSquareStyle: { backgroundColor: "#71877e" },
      boardStyle: {
        borderRadius: "12px",
        boxShadow: "0 18px 45px rgba(30, 42, 40, 0.16)",
      },
    }),
    [
      answerArrow,
      boardPosition,
      drill,
      finished,
      selectOrMove,
      selectedSquare,
      submitMove,
      triesLeft,
    ],
  );

  const completedCount = drills.filter(
    (item) => progress[item.id]?.status,
  ).length;
  const correctCount = drills.filter(
    (item) => progress[item.id]?.status === "correct",
  ).length;
  const completedGameCount = drills.filter(
    (item) => item.drillType === "game" && progress[item.id]?.status,
  ).length;
  const completedTheoryCount = drills.filter(
    (item) => item.drillType === "theory" && progress[item.id]?.status,
  ).length;

  return (
    <section
      className="daily-section daily-chess-section"
      aria-labelledby="chess-drills-heading"
    >
      <div className="daily-section-heading chess-section-heading">
        <div>
          <span>Opening repertoire</span>
          <h2 id="chess-drills-heading">Chess opening recall</h2>
        </div>
        <p>
          Five positions from your latest games and five deeper theory
          positions. Recall your book move; use Stockfish as a comparison, not
          a single-answer judge.
        </p>
      </div>

      {loading && !drill && (
        <div className="chess-drill-loading" role="status">
          <span className="chess-thinking-mark" aria-hidden="true">♞</span>
          <div>
            <strong>Matching games to your repertoire</strong>
            <p>Reading recent Chess.com games and building today's theory set.</p>
          </div>
        </div>
      )}

      {error && !drill && (
        <div className="math-error" role="alert">
          <strong>Chess drills are temporarily unavailable.</strong>
          <p>{error}</p>
          <button type="button" onClick={() => void loadDrills()}>
            Try again
          </button>
        </div>
      )}

      {payload?.warning && (
        <div className="math-warning" role="status">
          {payload.warning}
        </div>
      )}

      {drill && (
        <>
          <div className="chess-drill-toolbar">
            <div className="chess-progress-copy">
              <strong>
                Drill {activeIndex + 1} of {drills.length}
              </strong>
              <span>
                Games {completedGameCount}/5 / theory {completedTheoryCount}/5
                {" "}/ {correctCount} repertoire finds
              </span>
            </div>
            <div className="chess-progress-track" aria-hidden="true">
              <span
                style={{
                  width: `${(completedCount / drills.length) * 100}%`,
                }}
              />
            </div>
            <button
              type="button"
              className="chess-refresh-button"
              disabled={refreshing}
              onClick={() => void loadDrills({ refresh: true })}
            >
              {refreshing ? "Refreshing..." : "Pull newer games"}
            </button>
          </div>

          <div className="chess-drill-layout">
            <div className="chess-board-column">
              <div className="chess-board-frame">
                <Chessboard options={boardOptions} />
              </div>
              <div className="chess-tries" aria-label={`${triesLeft} tries left`}>
                {[0, 1, 2].map((index) => (
                  <span
                    className={index < triesLeft ? "is-live" : ""}
                    key={index}
                  />
                ))}
                <strong>{triesLeft} wrong tries left</strong>
                {!analysis && !engineError && (
                  <small>Stockfish comparison loading...</small>
                )}
              </div>
            </div>

            <div className="chess-drill-panel">
              <div className="chess-drill-meta">
                <span className={`is-${drill.drillType}`}>
                  {drill.drillType === "game" ? "Game sample" : "Theory book"}
                </span>
                <span>{drill.eco || "Opening"}</span>
                <span>Move {drill.moveNumber}</span>
                <span>{drill.playerColor} to move</span>
                {drill.occurrenceCount > 1 && (
                  <span>seen {drill.occurrenceCount} times</span>
                )}
              </div>
              <h3>{drill.repertoireTitle}</h3>
              <p className="chess-prompt">
                {drill.drillType === "game"
                  ? "This position occurred in one of your latest 100 games. Play an accepted move from your repertoire; your original move stays hidden until the drill ends."
                  : "This is a deeper position from your theory book. Recall the repertoire continuation, not merely the engine's first choice."}
              </p>
              <p className="chess-repertoire-note">{drill.repertoireNote}</p>

              {engineError && (
                <div className="chess-feedback is-error" role="alert">
                  <span>
                    {engineError} You can still complete the repertoire drill.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEngineError("");
                      setAnalysisNonce((value) => value + 1);
                    }}
                  >
                    Retry engine
                  </button>
                </div>
              )}

              {feedback && (
                <div
                  className={`chess-feedback ${
                    solvedCorrectly ? "is-correct" : ""
                  }`}
                  role="status"
                >
                  {feedback}
                </div>
              )}

              {wrongMoves.length > 0 && (
                <div className="chess-wrong-moves">
                  <span>Moves already tried</span>
                  <div>
                    {wrongMoves.map((move, index) => (
                      <code key={`${move.uci}-${index}`}>{move.san}</code>
                    ))}
                  </div>
                </div>
              )}

              <details className="chess-line-hint">
                <summary>Show moves leading to this position</summary>
                <p>{drill.movesBefore || "This is the starting position."}</p>
              </details>

              {!finished && (
                <button
                  type="button"
                  className="chess-reveal-button"
                  onClick={reveal}
                >
                  Reveal repertoire move
                </button>
              )}

              {finished && (
                <>
                  <div className="chess-answer-panel">
                    <div>
                      <span>Repertoire answer</span>
                      <strong>{acceptedMoveNames(drill)}</strong>
                      <small>Every listed book move counts as correct.</small>
                    </div>
                    <div>
                      <span>Stockfish first choice</span>
                      <strong>
                        {analysis?.bestMove
                          ? moveToSan(drill.fen, analysis.bestMove)
                          : "Calculating..."}
                      </strong>
                      <small>
                        {analysis
                          ? `Stockfish 18 / depth ${analysis.depth}`
                          : "The answer does not depend on the engine."}
                      </small>
                    </div>
                    {drill.drillType === "game" && (
                      <div>
                        <span>Your game move</span>
                        <strong>{drill.actualMoveSan}</strong>
                        <small>
                          {acceptedMove(drill, drill.actualMoveUci)
                            ? "You followed the repertoire in this game."
                            : "This game move departed from the saved repertoire."}
                        </small>
                      </div>
                    )}
                  </div>
                  <BookContinuations drill={drill} />
                  <VariationList drill={drill} analysis={analysis} />
                </>
              )}

              {drill.drillType === "game" ? (
                <div className="chess-game-source">
                  <div>
                    <span>Source game</span>
                    <strong>
                      vs {drill.opponent} ({drill.opponentRating})
                    </strong>
                    <small>
                      {drill.gameDate} / {drill.timeClass} / you{" "}
                      {resultLabel(drill.result)}
                    </small>
                  </div>
                  <a href={drill.gameUrl} target="_blank" rel="noreferrer">
                    Open game <span aria-hidden="true">↗</span>
                  </a>
                </div>
              ) : (
                <div className="chess-game-source">
                  <div>
                    <span>Theory source</span>
                    <strong>Personal repertoire book</strong>
                    <small>
                      Built from your declared choices and recurring profile
                      lines.
                    </small>
                  </div>
                  <a
                    href="https://github.com/lichess-org/chess-openings"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Opening data <span aria-hidden="true">↗</span>
                  </a>
                </div>
              )}
            </div>
          </div>

          <div className="chess-drill-navigation">
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex((index) => index - 1)}
            >
              Previous
            </button>
            <div role="tablist" aria-label="Chess drill positions">
              {drills.map((item, index) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={index === activeIndex}
                  aria-label={`Open ${item.drillType} chess drill ${index + 1}`}
                  title={
                    item.drillType === "game"
                      ? "Recent game position"
                      : "Opening theory position"
                  }
                  className={[
                    item.drillType === "theory" ? "is-theory" : "is-game",
                    progress[item.id]?.status
                      ? `is-${progress[item.id].status}`
                      : "",
                  ].join(" ")}
                  onClick={() => setActiveIndex(index)}
                  key={item.id}
                >
                  {index + 1}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={activeIndex === drills.length - 1}
              onClick={() => setActiveIndex((index) => index + 1)}
            >
              Next
            </button>
          </div>

          <p className="chess-engine-credit">
            The first five positions are matched from{" "}
            <a href={digest.profileUrl} target="_blank" rel="noreferrer">
              your public Chess.com archive
            </a>
            ; the final five come from the checked-in repertoire. Opening names
            use the{" "}
            <a
              href="https://github.com/lichess-org/chess-openings"
              target="_blank"
              rel="noreferrer"
            >
              Lichess CC0 opening dataset
            </a>
            . Optional comparison runs locally with{" "}
            <a
              href="https://github.com/nmrugg/stockfish.js"
              target="_blank"
              rel="noreferrer"
            >
              Stockfish.js 18
            </a>
            . {digest.gamesAnalyzed} recent games yielded{" "}
            {digest.candidatePositions} repertoire-matched positions.
          </p>
        </>
      )}
    </section>
  );
}
