"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TASK_ONE = {
  seconds: 20 * 60,
  duration: "20 min",
  targetWords: 150,
};
const TASK_TWO = {
  seconds: 40 * 60,
  duration: "40 min",
  targetWords: 250,
};

const MODES = {
  academic_line: {
    ...TASK_ONE,
    label: "Line graph",
    group: "Academic Task 1 · data",
    task: "academic",
    description: "Summarise changes and trends across time.",
  },
  academic_bar: {
    ...TASK_ONE,
    label: "Bar chart",
    group: "Academic Task 1 · data",
    task: "academic",
    description: "Compare categories, groups, highs and lows.",
  },
  academic_pie: {
    ...TASK_ONE,
    label: "Pie chart",
    group: "Academic Task 1 · data",
    task: "academic",
    description: "Compare proportions and the composition of a whole.",
  },
  academic_table: {
    ...TASK_ONE,
    label: "Table",
    group: "Academic Task 1 · data",
    task: "academic",
    description: "Select and compare the most important numerical features.",
  },
  academic_mixed: {
    ...TASK_ONE,
    label: "Mixed charts",
    group: "Academic Task 1 · data",
    task: "academic",
    description: "Combine trends and comparisons from two related series.",
  },
  academic_process: {
    ...TASK_ONE,
    label: "Process diagram",
    group: "Academic Task 1 · diagrams",
    task: "academic",
    description: "Describe a natural or manufactured sequence of stages.",
  },
  academic_map: {
    ...TASK_ONE,
    label: "Map or plan",
    group: "Academic Task 1 · diagrams",
    task: "academic",
    description: "Report the main spatial changes between two plans.",
  },
  general_personal_letter: {
    ...TASK_ONE,
    label: "Personal letter",
    group: "General Training Task 1",
    task: "letter",
    description: "Write naturally to a friend or relative.",
  },
  general_semiformal_letter: {
    ...TASK_ONE,
    label: "Semi-formal letter",
    group: "General Training Task 1",
    task: "letter",
    description: "Write appropriately to someone you know officially.",
  },
  general_formal_letter: {
    ...TASK_ONE,
    label: "Formal letter",
    group: "General Training Task 1",
    task: "letter",
    description: "Write clearly to an organisation or unfamiliar recipient.",
  },
  essay_opinion: {
    ...TASK_TWO,
    label: "Opinion essay",
    group: "Task 2 essays",
    task: "essay",
    description: "State, explain and support a clear position.",
  },
  essay_discussion: {
    ...TASK_TWO,
    label: "Discuss both views",
    group: "Task 2 essays",
    task: "essay",
    description: "Discuss two views and give your own opinion.",
  },
  essay_advantages: {
    ...TASK_TWO,
    label: "Advantages / disadvantages",
    group: "Task 2 essays",
    task: "essay",
    description: "Evaluate benefits, drawbacks and relative importance.",
  },
  essay_problem_solution: {
    ...TASK_TWO,
    label: "Problem / solution",
    group: "Task 2 essays",
    task: "essay",
    description: "Explain causes or problems and propose solutions.",
  },
  essay_two_part: {
    ...TASK_TWO,
    label: "Two-part question",
    group: "Task 2 essays",
    task: "essay",
    description: "Answer and develop both questions directly.",
  },
};

const MODE_GROUPS = [
  "Academic Task 1 · data",
  "Academic Task 1 · diagrams",
  "General Training Task 1",
  "Task 2 essays",
];
const DEFAULT_MODE = "academic_line";
const CHART_COLORS = ["#2563eb", "#db2777", "#059669", "#d97706"];

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

function ChartTable({ topic }) {
  if (!topic.chartCategories?.length || !topic.chartSeries?.length) return null;
  return (
    <div className="writing-table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Category</th>
            {topic.chartSeries.map((series) => (
              <th scope="col" key={series.name}>
                {series.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topic.chartCategories.map((category, index) => (
            <tr key={category}>
              <th scope="row">{category}</th>
              {topic.chartSeries.map((series) => (
                <td key={series.name}>{series.values[index]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CartesianChart({ topic, mixed = false }) {
  const allValues = topic.chartSeries.flatMap((series) => series.values);
  const maximum = Math.max(...allValues, 1);
  const categoryCount = topic.chartCategories.length;
  const xFor = (index) =>
    categoryCount === 1 ? 50 : 8 + (index * 84) / (categoryCount - 1);
  const yFor = (value) => 84 - (Number(value) / maximum) * 68;

  return (
    <div className="writing-chart" aria-label={topic.visualTitle}>
      <svg viewBox="0 0 100 100" role="img">
        {[16, 33, 50, 67, 84].map((y) => (
          <line
            className="writing-chart-grid"
            x1="7"
            x2="94"
            y1={y}
            y2={y}
            key={y}
          />
        ))}
        {mixed &&
          topic.chartSeries[0]?.values.map((value, index) => (
            <rect
              className="writing-chart-bar"
              fill={CHART_COLORS[0]}
              height={84 - yFor(value)}
              key={`${index}-${value}`}
              opacity="0.72"
              width={Math.min(9, 60 / categoryCount)}
              x={xFor(index) - Math.min(4.5, 30 / categoryCount)}
              y={yFor(value)}
            />
          ))}
        {topic.chartSeries.map((series, seriesIndex) => {
          if (mixed && seriesIndex === 0) return null;
          const points = series.values
            .map((value, index) => `${xFor(index)},${yFor(value)}`)
            .join(" ");
          return (
            <g key={series.name}>
              <polyline
                fill="none"
                points={points}
                stroke={CHART_COLORS[seriesIndex]}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
              {series.values.map((value, index) => (
                <circle
                  cx={xFor(index)}
                  cy={yFor(value)}
                  fill={CHART_COLORS[seriesIndex]}
                  key={`${index}-${value}`}
                  r="1.8"
                />
              ))}
            </g>
          );
        })}
        {topic.chartCategories.map((category, index) => (
          <text
            className="writing-chart-label"
            key={category}
            textAnchor="middle"
            x={xFor(index)}
            y="96"
          >
            {category.length > 10 ? `${category.slice(0, 9)}…` : category}
          </text>
        ))}
      </svg>
      <div className="writing-chart-legend">
        {topic.chartSeries.map((series, index) => (
          <span key={series.name}>
            <i style={{ background: CHART_COLORS[index] }} />
            {series.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function BarChart({ topic }) {
  const maximum = Math.max(
    ...topic.chartSeries.flatMap((series) => series.values),
    1
  );
  return (
    <div className="writing-bars" aria-label={topic.visualTitle}>
      {topic.chartCategories.map((category, categoryIndex) => (
        <div className="writing-bar-group" key={category}>
          <div className="writing-bar-stack">
            {topic.chartSeries.map((series, seriesIndex) => (
              <span
                aria-label={`${series.name}: ${series.values[categoryIndex]}`}
                key={series.name}
                style={{
                  background: CHART_COLORS[seriesIndex],
                  height: `${Math.max(
                    4,
                    (Number(series.values[categoryIndex]) / maximum) * 100
                  )}%`,
                }}
                title={`${series.name}: ${series.values[categoryIndex]}`}
              />
            ))}
          </div>
          <small>{category}</small>
        </div>
      ))}
      <div className="writing-chart-legend">
        {topic.chartSeries.map((series, index) => (
          <span key={series.name}>
            <i style={{ background: CHART_COLORS[index] }} />
            {series.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function PieChart({ topic }) {
  const values = topic.chartSeries[0]?.values || [];
  const total = values.reduce((sum, value) => sum + Number(value), 0) || 1;
  let offset = 0;
  const segments = values.map((value, index) => {
    const start = offset;
    offset += (Number(value) / total) * 100;
    return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${offset}%`;
  });
  return (
    <div className="writing-pie-layout">
      <div
        className="writing-pie"
        role="img"
        aria-label={topic.visualTitle}
        style={{ background: `conic-gradient(${segments.join(", ")})` }}
      />
      <div className="writing-pie-legend">
        {topic.chartCategories.map((category, index) => (
          <span key={category}>
            <i
              style={{
                background: CHART_COLORS[index % CHART_COLORS.length],
              }}
            />
            {category}: <strong>{values[index]}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function MapPanel({ label, features }) {
  return (
    <div className="writing-map-panel">
      <strong>{label}</strong>
      <div className="writing-map-canvas">
        {features.map((feature, index) => (
          <span
            key={`${feature.label}-${index}`}
            style={{
              left: `${feature.x}%`,
              top: `${feature.y}%`,
              width: `${Math.min(feature.width, 100 - feature.x)}%`,
              height: `${Math.min(feature.height, 100 - feature.y)}%`,
            }}
          >
            {feature.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function WritingVisual({ topic }) {
  if (topic.visualType === "none") return null;
  if (topic.visualType === "letter") {
    return (
      <div className="ielts-cue-card writing-letter-points">
        <span>In your letter:</span>
        <ul>
          {topic.bulletPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (topic.visualType === "process") {
    return (
      <div className="writing-visual-wrap">
        <strong>{topic.visualTitle}</strong>
        <div className="writing-process">
          {topic.processSteps.map((step, index) => (
            <div className="writing-process-stage" key={step}>
              <span>{index + 1}</span>
              <p>{step}</p>
              {index < topic.processSteps.length - 1 && (
                <i aria-hidden="true">→</i>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (topic.visualType === "map") {
    return (
      <div className="writing-visual-wrap">
        <strong>{topic.visualTitle}</strong>
        <div className="writing-maps">
          <MapPanel label="Before" features={topic.mapBefore} />
          <MapPanel label="After" features={topic.mapAfter} />
        </div>
      </div>
    );
  }
  if (topic.visualType === "table") {
    return (
      <div className="writing-table-wrap">
        <strong>{topic.visualTitle}</strong>
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
    );
  }
  return (
    <div className="writing-visual-wrap">
      <strong>{topic.visualTitle}</strong>
      {topic.visualType === "line" && <CartesianChart topic={topic} />}
      {topic.visualType === "mixed" && <CartesianChart topic={topic} mixed />}
      {topic.visualType === "bar" && <BarChart topic={topic} />}
      {topic.visualType === "pie" && <PieChart topic={topic} />}
      <div className="writing-table-wrap writing-chart-data">
        <ChartTable topic={topic} />
      </div>
    </div>
  );
}

export default function IeltsWriting() {
  const [mode, setMode] = useState(DEFAULT_MODE);
  const [topic, setTopic] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [essay, setEssay] = useState("");
  const [remainingMs, setRemainingMs] = useState(
    MODES[DEFAULT_MODE].seconds * 1000
  );
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

  const startTimer = useCallback(
    (seconds) => {
      const startedAt = Date.now();
      startedAtRef.current = startedAt;
      elapsedSecondsRef.current = 0;
      setRemainingMs(seconds * 1000);
      setPhase("writing");
      window.requestAnimationFrame(() => textareaRef.current?.focus());
      timerRef.current = window.setInterval(() => {
        const left = seconds * 1000 - (Date.now() - startedAt);
        setRemainingMs(Math.max(0, left));
        if (left <= 0) {
          clearTimer();
          void submitRef.current?.(true);
        }
      }, 250);
    },
    [clearTimer]
  );

  const generateTopic = useCallback(async () => {
    if (isBusy) return;
    resetAttempt();
    setTopic(null);
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
      setTopic(nextTopic);
      startTimer(MODES[mode].seconds);
    } catch (topicError) {
      if (!mountedRef.current) return;
      setError(topicError.message || "Could not generate a writing task.");
      setErrorKind("topic");
      setPhase("error");
    }
  }, [isBusy, mode, resetAttempt, startTimer]);

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
              config.task === "essay" ? "Task response" : "Task achievement",
              evaluation.criteria.taskAchievementOrResponse,
            ],
            ["Coherence & cohesion", evaluation.criteria.coherenceAndCohesion],
            ["Lexical resource", evaluation.criteria.lexicalResource],
            ["Grammar", evaluation.criteria.grammaticalRangeAndAccuracy],
          ]
        : [],
    [config.task, evaluation]
  );

  return (
    <div className="writing-workspace">
      <section className="ielts-setup" aria-label="Writing task type">
        <label className="ielts-section-label" htmlFor="writing-practice-type">
          Choose a practice type
        </label>
        <select
          className="writing-mode-select"
          disabled={isBusy}
          id="writing-practice-type"
          onChange={(event) => chooseMode(event.target.value)}
          value={mode}
        >
          {MODE_GROUPS.map((group) => (
            <optgroup label={group} key={group}>
              {Object.entries(MODES)
                .filter(([, option]) => option.group === group)
                .map(([key, option]) => (
                  <option value={key} key={key}>
                    {option.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <div className="writing-mode-summary">
          <div>
            <strong>{config.label}</strong>
            <span>{config.group}</span>
          </div>
          <p>{config.description}</p>
          <span>
            {config.duration} · minimum {config.targetWords} words
          </span>
        </div>
        <p className="writing-auto-start-note">
          The timer starts immediately when the generated task appears.
        </p>
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
            <WritingVisual topic={topic} />
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
              : `Generate ${config.label}`}
          </button>
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
              config.task === "academic"
                ? "Write your overview and key comparisons…"
                : config.task === "letter"
                  ? "Write the complete letter and cover all three points…"
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
                startTimer(config.seconds);
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
              <strong>{config.label}</strong>
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

          <article className="ielts-feedback-card writing-rewrite-card">
            <div className="writing-rewrite-heading">
              <div>
                <span className="ielts-section-label">
                  Minimal-change reference
                </span>
                <h3>Rewritten for band 7.5</h3>
              </div>
              {evaluation.attemptId && (
                <span className="writing-saved-status">
                  Saved to progress history
                </span>
              )}
            </div>
            <p className="writing-rewrite-note">
              Your ideas and structure are preserved; only changes needed to
              reach the target are made.
            </p>
            <p className="writing-response-copy">
              {evaluation.rewrittenEssay}
            </p>
          </article>

          <div className="ielts-result-actions">
            <button
              type="button"
              className="ielts-primary"
              onClick={() => {
                resetAttempt();
                startTimer(config.seconds);
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
