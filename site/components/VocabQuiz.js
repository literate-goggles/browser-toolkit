"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const VOCAB_FILES = [
  { file: "vocab.json" },
  { file: "vocab-c1.json" },
  { file: "vocab-pte.json" },
];

function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function quizFromItem(item) {
  return {
    word: item.word,
    base: typeof item.base === "string" ? item.base.trim() : "",
    correct: item.correct,
    options: shuffle([item.correct, ...item.wrong]),
    examples: Array.isArray(item.examples) ? item.examples : [],
  };
}

function pickBritishVoice() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  return (
    voices.find((v) => v.lang === "en-GB" && /Google/i.test(v.name)) ||
    voices.find(
      (v) => v.lang === "en-GB" && /Daniel|Kate|Serena|Oliver|Arthur/i.test(v.name),
    ) ||
    voices.find((v) => v.lang === "en-GB") ||
    voices.find((v) => /^en-GB/i.test(v.lang)) ||
    voices.find((v) => /British|UK/i.test(v.name)) ||
    null
  );
}

function speakWord(text) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) {
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-GB";
    utter.rate = 0.92;
    utter.pitch = 1;
    const voice = pickBritishVoice();
    if (voice) utter.voice = voice;
    window.speechSynthesis.speak(utter);
  } catch (error) {
    console.warn("[vocab] speech failed", error);
  }
}

export default function VocabQuiz() {
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState("");
  const [mode, setMode] = useState("idle"); // idle | single | session
  const [currentQuiz, setCurrentQuiz] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [pickedOption, setPickedOption] = useState(null);
  const [session, setSession] = useState(null); // {order, position, total, correct, answered}
  const [summary, setSummary] = useState(null); // {correct, total}
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const nextRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      VOCAB_FILES.map(({ file }) =>
        fetch(`/vocab/${file}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      const loaded = results
        .filter(
          (payload) =>
            payload &&
            payload.meta &&
            payload.meta.id &&
            Array.isArray(payload.items) &&
            payload.items.length,
        )
        .map((payload) => ({
          id: payload.meta.id,
          name: payload.meta.name || payload.meta.id,
          items: payload.items,
        }));
      setSources(loaded);
      if (loaded.length && !sourceId) {
        setSourceId(loaded[0].id);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!speechSupported) return;
    const primeVoices = () => window.speechSynthesis.getVoices();
    primeVoices();
    if (typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
      window.speechSynthesis.onvoiceschanged = primeVoices;
    }
  }, [speechSupported]);

  const activeSource = useMemo(
    () => sources.find((s) => s.id === sourceId) || sources[0] || null,
    [sources, sourceId],
  );

  const startSingle = useCallback(() => {
    if (!activeSource || !activeSource.items.length) return;
    const item =
      activeSource.items[Math.floor(Math.random() * activeSource.items.length)];
    const quiz = quizFromItem(item);
    setSession(null);
    setSummary(null);
    setMode("single");
    setCurrentQuiz(quiz);
    setRevealed(false);
    setPickedOption(null);
    speakWord(quiz.word);
  }, [activeSource]);

  const startSession = useCallback(() => {
    if (!activeSource || !activeSource.items.length) return;
    const order = shuffle(activeSource.items.map((_, idx) => idx));
    const firstQuiz = quizFromItem(activeSource.items[order[0]]);
    setSession({
      order,
      position: 0,
      total: order.length,
      correct: 0,
      answered: 0,
    });
    setSummary(null);
    setMode("session");
    setCurrentQuiz(firstQuiz);
    setRevealed(false);
    setPickedOption(null);
    speakWord(firstQuiz.word);
  }, [activeSource]);

  const advance = useCallback(() => {
    if (session) {
      const nextPosition = session.position + 1;
      if (nextPosition >= session.total) {
        setSummary({ correct: session.correct, total: session.total });
        setCurrentQuiz(null);
        return;
      }
      const nextIdx = session.order[nextPosition];
      const quiz = quizFromItem(activeSource.items[nextIdx]);
      setSession({ ...session, position: nextPosition });
      setCurrentQuiz(quiz);
      setRevealed(false);
      setPickedOption(null);
      speakWord(quiz.word);
    } else if (mode === "single") {
      startSingle();
    }
  }, [session, activeSource, mode, startSingle]);

  const handleAnswer = useCallback(
    (option) => {
      if (!currentQuiz || pickedOption) return;
      setPickedOption(option);
      const isCorrect = option === currentQuiz.correct;
      if (session) {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                answered: prev.answered + 1,
                correct: prev.correct + (isCorrect ? 1 : 0),
              }
            : prev,
        );
      }
      // Focus the "Next" button so the user can hit Enter/Space to advance.
      setTimeout(() => nextRef.current?.focus(), 0);
    },
    [currentQuiz, pickedOption, session],
  );

  const reset = useCallback(() => {
    setMode("idle");
    setCurrentQuiz(null);
    setSession(null);
    setSummary(null);
    setRevealed(false);
    setPickedOption(null);
  }, []);

  // Empty state — no vocab loaded yet or files missing.
  if (!sources.length) {
    return (
      <div className="vocab-card">
        <div className="vocab-empty">
          Loading vocab… If nothing appears, no vocab JSON files were built
          into <code>/vocab/</code>. Run <code>npm run extract-vocab</code> and
          rebuild.
        </div>
      </div>
    );
  }

  return (
    <div className="vocab-card">
      <div className="vocab-source-picker">
        <label htmlFor="vocab-source">Source</label>
        <select
          id="vocab-source"
          value={sourceId}
          onChange={(event) => {
            setSourceId(event.target.value);
            reset();
          }}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.items.length})
            </option>
          ))}
        </select>
      </div>

      {mode === "idle" && (
        <div className="vocab-controls">
          <button
            type="button"
            className="btn-primary"
            onClick={startSingle}
            disabled={!activeSource || !activeSource.items.length}
          >
            Show me a word
          </button>
          <button
            type="button"
            className="btn-session"
            onClick={startSession}
            disabled={!activeSource || !activeSource.items.length}
          >
            Study all {activeSource ? activeSource.items.length : 0} words
          </button>
        </div>
      )}

      {(mode === "single" || mode === "session") && currentQuiz && !summary && (
        <>
          {session && (
            <div className="vocab-progress">
              <span className="vocab-progress-counter">
                {Math.min(session.position + 1, session.total)} / {session.total}
              </span>
              <span className="vocab-progress-score">
                Score: {session.correct}
              </span>
            </div>
          )}

          <div className="vocab-word-block">
            <div className="vocab-word">{currentQuiz.word}</div>
            {currentQuiz.base &&
              currentQuiz.base.toLowerCase() !==
                currentQuiz.word.toLowerCase() && (
                <div className="vocab-base">base: {currentQuiz.base}</div>
              )}
            {speechSupported && (
              <button
                type="button"
                className="vocab-speak"
                onClick={() => speakWord(currentQuiz.word)}
                title="Play pronunciation (British)"
                aria-label="Play pronunciation (British)"
              >
                <span aria-hidden="true">🔊</span>
                <span>Play (British)</span>
              </button>
            )}
          </div>

          {!revealed && (
            <button
              type="button"
              className="vocab-reveal"
              onClick={(event) => {
                // Clear focus before the button unmounts: iOS Safari otherwise
                // keeps :hover/:focus on whichever new button ends up under the
                // last touch point (usually option 2 or 3).
                event.currentTarget.blur();
                setRevealed(true);
              }}
            >
              Reveal choices
            </button>
          )}

          {revealed && (
            <div className="vocab-options">
              {currentQuiz.options.map((option) => {
                let state = "";
                if (pickedOption) {
                  if (option === currentQuiz.correct) state = "correct";
                  else if (option === pickedOption) state = "wrong";
                }
                return (
                  <button
                    key={option}
                    type="button"
                    className="vocab-option"
                    data-state={state || undefined}
                    disabled={!!pickedOption}
                    onClick={() => handleAnswer(option)}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}

          {pickedOption && (
            <>
              <div
                className="vocab-feedback"
                data-state={
                  pickedOption === currentQuiz.correct ? "correct" : "wrong"
                }
              >
                {pickedOption === currentQuiz.correct
                  ? "Correct."
                  : `Correct answer: ${currentQuiz.correct}`}
              </div>

              {currentQuiz.examples.length > 0 && (
                <div className="vocab-examples">
                  <div className="vocab-examples-title">Used in a sentence</div>
                  <ol className="vocab-examples-list">
                    {currentQuiz.examples.map((sentence, i) => (
                      <li key={i}>{sentence}</li>
                    ))}
                  </ol>
                </div>
              )}

              <button
                type="button"
                className="vocab-next"
                ref={nextRef}
                onClick={advance}
              >
                {session && session.position + 1 >= session.total
                  ? "See results"
                  : "Next word"}
              </button>
            </>
          )}
        </>
      )}

      {summary && (
        <div className="vocab-summary">
          <div className="vocab-summary-title">Session complete</div>
          <div className="vocab-summary-score">
            {summary.correct} / {summary.total} correct
          </div>
          <div className="vocab-summary-percent">
            {summary.total > 0
              ? Math.round((summary.correct / summary.total) * 100)
              : 0}
            %
          </div>
          <div className="vocab-summary-actions">
            <button
              type="button"
              className="vocab-reveal"
              onClick={startSession}
            >
              Study again
            </button>
            <button type="button" className="vocab-next" onClick={reset}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
