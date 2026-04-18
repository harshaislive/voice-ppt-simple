# Technology Stack

**Analysis Date:** 2026-04-19

## Languages

**Primary:**
- JavaScript (CommonJS on the server, ESM in browser modules) - Backend entrypoint and services in `server.js`, `server/**/*.js`; browser app in `public/app.js` and `public/services/*.js`
- SQL - Local schema and migrations in `server/db/migrations.sql`; Supabase schema in `supabase/schema.sql` and `schema.sql`

**Secondary:**
- HTML/CSS - Static UI in `public/index.html`, `public/digest.html`, `public/mobile-mockup.html`, and `public/styles.css`
- Markdown/JSON content - Presentation and project content under `content/projects/**`, plus prompt and planning docs in repo root

## Runtime

**Environment:**
- Node.js `>=16.0.0` declared in `package.json`
- Docker runtime uses `node:20-alpine` in `Dockerfile`

**Package Manager:**
- npm - scripts and dependency metadata in `package.json`
- Lockfile: present in `package-lock.json`

## Frameworks

**Core:**
- Express `^4.18.2` - HTTP API and static file server in `server.js`
- Socket.IO `^4.7.2` - Realtime presentation events between backend and browser in `server.js` and `public/services/socket.js`
- Native browser WebRTC APIs - Voice session transport in `public/services/voice.js`

**Testing:**
- Not detected in `package.json`

**Build/Dev:**
- Nodemon `^3.0.1` - Development restart loop via `npm run dev` in `package.json`
- Docker / Compose - Containerized deployment in `Dockerfile` and `docker-compose.yml`
- No bundler/transpiler detected; static assets are served directly from `public/` by `express.static` in `server.js`

## Key Dependencies

**Critical:**
- `openai` `^4.20.0` - Azure OpenAI client used through `AzureOpenAI` in `server/services/model.js` and `server/services/tts.js`
- `microsoft-cognitiveservices-speech-sdk` `^1.49.0` - Azure Speech SDK TTS path in `server/services/tts.js`
- `socket.io` `^4.7.2` - Realtime narration, QA, and slide events in `server.js`
- `sql.js` `^1.9.0` - Embedded SQLite-compatible database loaded in-memory and persisted to file in `server/db/init.js`

**Infrastructure:**
- `dotenv` `^16.3.1` - Environment loading in `server.js`, `server/db/init.js`, and `scripts/*.js`
- `cors` `^2.8.5` - Runtime CORS policy in `server.js` and `server/config/runtime.js`
- `axios` `^1.6.0` - HTTP client used inside TTS service in `server/services/tts.js`
- `markdown-it` `^13.0.2` - Markdown parsing dependency declared in `package.json`
- `uuid` `^9.0.0` - Identifiers for sessions/questions/slides in `server/services/retrieval.js`, `server/services/supabaseSession.js`, and route handlers

## Configuration

**Environment:**
- Environment variables are documented in `.env.example`
- Runtime validation is centralized in `server/config/runtime.js`
- Server startup fails closed in production when Azure chat, TTS, CORS, or required Supabase settings are missing; see `server/config/runtime.js`
- Security-sensitive runtime toggles include `ALLOWED_ORIGINS`, `ADMIN_API_KEY`, `DEFAULT_PASSCODE`, `CMS_REMOTE_REQUIRED`, and the Azure/Supabase credentials listed in `.env.example`

**Build:**
- Container build config: `Dockerfile`
- Container runtime config: `docker-compose.yml`
- Local startup and utility commands: `package.json`

## Platform Requirements

**Development:**
- Node.js 16+ and npm for `npm install`, `npm run db:init`, and `npm start` from `README.md` and `package.json`
- Browser with WebRTC and microphone access for live voice mode in `public/services/voice.js`
- Optional Azure and Supabase credentials for full production-like behavior in `.env.example`

**Production:**
- Long-running Node process listening on `PORT`/`HOST` from `server.js`
- Persistent writable filesystem mount for `DB_PATH` (`/app/data/voice-ppt.db` in containers) from `Dockerfile` and `docker-compose.yml`
- Deployment shape documented for Coolify-style Docker deployment in `.env.example`

---

*Stack analysis: 2026-04-19*
