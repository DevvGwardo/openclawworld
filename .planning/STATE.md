# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-31)

**Core value:** Bots autonomously inhabit the world and feel alive -- even one bot joining, moving, and speaking through the LLM proves the full loop works.
**Current focus:** Phase 6 in progress (Client UI) -- chat message state and 3D bubble attribution

## Current Position

Phase: 6 of 8 (Client UI)
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-02-01 -- Completed 06-01-PLAN.md

Progress: [███████████░] 69%

## Performance Metrics

**Velocity:**
- Total plans completed: 11
- Average duration: 3 min
- Total execution time: 0.5 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 1 | 13 min | 13 min |
| 2 | 1 | 1 min | 1 min |
| 3 | 2 | 9 min | 4.5 min |
| 4 | 2 | 2 min | 1 min |
| 5 | 3 | 6 min | 2 min |
| 6 | 1 | 1 min | 1 min |

**Recent Trend:**
- Last 5 plans: 1 min, 1 min, 1 min, 2 min, 1 min
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
- [04-02]: Reconnect promise resolves immediately for reconnects (event-driven, not caller-blocking)
- [04-02]: Heartbeat interval configurable via constructor (default 15s)
- [04-02]: 20% jitter on backoff delay to prevent thundering herd
- [05-01]: Custom token bucket over limiter library wrapper (~30 lines, avoids API quirks)
- [05-01]: Chebyshev distance for perception radius (matches 8-directional tile grid)
- [05-02]: Dance emote dispatches to botClient.dance() separately from other emotes
- [05-02]: Look action is a no-op in v1 (logged at debug level only)
- [05-02]: Array LLM responses take first element only
- [05-03]: Gateway error/reconnectFailed events handled to prevent unhandled EventEmitter throws
- [05-03]: Single retry with simplified prompt on invalid LLM response before idle fallback
- [05-03]: Reactive trigger on chatMessage cancels timer and runs immediate tick
- [06-01]: charactersRef pattern for socket closure (handler can't see updated atom values)
- [06-01]: 20-message cap on chatMessagesAtom to prevent memory growth
- [06-01]: pointer-events-none on chat bubbles to avoid intercepting 3D clicks

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 5 (Bot Bridge): Perception serialization confirmed ~150-2000 chars (well within budget)
- Phase 7 (Bot Character): Emotional state modeling approach TBD (simple vector vs discrete states)

## Session Continuity

Last session: 2026-02-01
Stopped at: Completed 06-01-PLAN.md (Phase 6 plan 1 of 2)
Resume file: None
