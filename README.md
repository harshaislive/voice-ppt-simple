# Voice-PPT

A voice-first presentation engine that uses AI to narrate slides in real-time, handle audience questions, and adapt presentation flow.

## Features

- **Real-time AI narration** using Azure OpenAI GPT-5.4
- **Text-to-speech** via Azure OpenAI gpt-realtime-mini, Azure Speech SDK word-boundary synthesis, or tts-1/tts-1-hd
- **Question classification** and prioritization
- **Slide advancement** based on audience interaction
- **Document indexing** and semantic retrieval
- **Real-time updates** via WebSocket (Socket.IO)
- **Minimal, mobile-first UI** with Apple-inspired design
- **Full-screen slides** with image backgrounds, minimal text

## Prerequisites

- Node.js >= 16
- Azure OpenAI account with GPT-5.4 deployment and gpt-realtime-mini deployment (for TTS)

## Setup

1. Clone and install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your Azure OpenAI credentials.

### TTS Provider (default: Azure Realtime)

The app supports multiple TTS backends. Set `TTS_PROVIDER` to switch backends:

| `TTS_PROVIDER`   | Description | Required env vars |
|------------------|-------------|-------------------|
| `azure-realtime` | gpt-realtime-mini via WebSocket (default) | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_TTS_DEPLOYMENT` |
| `azure-speech`   | tts-1/tts-1-hd via REST API | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_TTS_DEPLOYMENT` |
| `azure-sdk`      | Azure Speech SDK with real word-boundary timings for karaoke highlighting | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| `kittentts`      | Legacy KittenTTS Python server | `KITTENTTS_URL` |

If you are using an Azure Foundry project/account endpoint such as `https://<name>.services.ai.azure.com/`, the app also accepts:

- `AZURE_VOICELIVE_ENDPOINT`
- `AZURE_VOICELIVE_API_KEY`
- `AZURE_EXISTING_AIPROJECT_ENDPOINT`
- `AZURE_CHAT_DEPLOYMENT`

### KittenTTS (legacy, only if TTS_PROVIDER=kittentts)

Only needed if you set `TTS_PROVIDER=kittentts`. A setup script is provided:

```bash
./setup-kittentts.sh
```

This will install system dependencies (requires sudo), create a Python virtual environment, install KittenTTS, and start a TTS server on `http://localhost:8080/tts`.

To start the TTS server manually:

```bash
source .venv-tts/bin/activate
python .venv-tts/kittentts_server.py
```

The TTS server must be running before starting the main application **only when using KittenTTS**.

3. Initialize the database:
```bash
npm run db:init
```

4. Start the server:
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

## API Endpoints

### Session Management
- `POST /api/session/start` - Start a new presentation session (deckId: "ten_percent_club" or "beforest_pitch")
- `GET /api/session/:id` - Get session state

### Presentation Flow
- `POST /api/narrate` - Generate narration for current slide
- `POST /api/slide/advance` - Advance to next slide based on question queue

### Questions
- `POST /api/question` - Submit an audience question
- `GET /api/questions/:sessionId` - Get question queue for session

### Text-to-Speech
- `POST /api/tts` - Proxy TTS requests to KittenTTS

### Document Indexing
- `POST /api/files/index` - Index a document for retrieval
- `POST /api/retrieve` - Retrieve relevant document chunks

## WebSocket Events

### Client → Server
- `join-session` - Join a presentation session room

### Server → Client
- `narration-start` - Narration generation started
- `narration-chunk` - Narration text chunk
- `narration-end` - Narration generation complete
- `audio-stream` - Audio data from TTS
- `slide-change` - Slide changed
- `question-added` - New question added to queue
- `queue-update` - Question queue updated

## Project Structure

```
voice-ppt/
├── server.js                 # Main Express server
├── server/
│   ├── routes/              # API route handlers
│   ├── services/            # Business logic services
│   ├── prompts/             # AI prompt templates
│   ├── decks/               # Presentation deck examples
│   ├── schemas/             # JSON schemas
│   └── db/                  # Database migrations
├── public/                  # Frontend files
└── package.json
```

## Example Decks

The project includes two example decks:

### 1. `ten_percent_club.json` - Beforest 10% Club Presentation (7 slides)
A minimal, mobile-friendly presentation for the Beforest 10% Club, focused on wilderness integration. Each slide contains just an image, heading, and subheading - the AI agent speaks the detailed content.

1. **The Art of Return** - Intro to 30 nights/year in wilderness
2. **Great Disconnect** - Urban exile and the need for nature
3. **10% Solution** - 30 nights/year, 10-year commitment
4. **Sanctuaries** - Six wilderness locations across India
5. **The Tribe** - Who this is for (Naturalist, Seeker, Authenticist, Pioneer)
6. **Not For** - Who this is not for (Quick Fix Seeker, etc.)
7. **Call to Action** - Webinar invitation

### 2. `beforest_pitch.json` - Beforest Investment Pitch (5 slides)
A traditional pitch deck for Beforest's forest investment model.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource endpoint | - |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key | - |
| `AZURE_OPENAI_DEPLOYMENT_NAME` | GPT deployment name | `gpt-5.4` |
| `AZURE_OPENAI_TTS_DEPLOYMENT` | TTS model deployment name | `gpt-realtime-mini` |
| `AZURE_OPENAI_TTS_VOICE` | TTS voice (alloy/echo/fable/onyx/nova/shimmer) | `alloy` |
| `AZURE_SPEECH_KEY` | Azure Speech resource key for word-boundary timing | - |
| `AZURE_SPEECH_REGION` | Azure Speech resource region | - |
| `AZURE_SPEECH_VOICE` | Azure Speech voice name | `en-US-AvaMultilingualNeural` |
| `AZURE_VOICELIVE_ENDPOINT` | Azure Foundry account endpoint alias | - |
| `AZURE_VOICELIVE_API_KEY` | Azure Foundry API key alias | - |
| `AZURE_EXISTING_AIPROJECT_ENDPOINT` | Azure Foundry project endpoint alias | - |
| `AZURE_CHAT_DEPLOYMENT` | Azure Foundry chat deployment alias | - |
| `TTS_PROVIDER` | TTS backend: `azure-realtime`, `azure-speech`, `azure-sdk`, `kittentts` | Auto-detect |
| `KITTENTTS_URL` | KittenTTS API endpoint (legacy) | `http://localhost:8080/tts` |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `DB_PATH` | SQLite database path | `./voice-ppt.db` |

## License

MIT
