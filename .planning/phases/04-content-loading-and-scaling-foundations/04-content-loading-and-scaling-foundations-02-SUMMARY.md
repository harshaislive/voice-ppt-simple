# Plan 04-02 Summary

## Outcome

Normalized runtime identity around `presentationSlug` while keeping `deckId` and persisted `deck_id` compatibility in place.

## What changed

- `public/app.js` now exports canonical selection helpers and preserves chosen `presentationSlug` and source during bootstrap
- Client startup no longer substitutes another presentation when a requested slug is missing
- `server/routes/session.js` now records canonical `presentationSlug` plus compatibility `deckId` metadata
- `server/routes/questions.js` and `server/routes/autoplex.js` now prefer `presentationSlug` over `projectSlug` for content reload
- Added `tests/runtime/content-identity.test.js`

## Verification

`npm test -- --runInBand tests/runtime/content-identity.test.js`

## Notes

Compatibility readers still receive `deckId`/`deck_id`, but canonical identity now flows through session metadata and client bootstrap explicitly.
