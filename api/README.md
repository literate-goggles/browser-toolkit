# daily.chebakov.me · FastAPI backend

One Python service backs the static Next.js site. It keeps the existing shared
vocab bans API and runs the server-only IELTS speaking pipeline.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service and provider-key readiness |
| `GET` | `/api/vocab/bans` | Fetch all shared vocab bans |
| `POST` | `/api/vocab/bans/<sourceId>` | Ban `{ "word": … }` |
| `DELETE` | `/api/vocab/bans/<sourceId>` | Clear one source |
| `DELETE` | `/api/vocab/bans/<sourceId>/<word>` | Unban one word |
| `POST` | `/api/ielts/topic` | Generate a 25-second or two-minute topic through OpenRouter |
| `POST` | `/api/ielts/transcribe` | Transcribe a raw browser audio upload through ElevenLabs Scribe |
| `POST` | `/api/ielts/evaluate` | Evaluate a transcript against the band-7.5 target through OpenRouter |

The browser calls transcription and evaluation separately so it can show the
real pipeline stage and retry evaluation without uploading audio again.
Recordings are not persisted by the backend.
Provider-backed routes have a small per-IP, in-memory hourly limit to put a
cost ceiling around this public personal site.

## Setup

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt -r api/requirements.txt
```

The repository-root `.env` is loaded by both the app and systemd unit:

```dotenv
ELEVENLABS_API_KEY=...
OPENROUTER_API_KEY=...

# Optional overrides
OPENROUTER_MODEL=google/gemini-2.5-flash
ELEVENLABS_STT_MODEL=scribe_v2
```

On the current server, the unit sets `CREDENTIALS_ENV_FILE` to the debate
project's existing `.env`. FastAPI selectively reads only
`ELEVENLABS_API_KEY` and `OPENROUTER_API_KEY` from it when this repository has
no local values; unrelated credentials are not imported into the process.

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

Runtime bans remain in `api/bans.json` and are excluded from git.
