# Voice-PPT Audit Issues Tracker

**Date:** April 17, 2026
**Total Issues:** 79
**Fixed:** 1

---

## Legend
- [x] = Fixed
- [ ] = Pending
- P = Performance | A = Architecture | F = Frontend | AI = AI/ML | S = Security

---

## CRITICAL Issues

### [ ] P1: Sequential AI + TTS Blocking (3-8s per slide)
**Category:** P
**Location:** `server/routes/narration.js:73,89`
**Impact:** 3-8 seconds blocking per slide - user sees nothing
**Fix Applied:** ✅ Progressive streaming implemented - text chunks emit immediately, TTS runs in background

---

### [ ] A1: sessionReactions Map Memory Leak
**Category:** A
**Location:** `server.js:153-181`
**Impact:** Unbounded memory growth over sessions

---

### [ ] A2: sessionVotes Map Memory Leak
**Category:** A
**Location:** `server.js:154,231-244`
**Impact:** Unbounded memory growth over sessions

---

### [ ] A3: Global autoplexIo Race Condition
**Category:** A
**Location:** `autoplex.js:32-46,928`
**Impact:** Presentation timeout checks run against undefined on first ticks

---

### [ ] F1: Socket Listener Memory Leak
**Category:** F
**Location:** `socket.js:17-186,190`
**Impact:** Old handlers remain in memory on reconnect, browser slowdown over time

---

### [ ] F2: Slide Change / Audio Chunk Race Condition
**Category:** F
**Location:** `app.js:774-816`, `socket.js:48-60`
**Impact:** Audio ghosting or stops working after slide transitions

---

### [ ] F3: WrapUp Timer Guaranteed Cleanup Failure
**Category:** F
**Location:** `app.js:1695-1702`
**Impact:** Timer runs forever after wrapup ends if exception thrown

---

### [ ] F4: Audio State Machine Incomplete Reset
**Category:** F
**Location:** `audio.js:117-131`
**Impact:** Next audio may have distortion or leftover gain values

---

### [ ] AI1: No Retry Logic on LLM Calls
**Category:** AI
**Location:** `model.js:54-68,95-101,136-142,166-172`
**Impact:** Transient failures immediately trigger mock fallback

---

### [ ] AI2: TTS Hardcoded 30s Timeout
**Category:** AI
**Location:** `tts.js:164`
**Impact:** Long narrations fail 100% on slow connections

---

### [ ] S1: SQL Injection via Dynamic Table/Column Names
**Category:** S
**Location:** `db/init.js:12,16`
**Impact:** Potential injection if table names become external

---

### [ ] S2: Dual-Write Data Inconsistency
**Category:** S
**Location:** `session.js:89-115,117-123,296-308`
**Impact:** SQLite written first, Supabase async - data diverges on failure

---

### [ ] S3: Path Traversal in Audio Upload
**Category:** S
**Location:** `questions.js:176-181`
**Impact:** Malicious sessionId with `../` could write outside directory

---

## HIGH Severity Issues

### Performance

| # | Issue | Location | Status |
|---|-------|----------|--------|
| P2 | N+1 query in Supabase CMS (51 queries for 50 presentations) | `cms.js:282-307` | [ ] |
| P3 | Missing index on events.created_at | `db/init.js` | [ ] |
| P4 | Sequential file system operations in CMS | `cms.js:156-193` | [ ] |
| P5 | In-memory cache no size limit | `cms.js:12-13`, `stateStore.js:2-6` | [ ] |
| P6 | Synchronous database save | `db/init.js:78-84` | [ ] |
| P7 | No connection pooling for Supabase | `cms.js:455-488` | [ ] |
| P8 | Question classification unbounded | `classifyQuestionsPrompt.js:40-43` | [ ] |

### Architecture

| # | Issue | Location | Status |
|---|-------|----------|--------|
| A4 | Socket connect promise race | `socket.js:17-23,185` | [ ] |
| A5 | waitForPlaybackFinish can stuck | `app.js:919-973` | [ ] |
| A6 | Master cache not invalidated | `masterSession.js:60-77` | [ ] |
| A7 | Audio chunk emission with sleep | `autoplex.js:720-736` | [ ] |
| A8 | Question submission dual-write | `questions.js:200-354` | [ ] |
| A9 | In-memory state not shareable across instances | `autoplex.js:16-25` | [ ] |

### Frontend

| # | Issue | Location | Status |
|---|-------|----------|--------|
| F5 | Full scrubber rebuild on deck size change | `app.js:1245-1294` | [ ] |
| F6 | Reaction button listeners never removed | `app.js:399-407` | [ ] |
| F7 | Completion handler duplication | `app.js:1756-1767` | [ ] |
| F8 | Transcript chunk timers not canceled | `app.js:1007-1035` | [ ] |
| F9 | Loading quotes fetched every session | `app.js:93-115` | [ ] |

### AI/ML

| # | Issue | Location | Status |
|---|-------|----------|--------|
| AI3 | No request deduplication | `model.js` | [ ] |
| AI4 | TTS provider code duplication (95% identical) | `tts.js:270-380,570-671` | [ ] |
| AI5 | LIKE search without FTS index | `retrieval.js:62-76` | [ ] |
| AI6 | Credential env var confusion | `model.js:17-31` | [ ] |
| AI7 | Mock fallback uses banned phrases | `model.js:185-199` | [ ] |

### Security

| # | Issue | Location | Status |
|---|-------|----------|--------|
| S4 | Pregeneration endpoint unprotected | `session.js:344-348` | [ ] |
| S5 | Health endpoint reveals services | `server.js:69-88` | [ ] |
| S6 | In-memory rate limiter bypass | `security.js:172-204` | [ ] |
| S7 | Socket.IO events no rate limiting | `server.js:183-250` | [ ] |
| S8 | No migration version tracking | `init.js:40-61` | [ ] |
| S9 | Participant name not sanitized | `session.js:61` | [ ] |

---

## MEDIUM Severity Issues

### Performance

| # | Issue | Location |
|---|-------|----------|
| P9 | Repeated require() calls in hot paths | `model.js:55-56` |
| P10 | Batch question updates vs sequential | `slides.js:54-70` |
| P11 | Missing index on audience_memory.key | `db/init.js` |

### Architecture

| # | Issue | Location |
|---|-------|----------|
| A10 | Client socket promise resolution race | `socket.js:185` |
| A11 | Fire-and-forget Supabase updates | `session.js:305-308` |
| A12 | Master detection race in preGen vs run | `autoplex.js:1096-1103` |

### Frontend

| # | Issue | Location |
|---|-------|----------|
| F10 | Multiple sequential DOM writes | `app.js:796-798` |
| F11 | Noop resize handler registered | `app.js:424` |
| F12 | Question audio player stale reference | `app.js:63` |
| F13 | UI quote transition state leak | `ui.js:82-101` |

### AI/ML

| # | Issue | Location |
|---|-------|----------|
| AI8 | No circuit breaker pattern | `model.js` |
| AI9 | Rate limiter Map accumulates | `security.js:172-204` |
| AI10 | TTS fallback generates silence | `tts.js:673-680` |
| AI11 | No cost tracking or budget alerts | - |

### Security

| # | Issue | Location |
|---|-------|----------|
| S10 | CORS permissive in dev mode | `runtime.js:91-93` |
| S11 | Internal IPs in CORS origins | `runtime.js:1` |
| S12 | Verbose security failure logging | `security.js:106-108` |
| S13 | No CSRF protection | `server.js` |
| S14 | Socket.IO timing attack possible | `server.js:191` |

---

## LOW Severity Issues

| # | Category | Issue | Location |
|---|----------|-------|----------|
| L1 | P | Unbounded caches not cleaned | `cms.js`, `stateStore.js` |
| L2 | P | sessionReactions Map never cleaned | `server.js` |
| L3 | A | hasPendingPlayback doesn't check end states | `audio.js:108-115` |
| L4 | A | Audio Context resume without state check | `app.js:1630-1646` |
| L5 | A | analyzeImageBrightness canvas leak | `app.js:1181-1192` |
| L6 | F | Pregenerated audio source leak | `audio.js:152-192` |
| L7 | AI | No API key rotation mechanism | `.env.example` |
| L8 | S | Admin key enum info leak | `security.js:160-162` |
| L9 | S | Raw Supabase errors exposed | `supabaseSession.js:46` |

---

## Fix Priority Roadmap

### Phase 1: Critical Fixes (Week 1)
- [ ] A1, A2: Add session cleanup for sessionReactions/sessionVotes
- [ ] A3: Fix autoplexIo race condition
- [ ] F1: Fix socket listener cleanup on reconnect
- [ ] F2: Fix slide change / audio chunk race
- [ ] F3: Fix wrapUp timer cleanup
- [ ] AI1: Add retry logic with exponential backoff
- [ ] AI2: Add per-request TTS timeout override
- [ ] S3: Add sessionId validation for path traversal
- [ ] S1: Validate table/column names against allowlist

### Phase 2: High Priority (Week 2)
- [ ] P2: Fix N+1 in listSupabasePresentations
- [ ] P3: Add index on events.created_at
- [ ] P5: Implement LRU cache with size limit
- [ ] F5: Fix scrubber rebuild with incremental DOM
- [ ] A4: Fix socket connect promise race
- [ ] A9: Migrate state to Redis for horizontal scaling
- [ ] S2: Add transaction/rollback to Supabase dual-write
- [ ] S4: Add auth to pregen-progress endpoint

### Phase 3: Medium Priority (Week 3-4)
- [ ] P6: Add connection pooling for Supabase
- [ ] P9: Move require() to top of file
- [ ] AI3: Add request deduplication
- [ ] AI4: Extract base RealtimeTTS class
- [ ] A5: Fix waitForPlaybackFinish livelock
- [ ] S5: Remove service config from health endpoint
- [ ] S10: Add Socket.IO rate limiting

### Phase 4: Architectural (Future)
- [ ] A9: Redis for distributed state
- [ ] A6: Add Socket.IO Redis adapter
- [ ] P7: Implement FTS5 for SQLite search
- [ ] Add comprehensive integration tests
- [ ] Add end-to-end latency monitoring

---

## Summary

| Category | Critical | High | Medium | Low | Fixed |
|----------|----------|------|--------|-----|-------|
| Performance (P) | 1 | 8 | 3 | 2 | 1 |
| Architecture (A) | 3 | 6 | 3 | 3 | 0 |
| Frontend (F) | 4 | 5 | 4 | 3 | 0 |
| AI/ML (AI) | 2 | 5 | 4 | 1 | 0 |
| Security (S) | 3 | 6 | 5 | 2 | 0 |
| **TOTAL** | **13** | **30** | **19** | **11** | **1** |

**Progress:** 1/73 issues fixed (1.4%)
