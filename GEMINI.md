# Project Overview
Voice-PPT is a voice-first presentation engine that uses AI to narrate slides in real-time, handle audience questions, and adapt the presentation flow. It features a Node.js/Express backend, Socket.IO for real-time WebSocket communication, and a mobile-first vanilla JavaScript frontend. The system relies heavily on Azure OpenAI for core AI functionalities, utilizing models like GPT-5.4 for content narration and question classification, and multiple Text-to-Speech (TTS) backends (such as Azure gpt-realtime-mini, Azure Speech REST API, or a legacy KittenTTS setup).

# Building and Running

### Prerequisites
- **Node.js**: >= 16.0.0
- **Azure OpenAI Account**: Requires deployments for GPT models and TTS models.

### Setup Instructions
1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Environment Configuration:**
   Copy `.env.example` to `.env` and populate it with your Azure OpenAI credentials.
   ```bash
   cp .env.example .env
   ```

3. **Initialize the Database:**
   Required before the first run.
   ```bash
   npm run db:init
   ```

### Running the Application
- **Production Mode:**
  ```bash
  npm start
  ```
- **Development Mode** (with nodemon for auto-restarting):
  ```bash
  npm run dev
  ```

*Optional: If using the legacy KittenTTS backend (`TTS_PROVIDER=kittentts`), setup the python environment using `./setup-kittentts.sh` and start the server manually on port 8080.*

# Development Conventions

- **Module System**: The backend codebase strictly adheres to CommonJS (`"type": "commonjs"`). Use `require()` and `module.exports`, not ES modules (`import`/`export`).
- **No Test/Linting Framework**: Currently, there is no configured test runner (`npm test` throws an error) and no linter or code formatter. 
- **Database Persistence**: The application uses `sql.js` to manage an in-memory SQLite database, which is flushed to a local file (`voice-ppt.db`) upon write or graceful shutdown. The schema migrations (`migrations.sql`) are re-run on every startup.
- **Frontend Architecture**: The `public/` directory contains vanilla HTML, CSS, and JS. There is no frontend build step or framework (like React or Vue).
- **Real-Time Communication**: Socket.IO is utilized extensively. Clients join session rooms via the `join-session` event, and the server pushes events such as `narration-chunk`, `audio-stream`, `slide-change`, and `question-added`.
- **Failure States & Mock Mode**: The system gracefully handles missing credentials by falling back to mock outputs and silent WAV placeholders for TTS, allowing for basic UI testing without active Azure keys.