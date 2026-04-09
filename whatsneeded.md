# What's Needed

## Goal

This file lists what is needed from the user to start building the CMS-backed, agent-driven presentation system cleanly.

## Minimum Needed To Start

### 1. One Real Project / Product Source

We need one concrete project to model first.

Provide:

- project name
- short product summary
- target audience
- what the presentation is supposed to achieve

This becomes the first real content set for `product.md`.

### 2. Product Truth Source

We need the factual source of truth.

Provide any of:

- existing pitch deck
- product brief
- website copy
- FAQ
- positioning document
- notes on claims that are approved vs not approved

This is needed so the agent does not invent business facts.

### 3. Presentation Goal

We need to know what the presentation is trying to do.

Examples:

- investor pitch
- sales demo
- product explainer
- onboarding walkthrough
- internal strategy presentation

This affects flow, CTA, tone, and question handling.

### 4. CTA / Contact Rules

We need the approved next-step behavior.

Provide:

- how users should contact you
- what action you want after the presentation
- whether CTA should push demo, call, signup, email, WhatsApp, etc
- exact contact details you want exposed

This becomes `cta/contact.md`.

### 5. Design Direction

We need enough visual direction to define `design.md`.

Provide:

- brand tone
- examples of visuals you like
- colors or style constraints if any
- whether the UI should feel more premium, editorial, cinematic, corporate, minimal, etc

If there is no strong design system yet, we can define one.

### 6. Image Source

We need a first approved image library.

Provide one of:

- a folder of approved images
- links to image assets
- existing slide visuals
- image list with context and usage notes

This becomes the basis for `images.json`.

### 7. Flow Preferences

We need presentation behavior rules.

Provide preferences for:

- should questions be answered immediately, after each slide, or at the end
- should the presenter ever auto-advance while mic mode is available
- how long should wrap-up last
- whether the agent may generate new slides dynamically

This becomes `flow.md`.

### 8. Agent Boundaries

We need to know what the agent is allowed to do.

Examples:

- can it generate new slides
- can it rewrite slide copy
- can it invent transitions
- can it answer only from approved content
- should it refuse when data is missing

This becomes part of repo `AGENTS.md` plus project-specific overrides.

## Needed For Supabase Phase

### 9. Supabase Project

When we move beyond local files, we will need:

- Supabase project URL
- anon key
- service role key for server-side work
- confirmation of whether we should create schema/migrations in this repo

### 10. CMS Editing Model

We need to know who will edit content.

Examples:

- only developers
- internal operators
- non-technical content team
- client-by-client editors

This affects schema design and admin UX decisions.

## Recommended First Deliverable From You

If you want the fastest start, give me these 5 things first:

1. one real project/product to model
2. the current pitch deck or product brief
3. desired CTA/contact details
4. 5 to 20 approved images or asset links
5. a short statement of how the presentation should behave

That is enough to let me scaffold:

- `AGENTS.md`
- `flow.md`
- `design.md`
- `product.md`
- `cta/contact.md`
- `images.json`
- and the first content schema

## Nice To Have

- brand guidelines
- existing customer objections
- sample audience questions
- competitor references
- preferred closing language
- examples of presentations whose pacing you like

## Best Way To Proceed

Recommended order:

1. start with local files in the repo
2. validate the content model on one real project
3. lock the schema and source-priority rules
4. then mirror that model into Supabase

This avoids designing the CMS too early without knowing what the agent actually needs.
