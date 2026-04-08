# AGENTS.md

## Project

Voice-first presentation engine. Node.js/Express + Socket.IO backend, vanilla JS frontend. Uses Azure OpenAI for narration/question classification and TTS (via gpt-realtime-mini WebSocket or audio/speech REST API). SQLite via sql.js (in-memory with file persistence).

## Commands

```bash
npm install          # install deps
npm run db:init      # initialize sqlite database (required before first run)
npm start            # production server (node server.js)
npm run dev          # dev server with nodemon auto-restart
```

TTS server (KittenTTS) is optional — only needed if `TTS_PROVIDER=kittentts`:

```bash
./setup-kittentts.sh                # one-time: install KittenTTS + Python venv (needs sudo)
source .venv-tts/bin/activate && python .venv-tts/kittentts_server.py   # start TTS on :8080
```

**Startup order**: `npm run db:init` (first time) → `npm start`. No separate TTS server needed when using Azure TTS (default).

## No Tests / No Lint

No test framework is configured (`npm test` exits with error). No linter or formatter is set up.

## Architecture

- `server.js` — Express + Socket.IO entrypoint, inlined TTS/retrieval endpoints
- `server/routes/` — API route handlers (session, narration, questions, slides)
- `server/services/tts.js` — TTS service with three backends: `azure-realtime` (WebSocket, for gpt-realtime-mini), `azure-speech` (REST, for tts-1/tts-1-hd), `kittentts` (legacy HTTP)
- `server/services/` — Business logic: `model.js` (Azure OpenAI), `slideEngine.js`, `questionClassifier.js`, `retrieval.js`, `stateStore.js`, `dbHelper.js`
- `server/prompts/` — AI prompt templates (each exports `buildMessages()`)
- `server/decks/` — Built-in presentation JSON files: `ten_percent_club.json`, `beforest_pitch.json`
- `server/db/` — `init.js` (sql.js bootstrap) + `migrations.sql`
- `public/` — Vanilla JS frontend (no build step)

## Key Gotchas

- **CommonJS only** — `"type": "commonjs"` in package.json. Use `require()`/`module.exports`, not ESM.
- **TTS provider auto-detection** — `tts.js` defaults to `azure-realtime` when `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY` are set. Override with `TTS_PROVIDER` env var (`azure-realtime`, `azure-speech`, `kittentts`). Falls back to silent WAV placeholders when no provider is available or all fail.
- **Azure Realtime TTS** — Uses WebSocket to Azure OpenAI Realtime API (`gpt-realtime-mini`). Returns PCM16 at 24kHz mono, converted to WAV. Each `synthesize()` call opens a fresh WebSocket; expect ~1-2s connection latency per call.
- **Azure Speech TTS** — Simpler REST API via `client.audio.speech.create()`. Works with `tts-1`/`tts-1-hd`/`gpt-4o-mini-tts` deployments. Set `AZURE_OPENAI_TTS_DEPLOYMENT` to the TTS deployment name and `TTS_PROVIDER=azure-speech`.
- **sql.js persistence** — Database lives in memory, exported to `voice-ppt.db` on write/shutdown. Not a standard SQLite binding; migrations run on every startup (uses `CREATE TABLE IF NOT EXISTS`).
- **Mock mode** — App runs without Azure OpenAI credentials; `model.js` falls back to hardcoded mock narration/classification. TTS falls back to silent WAV placeholders if all providers fail.
- **Session IDs** — Deck IDs are string literals (`"ten_percent_club"` or `"beforest_pitch"`), passed in `POST /api/session/start`.
- **Socket.IO rooms** — Clients join by session ID via `join-session` event; server emits `narration-start/chunk/end`, `audio-stream`, `slide-change`, `question-added`, `queue-update`.
- **`.env` required** — Copy `.env.example` to `.env` and fill in Azure OpenAI credentials. App warns on missing creds but does not crash.