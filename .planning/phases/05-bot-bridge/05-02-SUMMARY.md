---
phase: 05-bot-bridge
plan: 02
subsystem: bot-behavior
tags: [zod, validation, idle-patrol, action-schema]
dependency-graph:
  requires: [03-02]
  provides: [action-validation, idle-patrol, bot-actions-module]
  affects: [05-03]
tech-stack:
  added: [zod]
  patterns: [discriminated-union-validation, result-type-pattern]
key-files:
  created: [bot/actions.js, bot/idle.js]
  modified: []
decisions:
  - id: "05-02-01"
    summary: "Dance emote dispatches to botClient.dance() separately from other emotes"
  - id: "05-02-02"
    summary: "Look action is a no-op in v1 (logged at debug level only)"
  - id: "05-02-03"
    summary: "Array LLM responses take first element only"
metrics:
  duration: "1 min"
  completed: "2026-01-31"
---

# Phase 5 Plan 2: Action Validation and Idle Patrol Summary

Zod discriminated union validates move/say/emote/look actions from LLM output; IdleController generates random patrol waypoints with Chebyshev arrival detection.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Create Zod action schema and execution dispatch | bed59d0 | bot/actions.js |
| 2 | Create idle patrol controller | 6275e9d | bot/idle.js |

## What Was Built

### Action Schema (bot/actions.js)

- **ActionSchema**: Zod discriminated union with four action types (move, say, emote, look)
- **parseAction(raw)**: Accepts string or object, handles JSON parse errors and array responses (takes first), returns Result-type `{ ok, action/error }`
- **executeAction(action, botClient, logger)**: Dispatches validated actions to BotClient methods with try/catch error handling. Dance emote routes to `botClient.dance()` separately.

### Idle Controller (bot/idle.js)

- **IdleController class**: Autonomous patrol behavior with start/stop/tick/interrupt lifecycle
- Random waypoint generation avoiding map edges (1px inset) with minimum 3-unit distance from current position
- Chebyshev distance arrival detection with configurable threshold
- Patrol timer re-ticks every N ms to recover from stuck bots
- `interrupt()` clears waypoint without deactivating (patrol resumes after LLM action completes)

## Decisions Made

1. **Dance special case**: `emote("dance")` dispatches to `botClient.dance()` rather than `botClient.emote("dance")` since BotClient has a separate dance method/socket event.
2. **Look is a v1 no-op**: Logged at debug level with "no server support" message. Ready for future server-side implementation.
3. **Array response handling**: LLM may return multiple actions; we take only the first to avoid complex sequencing in v1.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed zod dependency**
- **Found during:** Task 1 setup
- **Issue:** zod not yet in bot/package.json (05-01 parallel plan installs it, but may not have run yet)
- **Fix:** Ran `npm install zod` in bot directory
- **Files modified:** bot/package.json, bot/package-lock.json (already committed by parallel plan)

## Verification Results

- `node --input-type=module -e "import './bot/actions.js'"` -- OK
- `node --input-type=module -e "import './bot/idle.js'"` -- OK
- Invalid Zod inputs produce `{ ok: false }`, never throw
- IdleController generates waypoints within [1, mapSize-2] bounds
- `emote("dance")` dispatches to `botClient.dance()`, others to `botClient.emote()`

## Next Phase Readiness

Both modules are ready for integration into the BotBridge orchestrator (05-03). No blockers.
