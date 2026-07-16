#!/usr/bin/env python3
"""Generate PTE-style "Repeat Sentence" practice items with matching audio.

Pipeline:
  1. Ask an LLM (via OpenRouter) to write PTE-style academic English sentences.
  2. Speak each sentence with ElevenLabs, rotating through a curated set of
     premade voices (UK/US/AU, mix of genders) so consecutive items don't
     sound identical.

Outputs:
  site/public/repeat-sentence/problems.json
  site/public/repeat-sentence/sentence-01.mp3 ... sentence-NN.mp3

Run:
  .venv/bin/python scripts/repeat_sentence_builder.py --count 20
  .venv/bin/python scripts/repeat_sentence_builder.py --reuse-sentences

`--reuse-sentences` reads the existing problems.json and only regenerates the
audio, which is useful when you want to change voices or TTS provider without
throwing away the curated sentence list.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_LLM = "anthropic/claude-sonnet-4.5"

ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
DEFAULT_TTS_MODEL = "eleven_multilingual_v2"

# Curated rotation of premade ElevenLabs voices — deliberate variety across
# accent (UK / US / AU) and gender so each sentence sounds different.
VOICE_ROTATION = [
    ("JBFqnCBsd6RMkjVDRZzb", "George",  "british"),
    ("EXAVITQu4vr4xnSDxMaL", "Sarah",   "american"),
    ("IKne3meq5aSn9XLyUdCD", "Charlie", "australian"),
    ("Xb7hH8MSUJpSbSDYk0k2", "Alice",   "british"),
    ("CwhRBWXzGAHq8TQ4Fs17", "Roger",   "american"),
    ("pFZP5JQG7iQjIQuC4Bku", "Lily",    "british"),
    ("onwK4e9ZLuTAKqWW03F9", "Daniel",  "british"),
    ("cgSgspJ2msm6clMCkdW9", "Jessica", "american"),
    ("nPczCjzI2devNBz1zQrb", "Brian",   "american"),
    ("XrExE9yKIg1WjnnlVkGX", "Matilda", "american"),
]


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


def elevenlabs_tts_mp3(
    text: str,
    api_key: str,
    voice_id: str,
    model_id: str,
) -> bytes:
    resp = requests.post(
        ELEVENLABS_TTS_URL.format(voice_id=voice_id),
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        json={
            "text": text,
            "model_id": model_id,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
                "style": 0.0,
                "use_speaker_boost": True,
            },
        },
        timeout=180,
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"ElevenLabs TTS error {resp.status_code}: {resp.text[:500]}"
        )
    if not resp.content:
        raise RuntimeError("ElevenLabs returned an empty body")
    return resp.content


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

def load_existing_sentences(out_dir: Path) -> list[str]:
    manifest_path = out_dir / "problems.json"
    if not manifest_path.exists():
        raise RuntimeError(
            f"--reuse-sentences: {manifest_path} not found; run without the "
            f"flag once to generate sentences first."
        )
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    items = data.get("items")
    if not isinstance(items, list) or not items:
        raise RuntimeError("--reuse-sentences: problems.json has no items")
    return [str(it.get("text", "")).strip() for it in items if it.get("text")]


def clear_audio_files(out_dir: Path, extensions: tuple[str, ...]) -> int:
    removed = 0
    for path in sorted(out_dir.iterdir()):
        if path.is_file() and path.suffix.lower() in extensions:
            path.unlink()
            removed += 1
    return removed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--out-dir", default="site/public/repeat-sentence")
    parser.add_argument("--llm-model", default=DEFAULT_LLM)
    parser.add_argument("--tts-model", default=DEFAULT_TTS_MODEL)
    parser.add_argument(
        "--reuse-sentences",
        action="store_true",
        help="Read texts from an existing problems.json and only regenerate the audio.",
    )
    args = parser.parse_args()

    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    elevenlabs_key = os.environ.get("ELEVENLABS_API_KEY")
    if not elevenlabs_key:
        print("ERROR: ELEVENLABS_API_KEY missing from .env", file=sys.stderr)
        return 1

    out_dir = (ROOT / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.reuse_sentences:
        print(f"[1/3] Reusing sentences from {out_dir.relative_to(ROOT)}/problems.json")
        sentences = load_existing_sentences(out_dir)
        print(f"      Got {len(sentences)} sentences to re-voice.")
    else:
        if not openrouter_key:
            print("ERROR: OPENROUTER_API_KEY missing from .env", file=sys.stderr)
            return 1
        print(f"[1/3] Generating {args.count} sentences via {args.llm_model}...")
        sentences = generate_sentences(args.count, openrouter_key, args.llm_model)
        print(f"      Got {len(sentences)} unique sentences.")
    if not sentences:
        print("ERROR: no sentences available", file=sys.stderr)
        return 1

    # Drop the previous audio artefacts so we don't end up with a mix of
    # .wav (old provider) and .mp3 (ElevenLabs) files in the output dir.
    removed = clear_audio_files(out_dir, (".mp3", ".wav"))
    if removed:
        print(f"      Cleared {removed} stale audio file(s).")

    print(
        f"[2/3] Synthesising audio via ElevenLabs (model={args.tts_model}), "
        f"rotating {len(VOICE_ROTATION)} voices..."
    )
    problems: list[dict] = []
    for idx, sentence in enumerate(sentences, start=1):
        voice_id, voice_name, accent = VOICE_ROTATION[(idx - 1) % len(VOICE_ROTATION)]
        slug = f"sentence-{idx:02d}.mp3"
        preview = sentence[:60] + ("…" if len(sentence) > 60 else "")
        print(f"      {idx:>2}/{len(sentences)}  {voice_name:<8} ({accent:<10})  {preview}")
        try:
            mp3 = elevenlabs_tts_mp3(sentence, elevenlabs_key, voice_id, args.tts_model)
        except Exception as exc:
            print(f"      TTS failed for {slug}: {exc}", file=sys.stderr)
            time.sleep(2)
            continue
        (out_dir / slug).write_bytes(mp3)
        problems.append(
            {
                "id": idx,
                "text": sentence,
                "audio": slug,
                "voice": voice_name,
                "voice_id": voice_id,
                "accent": accent,
            }
        )

    if not problems:
        print("ERROR: no audio was produced", file=sys.stderr)
        return 1

    manifest = {
        "meta": {
            "tts_provider": "elevenlabs",
            "tts_model": args.tts_model,
            "llm_model": args.llm_model,
            "voices": [
                {"id": v[0], "name": v[1], "accent": v[2]} for v in VOICE_ROTATION
            ],
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
