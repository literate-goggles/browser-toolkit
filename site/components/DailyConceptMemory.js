"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

async function responseError(response) {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
  } catch {
    // Use the status fallback.
  }
  return `Request failed (${response.status})`;
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
  const [form, setForm] = useState({ concept: "", explanation: "" });

  const loadConcepts = useCallback(async () => {
    try {
      const response = await fetch("/api/daily/concepts", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response));
      setPayload(await response.json());
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not load the concept recall queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConcepts();
  }, [loadConcepts]);

  const createConcept = useCallback(
    async (event) => {
      event.preventDefault();
      setCreating(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/daily/concepts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            concept: form.concept,
            explanation: form.explanation,
          }),
        });
        if (!response.ok) throw new Error(await responseError(response));
        setPayload(await response.json());
        setForm({ concept: "", explanation: "" });
        setNotice("Concept saved. Its first closed-book recall is tomorrow.");
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
      const response = await fetch(
        `/api/daily/concepts/${encodeURIComponent(conceptId)}/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ remembered }),
        }
      );
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json();
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
    if (!window.confirm(`Remove "${concept.concept}" from the recall queue?`)) {
      return;
    }
    setSavingId(concept.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/daily/concepts/${encodeURIComponent(concept.id)}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error(await responseError(response));
      setPayload(await response.json());
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
  const formReady =
    form.concept.trim().length >= 2 && form.explanation.trim().length >= 2;

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
          Write from memory before revealing your notes. Successful recalls
          move farther apart; a missed recall returns tomorrow.
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
                          aria-label={`Remove ${concept.concept}`}
                        >
                          Remove
                        </button>
                      </div>
                      <h4>{concept.concept}</h4>
                      <label htmlFor={`concept-recall-${concept.id}`}>
                        What can you recall without looking?
                      </label>
                      <textarea
                        id={`concept-recall-${concept.id}`}
                        value={draft}
                        disabled={answerRevealed || busy}
                        maxLength={8000}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [concept.id]: event.target.value,
                          }))
                        }
                        placeholder="Explain the idea in your own words..."
                      />

                      {!answerRevealed ? (
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
                          Reveal saved explanation
                        </button>
                      ) : (
                        <>
                          <div className="concept-memory-comparison">
                            <div>
                              <span>Your recall</span>
                              <p>{draft}</p>
                            </div>
                            <div>
                              <span>Saved explanation</span>
                              <p>{concept.explanation}</p>
                            </div>
                          </div>
                          <div className="concept-memory-verdict">
                            <span>Did your recall capture the central idea?</span>
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
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {payload.upcomingConcepts.length > 0 && (
              <div className="concept-memory-upcoming">
                <div className="concept-memory-subheading">
                  <div>
                    <span>Later</span>
                    <h3>Upcoming recalls</h3>
                  </div>
                  <strong>{payload.upcomingConcepts.length}</strong>
                </div>
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
            )}
          </div>

          <form className="concept-memory-form" onSubmit={createConcept}>
            <div>
              <span>Add today's learning</span>
              <h3>Create a recall cue</h3>
              <p>
                Save the question and the explanation while the idea is fresh.
                The explanation stays hidden during recall.
              </p>
            </div>
            <label htmlFor="new-memory-concept">
              Concept or recall question
            </label>
            <input
              id="new-memory-concept"
              type="text"
              value={form.concept}
              maxLength={240}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  concept: event.target.value,
                }))
              }
              placeholder="For example: Why does layer normalization help?"
            />
            <label htmlFor="new-memory-explanation">
              Explanation you want to remember
            </label>
            <textarea
              id="new-memory-explanation"
              value={form.explanation}
              maxLength={8000}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  explanation: event.target.value,
                }))
              }
              placeholder="Write a concise but complete explanation, example, or derivation..."
            />
            <div className="concept-memory-form-footer">
              <span>First recall: tomorrow</span>
              <button type="submit" disabled={!formReady || creating}>
                {creating ? "Saving..." : "Add concept"}
              </button>
            </div>
          </form>
        </div>
      )}

      <p className="concept-memory-research-note">
        This queue uses active retrieval across separate days. Exact optimal
        gaps depend on how long you need to retain the material, so the schedule
        is a practical default rather than a claim that every concept forgets at
        the same rate.
      </p>
    </section>
  );
}
