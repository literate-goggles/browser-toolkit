"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function RepeatSentence() {
  const [items, setItems] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [position, setPosition] = useState(0);
  const [playState, setPlayState] = useState("idle"); // idle | playing | played
  const [revealed, setRevealed] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/repeat-sentence/problems.json", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
        return r.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const list = Array.isArray(payload?.items) ? payload.items : [];
        setItems(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message || String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const total = items.length;
  const current = items[position] || null;
  const isLast = total > 0 && position + 1 >= total;

  useEffect(() => {
    // Reset per-problem state when advancing.
    setPlayState("idle");
    setRevealed(false);
  }, [position]);

  const play = useCallback(() => {
    const el = audioRef.current;
    if (!el || playState !== "idle") return;
    el.currentTime = 0;
    setPlayState("playing");
    el.play().catch((err) => {
      console.warn("[repeat-sentence] play failed", err);
      setPlayState("idle");
    });
  }, [playState]);

  const advance = useCallback(() => {
    if (isLast) return;
    setPosition((p) => Math.min(p + 1, total - 1));
  }, [isLast, total]);

  const restart = useCallback(() => {
    setPosition(0);
  }, []);

  const progressLabel = useMemo(
    () => (total > 0 ? `${position + 1} / ${total}` : "0 / 0"),
    [position, total],
  );

  if (loadError) {
    return (
      <div className="vocab-card">
        <div className="vocab-empty">
          Couldn&apos;t load problems: <code>{loadError}</code>. Generate them
          with <code>scripts/repeat_sentence_builder.py</code> and rebuild.
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="vocab-card">
        <div className="vocab-empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="vocab-card repeat-card">
      <div className="vocab-progress">
        <span className="vocab-progress-counter">{progressLabel}</span>
        <span className="vocab-progress-score">
          {playState === "played"
            ? "Played"
            : playState === "playing"
              ? "Playing…"
              : "Ready"}
        </span>
      </div>

      <div className="repeat-audio-block">
        <button
          type="button"
          className="repeat-play"
          onClick={play}
          disabled={playState !== "idle"}
          aria-label={
            playState === "played"
              ? "Already played"
              : playState === "playing"
                ? "Playing"
                : "Play once"
          }
        >
          <span aria-hidden="true">
            {playState === "playing" ? "▶" : playState === "played" ? "✓" : "▶"}
          </span>
          <span>
            {playState === "played"
              ? "Played once"
              : playState === "playing"
                ? "Playing…"
                : "Play once"}
          </span>
        </button>

        <audio
          ref={audioRef}
          src={`/repeat-sentence/${current.audio}`}
          preload="auto"
          onEnded={() => setPlayState("played")}
          onError={() => setPlayState("idle")}
        />
      </div>

      {!revealed ? (
        <button
          type="button"
          className="vocab-reveal"
          onClick={(event) => {
            event.currentTarget.blur();
            setRevealed(true);
          }}
        >
          Reveal text
        </button>
      ) : (
        <div className="repeat-text">{current.text}</div>
      )}

      <div className="repeat-actions">
        <button
          type="button"
          className="vocab-next"
          onClick={advance}
          disabled={isLast}
        >
          Next sentence
        </button>
        <button type="button" className="vocab-next" onClick={restart}>
          Restart
        </button>
      </div>
    </div>
  );
}
