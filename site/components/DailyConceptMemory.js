"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const REQUEST_TIMEOUT_MS = 15000;

async function responseError(response) {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
  } catch {
    // Use the status fallback.
  }
  return `Request failed (${response.status})`;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await responseError(response));
    return await response.json();
  } catch (requestError) {
    if (requestError.name === "AbortError") {
      throw new Error("The request timed out. Please try again.");
    }
    throw requestError;
  } finally {
    window.clearTimeout(timeout);
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function DailyConceptMemory() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [drafts, setDrafts] = useState({});
  const [revealed, setRevealed] = useState({});
  const [form, setForm] = useState({ concept: "" });

  const loadConcepts = useCallback(async () => {
    try {
      const nextPayload = await requestJson("/api/daily/concepts", {
        cache: "no-store",
      });
      setPayload(nextPayload);
      setError("");
      return nextPayload;
    } catch (loadError) {
      setError(loadError.message || "Could not load the concept recall queue.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConcepts();
  }, [loadConcepts]);

  const waitingForQuestions = Boolean(
    payload?.dueConcepts?.some((concept) => !concept.question)
  );

  useEffect(() => {
    if (!waitingForQuestions) return undefined;
    const timeout = window.setTimeout(() => void loadConcepts(), 3000);
    return () => window.clearTimeout(timeout);
  }, [loadConcepts, payload, waitingForQuestions]);

  const createConcept = useCallback(
    async (event) => {
      event.preventDefault();
      setCreating(true);
      setError("");
      setNotice("");
      try {
        const nextPayload = await requestJson("/api/daily/concepts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            concept: form.concept.trim(),
          }),
        });
        setPayload(nextPayload);
        setForm({ concept: "" });
        setNotice(
          "Concept saved. OpenAI will prepare its first indirect question tomorrow."
        );
      } catch (createError) {
        setError(createError.message || "Could not save the concept.");
      } finally {
        setCreating(false);
      }
    },
    [form]
  );

  const reviewConcept = useCallback(async (conceptId, remembered) => {
    setSavingId(conceptId);
    setError("");
    setNotice("");
    try {
      const result = await requestJson(
        `/api/daily/concepts/${encodeURIComponent(conceptId)}/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ remembered }),
        }
      );
      setPayload(result.memory);
      setNotice(result.message);
      setDrafts((current) => {
        const next = { ...current };
        delete next[conceptId];
        return next;
      });
      setRevealed((current) => {
        const next = { ...current };
        delete next[conceptId];
        return next;
      });
    } catch (reviewError) {
      setError(reviewError.message || "Could not save the recall result.");
    } finally {
      setSavingId("");
    }
  }, []);

  const removeConcept = useCallback(async (concept) => {
    if (!window.confirm("Remove this concept from the recall queue?")) {
      return;
    }
    setSavingId(concept.id);
    setError("");
    setNotice("");
    try {
      const nextPayload = await requestJson(
        `/api/daily/concepts/${encodeURIComponent(concept.id)}`,
        { method: "DELETE" }
      );
      setPayload(nextPayload);
      setNotice("Concept removed from the recall queue.");
    } catch (removeError) {
      setError(removeError.message || "Could not remove the concept.");
    } finally {
      setSavingId("");
    }
  }, []);

  const nextDueDate = useMemo(
    () => payload?.upcomingConcepts?.[0]?.nextReviewDate || "",
    [payload]
  );
  const formReady = form.concept.trim().length >= 2;

  return (
    <section
      className="daily-section concept-memory-section"
      aria-labelledby="concept-memory-heading"
    >
      <div className="daily-section-heading concept-memory-heading">
        <div>
          <span>Long-term memory</span>
          <h2 id="concept-memory-heading">Recall what you learned</h2>
        </div>
        <p>
          OpenAI asks about the target indirectly without naming it. Identify
          the concept before revealing the answer.
        </p>
      </div>

      {payload && (
        <>
          <div className="concept-memory-stats" aria-label="Concept statistics">
            <span>
              Due today <strong>{payload.stats.dueToday}</strong>
            </span>
            <span>
              Active <strong>{payload.stats.activeConcepts}</strong>
            </span>
            <span>
              Fully remembered <strong>{payload.stats.fullyRemembered}</strong>
            </span>
            <span>
              Recalled today <strong>{payload.stats.reviewsToday}</strong>
            </span>
          </div>

          <div className="concept-memory-schedule">
            <div>
              <span>Recall schedule</span>
              <strong>After each successful recall</strong>
            </div>
            <ol aria-label="Recall intervals in days">
              {payload.scheduleDays.map((days, index) => (
                <li key={days} data-complete={false}>
                  <span>{index + 1}</span>
                  {days} {days === 1 ? "day" : "days"}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}

      {notice && (
        <div className="concept-memory-notice" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="concept-memory-error" role="alert">
          <span>{error}</span>
          {!payload && (
            <button type="button" onClick={() => void loadConcepts()}>
              Retry
            </button>
          )}
        </div>
      )}

      {loading && !payload && (
        <div className="concept-memory-empty" role="status">
          Loading your recall queue...
        </div>
      )}

      {payload && (
        <div className="concept-memory-layout">
          <div className="concept-memory-queue">
            <div className="concept-memory-subheading">
              <div>
                <span>Closed book</span>
                <h3>Due for recall</h3>
              </div>
              <strong>{payload.dueConcepts.length}</strong>
            </div>

            {payload.dueConcepts.length === 0 ? (
              <div className="concept-memory-empty">
                <strong>Nothing is due today.</strong>
                <p>
                  {nextDueDate
                    ? `Your next concept returns on ${formatDate(nextDueDate)}.`
                    : "Add something you learned and it will return tomorrow."}
                </p>
              </div>
            ) : (
              <div className="concept-memory-due-list">
                {payload.dueConcepts.map((concept) => {
                  const draft = drafts[concept.id] || "";
                  const answerRevealed = Boolean(revealed[concept.id]);
                  const busy = savingId === concept.id;
                  return (
                    <article className="concept-memory-card" key={concept.id}>
                      <div className="concept-memory-card-meta">
                        <span>
                          Recall {concept.reviewNumber}/{concept.totalReviews}
                        </span>
                        <span>
                          {concept.overdueDays
                            ? `${concept.overdueDays} days overdue`
                            : "Due today"}
                        </span>
                        <button
                          type="button"
                          disabled={Boolean(savingId)}
                          onClick={() => void removeConcept(concept)}
                          aria-label="Remove this recall"
                        >
                          Remove
                        </button>
                      </div>
                      {concept.question ? (
                        <>
                          <span className="concept-memory-question-label">
                            Which concept is this?
                          </span>
                          <h4>{concept.question}</h4>
                          <label htmlFor={`concept-recall-${concept.id}`}>
                            Your answer
                          </label>
                          <textarea
                            id={`concept-recall-${concept.id}`}
                            value={draft}
                            disabled={answerRevealed || busy}
                            maxLength={1000}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [concept.id]: event.target.value,
                              }))
                            }
                            placeholder="Name the hidden concept..."
                          />
                        </>
                      ) : (
                        <div className="concept-memory-question-missing">
                          <strong>Preparing today's question...</strong>
                          <p>
                            The queue remains usable while OpenAI works in the
                            background.
                          </p>
                          <button
                            type="button"
                            onClick={() => void loadConcepts()}
                          >
                            Check now
                          </button>
                        </div>
                      )}

                      {concept.question &&
                        (!answerRevealed ? (
                          <button
                            className="concept-reveal-button"
                            type="button"
                            disabled={draft.trim().length < 2 || busy}
                            onClick={() =>
                              setRevealed((current) => ({
                                ...current,
                                [concept.id]: true,
                              }))
                            }
                          >
                            Reveal answer
                          </button>
                        ) : (
                          <>
                            <div className="concept-memory-comparison">
                              <div>
                                <span>Your answer</span>
                                <p>{draft}</p>
                              </div>
                              <div>
                                <span>Target concept</span>
                                <p>{concept.concept}</p>
                              </div>
                            </div>
                            <div className="concept-memory-verdict">
                              <span>Did you identify the correct concept?</span>
                              <div>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void reviewConcept(concept.id, false)
                                  }
                                >
                                  {busy ? "Saving..." : "Not yet"}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void reviewConcept(concept.id, true)
                                  }
                                >
                                  {busy ? "Saving..." : "Remembered"}
                                </button>
                              </div>
                            </div>
                          </>
                        ))}
                    </article>
                  );
                })}
              </div>
            )}

            {payload.upcomingConcepts.length > 0 && (
              <details className="concept-memory-upcoming-panel">
                <summary>
                  <span>Upcoming recalls</span>
                  <strong>{payload.upcomingConcepts.length}</strong>
                </summary>
                <div className="concept-memory-upcoming">
                  <ol>
                    {payload.upcomingConcepts.map((concept) => (
                      <li key={concept.id}>
                        <div>
                          <strong>{concept.concept}</strong>
                          <span>
                            {formatDate(concept.nextReviewDate)} - step {concept.reviewNumber}/
                            {concept.totalReviews}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={Boolean(savingId)}
                          onClick={() => void removeConcept(concept)}
                          aria-label={`Remove ${concept.concept}`}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
            )}
          </div>

          <details className="concept-memory-create-panel">
            <summary>
              <span>Create a recall</span>
              <strong>Add a concept</strong>
            </summary>
            <form className="concept-memory-form" onSubmit={createConcept}>
              <div>
                <span>Add today's learning</span>
                <h3>What do you want to remember?</h3>
                <p>
                  Save only the target concept. On each due date, OpenAI will
                  ask a new question without using its direct name. Names and
                  surnames are prompted through etymology.
                </p>
              </div>
              <label htmlFor="new-memory-concept">Target concept</label>
              <input
                id="new-memory-concept"
                type="text"
                value={form.concept}
                maxLength={240}
                onChange={(event) =>
                  setForm({ concept: event.target.value })
                }
                placeholder="For example: Шумер"
              />
              <div className="concept-memory-form-footer">
                <span>First recall: tomorrow</span>
                <button type="submit" disabled={!formReady || creating}>
                  {creating ? "Saving..." : "Add concept"}
                </button>
              </div>
            </form>
          </details>
        </div>
      )}

      <p className="concept-memory-research-note">
        Each due date gets one persisted question, so refreshing cannot reveal
        a different clue. Exact optimal gaps depend on how long you need to
        retain the material, so the schedule remains a practical default.
      </p>
    </section>
  );
}
