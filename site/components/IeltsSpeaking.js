"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MODES = {
  short: {
    label: "Quick answer",
    part: "Part 1 style",
    seconds: 25,
    duration: "25 sec",
    description:
      "Answer naturally, then support your idea with a reason or example.",
  },
  long: {
    label: "Long turn",
    part: "Part 2 style",
    seconds: 120,
    duration: "2 min",
    description:
      "Develop a clear story or description around the cue-card points.",
  },
};

const PIPELINE_PHASES = ["transcribing", "evaluating", "complete"];
const RECENT_TOPICS_KEY = "daily-ielts-recent-topics";
const PREPARATION_MS = 5_000;

function formatTime(milliseconds) {
  const safe = Math.max(0, milliseconds);
  const totalSeconds = Math.ceil(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function supportedMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
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
    if (typeof payload?.error === "string") return payload.error;
  } catch {
    // Use the generic status message below.
  }
  return `Request failed (${response.status})`;
}

function Pipeline({ phase }) {
  const activeIndex = PIPELINE_PHASES.indexOf(phase);
  return (
    <div className="ielts-pipeline" aria-label="Evaluation progress">
      {PIPELINE_PHASES.map((step, index) => {
        const state =
          index < activeIndex
            ? "done"
            : index === activeIndex
              ? "active"
              : "waiting";
        return (
          <div className="ielts-pipeline-step" data-state={state} key={step}>
            <span className="ielts-pipeline-dot" aria-hidden="true">
              {state === "done" ? "✓" : index + 1}
            </span>
            <span>
              {step === "transcribing"
                ? "Transcribe"
                : step === "evaluating"
                  ? "Evaluate"
                  : "Feedback"}
            </span>
          </div>
        );
      })}
    </div>
  );
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

export default function IeltsSpeaking() {
  const [mode, setMode] = useState("short");
  const [topic, setTopic] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [remainingMs, setRemainingMs] = useState(MODES.short.seconds * 1000);
  const [preparationMs, setPreparationMs] = useState(PREPARATION_MS);
  const [micLevel, setMicLevel] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [transcription, setTranscription] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState(null);
  const [errorKind, setErrorKind] = useState(null);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const meterFrameRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioUrlRef = useRef(null);
  const recordingBlobRef = useRef(null);
  const sessionRef = useRef(null);
  const mountedRef = useRef(true);

  const modeConfig = MODES[mode];
  const isBusy = [
    "generating",
    "requesting-mic",
    "preparing",
    "recording",
    "transcribing",
    "evaluating",
  ].includes(phase);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const closeInput = useCallback(() => {
    if (meterFrameRef.current) {
      window.cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const resetAttempt = useCallback(() => {
    setEvaluation(null);
    setTranscription(null);
    setError(null);
    setErrorKind(null);
    recordingBlobRef.current = null;
    sessionRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setAudioUrl(null);
  }, []);

  const runPipeline = useCallback(
    async (blob, session, cachedTranscription = null) => {
      let speechData = cachedTranscription;
      try {
        if (!speechData) {
          setPhase("transcribing");
          const transcriptionResponse = await fetch("/api/ielts/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": blob.type || "application/octet-stream",
              "X-Recording-Duration-Ms": String(
                Math.round(session.recordedSeconds * 1000)
              ),
            },
            body: blob,
          });
          if (!transcriptionResponse.ok) {
            throw new Error(await responseError(transcriptionResponse));
          }
          speechData = await transcriptionResponse.json();
          if (!mountedRef.current) return;
          setTranscription(speechData);
        }

        setPhase("evaluating");
        const evaluationResponse = await fetch("/api/ielts/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: session.topic,
            transcript: speechData.transcript,
            stats: speechData.stats,
          }),
        });
        if (!evaluationResponse.ok) {
          throw new Error(await responseError(evaluationResponse));
        }
        const result = await evaluationResponse.json();
        if (!mountedRef.current) return;
        setEvaluation(result);
        setError(null);
        setErrorKind(null);
        setPhase("complete");
      } catch (pipelineError) {
        if (!mountedRef.current) return;
        setError(pipelineError.message || "The evaluation pipeline failed.");
        setErrorKind("pipeline");
        setPhase("error");
      }
    },
    []
  );

  const generateTopic = useCallback(async () => {
    if (isBusy) return;
    setPhase("generating");
    setError(null);
    setErrorKind(null);
    try {
      const response = await fetch("/api/ielts/topic", {
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
      setError(topicError.message || "Could not generate a topic.");
      setErrorKind("topic");
      setPhase("error");
    }
  }, [isBusy, mode, resetAttempt]);

  const startMeter = useCallback(async (stream) => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    audioContextRef.current = context;
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    const values = new Uint8Array(analyser.frequencyBinCount);

    const measure = () => {
      analyser.getByteFrequencyData(values);
      const average =
        values.reduce((sum, value) => sum + value, 0) / values.length;
      setMicLevel(Math.min(1, average / 72));
      meterFrameRef.current = window.requestAnimationFrame(measure);
    };
    measure();
  }, []);

  const startRecording = useCallback(async () => {
    if (!topic || isBusy) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError(
        "This browser does not support microphone recording. Try current Chrome, Safari, or Firefox over HTTPS."
      );
      setErrorKind("recording");
      setPhase("error");
      return;
    }

    resetAttempt();
    setPhase("requesting-mic");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 48_000,
      });
      recorderRef.current = recorder;
      chunksRef.current = [];
      const session = {
        topic,
        limitSeconds: modeConfig.seconds,
        recordedSeconds: modeConfig.seconds,
        startedAt: null,
      };
      sessionRef.current = session;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        session.cancelled = true;
        clearTimer();
        closeInput();
        setError(
          "The browser could not record the microphone. Please try again."
        );
        setErrorKind("recording");
        setPhase("error");
      };
      recorder.onstop = () => {
        clearTimer();
        closeInput();
        if (session.cancelled) return;
        const recordedSeconds = Math.max(
          0.1,
          Math.min(
            session.limitSeconds,
            (performance.now() - session.startedAt) / 1000
          )
        );
        session.recordedSeconds = recordedSeconds;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "application/octet-stream",
        });
        recordingBlobRef.current = blob;
        const nextAudioUrl = URL.createObjectURL(blob);
        audioUrlRef.current = nextAudioUrl;
        setAudioUrl(nextAudioUrl);
        void runPipeline(blob, session);
      };

      await startMeter(stream);
      const preparationStartedAt = performance.now();
      setPreparationMs(PREPARATION_MS);
      setPhase("preparing");
      timerRef.current = window.setInterval(() => {
        const preparationLeft =
          PREPARATION_MS - (performance.now() - preparationStartedAt);
        setPreparationMs(Math.max(0, preparationLeft));
        if (preparationLeft <= 0) {
          clearTimer();
          try {
            session.startedAt = performance.now();
            recorder.start(1_000);
            setRemainingMs(modeConfig.seconds * 1000);
            setPhase("recording");
            timerRef.current = window.setInterval(() => {
              const speakingLeft =
                modeConfig.seconds * 1000 -
                (performance.now() - session.startedAt);
              setRemainingMs(Math.max(0, speakingLeft));
              if (speakingLeft <= 0) {
                clearTimer();
                if (recorder.state !== "inactive") recorder.stop();
              }
            }, 100);
          } catch (startError) {
            session.cancelled = true;
            closeInput();
            setError(startError?.message || "Could not start the recording.");
            setErrorKind("recording");
            setPhase("error");
          }
        }
      }, 100);
    } catch (recordingError) {
      clearTimer();
      closeInput();
      const message =
        recordingError?.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in the browser's site settings and try again."
          : recordingError?.message || "Could not start the microphone.";
      setError(message);
      setErrorKind("recording");
      setPhase("error");
    }
  }, [
    clearTimer,
    closeInput,
    isBusy,
    modeConfig.seconds,
    resetAttempt,
    runPipeline,
    startMeter,
    topic,
  ]);

  const stopRecording = useCallback(() => {
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, [clearTimer]);

  const retryPipeline = useCallback(() => {
    if (!recordingBlobRef.current || !sessionRef.current) return;
    setError(null);
    setErrorKind(null);
    void runPipeline(
      recordingBlobRef.current,
      sessionRef.current,
      transcription
    );
  }, [runPipeline, transcription]);

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
    return () => {
      mountedRef.current = false;
      clearTimer();
      if (recorderRef.current?.state !== "inactive") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      if (meterFrameRef.current)
        window.cancelAnimationFrame(meterFrameRef.current);
      if (audioContextRef.current)
        audioContextRef.current.close().catch(() => {});
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, [clearTimer]);

  const pipelineVisible = ["transcribing", "evaluating", "complete"].includes(
    phase
  );
  const stats = transcription?.stats;
  const criteria = useMemo(
    () =>
      evaluation
        ? [
            ["Fluency & coherence", evaluation.criteria.fluencyAndCoherence],
            ["Lexical resource", evaluation.criteria.lexicalResource],
            ["Grammar", evaluation.criteria.grammaticalRangeAndAccuracy],
          ]
        : [],
    [evaluation]
  );

  return (
    <div className="ielts-workspace">
      <section className="ielts-setup" aria-label="Exercise type">
        <div className="ielts-section-label">Choose an exercise</div>
        <div className="ielts-mode-grid">
          {Object.entries(MODES).map(([key, config]) => (
            <button
              type="button"
              className="ielts-mode"
              data-selected={mode === key}
              onClick={() => chooseMode(key)}
              disabled={isBusy}
              key={key}
            >
              <span className="ielts-mode-topline">
                <strong>{config.label}</strong>
                <span>{config.duration}</span>
              </span>
              <span className="ielts-mode-part">{config.part}</span>
              <span className="ielts-mode-description">
                {config.description}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="ielts-topic-card">
        <div className="ielts-topic-heading">
          <span className="ielts-section-label">Your topic</span>
          <span className="ielts-duration-badge">{modeConfig.duration}</span>
        </div>
        {topic ? (
          <div className="ielts-topic-content">
            <h2>{topic.title}</h2>
            <p>{topic.prompt}</p>
            {topic.bulletPoints.length > 0 && (
              <div className="ielts-cue-card">
                <span>You should say:</span>
                <ul>
                  {topic.bulletPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="ielts-topic-empty">
            Generate a fresh {modeConfig.part.toLowerCase()} topic when you are
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
              : `Generate ${modeConfig.duration} topic`}
          </button>
        )}

        {topic && phase === "ready" && (
          <div className="ielts-topic-actions">
            <button
              type="button"
              className="ielts-primary"
              onClick={startRecording}
            >
              Start · 5 sec prep
            </button>
            <button
              type="button"
              className="ielts-secondary"
              onClick={generateTopic}
            >
              New topic
            </button>
          </div>
        )}

        {phase === "requesting-mic" && (
          <div className="ielts-status" role="status">
            Waiting for microphone permission…
          </div>
        )}

        {phase === "preparing" && (
          <div className="ielts-preparation" aria-live="assertive">
            <span className="ielts-section-label">Read the topic</span>
            <strong>{Math.max(1, Math.ceil(preparationMs / 1000))}</strong>
            <p>
              Recording starts automatically when the countdown reaches zero.
            </p>
          </div>
        )}

        {phase === "recording" && (
          <div className="ielts-recorder" aria-live="polite">
            <div className="ielts-recorder-topline">
              <span className="ielts-live">
                <i aria-hidden="true" /> Recording
              </span>
              <strong className="ielts-timer">{formatTime(remainingMs)}</strong>
            </div>
            <div className="ielts-meter" aria-label="Microphone input level">
              <span
                style={{ transform: `scaleX(${Math.max(0.025, micLevel)})` }}
              />
            </div>
            <button
              type="button"
              className="ielts-stop"
              onClick={stopRecording}
            >
              Finish early
            </button>
          </div>
        )}
      </section>

      {(pipelineVisible || audioUrl) && (
        <section className="ielts-processing-card">
          {pipelineVisible && <Pipeline phase={phase} />}
          {phase === "transcribing" && (
            <p role="status">ElevenLabs is transcribing your recording…</p>
          )}
          {phase === "evaluating" && (
            <p role="status">Your IELTS coach is preparing feedback…</p>
          )}
          {audioUrl && (
            <div className="ielts-playback">
              <span>Your recording</span>
              <audio controls preload="metadata" src={audioUrl} />
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
          {errorKind === "pipeline" && recordingBlobRef.current ? (
            <button
              type="button"
              className="ielts-secondary"
              onClick={retryPipeline}
            >
              Retry pipeline
            </button>
          ) : errorKind === "recording" && topic ? (
            <button
              type="button"
              className="ielts-secondary"
              onClick={startRecording}
            >
              Try recording again
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

      {evaluation && transcription && (
        <section className="ielts-results">
          <div className="ielts-score-card">
            <div>
              <span className="ielts-section-label">
                Estimated practice band
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

          {stats && (
            <div className="ielts-stats" aria-label="Delivery statistics">
              <span>
                <strong>{stats.wordCount}</strong> words
              </span>
              <span>
                <strong>{stats.wordsPerMinute}</strong> wpm
              </span>
              <span>
                <strong>{stats.pauseCount}</strong> notable pauses
              </span>
              <span>
                <strong>{stats.recordedSeconds.toFixed(1)}s</strong> recorded
              </span>
            </div>
          )}

          <div className="ielts-criteria-grid">
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
            <h3>What you said</h3>
            <p className="ielts-transcript">{transcription.transcript}</p>
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

          <p className="ielts-evaluation-note">
            This practice estimate uses your transcript and timing.
            Pronunciation is not scored because the evaluator does not receive
            phonetic audio evidence.
          </p>

          <div className="ielts-result-actions">
            <button
              type="button"
              className="ielts-primary"
              onClick={() => {
                resetAttempt();
                setRemainingMs(modeConfig.seconds * 1000);
                setPhase("ready");
              }}
            >
              Try this topic again
            </button>
            <button
              type="button"
              className="ielts-secondary"
              onClick={generateTopic}
            >
              Generate new topic
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
