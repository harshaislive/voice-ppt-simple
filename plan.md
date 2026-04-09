# Plan

## Purpose

This file is the next-step handoff for the agent. It captures the planned move from a hardcoded presentation runtime into a CMS-backed, agent-driven presentation system.

## Core Direction

The product should evolve from:

- a runtime that plays static deck JSON files

into:

- a content system where the agent can read structured business context,
- compose or adapt slides on demand,
- narrate from grounded product knowledge,
- answer questions from approved sources,
- and close with approved CTA / contact guidance.

## Proposed Knowledge System

The agent should work from a small set of authoritative content sources instead of relying mainly on prompt text and deck JSON.

### `AGENTS.md`

Top-level declarative orchestration file.

It should define:

- source priority across all other files
- which source is authoritative for which topic
- what to do when sources conflict
- what the agent must never invent
- fallback behavior when information is missing
- runtime boundaries for narration, Q&A, design, and closing behavior

Important:

- `AGENTS.md` should stay declarative and compact
- it should not become a long essay or a mixed bag of random notes

Recommended location model:

- keep a base `AGENTS.md` in the repo as the global system contract
- store project-specific agent instructions in Supabase as overrides

This gives a clean split between:

- app-level orchestration rules that belong with the codebase
- project-level behavior that belongs with the CMS

### `flow.md`

Presentation runtime rules.

It should define:

- intro flow
- slide pacing
- question timing
- live mic interruption behavior
- subtitle behavior
- wrap-up behavior
- how the presentation transitions into CTA / next steps

This is the operational presentation playbook.

### `design.md`

Quick design rules for composition and UI behavior.

It should define:

- image-first layout
- heading placement
- max 2 lines of supporting text
- subtitle treatment
- mobile layout rules
- dock / mic placement
- chat affordance behavior
- wrap-up overlay rules

This should be practical design instruction, not vague branding copy.

### `images.json`

Structured visual library for agent-driven slide generation and adaptation.

Recommended fields:

- `id`
- `title`
- `path` or `url`
- `context`
- `tags`
- `tone`
- `best_for`
- `avoid_for`

This lets the agent choose visuals with context instead of guessing.

### `product.md`

Primary factual grounding source for company / product truth.

It should include:

- problem
- audience
- product definition
- positioning
- differentiation
- approved claims
- proof points
- objections / FAQs
- pricing or business model if relevant

This should be the main business truth source.

### `cta/contact.md`

Approved next-step and outreach guidance.

It should define:

- how users can reach out
- what next steps are possible
- demo / sales / support routes
- approved CTA wording
- how the presenter should end the conversation

This prevents weak or hallucinated closers.

## Additional Recommended Schema File

### `content_schema.json` or `deck_schema.md`

Recommended to formalize what a generated slide is allowed to contain.

It should define:

- required fields
- optional fields
- allowed layouts
- text limits
- image behavior
- subtitle expectations
- CTA slide structure

Without this, the agent may understand the content but still generate inconsistent slides.

## Source Priority Model

Recommended precedence:

1. `AGENTS.md`
2. `product.md`
3. `cta/contact.md`
4. `flow.md`
5. `design.md`
6. `images.json`
7. runtime / generated slide state

Suggested rule split:

- product facts come from `product.md`
- presentation behavior comes from `flow.md`
- visual decisions come from `design.md`
- outbound next steps come from `cta/contact.md`
- image selection comes from `images.json`

If sources conflict:

- factual truth should beat style guidance
- explicit CTA wording should beat generated closing language
- `AGENTS.md` should define final arbitration behavior

## CMS Direction

Yes, Supabase is a reasonable CMS/storage direction.

The right model is not literally “a table named `agents.md`.”

The better model is:

- structured rows for projects, decks, slides, docs, assets, and CTA blocks
- JSON columns where flexible structured content is useful
- object storage for images and media

Recommended split for agent instructions:

- repo `AGENTS.md` = base contract for all projects
- Supabase agent config = project-specific overrides

## Supabase Approach

Supabase can store the same concepts as the proposed file system.

Two good approaches:

### Option 1: Mixed Structured + Text

Use relational columns for stable fields and text fields for source docs.

Example:

- `projects`
- `presentations`
- `slides`
- `knowledge_docs`
- `images`
- `cta_blocks`

Where:

- `knowledge_docs.doc_type` could be `agents`, `flow`, `design`, `product`, `cta`
- `knowledge_docs.content` could store markdown or plain text

In this model:

- repo `AGENTS.md` remains authoritative for global behavior
- `knowledge_docs` with `doc_type = 'agents'` stores project-level additions or overrides

### Option 2: JSON-Heavy CMS

Make more of the content JSON-based.

Example:

- `projects.config_json`
- `presentations.flow_json`
- `presentations.design_json`
- `slides.content_json`
- `images.metadata_json`
- `cta_blocks.cta_json`

In this model:

- repo `AGENTS.md` still remains the global base contract
- project-specific agent instructions can live in something like `projects.config_json.agent_rules`

This is flexible and works well if you want the agent to consume everything as structured objects.

## Recommended Supabase Data Model

Suggested tables:

- `projects`
  - `id`
  - `name`
  - `slug`
  - `status`
  - `config_json`

- `knowledge_docs`
  - `id`
  - `project_id`
  - `doc_type`
  - `title`
  - `content`
  - `content_json`
  - `version`

- `presentations`
  - `id`
  - `project_id`
  - `title`
  - `deck_schema_json`
  - `flow_json`
  - `design_json`

- `slides`
  - `id`
  - `presentation_id`
  - `slide_index`
  - `layout_type`
  - `content_json`
  - `notes`

- `images`
  - `id`
  - `project_id`
  - `storage_path`
  - `title`
  - `context`
  - `metadata_json`

- `cta_blocks`
  - `id`
  - `project_id`
  - `title`
  - `content_json`

- `contacts`
  - `id`
  - `project_id`
  - `contact_type`
  - `label`
  - `value`
  - `metadata_json`

## Should Everything Be JSON?

Yes, it can be mostly JSON if you want.

That is workable for agent consumption because:

- the agent can read structured fields cleanly
- schemas can be validated before runtime
- content can be versioned consistently
- project-specific overrides are easier

Recommended compromise:

- stable relational columns for identity and indexing
- JSON columns for flexible content
- storage bucket for media

That gives you structure without losing flexibility.

## Recommended `AGENTS.md` Strategy

Best strategy:

- keep `/repo/AGENTS.md` as the stable, versioned base contract
- load project-specific agent instructions from Supabase at runtime
- merge project overrides under the source-priority rules defined in `AGENTS.md`

Suggested precedence:

1. repo `AGENTS.md`
2. project-specific Supabase agent config
3. project `product` / `flow` / `design` / `cta` content

This avoids two common problems:

- putting too much unstable project behavior directly into the repo
- losing a stable global agent contract by moving everything into the CMS

## Recommended Build Path

### Phase 1: Local File System

- create the docs and JSON files locally
- define the schema and source priority clearly
- wire runtime to read from these files

### Phase 2: Agent Grounding Layer

- load the new content sources into narration and Q&A context
- enforce schema rules for generated slides
- use image metadata for visual selection

### Phase 3: Supabase CMS

- mirror the local content model in Supabase
- move source content to project-backed tables
- store visuals in Supabase Storage
- load project-specific content at runtime

### Phase 4: Dynamic Slide Generation

- let the agent generate slides on the fly from project docs
- let the agent pick approved visuals from image metadata
- ground wrap-up and CTAs from stored CTA / contact content

## Immediate Next Task For Agent

The next agent should:

1. scaffold the content file structure
2. write a compact but strong `AGENTS.md`
3. create starter `flow.md`, `design.md`, `product.md`, `cta/contact.md`, and `images.json`
4. define `content_schema.json` or `deck_schema.md`
5. propose the Supabase schema that mirrors the same content model

## Summary

This is the right direction.

The goal is not just “move slides into a database.”

The goal is:

- declarative agent instructions
- grounded business context
- reusable presentation logic
- controlled visual selection
- approved CTA behavior
- and a clean path from local files to a Supabase-backed CMS.
