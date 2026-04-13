-- Core Supabase CMS schema for Voice-PPT Agentic Presentations
-- This schema models the projects, context docs (soul, product, flow), presentations, and slides.

create extension if not exists "pgcrypto";

-- 1. PROJECTS
-- Top-level container for a brand or specific initiative (e.g., 'beforest')
create table if not exists projects (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,  -- e.g., 'beforest'
    name text not null,         -- e.g., 'Beforest Collectives'
    status text not null default 'active',
    config_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 2. KNOWLEDGE DOCS
-- Contextual rules and personality for the AI attached to a specific project.
-- These compile into the system prompt when a presentation is loaded.
create table if not exists knowledge_docs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    doc_type text not null,     -- e.g., 'soul', 'agents', 'flow', 'product', 'design', 'cta'
    title text,
    content text,               -- Raw Markdown text defining the rules
    content_json jsonb not null default '{}'::jsonb,
    version integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (project_id, doc_type)
);

-- 3. PRESENTATIONS
-- Individual slide decks linked to a project.
create table if not exists presentations (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    slug text not null unique,  -- e.g., 'ten_percent_club'
    title text not null,        -- e.g., 'Beforest 10% Club'
    status text not null default 'draft',
    deck_schema_json jsonb not null default '{}'::jsonb,
    flow_json jsonb not null default '{}'::jsonb,
    design_json jsonb not null default '{}'::jsonb, -- Stores { "startTitle": "...", "startSubtitle": "..." }
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 4. SLIDES
-- Sequence of slides for a specific presentation.
create table if not exists slides (
    id uuid primary key default gen_random_uuid(),
    presentation_id uuid not null references presentations(id) on delete cascade,
    slide_index integer not null,
    layout_type text not null default 'immersive',
    content_json jsonb not null default '{}'::jsonb, -- Stores { "title": "...", "content": "...", "image": "...", "customPrompt": "..." }
    notes text,                 -- The AI's narration script for this specific slide
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (presentation_id, slide_index)
);

-- 5. SUPPORTING TABLES (Optional / Expanded Capabilities)
-- For future-proofing your external CMS creator.

create table if not exists images (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    storage_path text not null,
    title text,
    context text,
    metadata_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (project_id, storage_path)
);

create table if not exists cta_blocks (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    title text,
    content_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists contacts (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    contact_type text not null,
    label text,
    value text not null,
    metadata_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 6. ANALYTICS TABLES
-- For deep analytics on AI and user behavior per session.
create table if not exists analytics_sessions (
    id uuid primary key default gen_random_uuid(),
    session_id text not null unique,
    project_slug text,
    presentation_slug text,
    participant_name text,
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    total_slides integer,
    questions_asked integer default 0
);

create table if not exists analytics_events (
    id uuid primary key default gen_random_uuid(),
    session_id text not null references analytics_sessions(session_id) on delete cascade,
    event_type text not null, -- 'slide_change', 'user_question', 'ai_narration', 'ai_answer', 'reaction'
    slide_index integer,
    content text,
    metadata_json jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- INDEXES for fast querying
create index if not exists idx_knowledge_docs_project on knowledge_docs(project_id);
create index if not exists idx_presentations_project on presentations(project_id);
create index if not exists idx_slides_presentation on slides(presentation_id);
create index if not exists idx_images_project on images(project_id);
create index if not exists idx_cta_blocks_project on cta_blocks(project_id);
create index if not exists idx_contacts_project on contacts(project_id);
create index if not exists idx_analytics_events_session on analytics_events(session_id);
