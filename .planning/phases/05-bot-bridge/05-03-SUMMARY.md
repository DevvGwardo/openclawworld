---
phase: "05"
plan: "03"
subsystem: "bot-orchestration"
tags: ["orchestrator", "perception-decision-action", "lifecycle", "rate-limiting", "llm-integration"]
dependency-graph:
  requires: ["05-01", "05-02"]
  provides: ["BotBridge orchestrator", "autonomous bot entry point"]
  affects: ["06", "07"]
tech-stack:
  added: []
  patterns: ["perception-decision-action loop", "event-driven reactive triggers", "graceful lifecycle management"]
key-files:
  created: ["bot/BotBridge.js"]
  modified: ["bot/index.js"]
decisions:
  - id: "05-03-01"
    description: "Gateway error/reconnectFailed events handled to prevent unhandled EventEmitter throws"
  - id: "05-03-02"
    description: "Single retry with simplified prompt on invalid LLM response before idle fallback"
  - id: "05-03-03"
    description: "Reactive trigger on chatMessage cancels timer and runs immediate tick"
metrics:
  duration: "2 min"
  completed: "2026-01-31"
---

# Phase 5 Plan 3: BotBridge Orchestrator Summary

**BotBridge wires perception, LLM decision, and action execution into a single autonomous loop with lifecycle management, rate limiting, and idle fallback.**

## What Was Built

### Task 1: BotBridge Orchestrator (bot/BotBridge.js)

The main orchestrator class that creates and coordinates all modules:

- **Constructor** accepts full configuration via options/env vars (server URLs, bot name, loop interval, perception radius, rate limit params, debug flag)
- **Lifecycle**: `init -> spawning -> active -> stopping -> stopped` with clean transitions
- **`start()`**: Connects Gateway, connects game server, joins first room, starts idle + loop
- **`stop()`**: Clears timers, stops idle, destroys rate limiter, disconnects everything
- **`_tick()`**: Core perception-decision-action cycle:
  1. Take perception snapshot
  2. If no nearby players or no gateway: idle tick
  3. Serialize perception, build LLM prompt
  4. Call Gateway `invokeAgent()` for decision
  5. Parse + validate response (retry once on invalid JSON)
  6. Rate limit check before execution
  7. Execute action via `executeAction()`
  8. Record own action in perception context
  9. Log cycle with latency metrics
- **Reactive triggers**: Chat messages trigger immediate tick (cancel + restart interval)
- **Error handling**: All cycle errors caught, fall back to idle, structured error logging

### Task 2: Entry Point (bot/index.js)

Replaced demo script with production entry point:
- Creates BotBridge from environment config (`BOT_NAME`, `SERVER_URL`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`)
- Graceful shutdown on SIGINT/SIGTERM
- Structured JSON error logging on startup failure with exit code 1

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added Gateway error event handlers**

- **Found during:** Task 2 verification
- **Issue:** GatewayClient extends EventEmitter and emits "error" events. Without a listener, Node.js throws an unhandled error that crashes the process instead of producing a clean structured log.
- **Fix:** Added `this._gateway.on("error", ...)` and `this._gateway.on("reconnectFailed", ...)` handlers in BotBridge constructor
- **Files modified:** bot/BotBridge.js
- **Commit:** ceed0a1

## Verification Results

1. `import { BotBridge } from './bot/BotBridge.js'` -- imports cleanly
2. Constructor creates all sub-modules, state is "init"
3. Without servers: structured JSON error log + exit code 1 (no unhandled exceptions)
4. Old demo code fully replaced (no `sleep` references)

## Next Phase Readiness

BotBridge is the core deliverable of Phase 5 -- one bot that perceives, decides, and acts. All three phase 5 plans are now complete:
- 05-01: Logger, perception, rate limiter (foundational modules)
- 05-02: Action validation, idle controller (behavior modules)
- 05-03: BotBridge orchestrator, entry point (integration)

Ready for Phase 6 (server hardening) and Phase 7 (bot character/personality).
