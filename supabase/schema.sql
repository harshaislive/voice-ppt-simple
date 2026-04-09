-- Supabase CMS schema for Voice-PPT
-- This mirrors the local file/content model described in plan.md

create extension if not exists "pgcrypto";

create table if not exists projects (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    name text not null,
    status text not null default 'draft',
    config_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists knowledge_docs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    doc_type text not null,
    title text,
    content text,
    content_json jsonb not null default '{}'::jsonb,
    version integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (project_id, doc_type)
);

create table if not exists presentations (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    slug text not null unique,
    title text not null,
    status text not null default 'draft',
    deck_schema_json jsonb not null default '{}'::jsonb,
    flow_json jsonb not null default '{}'::jsonb,
    design_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists slides (
    id uuid primary key default gen_random_uuid(),
    presentation_id uuid not null references presentations(id) on delete cascade,
    slide_index integer not null,
    layout_type text not null default 'immersive',
    content_json jsonb not null default '{}'::jsonb,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (presentation_id, slide_index)
);

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

create index if not exists idx_knowledge_docs_project on knowledge_docs(project_id);
create index if not exists idx_presentations_project on presentations(project_id);
create index if not exists idx_slides_presentation on slides(presentation_id);
create index if not exists idx_images_project on images(project_id);
create index if not exists idx_cta_blocks_project on cta_blocks(project_id);
create index if not exists idx_contacts_project on contacts(project_id);
