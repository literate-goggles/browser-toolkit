"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const VOCAB_FILES = [
  { file: "vocab.json" },
  { file: "vocab-c1.json" },
  { file: "vocab-pte.json" },
];

const BAN_STORAGE_PREFIX = "dailychebakov:vocab:banned:";

function bannedStorageKey(sourceId) {
  return `${BAN_STORAGE_PREFIX}${sourceId}`;
}

function readBanned(sourceId) {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(bannedStorageKey(sourceId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((s) => String(s).toLowerCase()));
  } catch (error) {
    console.warn("[vocab] failed to read banned list", error);
    return new Set();
  }
}

function writeBanned(sourceId, set) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      bannedStorageKey(sourceId),
      JSON.stringify([...set]),
    );
  } catch (error) {
    console.warn("[vocab] failed to persist banned list", error);
  }
}

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
  const [bannedBySource, setBannedBySource] = useState({}); // { sourceId: Set<lowercased word> }
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

  // Hydrate banned sets from localStorage once we know which sources exist.
  useEffect(() => {
    if (!sources.length) return;
    const next = {};
    sources.forEach((src) => {
      next[src.id] = readBanned(src.id);
    });
    setBannedBySource(next);
  }, [sources]);

  const activeBanned = useMemo(() => {
    if (!activeSource) return new Set();
    return bannedBySource[activeSource.id] || new Set();
  }, [activeSource, bannedBySource]);

  const activeItems = useMemo(() => {
    if (!activeSource) return [];
    if (!activeBanned.size) return activeSource.items;
    return activeSource.items.filter(
      (item) => !activeBanned.has(String(item.word).toLowerCase()),
    );
  }, [activeSource, activeBanned]);

  const banCurrentWord = useCallback(() => {
    if (!currentQuiz || !activeSource) return;
    const word = String(currentQuiz.word).toLowerCase();
    setBannedBySource((prev) => {
      const prevSet = prev[activeSource.id] || new Set();
      if (prevSet.has(word)) return prev;
      const nextSet = new Set(prevSet);
      nextSet.add(word);
      writeBanned(activeSource.id, nextSet);
      return { ...prev, [activeSource.id]: nextSet };
    });
  }, [currentQuiz, activeSource]);

  const unbanAll = useCallback(() => {
    if (!activeSource) return;
    setBannedBySource((prev) => {
      const nextSet = new Set();
      writeBanned(activeSource.id, nextSet);
      return { ...prev, [activeSource.id]: nextSet };
    });
  }, [activeSource]);

  const isCurrentBanned =
    !!currentQuiz &&
    activeBanned.has(String(currentQuiz.word).toLowerCase());

  const startSingle = useCallback(() => {
    if (!activeItems.length) return;
    const item = activeItems[Math.floor(Math.random() * activeItems.length)];
    const quiz = quizFromItem(item);
    setSession(null);
    setSummary(null);
    setMode("single");
    setCurrentQuiz(quiz);
    setRevealed(false);
    setPickedOption(null);
    speakWord(quiz.word);
  }, [activeItems]);

  const startSession = useCallback(() => {
    if (!activeItems.length) return;
    // Snapshot the item list at session start; banning mid-session only takes
    // effect for future sessions, not the current shuffled order.
    const snapshot = activeItems.slice();
    const order = shuffle(snapshot.map((_, idx) => idx));
    const firstQuiz = quizFromItem(snapshot[order[0]]);
    setSession({
      order,
      snapshot,
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
  }, [activeItems]);

  const advance = useCallback(() => {
    if (session) {
      const nextPosition = session.position + 1;
      if (nextPosition >= session.total) {
        setSummary({ correct: session.correct, total: session.total });
        setCurrentQuiz(null);
        return;
      }
      const nextIdx = session.order[nextPosition];
      const list = session.snapshot || activeItems;
      const quiz = quizFromItem(list[nextIdx]);
      setSession({ ...session, position: nextPosition });
      setCurrentQuiz(quiz);
      setRevealed(false);
      setPickedOption(null);
      speakWord(quiz.word);
    } else if (mode === "single") {
      startSingle();
    }
  }, [session, activeItems, mode, startSingle]);

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
          {sources.map((s) => {
            const bannedInSrc = (bannedBySource[s.id] || new Set()).size;
            const effective = s.items.length - bannedInSrc;
            return (
              <option key={s.id} value={s.id}>
                {s.name} ({effective}
                {bannedInSrc ? ` · ${bannedInSrc} banned` : ""})
              </option>
            );
          })}
        </select>
        {activeBanned.size > 0 && (
          <div className="vocab-banned-hint">
            <span>{activeBanned.size} banned in this source</span>
            <button
              type="button"
              className="vocab-banned-reset"
              onClick={unbanAll}
            >
              Unban all
            </button>
          </div>
        )}
      </div>

      {mode === "idle" && (
        <div className="vocab-controls">
          <button
            type="button"
            className="btn-primary"
            onClick={startSingle}
            disabled={!activeItems.length}
          >
            Show me a word
          </button>
          <button
            type="button"
            className="btn-session"
            onClick={startSession}
            disabled={!activeItems.length}
          >
            Study all {activeItems.length} words
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

              <div className="vocab-answered-actions">
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
                <button
                  type="button"
                  className="vocab-ban"
                  onClick={banCurrentWord}
                  disabled={isCurrentBanned}
                  title="Never show this word again on this device"
                >
                  {isCurrentBanned ? "Banned" : "Ban this word"}
                </button>
              </div>
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
