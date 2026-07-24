# daily.chebakov.me · FastAPI backend

One Python service backs the static Next.js site. It prepares and remembers the
daily morning digest, keeps the shared vocab bans API, and runs the server-only
IELTS pipelines.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service and provider-key readiness |
| `GET` | `/api/daily` | Return today's cached digest, generating it when stale |
| `GET` | `/api/vocab/bans` | Fetch all shared vocab bans |
| `POST` | `/api/vocab/bans/<sourceId>` | Ban `{ "word": … }` |
| `DELETE` | `/api/vocab/bans/<sourceId>` | Clear one source |
| `DELETE` | `/api/vocab/bans/<sourceId>/<word>` | Unban one word |
| `POST` | `/api/ielts/topic` | Generate a Speaking Part 1, 2, or 3 topic with GPT-5.6 Sol |
| `POST` | `/api/ielts/transcribe` | Transcribe audio and assess audible delivery with OpenAI |
| `POST` | `/api/ielts/evaluate` | Combine transcript and audio evidence into band-7.5 feedback |
| `POST` | `/api/ielts/writing/topic` | Generate Academic visuals, General Training letters, or Task 2 essays |
| `POST` | `/api/ielts/writing/evaluate` | Evaluate writing against four IELTS criteria and the 7.5 target |

The browser converts its recording to 16 kHz mono WAV, then calls
transcription/audio assessment and final evaluation separately so it can show
the real pipeline stage and retry evaluation without uploading audio again.
Recordings are not persisted by the backend. GPT-4o Transcribe produces the
text, GPT-Audio-1.5 listens for pronunciation, rhythm, intelligibility, and
naturalness, and GPT-5.6 Sol produces structured IELTS feedback.
Provider-backed routes have a small per-IP, in-memory hourly limit to put a
cost ceiling around this public personal site.

The daily digest fetches both Wikipedia date pages, Hugging Face Daily Papers,
the Hugging Face blog, and alphaXiv. GPT-5.6 Sol selects and writes
self-contained summaries. Free car images are resolved separately through
Wikipedia's PageImages API, so the model never supplies image URLs. The result
and persistent non-repetition history are stored in `api/daily.json`. A
background scheduler refreshes after midnight in `DAILY_TIMEZONE`; the first
request after a date change is a synchronous fallback if the scheduled refresh
has not finished.

## Setup

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt -r api/requirements.txt
```

The repository-root `.env` is loaded by both the app and systemd unit:

```dotenv
OPENAI_API_KEY=...

# Optional overrides
OPENAI_TEXT_MODEL=gpt-5.6-sol
OPENAI_TEXT_REASONING_EFFORT=low
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_AUDIO_MODEL=gpt-audio-1.5
DAILY_TIMEZONE=UTC
```

A repository-root `.env` supplies the server-only OpenAI key without exposing
it to the statically exported site. `CREDENTIALS_ENV_FILE` remains supported
for a separately managed credential file.

For local development:

```sh
cd api
../.venv/bin/uvicorn main:app --host 127.0.0.1 --port 3011 --reload
```

## Production

The systemd unit remains named `daily-vocab-bans.service` for a no-downtime
migration from the former Node service, but now launches FastAPI:

```sh
cd ~/Projects/dotfiles
sudo make services
sudo make nginx

sudo systemctl status daily-vocab-bans
sudo journalctl -u daily-vocab-bans -f
```

Runtime bans remain in `api/bans.json`; the daily cache and history live in
`api/daily.json`. Both files are excluded from git.
