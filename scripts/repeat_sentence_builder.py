#!/usr/bin/env python3
"""Generate PTE-style "Repeat Sentence" practice items with matching audio.

For each generated sentence we:
  1. Ask an LLM (via OpenRouter) to write PTE-style academic English sentences.
  2. Ask openai/gpt-audio-mini (also via OpenRouter) to speak the sentence,
     streaming pcm16 samples; we wrap those samples in a WAV container.

Outputs:
  site/public/repeat-sentence/problems.json
  site/public/repeat-sentence/sentence-01.wav ... sentence-NN.wav

Run:
  .venv/bin/python scripts/repeat_sentence_builder.py --count 20
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import struct
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_LLM = "anthropic/claude-sonnet-4.5"
DEFAULT_TTS = "openai/gpt-audio-mini"
DEFAULT_VOICE = "fable"  # British male on gpt-audio-mini
SAMPLE_RATE = 24_000
CHANNELS = 1
BITS_PER_SAMPLE = 16


# ---------------------------------------------------------------------------
# OpenRouter helpers
# ---------------------------------------------------------------------------

def _extract_json(content: str) -> dict:
    import re

    text = content.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```\s*$", text, re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    if not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
    return json.loads(text)


def openrouter_chat(messages: list[dict], api_key: str, model: str) -> dict:
    body = {
        "model": model,
        "messages": messages,
        "temperature": 0.9,
        "response_format": {"type": "json_object"},
    }
    resp = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/literate-goggles/browser-toolkit",
            "X-Title": "LiterateGoggles Repeat Sentence Builder",
        },
        json=body,
        timeout=240,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"OpenRouter chat error {resp.status_code}: {resp.text[:500]}")
    payload = resp.json()
    content = payload["choices"][0]["message"]["content"]
    return _extract_json(content)


def openrouter_tts_pcm16(
    text: str,
    api_key: str,
    model: str,
    voice: str,
) -> bytes:
    body = {
        "model": model,
        "modalities": ["text", "audio"],
        "audio": {"voice": voice, "format": "pcm16"},
        "stream": True,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You produce audio only. Read the user's sentence aloud "
                    "clearly, in a natural British English accent, at a normal "
                    "conversational pace. Do not add any commentary."
                ),
            },
            {"role": "user", "content": text},
        ],
    }
    resp = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/literate-goggles/browser-toolkit",
            "X-Title": "LiterateGoggles Repeat Sentence Builder",
        },
        json=body,
        timeout=180,
        stream=True,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"TTS error {resp.status_code}: {resp.text[:500]}")

    chunks: list[str] = []
    for raw in resp.iter_lines():
        if not raw:
            continue
        s = raw.decode("utf-8", errors="replace")
        if s.startswith("data: "):
            s = s[6:]
        if s.strip() == "[DONE]":
            break
        try:
            payload = json.loads(s)
        except Exception:
            continue
        for choice in payload.get("choices", []):
            delta = choice.get("delta") or {}
            aud = delta.get("audio")
            if isinstance(aud, dict) and aud.get("data"):
                chunks.append(aud["data"])
    if not chunks:
        raise RuntimeError("TTS returned no audio chunks")
    return base64.b64decode("".join(chunks))


# ---------------------------------------------------------------------------
# WAV wrapping
# ---------------------------------------------------------------------------

def pcm16_to_wav(pcm: bytes) -> bytes:
    byte_rate = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE // 8
    block_align = CHANNELS * BITS_PER_SAMPLE // 8
    subchunk2_size = len(pcm)
    chunk_size = 36 + subchunk2_size
    header = b"".join(
        [
            b"RIFF",
            struct.pack("<I", chunk_size),
            b"WAVE",
            b"fmt ",
            struct.pack(
                "<IHHIIHH",
                16,
                1,
                CHANNELS,
                SAMPLE_RATE,
                byte_rate,
                block_align,
                BITS_PER_SAMPLE,
            ),
            b"data",
            struct.pack("<I", subchunk2_size),
        ]
    )
    return header + pcm


# ---------------------------------------------------------------------------
# Sentence generation
# ---------------------------------------------------------------------------

def build_sentence_prompt(count: int) -> list[dict]:
    system = (
        "You author practice items for the PTE Academic \"Repeat Sentence\" task. "
        "Return STRICT JSON only, no prose."
    )
    user = (
        f"Write {count} original single sentences suitable for the PTE Academic "
        f"\"Repeat Sentence\" task. Requirements for each sentence:\n"
        f"  - between 8 and 14 words\n"
        f"  - academic register (university/campus/study context is ideal)\n"
        f"  - one clear main clause, one straightforward subordinate at most\n"
        f"  - concrete vocabulary, not abstract philosophy\n"
        f"  - factual/instructional tone, no questions, no imperatives shouted\n"
        f"  - no proper nouns, no ambiguous homophones, no digits\n"
        f"  - vary the topic across the batch (library, lectures, research, "
        f"student services, campus facilities, assignments, seminars, "
        f"scholarships, orientation, timetables, etc.)\n\n"
        f'Return this exact JSON shape:\n'
        f'{{"items": ["Sentence one.", "Sentence two.", ...]}}\n\n'
        f"Exactly {count} sentences. No duplicates. No commentary."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def generate_sentences(count: int, api_key: str, model: str) -> list[str]:
    data = openrouter_chat(build_sentence_prompt(count), api_key, model)
    raw = data.get("items")
    if not isinstance(raw, list):
        raise RuntimeError(f"Unexpected sentence payload: {data!r}")
    seen: set[str] = set()
    out: list[str] = []
    for entry in raw:
        s = str(entry).strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out[:count]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--out-dir", default="site/public/repeat-sentence")
    parser.add_argument("--llm-model", default=DEFAULT_LLM)
    parser.add_argument("--tts-model", default=DEFAULT_TTS)
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    args = parser.parse_args()

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY missing from .env", file=sys.stderr)
        return 1

    out_dir = (ROOT / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/3] Generating {args.count} sentences via {args.llm_model}...")
    sentences = generate_sentences(args.count, api_key, args.llm_model)
    print(f"      Got {len(sentences)} unique sentences.")
    if not sentences:
        print("ERROR: no sentences produced", file=sys.stderr)
        return 1

    print(
        f"[2/3] Synthesising audio via {args.tts_model} (voice={args.voice})..."
    )
    problems: list[dict] = []
    for idx, sentence in enumerate(sentences, start=1):
        slug = f"sentence-{idx:02d}.wav"
        print(f"      {idx:>2}/{len(sentences)}: {sentence[:60]}{'…' if len(sentence) > 60 else ''}")
        try:
            pcm = openrouter_tts_pcm16(sentence, api_key, args.tts_model, args.voice)
        except Exception as exc:
            print(f"      TTS failed for {slug}: {exc}", file=sys.stderr)
            time.sleep(2)
            continue
        wav = pcm16_to_wav(pcm)
        (out_dir / slug).write_bytes(wav)
        problems.append({"id": idx, "text": sentence, "audio": slug})

    if not problems:
        print("ERROR: no audio was produced", file=sys.stderr)
        return 1

    manifest = {
        "meta": {
            "voice": args.voice,
            "tts_model": args.tts_model,
            "llm_model": args.llm_model,
            "sample_rate": SAMPLE_RATE,
            "generated_count": len(problems),
        },
        "items": problems,
    }
    (out_dir / "problems.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"[3/3] Wrote {len(problems)} audio files + problems.json to "
        f"{out_dir.relative_to(ROOT)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
