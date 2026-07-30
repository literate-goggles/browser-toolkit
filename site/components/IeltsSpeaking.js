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
  discussion: {
    label: "Discussion",
    part: "Part 3 style",
    seconds: 60,
    duration: "1 min",
    description:
      "Explain, compare or speculate about a broader issue and support your view.",
  },
};

const PIPELINE_PHASES = ["transcribing", "evaluating", "complete"];
const RECENT_TOPICS_KEY = "daily-ielts-recent-topics";

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

function encodeWav(audioBuffer) {
  const samples = audioBuffer.getChannelData(0);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      44 + index * 2,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true
    );
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function convertToAssessmentWav(blob) {
  if (blob.type.split(";", 1)[0] === "audio/wav") return blob;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const OfflineAudioContext =
    window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContext || !OfflineAudioContext) {
    throw new Error(
      "This browser cannot prepare the recording for audio assessment."
    );
  }

  const decodingContext = new AudioContext();
  try {
    const decoded = await decodingContext.decodeAudioData(
      await blob.arrayBuffer()
    );
    const sampleRate = 16_000;
    const frameCount = Math.max(1, Math.ceil(decoded.duration * sampleRate));
    const renderingContext = new OfflineAudioContext(1, frameCount, sampleRate);
    const source = renderingContext.createBufferSource();
    source.buffer = decoded;
    source.connect(renderingContext.destination);
    source.start();
    return encodeWav(await renderingContext.startRendering());
  } finally {
    await decodingContext.close().catch(() => {});
  }
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
  const [micLevel, setMicLevel] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [transcription, setTranscription] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState(null);
  const [errorKind, setErrorKind] = useState(null);
  const [topicVoice, setTopicVoice] = useState("");

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const meterFrameRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioUrlRef = useRef(null);
  const recordingBlobRef = useRef(null);
  const sessionRef = useRef(null);
  const startRecordingRef = useRef(null);
  const topicAudioRef = useRef(null);
  const topicAudioUrlRef = useRef(null);
  const pendingPromptStreamRef = useRef(null);
  const mountedRef = useRef(true);

  const modeConfig = MODES[mode];
  const isBusy = [
    "generating",
    "synthesizing-topic",
    "playing-topic",
    "topic-ready",
    "requesting-mic",
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
    if (topicAudioRef.current) {
      topicAudioRef.current.pause();
      topicAudioRef.current.removeAttribute("src");
      topicAudioRef.current = null;
    }
    if (topicAudioUrlRef.current) {
      URL.revokeObjectURL(topicAudioUrlRef.current);
      topicAudioUrlRef.current = null;
    }
    if (pendingPromptStreamRef.current) {
      pendingPromptStreamRef.current
        .getTracks()
        .forEach((track) => track.stop());
      pendingPromptStreamRef.current = null;
    }
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
    setTopicVoice("");
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
            audioAssessment: speechData.audioAssessment,
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

  const handTopicToRecorder = useCallback((selectedTopic, preparedStream) => {
    if (!mountedRef.current) {
      preparedStream.getTracks().forEach((track) => track.stop());
      return;
    }
    pendingPromptStreamRef.current = null;
    void startRecordingRef.current?.(selectedTopic, preparedStream);
  }, []);

  const playTopicAudio = useCallback(
    async (selectedTopic, audioBlob, preparedStream, voiceName) => {
      const promptUrl = URL.createObjectURL(audioBlob);
      const promptAudio = new Audio(promptUrl);
      topicAudioRef.current = promptAudio;
      topicAudioUrlRef.current = promptUrl;
      pendingPromptStreamRef.current = preparedStream;
      setTopicVoice(voiceName);
      setError(null);
      setErrorKind(null);

      promptAudio.preload = "auto";
      promptAudio.onended = () => {
        handTopicToRecorder(selectedTopic, preparedStream);
      };
      promptAudio.onerror = () => {
        preparedStream.getTracks().forEach((track) => track.stop());
        pendingPromptStreamRef.current = null;
        setError(
          "The spoken question could not be played. Generate a new topic and try again."
        );
        setErrorKind("topic");
        setPhase("error");
      };

      setPhase("playing-topic");
      try {
        await promptAudio.play();
      } catch (playbackError) {
        if (playbackError?.name === "NotAllowedError") {
          setError(
            "Your browser blocked automatic audio. Press \"Play spoken question\" once; recording will still start automatically when it ends."
          );
          setErrorKind("topic-playback");
          setPhase("topic-ready");
          return;
        }
        preparedStream.getTracks().forEach((track) => track.stop());
        pendingPromptStreamRef.current = null;
        throw playbackError;
      }
    },
    [handTopicToRecorder]
  );

  const resumeTopicPlayback = useCallback(async () => {
    const promptAudio = topicAudioRef.current;
    if (!promptAudio) return;
    setError(null);
    setErrorKind(null);
    setPhase("playing-topic");
    try {
      await promptAudio.play();
    } catch (playbackError) {
      setError(
        playbackError?.message || "The spoken question could not be played."
      );
      setErrorKind("topic-playback");
      setPhase("topic-ready");
    }
  }, []);

  const prepareSpokenTopic = useCallback(
    async (existingTopic = null) => {
      if (isBusy) return;
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setError(
          "This browser does not support microphone recording. Try current Chrome, Safari, or Firefox over HTTPS."
        );
        setErrorKind("recording");
        setPhase("error");
        return;
      }

      let preparedStream = null;
      resetAttempt();
      if (!existingTopic) setTopic(null);
      setError(null);
      setErrorKind(null);
      try {
        setPhase("requesting-mic");
        preparedStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        pendingPromptStreamRef.current = preparedStream;
        if (!mountedRef.current) {
          preparedStream.getTracks().forEach((track) => track.stop());
          pendingPromptStreamRef.current = null;
          return;
        }

        let nextTopic = existingTopic;
        if (!nextTopic) {
          setPhase("generating");
          const response = await fetch("/api/ielts/topic", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode, recentTopics: recentTopics() }),
          });
          if (!response.ok) throw new Error(await responseError(response));
          nextTopic = await response.json();
          if (!mountedRef.current) {
            preparedStream.getTracks().forEach((track) => track.stop());
            pendingPromptStreamRef.current = null;
            return;
          }
          rememberTopic(nextTopic.prompt);
          setTopic(nextTopic);
        }

        setRemainingMs(MODES[nextTopic.mode].seconds * 1000);
        setPhase("synthesizing-topic");
        const speechResponse = await fetch("/api/ielts/topic/audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextTopic),
        });
        if (!speechResponse.ok) {
          throw new Error(await responseError(speechResponse));
        }
        const voiceName =
          speechResponse.headers.get("X-ElevenLabs-Voice") || "British voice";
        const speechBlob = await speechResponse.blob();
        if (!speechBlob.size) {
          throw new Error("ElevenLabs returned an empty spoken question.");
        }
        if (!mountedRef.current) {
          preparedStream.getTracks().forEach((track) => track.stop());
          pendingPromptStreamRef.current = null;
          return;
        }
        await playTopicAudio(
          nextTopic,
          speechBlob,
          preparedStream,
          voiceName
        );
        preparedStream = null;
      } catch (topicError) {
        preparedStream?.getTracks().forEach((track) => track.stop());
        if (pendingPromptStreamRef.current === preparedStream) {
          pendingPromptStreamRef.current = null;
        }
        if (!mountedRef.current) return;
        const microphoneDenied = topicError?.name === "NotAllowedError";
        setError(
          microphoneDenied
            ? "Microphone access was denied. Allow it in the browser's site settings and try again."
            : topicError.message || "Could not prepare a spoken topic."
        );
        setErrorKind(microphoneDenied ? "recording" : "topic");
        setPhase("error");
      }
    },
    [isBusy, mode, playTopicAudio, resetAttempt]
  );

  const generateTopic = useCallback(
    () => prepareSpokenTopic(),
    [prepareSpokenTopic]
  );

  const retryCurrentTopic = useCallback(
    () => prepareSpokenTopic(topic),
    [prepareSpokenTopic, topic]
  );

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

  const startRecording = useCallback(
    async (selectedTopic = topic, preparedStream = null) => {
      if (!selectedTopic || (isBusy && !preparedStream)) return;
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
        const stream =
          preparedStream ||
          (await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          }));
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
          topic: selectedTopic,
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
        recorder.onstop = async () => {
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
          const playbackBlob = new Blob(chunksRef.current, {
            type: recorder.mimeType || mimeType || "application/octet-stream",
          });
          const nextAudioUrl = URL.createObjectURL(playbackBlob);
          audioUrlRef.current = nextAudioUrl;
          setAudioUrl(nextAudioUrl);
          setPhase("transcribing");
          try {
            const assessmentBlob = await convertToAssessmentWav(playbackBlob);
            if (!mountedRef.current || session.cancelled) return;
            recordingBlobRef.current = assessmentBlob;
            void runPipeline(assessmentBlob, session);
          } catch (conversionError) {
            if (!mountedRef.current) return;
            setError(
              conversionError?.message ||
                "Could not prepare the recording for evaluation."
            );
            setErrorKind("pipeline");
            setPhase("error");
          }
        };

        await startMeter(stream);
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
    },
    [
      clearTimer,
      closeInput,
      isBusy,
      modeConfig.seconds,
      resetAttempt,
      runPipeline,
      startMeter,
      topic,
    ]
  );
  startRecordingRef.current = startRecording;

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
      topicAudioRef.current?.pause();
      pendingPromptStreamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());
      if (topicAudioUrlRef.current)
        URL.revokeObjectURL(topicAudioUrlRef.current);
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
            ["Pronunciation", evaluation.criteria.pronunciation],
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
        <p className="writing-auto-start-note">
          The question is spoken once in a random British voice. Recording and
          the answer timer start immediately when the voice finishes.
        </p>
      </section>

      <section className="ielts-topic-card">
        <div className="ielts-topic-heading">
          <span className="ielts-section-label">Your topic</span>
          <span className="ielts-duration-badge">{modeConfig.duration}</span>
        </div>
        {topic ? (
          <div
            className="ielts-spoken-topic"
            data-state={phase}
            aria-live="polite"
          >
            <div className="ielts-spoken-topic-mark" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div>
              <h2>
                {phase === "synthesizing-topic"
                  ? "Preparing the spoken question"
                  : phase === "playing-topic"
                    ? "Listen carefully"
                    : phase === "topic-ready"
                      ? "Spoken question ready"
                      : "Question delivered"}
              </h2>
              <p>
                {phase === "synthesizing-topic"
                  ? "Selecting a random British examiner voice."
                  : phase === "playing-topic"
                    ? `${topicVoice || "British voice"} is reading your prompt now.`
                    : phase === "topic-ready"
                      ? "Press play once. Your recording starts when the question ends."
                      : "Answer now; the written prompt stays hidden."}
              </p>
            </div>
            {phase === "topic-ready" && (
              <button
                type="button"
                className="ielts-primary"
                onClick={() => void resumeTopicPlayback()}
              >
                Play spoken question
              </button>
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
            disabled={isBusy}
          >
            {phase === "requesting-mic"
              ? "Allow microphone…"
              : phase === "generating"
                ? "Generating…"
                : phase === "synthesizing-topic"
                  ? "Preparing audio…"
                : `Generate ${modeConfig.duration} topic`}
          </button>
        )}

        {phase === "requesting-mic" && (
          <div className="ielts-status" role="status">
            Waiting for microphone permission…
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
            <p role="status">
              OpenAI is transcribing and listening to your delivery…
            </p>
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
          ) : errorKind === "topic-playback" ? (
            <button
              type="button"
              className="ielts-primary"
              onClick={() => void resumeTopicPlayback()}
            >
              Play spoken question
            </button>
          ) : errorKind === "recording" && topic ? (
            <button
              type="button"
              className="ielts-secondary"
              onClick={() => void retryCurrentTopic()}
            >
              Hear topic and try again
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
                <strong>
                  {evaluation.deliveryAssessment.naturalness.band.toFixed(1)}
                </strong>{" "}
                naturalness
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
            <h3>Voice delivery</h3>
            <p>{evaluation.deliveryAssessment.summary}</p>
            <div className="ielts-criteria-grid">
              {[
                ["Naturalness", evaluation.deliveryAssessment.naturalness],
                [
                  "Rhythm & stress",
                  evaluation.deliveryAssessment.rhythmAndStress,
                ],
                [
                  "Intelligibility",
                  evaluation.deliveryAssessment.intelligibility,
                ],
              ].map(([label, criterion]) => (
                <div className="ielts-criterion" key={label}>
                  <div>
                    <h3>{label}</h3>
                    <strong>{criterion.band.toFixed(1)}</strong>
                  </div>
                  <p>{criterion.feedback}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="ielts-feedback-card">
            <h3>What you said</h3>
            <div className="ielts-response-version">
              <span>Your transcript</span>
              <p className="ielts-transcript">{transcription.transcript}</p>
            </div>
            <div
              className="ielts-response-version ielts-response-rewrite"
              data-target="7.5"
            >
              <span>Band 7.5 - minimal changes</span>
              <p>{evaluation.rewrittenResponse}</p>
            </div>
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
            This practice estimate combines the transcript, timing, and a direct
            audio assessment. Naturalness is coaching feedback; pronunciation is
            the official IELTS criterion. A clear non-native accent is not
            penalized.
          </p>

          <div className="ielts-result-actions">
            <button
              type="button"
              className="ielts-primary"
              onClick={generateTopic}
            >
              Generate new topic
            </button>
            <button
              type="button"
              className="ielts-secondary"
              onClick={() => void retryCurrentTopic()}
            >
              Try this topic again
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
