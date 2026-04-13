# Voice-PPT: Content Upload Pipeline

Reference document for uploading presentation decks to the Voice-PPT Supabase CMS.

## Environment Setup

Create a `.env` file with:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SCHEMA=public
```

## Supabase Table Structure

### 1. `projects` — Brand/Initiative container

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | auto | Primary key |
| slug | text | YES | Unique identifier e.g. "beforest" |
| name | text | YES | Display name e.g. "Beforest Collectives" |
| status | text | default "active" | |
| config_json | jsonb | default {} | Project-level config |
| created_at | timestamptz | auto | |
| updated_at | timestamptz | auto | |

### 2. `knowledge_docs` — AI context documents per project

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | auto | Primary key |
| project_id | uuid | YES | FK to projects.id |
| doc_type | text | YES | One of: "soul", "agents", "product", "flow", "design", "cta" |
| title | text | optional | Display title |
| content | text | YES | Raw markdown content |
| content_json | jsonb | default {} | Structured version if applicable |
| version | integer | default 1 | |
| created_at | timestamptz | auto | |
| updated_at | timestamptz | auto | |

**UNIQUE constraint on (project_id, doc_type)** — only one doc of each type per project.

### 3. `presentations` — Slide decks linked to a project

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | auto | Primary key |
| project_id | uuid | YES | FK to projects.id |
| slug | text | YES | Unique identifier e.g. "ten_percent_club" |
| title | text | YES | Display name |
| status | text | default "draft" | Use "published" for live decks |
| deck_schema_json | jsonb | default {} | Optional schema rules |
| flow_json | jsonb | default {} | Optional presentation flow config |
| design_json | jsonb | default {} | Must include { "startTitle": "...", "startSubtitle": "..." } |
| created_at | timestamptz | auto | |
| updated_at | timestamptz | auto | |

### 4. `slides` — Individual slides in a presentation

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | auto | Primary key |
| presentation_id | uuid | YES | FK to presentations.id |
| slide_index | integer | YES | 0-based slide order |
| layout_type | text | default "immersive" | Slide layout type |
| content_json | jsonb | YES | { "title": "...", "content": "...", "image": "<url>", "customPrompt": "..." } |
| notes | text | optional | AI narration script for this slide |
| created_at | timestamptz | auto | |
| updated_at | timestamptz | auto | |

**UNIQUE constraint on (presentation_id, slide_index)**

### 5. `images` — Image metadata linked to project storage

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | auto | Primary key |
| project_id | uuid | YES | FK to projects.id |
| storage_path | text | YES | Path in Supabase Storage bucket |
| title | text | optional | Image description |
| context | text | optional | Usage context |
| metadata_json | jsonb | default {} | Alt text, dimensions, etc. |
| created_at | timestamptz | auto | |
| updated_at | timestamptz | auto | |

## Upload Workflow

Follow this exact order:

### Step 1: Create the project (if not exists)

```
POST /rest/v1/projects
Body: { "slug": "<project-slug>", "name": "<Project Display Name>" }
Headers: apikey, Authorization: Bearer <service_role_key>, Prefer: return=representation
```

Use `Prefer: resolution=merge-duplicates` to upsert.

### Step 2: Upload images to Supabase Storage

1. Create a storage bucket called `presentation-images` in Supabase dashboard (if not exists). Set it to **public**.
2. For each image file:

```
PUT /storage/v1/object/presentation-images/<project-slug>/<filename>
Headers: apikey, Authorization: Bearer <service_role_key>, Content-Type: <mime-type>
Body: <binary file content>
```

3. The public URL will be:
`https://<project-ref>.supabase.co/storage/v1/object/public/presentation-images/<project-slug>/<filename>`

4. Insert image metadata:

```
POST /rest/v1/images
Body: { "project_id": "<uuid>", "storage_path": "<project-slug>/<filename>", "title": "<description>", "context": "slide" }
```

### Step 3: Insert knowledge docs

Map each `.md` file to a doc_type:

| File | doc_type | Description |
|------|----------|-------------|
| soul.md | soul | Brand persona and voice |
| AGENTS.md | agents | Project-level rules and guardrails |
| product.md | product | Domain knowledge, features, pricing |
| flow.md | flow | Pacing and interaction rules |
| design.md | design | Visual layout context |
| cta/contact.md | cta | Call to action and contact info |

```
POST /rest/v1/knowledge_docs
Body: [{ "project_id": "<uuid>", "doc_type": "soul", "title": "Soul", "content": "<full markdown content>" }]
Headers: Prefer: return=representation
```

Use upsert with `Prefer: resolution=merge-duplicates` and include `on_conflict` query param.

### Step 4: Create the presentation

```
POST /rest/v1/presentations
Body: {
  "project_id": "<uuid>",
  "slug": "<deck-slug>",
  "title": "<Deck Title>",
  "status": "published",
  "design_json": { "startTitle": "<home title>", "startSubtitle": "<home subtitle>" }
}
```

### Step 5: Insert slides with image references

The `image` field in `content_json` must be the **full public Supabase Storage URL** from Step 2:

```
POST /rest/v1/slides
Body: [
  {
    "presentation_id": "<uuid>",
    "slide_index": 0,
    "layout_type": "immersive",
    "content_json": {
      "title": "Slide Title",
      "content": "Slide subtitle/text",
      "image": "https://<ref>.supabase.co/storage/v1/object/public/presentation-images/<project-slug>/slide-0.jpg"
    },
    "notes": "AI narration guidance for this slide"
  }
]
```

## Important Rules

- **Upsert everything**: Use `Prefer: resolution=merge-duplicates` and `on_conflict` query params to allow re-runs
- **References use UUIDs**: After creating a project, capture its `id` UUID — you need it for knowledge_docs, images, and presentations
- **Image URLs must be fully qualified**: The `content_json.image` field must contain the full public storage URL, not a relative path
- **Slide order matters**: `slide_index` starts at 0 and must be sequential
- **knowledge_docs use doc_type strings**: Only "soul", "agents", "product", "flow", "design", "cta" are read by the Voice-PPT engine
- **status must be "published"**: For presentations to appear in the app, their status must be "published"

## Example: Node.js Upload Script

```javascript
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PROJECT_SLUG = 'beforest';
const DECK_SLUG = 'beforest_pitch';
const CONTENT_DIR = './content/projects/beforest';
const IMAGES_DIR = './content/projects/beforest/images';

// Step 1: Upsert project
const { data: project } = await supabase
  .from('projects')
  .upsert({ slug: PROJECT_SLUG, name: 'Beforest Collectives' }, { onConflict: 'slug' })
  .select().single();

// Step 2: Upload images
const imageFiles = readdirSync(IMAGES_DIR);
const imageMap = {};
for (const file of imageFiles) {
  const buffer = readFileSync(join(IMAGES_DIR, file));
  const storagePath = `${PROJECT_SLUG}/${file}`;
  await supabase.storage.from('presentation-images').upload(storagePath, buffer, { upsert: true });
  const { data: { publicUrl } } = supabase.storage.from('presentation-images').getPublicUrl(storagePath);
  imageMap[file] = publicUrl;
  await supabase.from('images').upsert({
    project_id: project.id, storage_path: storagePath, title: file
  }, { onConflict: 'project_id,storage_path' });
}

// Step 3: Insert knowledge docs
const docTypes = {
  'soul.md': 'soul', 'AGENTS.md': 'agents', 'product.md': 'product',
  'flow.md': 'flow', 'design.md': 'design'
};
for (const [file, docType] of Object.entries(docTypes)) {
  try {
    const content = readFileSync(join(CONTENT_DIR, file), 'utf8');
    await supabase.from('knowledge_docs').upsert({
      project_id: project.id, doc_type: docType, title: file, content
    }, { onConflict: 'project_id,doc_type' });
  } catch {}
}

// Step 4: Create presentation
const deckConfig = JSON.parse(readFileSync(join(CONTENT_DIR, 'presentations/beforest_pitch.json'), 'utf8'));
const { data: presentation } = await supabase.from('presentations').upsert({
  project_id: project.id, slug: DECK_SLUG, title: deckConfig.title,
  status: 'published', design_json: { startTitle: deckConfig.startTitle, startSubtitle: deckConfig.startSubtitle }
}, { onConflict: 'slug' }).select().single();

// Step 5: Insert slides
await supabase.from('slides').delete().eq('presentation_id', presentation.id);
const slideRows = deckConfig.slides.map((slide, i) => ({
  presentation_id: presentation.id, slide_index: i,
  layout_type: slide.layout || 'immersive',
  content_json: {
    title: slide.title, content: slide.content,
    image: slide.image ? imageMap[basename(slide.image)] : null
  },
  notes: slide.notes
}));
await supabase.from('slides').insert(slideRows);
```