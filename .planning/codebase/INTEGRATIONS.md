# External Integrations

**Analysis Date:** 2026-04-19

## APIs & External Services

**AI / LLM:**
- Azure OpenAI / Azure AI Foundry - Chat completions for narration, question classification, and next-step decisions
  - SDK/Client: `openai` `AzureOpenAI` client in `server/services/model.js`
  - Auth: `AZURE_OPENAI_API_KEY` or `AZURE_VOICELIVE_API_KEY` or `AZURE_AI_API_KEY`

**Realtime Voice:**
- Azure OpenAI Realtime / Azure AI Foundry Realtime - Browser voice conversations over WebRTC with ephemeral client secrets minted by backend
  - SDK/Client: backend REST calls in `server/routes/realtime.js`; browser `RTCPeerConnection` in `public/services/voice.js`; backend WS helper in `server/services/realtimePresenter.js`
  - Auth: `AZURE_OPENAI_REALTIME_API_KEY` or `AZURE_OPENAI_TTS_API_KEY` or `AZURE_OPENAI_API_KEY`

**Speech Synthesis:**
- Azure Speech SDK - Word-boundary-aware TTS path for synchronized highlighting
  - SDK/Client: `microsoft-cognitiveservices-speech-sdk` in `server/services/tts.js`
  - Auth: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`

**Legacy Speech Fallback:**
- KittenTTS server - Optional local/legacy HTTP TTS backend
  - SDK/Client: HTTP calls from `server/services/tts.js`
  - Auth: none detected; endpoint configured by `KITTENTTS_URL`

**CMS / Content Backend:**
- Supabase REST API - Remote project, presentation, slide, knowledge-doc, CTA, and analytics access
  - SDK/Client: direct `fetch` wrapper in `server/services/cms.js` and `server/services/supabaseSession.js`
  - Auth: `SUPABASE_SERVICE_ROLE_KEY`

## Data Storage

**Databases:**
- Embedded SQLite-compatible database persisted with `sql.js`
  - Connection: `DB_PATH`
  - Client: `sql.js` via `server/db/init.js` and helper wrapper in `server/services/dbHelper.js`
- Supabase Postgres (via REST)
  - Connection: `SUPABASE_URL`, `SUPABASE_SCHEMA`
  - Client: custom REST access in `server/services/cms.js`, `server/services/supabaseSession.js`, and `scripts/seed-supabase.js`

**File Storage:**
- Local filesystem for persisted local database and repo-hosted presentation assets in `content/projects/**` and `public/**`
- Supabase Storage for generated QA audio and slide narration audio in `server/services/supabaseSession.js`

**Caching:**
- In-memory TTL cache for CMS presentation loads in `server/services/cms.js`

## Authentication & Identity

**Auth Provider:**
- Custom session-control auth
  - Implementation: per-session control token validation and admin API key checks in `server/middleware/security.js`, plus optional passcode flow in `server/routes/session.js`
- Supabase service-role auth
  - Implementation: backend-to-Supabase bearer/API-key headers in `server/services/cms.js`, `server/services/supabaseSession.js`, and `scripts/seed-supabase.js`

## Monitoring & Observability

**Error Tracking:**
- None detected

**Logs:**
- Console logging throughout backend services and routes, including startup, CMS fallback, analytics writes, and TTS/model failures in `server.js`, `server/services/*.js`, and `server/routes/*.js`
- Health endpoint at `GET /api/health` in `server.js`

## CI/CD & Deployment

**Hosting:**
- Dockerized Node service in `Dockerfile`
- Compose deployment example in `docker-compose.yml`
- Coolify-targeted deployment notes in `.env.example`

**CI Pipeline:**
- None detected in repository files scanned

## Environment Configuration

**Required env vars:**
- Core server: `PORT`, `HOST`, `NODE_ENV`, `ALLOWED_ORIGINS`, `DB_PATH`
- Admin/session control: `ADMIN_API_KEY`, `DEFAULT_PASSCODE`
- Azure chat: `AZURE_OPENAI_ENDPOINT` or `AZURE_VOICELIVE_ENDPOINT` or `AZURE_EXISTING_AIPROJECT_ENDPOINT`
- Azure chat auth: `AZURE_OPENAI_API_KEY` or `AZURE_VOICELIVE_API_KEY` or `AZURE_AI_API_KEY`
- Azure chat deployment: `AZURE_OPENAI_DEPLOYMENT_NAME` or `AZURE_CHAT_DEPLOYMENT`
- Azure realtime / TTS: `AZURE_OPENAI_REALTIME_ENDPOINT`, `AZURE_OPENAI_REALTIME_API_KEY`, `AZURE_OPENAI_REALTIME_DEPLOYMENT`, `AZURE_OPENAI_TTS_ENDPOINT`, `AZURE_OPENAI_TTS_API_KEY`, `AZURE_OPENAI_TTS_DEPLOYMENT`, `AZURE_OPENAI_TTS_VOICE`, `TTS_PROVIDER`
- Azure Speech SDK: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_SPEECH_VOICE`
- Legacy fallback: `KITTENTTS_URL`
- Supabase CMS/session backend: `CMS_REMOTE_REQUIRED`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SCHEMA`, `SUPABASE_ANON_KEY`
- Supabase audio buckets used at runtime: `SUPABASE_QA_AUDIO_BUCKET`, `SUPABASE_SLIDE_AUDIO_BUCKET`

**Secrets location:**
- Environment variables loaded from `.env`/process environment, with examples in `.env.example`

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- Azure OpenAI chat completion requests from `server/services/model.js`
- Azure Realtime ephemeral secret and WebRTC call setup requests from `server/routes/realtime.js`
- Azure Realtime / TTS websocket and speech synthesis calls from `server/services/tts.js` and `server/services/realtimePresenter.js`
- Supabase REST and Storage requests from `server/services/cms.js`, `server/services/supabaseSession.js`, and `scripts/seed-supabase.js`

---

*Integration audit: 2026-04-19*
