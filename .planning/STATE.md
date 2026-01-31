# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-31)

**Core value:** Bots autonomously inhabit the world and feel alive -- even one bot joining, moving, and speaking through the LLM proves the full loop works.
**Current focus:** Phase 4 in progress -- Gateway integration

## Current Position

Phase: 4 of 8 (Gateway Integration)
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-01-31 -- Completed 04-01-PLAN.md

Progress: [█████░░░░░] 31%

## Performance Metrics

**Velocity:**
- Total plans completed: 5
- Average duration: 5 min
- Total execution time: 0.4 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 1 | 13 min | 13 min |
| 2 | 1 | 1 min | 1 min |
| 3 | 2 | 9 min | 4.5 min |
| 4 | 1 | 1 min | 1 min |

**Recent Trend:**
- Last 5 plans: 13 min, 1 min, 4 min, 5 min, 1 min
- Trend: fast

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 8 phases derived from requirement clusters and testability dependencies
- [Roadmap]: Phases 3 and 4 parallelizable (headless bot client and Gateway integration are independent)
- [Roadmap]: INFRA-01 (health endpoint) moved to Phase 2 to be available early for server verification
- [02-01]: ALLOWED_EMOTES array-based validation for emote:play events
- [02-01]: http.createServer callback approach for health endpoint (not separate .on("request"))
- [02-01]: Legacy dance handler kept for backward compatibility (migration in Phase 6)
- [03-01]: BotClient extends EventEmitter for event forwarding from socket to consumer
- [03-01]: websocket-only transport to bypass CORS (no HTTP polling fallback)
- [03-01]: 5-second join timeout for fast failure detection
- [03-02]: Optimistic position update in move() rather than server confirmation
- [03-02]: No client-side emote validation -- server is authority
- [04-01]: Ed25519 signing via crypto.sign(null) -- Ed25519 requires null algorithm
- [04-01]: Connect request uses reserved id "0" for auth handshake
- [04-01]: Pre-auth request queuing with automatic flush on hello-ok

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 4 (Gateway): Exact LLM method names on Gateway API need verification during planning
- Phase 5 (Bot Bridge): Perception serialization token budget TBD during implementation
- Phase 7 (Bot Character): Emotional state modeling approach TBD (simple vector vs discrete states)

## Session Continuity

Last session: 2026-01-31
Stopped at: Completed 04-01-PLAN.md
Resume file: None
