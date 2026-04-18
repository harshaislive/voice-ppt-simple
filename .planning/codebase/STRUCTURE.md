# Codebase Structure

**Analysis Date:** 2026-04-19

## Directory Layout

```text
voice-ppt-simple/
├── server.js                  # Process entry point; mounts middleware, routes, Socket.IO, and DB startup
├── server/                    # Backend modules grouped by role
├── public/                    # Static browser app, HTML, CSS, and frontend services
├── content/                   # File-based CMS content and project knowledge documents
├── supabase/                  # Supabase SQL/config artifacts for remote persistence
├── scripts/                   # One-off project scripts such as seeding utilities
├── .planning/codebase/        # Generated repository mapping documents
└── package.json               # Node package manifest and scripts
```

## Directory Purposes

**`server/`:**
- Purpose: All backend application code.
- Contains: Route modules in `server/routes/`, service modules in `server/services/`, prompt builders in `server/prompts/`, DB bootstrap files in `server/db/`, runtime config and middleware.
- Key files: `server/config/runtime.js`, `server/middleware/security.js`, `server/routes/autoplex.js`, `server/routes/session.js`, `server/services/cms.js`, `server/services/model.js`

**`public/`:**
- Purpose: The browser-delivered presentation client.
- Contains: App bootstrap in `public/app.js`, service classes in `public/services/*.js`, top-level HTML pages, fonts, and styles.
- Key files: `public/index.html`, `public/app.js`, `public/services/socket.js`, `public/services/audio.js`, `public/services/ui.js`, `public/styles.css`

**`content/`:**
- Purpose: Project content source for presentations and grounding documents.
- Contains: Per-project directories under `content/projects/` with `project.json`, presentation JSON files, and knowledge Markdown.
- Key files: `content/projects/beforest/project.json`, `content/projects/beforest/presentations/10_percent_lifestyle.json`, `content/projects/beforest/AGENTS.md`, `content/projects/beforest/product.md`

**`supabase/`:**
- Purpose: Remote persistence schema/setup assets.
- Contains: Supabase-side SQL or provisioning files used outside the Node runtime.
- Key files: `supabase/` contents are not required by `server.js`, but this directory is the natural home for remote DB/storage setup artifacts.

**`scripts/`:**
- Purpose: Operational and setup utilities.
- Contains: Scripted tasks referenced from `package.json`, such as `scripts/seed-supabase.js`.
- Key files: `scripts/seed-supabase.js`

## Key File Locations

**Entry Points:**
- `server.js`: Main backend startup and route composition root.
- `public/app.js`: Main browser application class and UI orchestration entry.
- `server/db/init.js`: Database initialization entry used by both startup and `npm run db:init`.

**Configuration:**
- `package.json`: Scripts, runtime metadata, and dependency list.
- `server/config/runtime.js`: CORS and production env validation rules.
- `AGENTS.md`: Global agent constitution loaded into realtime knowledge context.
- `.env.example`: Environment variable template; use this as the reference instead of reading local `.env` files.

**Core Logic:**
- `server/routes/`: HTTP API surface.
- `server/services/`: Backend orchestration, AI, persistence, CMS, and helper logic.
- `server/prompts/`: Prompt-construction modules used by `server/services/model.js`.
- `content/projects/`: Runtime content packages for presentations.

**Testing:**
- No dedicated automated test directory or test runner files are present in the repository root.
- `verify.sh` exists at the root, but it is an ad hoc verification script rather than a formal test suite.

## Naming Conventions

**Files:**
- Backend modules use lower camel or plain lowercase filenames with role-based names, for example `server/routes/session.js`, `server/services/slideEngine.js`, and `server/services/supabaseSession.js`.
- Content documents preserve semantic names from the agent context model, for example `content/projects/beforest/soul.md`, `content/projects/beforest/flow.md`, and `content/projects/beforest/cta/contact.md`.
- Frontend service files are singular nouns under `public/services/`, for example `public/services/audio.js` and `public/services/socket.js`.

**Directories:**
- Backend directories are layered by concern: `routes`, `services`, `middleware`, `config`, `db`, `prompts`, `schemas`, `decks`.
- Content directories are organized first by `projectSlug`, then by content type, as in `content/projects/beforest/presentations/` and `content/projects/beforest/cta/`.

## Where to Add New Code

**New Feature:**
- Primary code: Add HTTP endpoints under `server/routes/` and place nontrivial business logic in `server/services/`.
- Tests: Not applicable as a standardized location; if introducing automated tests, create a dedicated test location intentionally because none exists today.

**New Component/Module:**
- Implementation: Put browser-side modules under `public/services/` when they encapsulate UI, audio, socket, or voice behavior; keep page bootstrap in `public/app.js`.

**Utilities:**
- Shared helpers: Add backend helpers to `server/services/` if they are domain-aware, or colocate tightly scoped helpers inside the route/service module that owns them.

**New Presentation Content:**
- Project package: Create a new directory under `content/projects/<project-slug>/`.
- Presentation JSON: Place decks under `content/projects/<project-slug>/presentations/`.
- Knowledge docs: Place `AGENTS.md`, `soul.md`, `product.md`, `flow.md`, `design.md`, and `cta/contact.md` alongside the project as needed so `server/services/cms.js` can load them automatically.

## Special Directories

**`server/decks/`:**
- Purpose: Legacy or example local deck JSON files used as fallback by `server/services/cms.js`.
- Generated: No
- Committed: Yes

**`content/projects/`:**
- Purpose: Primary file-based CMS source used to assemble project knowledge and presentation definitions.
- Generated: No
- Committed: Yes

**`public/generated/`:**
- Purpose: Runtime audio artifact output path referenced by `server/routes/questions.js` and `server/routes/autoplex.js` for generated WAV files.
- Generated: Yes
- Committed: Not detected in the current tree

**`.planning/codebase/`:**
- Purpose: Generated architecture/reference docs consumed by other GSD commands.
- Generated: Yes
- Committed: Yes

---

*Structure analysis: 2026-04-19*
