# Future Feature: Presenter / Admin Mode

## Status
- Future feature.
- Not in current implementation scope.
- Current priority remains self-paced, per-viewer isolated sessions.

## Goal
Add a separate presenter-led mode for guided sessions, demos, webinars, or live sales walkthroughs, without mixing that behavior into the normal self-paced viewer flow.

## Product Shape
Two runtime modes should exist side by side:

### 1. Self-Paced Mode
- Every visitor gets an independent viewer session.
- Each viewer controls their own slide progression, pause, replay, and Q&A.
- Shared narration/audio assets can still be reused by deck and slide.

### 2. Presenter-Led Mode
- One presenter controls a shared live room.
- Audience members join as viewers of that room.
- Only the presenter can:
  - pause
  - resume
  - replay
  - jump slides
  - open or close Q&A
  - continue the flow
- Audience members should still be able to:
  - submit questions
  - react
  - view CTA/contact links

## Core Architecture

### Shared Content
- `deck` remains the canonical content source.
- Narration/audio assets should stay reusable by `deck + slideIndex`.

### Separate Runtime Types
- `viewer_session`
  - individual runtime
  - used for self-paced viewing
- `live_room`
  - shared runtime owned by one presenter
  - used for guided playback
- `live_room_participant`
  - membership and role mapping for a room
  - roles: `presenter`, `viewer`

## Expected Behavior

### Presenter
- Starts a live room from a deck.
- Receives a presenter control surface.
- Owns room playback state.
- Sees question queue and audience count.

### Viewer in Live Room
- Follows room state instead of controlling playback locally.
- Cannot send playback-control events.
- Can still interact through questions and reactions.

## UI Requirements

### Presenter UI
- current slide
- next / previous / jump
- pause / resume / replay
- audience count
- live question queue
- status of room

### Viewer UI
- clear `Live Session` indicator
- no local playback ownership
- question entry
- reaction controls
- CTA access

## Data / Event Model
- `deck`
- `viewer_session`
- `live_room`
- `live_room_participant`
- optional `live_room_question_queue`

Socket and API events for live rooms should be separate from self-paced viewer session events wherever possible.

## Why This Should Be Separate
- avoids polluting self-paced logic with shared-room assumptions
- prevents control collisions
- keeps 100+ self-paced viewers scalable
- makes live sessions explicit and easier to secure

## Suggested Implementation Order
1. Finish self-paced isolation completely.
2. Add deck-level public entry and per-viewer runtime as the default.
3. Introduce `live_room` backend model.
4. Add presenter-only control endpoints and sockets.
5. Add viewer live-room client behavior.
6. Add moderation / question queue improvements if needed.

## Non-Goals For Now
- full admin dashboard
- multi-presenter collaboration
- recording / playback of live rooms
- role management beyond one presenter and many viewers
