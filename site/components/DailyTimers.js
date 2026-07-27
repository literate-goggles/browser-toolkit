"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ACTIVITY_MARKS = {
  "english-reading": "EN",
  "russian-reading": "RU",
};

function formatClock(totalSeconds) {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function responseError(response) {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
  } catch {
    // Use the status fallback.
  }
  return `Request failed (${response.status})`;
}

function addChimeTone(context, startAt, frequency) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.32);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + 0.34);
}

export default function DailyTimers() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [startingKey, setStartingKey] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const serverOffsetRef = useRef(0);
  const audioContextRef = useRef(null);
  const scheduledSessionsRef = useRef(new Set());
  const handledSessionsRef = useRef(new Set());

  const loadTimers = useCallback(async () => {
    try {
      const response = await fetch("/api/daily/timers", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const next = await response.json();
      serverOffsetRef.current = Date.parse(next.serverNow) - Date.now();
      setPayload(next);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not load daily timers.");
    }
  }, []);

  const unlockAudio = useCallback(async () => {
    if (!audioContextRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const scheduleCompletionChime = useCallback(
    async (session) => {
      if (!session || scheduledSessionsRef.current.has(session.id)) return;
      const context = await unlockAudio();
      if (!context) return;
      const remainingSeconds = Math.max(
        0.05,
        (Date.parse(session.endsAt) - (Date.now() + serverOffsetRef.current)) /
          1000
      );
      const startAt = context.currentTime + remainingSeconds;
      addChimeTone(context, startAt, 659.25);
      addChimeTone(context, startAt + 0.23, 783.99);
      addChimeTone(context, startAt + 0.46, 987.77);
      scheduledSessionsRef.current.add(session.id);
    },
    [unlockAudio]
  );

  const playCompletionChime = useCallback(async () => {
    const context = await unlockAudio();
    if (!context) return;
    const startAt = context.currentTime + 0.03;
    addChimeTone(context, startAt, 659.25);
    addChimeTone(context, startAt + 0.23, 783.99);
    addChimeTone(context, startAt + 0.46, 987.77);
  }, [unlockAudio]);

  useEffect(() => {
    void loadTimers();
    const refreshInterval = window.setInterval(
      () => void loadTimers(),
      15 * 1000
    );
    return () => window.clearInterval(refreshInterval);
  }, [loadTimers]);

  useEffect(() => {
    const clockInterval = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    const serverNow = nowMs + serverOffsetRef.current;
    for (const activity of payload?.activities || []) {
      const session = activity.session;
      if (
        activity.status !== "running" ||
        !session ||
        Date.parse(session.endsAt) > serverNow ||
        handledSessionsRef.current.has(session.id)
      ) {
        continue;
      }
      handledSessionsRef.current.add(session.id);
      if (!scheduledSessionsRef.current.has(session.id)) {
        void playCompletionChime();
      }
      void loadTimers();
    }
  }, [loadTimers, nowMs, payload, playCompletionChime]);

  useEffect(
    () => () => {
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    },
    []
  );

  const startTimer = useCallback(
    async (activityKey) => {
      setStartingKey(activityKey);
      setError("");
      try {
        await unlockAudio();
        const response = await fetch(
          `/api/daily/timers/${encodeURIComponent(activityKey)}/start`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }
        );
        if (!response.ok) throw new Error(await responseError(response));
        const next = await response.json();
        serverOffsetRef.current = Date.parse(next.serverNow) - Date.now();
        setPayload(next);
        const startedActivity = next.activities.find(
          (activity) =>
            activity.key === activityKey && activity.status === "running"
        );
        try {
          await scheduleCompletionChime(startedActivity?.session);
        } catch (audioError) {
          console.warn("Could not schedule the completion chime.", audioError);
        }
      } catch (startError) {
        setError(startError.message || "Could not start the timer.");
        await loadTimers();
      } finally {
        setStartingKey("");
      }
    },
    [loadTimers, scheduleCompletionChime, unlockAudio]
  );

  const serverNow = nowMs + serverOffsetRef.current;

  return (
    <section
      className="daily-section daily-timers-section"
      aria-labelledby="daily-timers-heading"
    >
      <div className="daily-section-heading">
        <div>
          <span>Daily focus</span>
          <h2 id="daily-timers-heading">Twenty-five minutes, uninterrupted.</h2>
        </div>
        <p>
          Start one reading block. The server clock cannot be paused or reset.
        </p>
      </div>

      {payload && (
        <div className="daily-timer-summary" aria-label="Timer statistics">
          <span>
            Today
            <strong>
              {payload.stats.completedToday}/{payload.activities.length}
            </strong>
          </span>
          <span>
            All sessions
            <strong>{payload.stats.completedSessions}</strong>
          </span>
          <span>
            Focus logged
            <strong>{payload.stats.completedMinutes} min</strong>
          </span>
        </div>
      )}

      <div className="daily-timer-grid">
        {(payload?.activities || []).map((activity) => {
          const session = activity.session;
          const rawRemaining =
            activity.status === "running" && session
              ? (Date.parse(session.endsAt) - serverNow) / 1000
              : activity.status === "completed"
                ? 0
                : activity.durationSeconds;
          const remainingSeconds = Math.max(0, rawRemaining);
          const effectiveStatus =
            activity.status === "running" && remainingSeconds <= 0
              ? "completed"
              : activity.status;
          const progress =
            effectiveStatus === "available"
              ? 0
              : Math.min(
                  100,
                  ((activity.durationSeconds - remainingSeconds) /
                    activity.durationSeconds) *
                    100
                );
          return (
            <article
              className="daily-timer-card"
              data-status={effectiveStatus}
              key={activity.key}
            >
              <div className="daily-timer-card-head">
                <span className="daily-timer-mark" aria-hidden="true">
                  {ACTIVITY_MARKS[activity.key] || "25"}
                </span>
                <span className="daily-timer-status">
                  {effectiveStatus === "running"
                    ? "In progress"
                    : effectiveStatus === "completed"
                      ? "Done today"
                      : "Ready"}
                </span>
              </div>
              <div>
                <h3>{activity.label}</h3>
                <p>{activity.description}</p>
              </div>
              <time
                className="daily-timer-clock"
                dateTime={`PT${Math.ceil(remainingSeconds)}S`}
              >
                {formatClock(remainingSeconds)}
              </time>
              <div className="daily-timer-progress" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>
              {effectiveStatus === "available" ? (
                <button
                  type="button"
                  disabled={Boolean(startingKey)}
                  onClick={() => void startTimer(activity.key)}
                >
                  {startingKey === activity.key
                    ? "Starting..."
                    : "Start 25 minutes"}
                </button>
              ) : (
                <div className="daily-timer-locked">
                  {effectiveStatus === "running"
                    ? "Locked in - no pause"
                    : "Session saved"}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {!payload && !error && (
        <div className="daily-timer-loading" role="status">
          Loading focus timers...
        </div>
      )}
      {error && (
        <div className="daily-timer-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadTimers()}>
            Retry
          </button>
        </div>
      )}
      <p className="daily-timer-rule">
        Keep this tab open and sound on for the completion chime. Closing or
        reloading the page does not stop a running session.
      </p>
    </section>
  );
}
