"use client";

import { Chess } from "chess.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";


const STORAGE_KEY = "daily-opening-names:v1";
const MAX_MOVE_TRIES = 3;

async function responseError(response) {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
  } catch {
    // Use the status fallback.
  }
  return `Request failed (${response.status})`;
}

function loadStoredProgress() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      attempted: Number.isInteger(parsed.attempted) ? parsed.attempted : 0,
      correct: Number.isInteger(parsed.correct)
        ? parsed.correct
        : Number.isInteger(parsed.known)
          ? parsed.known
          : 0,
    };
  } catch {
    return { attempted: 0, correct: 0 };
  }
}

function storeProgress(progress) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // The drill still works if local storage is unavailable.
  }
}

function acceptedMove(drill, uci) {
  return drill.nextMoves.find((move) => move.uci === uci);
}

export default function DailyOpeningNames() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [guess, setGuess] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [nameResult, setNameResult] = useState("");
  const [boardPosition, setBoardPosition] = useState("");
  const [selectedSquare, setSelectedSquare] = useState("");
  const [moveTries, setMoveTries] = useState([]);
  const [moveFeedback, setMoveFeedback] = useState("");
  const [moveFinished, setMoveFinished] = useState(false);
  const [solvedMove, setSolvedMove] = useState("");
  const [progress, setProgress] = useState({
    attempted: 0,
    correct: 0,
  });

  const loadDrill = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/daily/opening-names", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const next = await response.json();
      setPayload(next);
      setGuess("");
      setRevealed(false);
      setNameResult("");
      setBoardPosition(next.drill.fen);
      setSelectedSquare("");
      setMoveTries([]);
      setMoveFeedback("");
      setMoveFinished(false);
      setSolvedMove("");
    } catch (loadError) {
      setError(loadError.message || "Could not load an opening position.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = loadStoredProgress();
    setProgress(stored);
    void loadDrill();
  }, [loadDrill]);

  const drill = payload?.drill;
  const triesLeft = Math.max(0, MAX_MOVE_TRIES - moveTries.length);

  const checkName = useCallback(() => {
    if (!drill || !guess || revealed) return;
    const result = guess === drill.name ? "correct" : "incorrect";
    setRevealed(true);
    setNameResult(result);
    setProgress((current) => {
      const next = {
        attempted: current.attempted + 1,
        correct: current.correct + (result === "correct" ? 1 : 0),
      };
      storeProgress(next);
      return next;
    });
  }, [drill, guess, revealed]);

  const nextDrill = useCallback(() => {
    void loadDrill();
  }, [loadDrill]);

  const submitMove = useCallback(
    ({ sourceSquare, targetSquare }) => {
      if (
        !drill?.askNextMove ||
        !revealed ||
        moveFinished ||
        !targetSquare
      ) {
        return false;
      }
      const game = new Chess(drill.fen);
      let move;
      try {
        move = game.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: "q",
        });
      } catch {
        setMoveFeedback("That move is illegal and does not use a try.");
        return false;
      }
      if (!move) {
        setMoveFeedback("That move is illegal and does not use a try.");
        return false;
      }
      const uci = `${move.from}${move.to}${move.promotion || ""}`;
      const bookMove = acceptedMove(drill, uci);
      if (bookMove) {
        setSolvedMove(uci);
        setMoveFinished(true);
        setBoardPosition(game.fen());
        setMoveFeedback(
          `Book continuation: ${move.san}. It can lead to ${bookMove.openingNames
            .slice(0, 2)
            .join(" or ")}.`
        );
        return true;
      }

      const nextTries = [...moveTries, move.san];
      setMoveTries(nextTries);
      if (nextTries.length >= MAX_MOVE_TRIES) {
        setMoveFinished(true);
        setMoveFeedback(
          `Three tries used. Book continuations include ${drill.nextMoves
            .map((item) => item.san)
            .join(" or ")}.`
        );
      } else {
        setMoveFeedback(
          `${move.san} is legal, but it is not a continuation in this opening dataset. ${
            MAX_MOVE_TRIES - nextTries.length
          } ${nextTries.length === 2 ? "try" : "tries"} left.`
        );
      }
      return false;
    },
    [drill, moveFinished, moveTries, revealed]
  );

  const selectOrMove = useCallback(
    ({ piece, square }) => {
      if (!drill?.askNextMove || !revealed || moveFinished) return;
      if (selectedSquare) {
        if (selectedSquare !== square) {
          submitMove({ sourceSquare: selectedSquare, targetSquare: square });
        }
        setSelectedSquare("");
        return;
      }
      const expectedPrefix = drill.sideToMove === "white" ? "w" : "b";
      if (piece?.pieceType?.startsWith(expectedPrefix)) {
        setSelectedSquare(square);
        setMoveFeedback(`Selected ${square}. Choose a destination square.`);
      }
    },
    [drill, moveFinished, revealed, selectedSquare, submitMove]
  );

  const answerArrows = useMemo(() => {
    if (!drill || !moveFinished) return [];
    const uci = solvedMove || drill.nextMoves[0]?.uci;
    if (!uci) return [];
    return [
      {
        startSquare: uci.slice(0, 2),
        endSquare: uci.slice(2, 4),
        color: "rgba(204, 92, 56, 0.82)",
      },
    ];
  }, [drill, moveFinished, solvedMove]);

  const boardOptions = useMemo(
    () => ({
      id: drill ? `opening-name-${drill.id}` : "opening-name-board",
      position: boardPosition || drill?.fen,
      boardOrientation: "white",
      allowDragging: Boolean(
        drill?.askNextMove && revealed && !moveFinished && triesLeft > 0
      ),
      showNotation: true,
      animationDurationInMs: 180,
      onPieceDrop: submitMove,
      onSquareClick: selectOrMove,
      arrows: answerArrows,
      squareStyles: selectedSquare
        ? {
            [selectedSquare]: {
              boxShadow: "inset 0 0 0 4px rgba(204, 92, 56, 0.82)",
            },
          }
        : {},
      lightSquareStyle: { backgroundColor: "#eee8dc" },
      darkSquareStyle: { backgroundColor: "#7b8d78" },
      boardStyle: {
        borderRadius: "12px",
        boxShadow: "0 18px 45px rgba(30, 42, 40, 0.14)",
      },
    }),
    [
      answerArrows,
      boardPosition,
      drill,
      moveFinished,
      revealed,
      selectOrMove,
      selectedSquare,
      submitMove,
      triesLeft,
    ]
  );

  return (
    <section
      className="daily-section opening-names-section"
      aria-labelledby="opening-names-heading"
    >
      <div className="daily-section-heading">
        <div>
          <span>Opening atlas</span>
          <h2 id="opening-names-heading">Name the chess opening</h2>
        </div>
        <p>
          Identify a real named position at a randomly sampled depth. Some
          rounds also ask for a known continuation.
        </p>
      </div>

      <div className="opening-names-toolbar">
        <span>
          Attempts <strong>{progress.attempted}</strong>
        </span>
        <span>
          Correct <strong>{progress.correct}</strong>
        </span>
        <span>
          Source positions <strong>{payload?.poolSize || "-"}</strong>
        </span>
        <button type="button" disabled={loading} onClick={nextDrill}>
          {loading ? "Sampling..." : "New random position"}
        </button>
      </div>

      {error && !drill && (
        <div className="math-error" role="alert">
          <strong>Opening-name practice is temporarily unavailable.</strong>
          <p>{error}</p>
          <button type="button" onClick={() => void loadDrill()}>
            Try again
          </button>
        </div>
      )}

      {loading && !drill && (
        <div className="chess-drill-loading" role="status">
          <span className="chess-thinking-mark" aria-hidden="true">♞</span>
          <div>
            <strong>Sampling the opening atlas</strong>
            <p>The first load prepares the CC0 Lichess opening-name dataset.</p>
          </div>
        </div>
      )}

      {drill && (
        <div className="opening-names-layout">
          <div className="opening-names-board-column">
            <div className="chess-board-frame">
              <Chessboard options={boardOptions} />
            </div>
            <div className="opening-names-depth">
              <span>{drill.ply} plies deep</span>
              <span>Move {drill.moveNumber}</span>
              <span>{drill.sideToMove} to move</span>
            </div>
          </div>

          <div className="opening-names-panel">
            {!revealed ? (
              <>
                <span className="opening-names-kicker">Position recognition</span>
                <h3>Which opening has reached this position?</h3>
                <p>
                  Read the pawn structure and piece placement before checking
                  the move sequence.
                </p>
                <label htmlFor="opening-name-guess">Choose the opening</label>
                <select
                  id="opening-name-guess"
                  value={guess}
                  onChange={(event) => setGuess(event.target.value)}
                >
                  <option value="">Select an opening...</option>
                  {drill.nameOptions.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <button
                  className="opening-name-reveal"
                  type="button"
                  disabled={!guess}
                  onClick={checkName}
                >
                  Check answer
                </button>
              </>
            ) : (
              <>
                <div className="opening-name-answer">
                  <span>{drill.eco}</span>
                  <h3>{drill.name}</h3>
                  <p>
                    Your answer: <strong>{guess}</strong>
                  </p>
                </div>

                <div className="opening-name-result" data-result={nameResult}>
                  {nameResult === "correct"
                    ? "Correct. This opening remains in the random pool."
                    : "Not quite. Compare your choice with the opening above."}
                </div>

                {drill.askNextMove && (
                  <div className="opening-name-bonus">
                    <span>Bonus book move</span>
                    <h4>Play a known continuation on the board.</h4>
                    <p>
                      Any continuation represented in the source dataset counts.
                      You have {triesLeft} {triesLeft === 1 ? "try" : "tries"} left.
                    </p>
                    {moveFeedback && <strong>{moveFeedback}</strong>}
                  </div>
                )}

                <details className="opening-name-moves">
                  <summary>Show moves leading to this position</summary>
                  <p>{drill.movesBefore}</p>
                </details>

                <button
                  className="opening-name-next"
                  type="button"
                  onClick={nextDrill}
                >
                  Next random position
                </button>
              </>
            )}

            {payload && (
              <a
                className="opening-name-source"
                href={payload.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {payload.sourceLabel} ↗
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
