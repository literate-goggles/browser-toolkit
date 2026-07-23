"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MODES = {
  task1: {
    label: "Academic Task 1",
    shortLabel: "Task 1",
    seconds: 20 * 60,
    duration: "20 min",
    targetWords: 150,
    description:
      "Summarise a generated data table and compare its key features.",
  },
  task2: {
    label: "Academic Task 2",
    shortLabel: "Task 2",
    seconds: 40 * 60,
    duration: "40 min",
    targetWords: 250,
    description: "Develop and support a clear position in an academic essay.",
  },
};

const RECENT_TOPICS_KEY = "daily-ielts-writing-recent-topics";

function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function countWords(text) {
  return text.match(/[\p{L}\p{N}]+(?:['’ʼ-][\p{L}\p{N}]+)*/gu)?.length || 0;
}

function recentTopics() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_TOPICS_KEY) || "[]");
    return Array.isArray(stored) ? stored.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function rememberTopic(prompt) {
  const next = [
    prompt,
    ...recentTopics().filter((item) => item !== prompt),
  ].slice(0, 10);
  localStorage.setItem(RECENT_TOPICS_KEY, JSON.stringify(next));
}

async function responseError(response) {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
  } catch {
    // Use the generic status message below.
  }
  return `Request failed (${response.status})`;
}

function FeedbackList({ items }) {
  return (
    <ul className="ielts-feedback-list">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

export default function IeltsWriting() {
  const [mode, setMode] = useState("task1");
  const [topic, setTopic] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [essay, setEssay] = useState("");
  const [remainingMs, setRemainingMs] = useState(MODES.task1.seconds * 1000);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState(null);
  const [errorKind, setErrorKind] = useState(null);

  const timerRef = useRef(null);
  const startedAtRef = useRef(null);
  const elapsedSecondsRef = useRef(0);
  const essayRef = useRef("");
  const submittingRef = useRef(false);
  const submitRef = useRef(null);
  const textareaRef = useRef(null);
  const mountedRef = useRef(true);

  const config = MODES[mode];
  const wordCount = useMemo(() => countWords(essay), [essay]);
  const isBusy = ["generating", "writing", "evaluating"].includes(phase);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetAttempt = useCallback(() => {
    clearTimer();
    setEssay("");
    essayRef.current = "";
    setEvaluation(null);
    setError(null);
    setErrorKind(null);
    startedAtRef.current = null;
    elapsedSecondsRef.current = 0;
    submittingRef.current = false;
  }, [clearTimer]);

  const generateTopic = useCallback(async () => {
    if (isBusy) return;
    setPhase("generating");
    setError(null);
    setErrorKind(null);
    try {
      const response = await fetch("/api/ielts/writing/topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, recentTopics: recentTopics() }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const nextTopic = await response.json();
      if (!mountedRef.current) return;
      rememberTopic(nextTopic.prompt);
      resetAttempt();
      setTopic(nextTopic);
      setRemainingMs(MODES[mode].seconds * 1000);
      setPhase("ready");
    } catch (topicError) {
      if (!mountedRef.current) return;
      setError(topicError.message || "Could not generate a writing task.");
      setErrorKind("topic");
      setPhase("error");
    }
  }, [isBusy, mode, resetAttempt]);

  const submitEssay = useCallback(
    async (automatic = false) => {
      if (!topic || submittingRef.current) return;
      const answer = essayRef.current.trim();
      if (!answer) {
        clearTimer();
        setError(
          automatic
            ? "Time is up, but there is no response to evaluate."
            : "Write a response before submitting it."
        );
        setErrorKind("empty");
        setPhase("error");
        return;
      }

      submittingRef.current = true;
      clearTimer();
      const elapsedSeconds = startedAtRef.current
        ? Math.min(
            config.seconds,
            Math.max(1, (Date.now() - startedAtRef.current) / 1000)
          )
        : elapsedSecondsRef.current;
      elapsedSecondsRef.current = elapsedSeconds;
      startedAtRef.current = null;
      setPhase("evaluating");
      setError(null);
      setErrorKind(null);
      try {
        const response = await fetch("/api/ielts/writing/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic,
            essay: answer,
            elapsedSeconds,
          }),
        });
        if (!response.ok) throw new Error(await responseError(response));
        const result = await response.json();
        if (!mountedRef.current) return;
        setEvaluation(result);
        setPhase("complete");
      } catch (evaluationError) {
        if (!mountedRef.current) return;
        setError(
          evaluationError.message || "Could not evaluate this response."
        );
        setErrorKind("evaluation");
        setPhase("error");
      } finally {
        submittingRef.current = false;
      }
    },
    [clearTimer, config.seconds, topic]
  );

  submitRef.current = submitEssay;

  const startWriting = useCallback(() => {
    if (!topic || phase !== "ready") return;
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    elapsedSecondsRef.current = 0;
    setRemainingMs(config.seconds * 1000);
    setPhase("writing");
    window.requestAnimationFrame(() => textareaRef.current?.focus());
    timerRef.current = window.setInterval(() => {
      const left = config.seconds * 1000 - (Date.now() - startedAt);
      setRemainingMs(Math.max(0, left));
      if (left <= 0) {
        clearTimer();
        void submitRef.current?.(true);
      }
    }, 250);
  }, [clearTimer, config.seconds, phase, topic]);

  const chooseMode = useCallback(
    (nextMode) => {
      if (isBusy || nextMode === mode) return;
      resetAttempt();
      setMode(nextMode);
      setTopic(null);
      setRemainingMs(MODES[nextMode].seconds * 1000);
      setPhase("idle");
    },
    [isBusy, mode, resetAttempt]
  );

  useEffect(() => {
    essayRef.current = essay;
  }, [essay]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const criteria = useMemo(
    () =>
      evaluation
        ? [
            [
              mode === "task1" ? "Task achievement" : "Task response",
              evaluation.criteria.taskAchievementOrResponse,
            ],
            ["Coherence & cohesion", evaluation.criteria.coherenceAndCohesion],
            ["Lexical resource", evaluation.criteria.lexicalResource],
            ["Grammar", evaluation.criteria.grammaticalRangeAndAccuracy],
          ]
        : [],
    [evaluation, mode]
  );

  return (
    <div className="writing-workspace">
      <section className="ielts-setup" aria-label="Writing task type">
        <div className="ielts-section-label">Choose a task</div>
        <div className="ielts-mode-grid">
          {Object.entries(MODES).map(([key, option]) => (
            <button
              type="button"
              className="ielts-mode"
              data-selected={mode === key}
              onClick={() => chooseMode(key)}
              disabled={isBusy}
              key={key}
            >
              <span className="ielts-mode-topline">
                <strong>{option.label}</strong>
                <span>{option.duration}</span>
              </span>
              <span className="ielts-mode-part">
                Minimum {option.targetWords} words
              </span>
              <span className="ielts-mode-description">
                {option.description}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="writing-task-card">
        <div className="ielts-topic-heading">
          <span className="ielts-section-label">Your writing task</span>
          <span className="ielts-duration-badge">
            {config.duration} · {config.targetWords}+ words
          </span>
        </div>

        {topic ? (
          <div className="writing-prompt">
            <div className="writing-prompt-heading">
              <div>
                <span>{topic.questionType}</span>
                <h2>{topic.title}</h2>
              </div>
            </div>
            <p>{topic.prompt}</p>

            {mode === "task1" && topic.tableRows.length > 0 && (
              <div className="writing-table-wrap">
                <strong>{topic.tableTitle}</strong>
                <div className="writing-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {topic.tableColumns.map((column) => (
                          <th key={column} scope="col">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {topic.tableRows.map((row, rowIndex) => (
                        <tr key={`${rowIndex}-${row[0]}`}>
                          {row.map((cell, cellIndex) =>
                            cellIndex === 0 ? (
                              <th key={cellIndex} scope="row">
                                {cell}
                              </th>
                            ) : (
                              <td key={cellIndex}>{cell}</td>
                            )
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="ielts-topic-empty">
            Generate a fresh {config.label.toLowerCase()} question when you are
            ready.
          </p>
        )}

        {!topic && (
          <button
            type="button"
            className="ielts-primary"
            onClick={generateTopic}
            disabled={phase === "generating"}
          >
            {phase === "generating"
              ? "Generating…"
              : `Generate ${config.shortLabel}`}
          </button>
        )}

        {topic && phase === "ready" && (
          <div className="ielts-topic-actions">
            <button
              type="button"
              className="ielts-primary"
              onClick={startWriting}
            >
              Start {config.duration} timer
            </button>
            <button
              type="button"
              className="ielts-secondary"
              onClick={generateTopic}
            >
              New task
            </button>
          </div>
        )}
      </section>

      {topic && ["writing", "evaluating", "error"].includes(phase) && (
        <section className="writing-editor-card">
          <div className="writing-editor-toolbar">
            <div
              className="writing-clock"
              data-warning={remainingMs <= 5 * 60 * 1000}
            >
              <span>Time remaining</span>
              <strong>{formatTime(remainingMs)}</strong>
            </div>
            <div
              className="writing-word-count"
              data-reached={wordCount >= config.targetWords}
            >
              <span>Word count</span>
              <strong>
                {wordCount} / {config.targetWords}
              </strong>
            </div>
          </div>
          <label htmlFor="ielts-writing-response">Your response</label>
          <textarea
            id="ielts-writing-response"
            ref={textareaRef}
            value={essay}
            onChange={(event) => setEssay(event.target.value)}
            disabled={phase !== "writing"}
            spellCheck
            placeholder={
              mode === "task1"
                ? "Write your overview and key comparisons…"
                : "Write your introduction, developed body paragraphs and conclusion…"
            }
          />
          {phase === "writing" && (
            <div className="writing-editor-actions">
              <span>
                Your response submits automatically when the timer reaches zero.
              </span>
              <button
                type="button"
                className="ielts-primary"
                onClick={() => void submitEssay(false)}
                disabled={wordCount === 0}
              >
                Submit for feedback
              </button>
            </div>
          )}
          {phase === "evaluating" && (
            <div className="writing-evaluating" role="status">
              <span className="writing-spinner" aria-hidden="true" />
              Evaluating your response against the band-7.5 target…
            </div>
          )}
        </section>
      )}

      {error && (
        <section className="ielts-error" role="alert">
          <div>
            <strong>Something went wrong</strong>
            <p>{error}</p>
          </div>
          {errorKind === "evaluation" ? (
            <button
              type="button"
              className="ielts-secondary"
              onClick={() => void submitEssay(false)}
            >
              Retry evaluation
            </button>
          ) : errorKind === "empty" && topic ? (
            <button
              type="button"
              className="ielts-secondary"
              onClick={() => {
                setError(null);
                setErrorKind(null);
                setPhase("ready");
              }}
            >
              Restart task
            </button>
          ) : (
            <button
              type="button"
              className="ielts-secondary"
              onClick={generateTopic}
            >
              Try again
            </button>
          )}
        </section>
      )}

      {evaluation && phase === "complete" && (
        <section className="ielts-results">
          <div className="ielts-score-card">
            <div>
              <span className="ielts-section-label">
                Estimated writing band
              </span>
              <div className="ielts-band">
                {evaluation.overallBand.toFixed(1)}
              </div>
              <span
                className="ielts-target"
                data-status={evaluation.targetStatus}
              >
                Target 7.5 · {evaluation.targetStatus}
              </span>
            </div>
            <p>{evaluation.summary}</p>
          </div>

          <div className="ielts-stats writing-stats">
            <span>
              <strong>{evaluation.wordCount}</strong> words
            </span>
            <span>
              <strong>
                {Math.max(1, Math.round(elapsedSecondsRef.current / 60))}
              </strong>{" "}
              minutes used
            </span>
            <span>
              <strong>{config.targetWords}+</strong> target words
            </span>
            <span>
              <strong>{config.shortLabel}</strong> Academic
            </span>
          </div>

          <div className="ielts-criteria-grid writing-criteria-grid">
            {criteria.map(([label, criterion]) => (
              <article className="ielts-criterion" key={label}>
                <div>
                  <h3>{label}</h3>
                  <strong>{criterion.band.toFixed(1)}</strong>
                </div>
                <p>{criterion.feedback}</p>
              </article>
            ))}
          </div>

          <article className="ielts-feedback-card">
            <h3>Your response</h3>
            <p className="writing-response-copy">{essay}</p>
          </article>

          <div className="ielts-feedback-columns">
            <article className="ielts-feedback-card">
              <h3>What worked</h3>
              <FeedbackList items={evaluation.strengths} />
            </article>
            <article className="ielts-feedback-card">
              <h3>Next steps</h3>
              <FeedbackList items={evaluation.suggestions} />
            </article>
          </div>

          <article className="ielts-feedback-card">
            <h3>Structure & development</h3>
            <p>{evaluation.structureFeedback}</p>
          </article>

          <article className="ielts-feedback-card">
            <h3>Grammar</h3>
            {evaluation.grammarCorrections.length ? (
              <div className="ielts-corrections">
                {evaluation.grammarCorrections.map((item, index) => (
                  <div
                    className="ielts-correction"
                    key={`${index}-${item.original}`}
                  >
                    <p>
                      <del>{item.original}</del>
                    </p>
                    <p>
                      <ins>{item.correction}</ins>
                    </p>
                    <span>{item.explanation}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p>No clear grammar errors worth correcting in this response.</p>
            )}
          </article>

          <article className="ielts-focus-card">
            <span className="ielts-section-label">Best move toward 7.5</span>
            <p>{evaluation.targetFocus}</p>
          </article>

          <div className="ielts-result-actions">
            <button
              type="button"
              className="ielts-primary"
              onClick={() => {
                resetAttempt();
                setRemainingMs(config.seconds * 1000);
                setPhase("ready");
              }}
            >
              Rewrite this task
            </button>
            <button
              type="button"
              className="ielts-secondary"
              onClick={generateTopic}
            >
              Generate new task
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
