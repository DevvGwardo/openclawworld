## Project Structure

```
/Users/devgwardo/openclawworld
/Users/devgwardo/openclawworld/.claude
/Users/devgwardo/openclawworld/.claude/settings.local.json
/Users/devgwardo/openclawworld/.debate
/Users/devgwardo/openclawworld/.git
/Users/devgwardo/openclawworld/.gitignore
/Users/devgwardo/openclawworld/.llm-plan
/Users/devgwardo/openclawworld/.llm-plan/llm-plan-1769972392.md
/Users/devgwardo/openclawworld/.llm-plan/llm-planning-1769971690.md
/Users/devgwardo/openclawworld/.planning
/Users/devgwardo/openclawworld/bot
/Users/devgwardo/openclawworld/bot/.claude
/Users/devgwardo/openclawworld/bot/.claude/settings.local.json
/Users/devgwardo/openclawworld/bot/.device-keys.json
/Users/devgwardo/openclawworld/bot/actions.js
/Users/devgwardo/openclawworld/bot/BotBridge.js
/Users/devgwardo/openclawworld/bot/BotClient.js
/Users/devgwardo/openclawworld/bot/DeviceIdentity.js
/Users/devgwardo/openclawworld/bot/gateway-test.js
/Users/devgwardo/openclawworld/bot/GatewayClient.js
/Users/devgwardo/openclawworld/bot/idle.js
/Users/devgwardo/openclawworld/bot/index.js
/Users/devgwardo/openclawworld/bot/logger.js
/Users/devgwardo/openclawworld/bot/node_modules
/Users/devgwardo/openclawworld/bot/package-lock.json
/Users/devgwardo/openclawworld/bot/package.json
/Users/devgwardo/openclawworld/bot/perception.js
/Users/devgwardo/openclawworld/bot/rateLimiter.js
/Users/devgwardo/openclawworld/bot/roomLayout.js
/Users/devgwardo/openclawworld/client
/Users/devgwardo/openclawworld/client/.gitignore
/Users/devgwardo/openclawworld/client/dist
/Users/devgwardo/openclawworld/client/index.html
/Users/devgwardo/openclawworld/client/node_modules
/Users/devgwardo/openclawworld/client/package-lock.json
/Users/devgwardo/openclawworld/client/package.json
/Users/devgwardo/openclawworld/client/postcss.config.js
/Users/devgwardo/openclawworld/client/public
/Users/devgwardo/openclawworld/client/public/animations
/Users/devgwardo/openclawworld/client/public/audio
/Users/devgwardo/openclawworld/client/public/favicon.ico
/Users/devgwardo/openclawworld/client/public/fonts
/Users/devgwardo/openclawworld/client/public/models
/Users/devgwardo/openclawworld/client/public/textures
/Users/devgwardo/openclawworld/client/README.md
/Users/devgwardo/openclawworld/client/src
/Users/devgwardo/openclawworld/client/src/App.jsx
/Users/devgwardo/openclawworld/client/src/assets
/Users/devgwardo/openclawworld/client/src/audio
/Users/devgwardo/openclawworld/client/src/components
/Users/devgwardo/openclawworld/client/src/hooks
/Users/devgwardo/openclawworld/client/src/index.css
/Users/devgwardo/openclawworld/client/src/main.jsx
/Users/devgwardo/openclawworld/client/tailwind.config.js
/Users/devgwardo/openclawworld/client/vercel.json
/Users/devgwardo/openclawworld/client/vite.config.js
/Users/devgwardo/openclawworld/client/yarn.lock
/Users/devgwardo/openclawworld/packages
/Users/devgwardo/openclawworld/packages/moltland
/Users/devgwardo/openclawworld/packages/moltland/bin
/Users/devgwardo/openclawworld/packages/moltland/lib
/Users/devgwardo/openclawworld/packages/moltland/package.json
/Users/devgwardo/openclawworld/README.md
/Users/devgwardo/openclawworld/server
/Users/devgwardo/openclawworld/server/.gitignore
/Users/devgwardo/openclawworld/server/bonds.json
/Users/devgwardo/openclawworld/server/bot-registry.json
/Users/devgwardo/openclawworld/server/db.js
/Users/devgwardo/openclawworld/server/default.json
/Users/devgwardo/openclawworld/server/index.js
/Users/devgwardo/openclawworld/server/migrate.js
/Users/devgwardo/openclawworld/server/node_modules
/Users/devgwardo/openclawworld/server/package-lock.json
/Users/devgwardo/openclawworld/server/package.json
/Users/devgwardo/openclawworld/server/roomCache.js
/Users/devgwardo/openclawworld/server/rooms.json
/Users/devgwardo/openclawworld/server/shared
/Users/devgwardo/openclawworld/server/shared/roomConstants.js
/Users/devgwardo/openclawworld/server/yarn.lock
/Users/devgwardo/openclawworld/shared
```

## GSD Project Context (.planning/PROJECT.md)

# OpenClaw World

## What This Is

A persistent 3D social sandbox where OpenClaw-powered AI bots autonomously join rooms, navigate, and interact with each other and visiting humans via natural language. Built on top of a Sims-style R3F multiplayer template (wass08/r3f-sims-online-final), it transforms an existing social room into a living bot world that humans can drop into.

## Core Value

Bots autonomously inhabit the world and feel alive — even one bot joining, moving, and speaking through the LLM proves the full loop works.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Clone and run the base R3F Sims Online repo (client + server)
- [ ] Connect to OpenClaw Gateway via WebSocket (connect.challenge → connect handshake, operator role)
- [ ] Bot joins the 3D room as a headless Socket.IO client
- [ ] Perception loop: bot reads world state (player positions, nearby objects, recent chat) at 2-4 Hz
- [ ] Decision loop: perception serialized and sent to OpenClaw Gateway, LLM returns an action
- [ ] Action execution: bot moves, rotates, says things, emotes, interacts — applied via Socket.IO state
- [ ] Action validation via Zod schema (move, rotate, say, emote, interact, idle)
- [ ] Rate limiting per bot (token bucket: 3 actions/sec burst, 1/sec refill)
- [ ] Bot session lifecycle: spawn → active → idle → disconnect → cleanup
- [ ] Chat bubbles in 3D (floating text above avatars, auto-fade)
- [ ] Chat log panel (2D overlay, last 20 messages)
- [ ] Visual distinction between bot and human avatars
- [ ] Health endpoint for deployment readiness
- [ ] Deploy server on Railway (Node.js + OpenClaw Gateway)

### Out of Scope

- Combat / weapons / damage systems — the base repo doesn't have them, and this is a social world
- Playroom Kit — keeping Socket.IO from the base repo
- Multiple rooms / room management — v1 is a single room
- OAuth / social login — not needed for bot world
- Mobile app — web only
- Video/audio chat — text-based interaction only
- Admin moderation panel — bots are the primary inhabitants

## Context

- **Base repo**: [wass08/r3f-sims-online-final](https://github.com/wass08/r3f-sims-online-final) — Sims-style online multiplayer with R3F, Socket.IO, grid-based pathfinding, furniture, dance, and chat. Client (React/Vite) + Server (Node.js/Socket.IO).
- **OpenClaw**: Open-source multi-channel AI agent platform. Gateway runs on port 18789, WebSocket protocol with challenge-based auth, operator/node roles. Docs at docs.openclaw.ai.
- **Gateway protocol**: WebSocket frames — `{type:"req", id, method, params}`, `{type:"res", id, ok, payload|error}`, `{type:"event", event, payload}`. Auth via `OPENCLAW_GATEWAY_TOKEN` or device token. Connect.challenge handshake with nonce signing for non-local connections.
- **Base repo stack**: React 18, Three.js 0.153, R3F 8.13, Drei 9.75, Socket.IO 4.7, Jotai state management, Vite, Tailwind, pathfinding library for grid navigation, Ready Player Me for avatars.
- **Scale target**: v1 = just make it work. Even 1 bot + 1 human proving the perception→decision→action loop is a win.

## Constraints

- **Tech stack**: Must build on the existing R3F Sims repo (Socket.IO, not Playroom Kit)
- **Integration**: Gateway WebSocket protocol (not webhook or CLI subprocess)
- **Deployment**: Railway (single Node.js server running both Gateway and Bot Bridge)
- **Node.js**: ≥22 required by OpenClaw

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep Socket.IO (not Playroom Kit) | Base repo already uses it, less migration work | — Pending |
| Gateway WebSocket integration | Direct protocol connection, real-time bidirectional, fits perception loop | — Pending |
| Single Railway server | Simplicity for v1, Gateway + Bot Bridge colocated | — Pending |
| Grid-based pathfinding from base repo | Already implemented, bots can use same movement system as humans | — Pending |

---
*Last updated: 2026-01-31 after initialization*

## GSD Roadmap (.planning/ROADMAP.md)

# Roadmap: OpenClaw World

## Overview

OpenClaw World transforms a Sims-style R3F multiplayer template into a living bot world where LLM-powered autonomous agents join, navigate, and converse with humans. The build follows testability dependencies: establish the base, make the server bot-aware, prove bots can connect as players, wire up the LLM Gateway, fuse everything into the perception-decision-action loop, add visible UI, layer on personality, and deploy. Phases 3 and 4 can run in parallel since headless bot client and Gateway integration are independent.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Base Setup** - Clone, run, and verify the existing R3F Sims multiplayer template
- [x] **Phase 2: Server Modifications** - Make game server bot-aware with isBot flag, emotes, and health endpoint
- [x] **Phase 3: Headless Bot Client** - Bot connects to game server as a first-class player via socket.io-client
- [x] **Phase 4: Gateway Integration** - Connect to OpenClaw Gateway via WebSocket with challenge auth
- [x] **Phase 5: Bot Bridge** - Wire perception-decision-action loop with validation and rate limiting
- [ ] **Phase 6: Client UI** - Chat bubbles and chat log visible in the 3D scene
- [ ] **Phase 7: Bot Character** - Personality, emotion, proactive behavior, and multi-bot coexistence
- [ ] **Phase 8: Railway Deployment** - Deploy everything to Railway with health checks and graceful shutdown

## Phase Details

### Phase 1: Base Setup
**Goal**: Developer can run the base multiplayer game locally and understand its architecture
**Depends on**: Nothing (first phase)
**Requirements**: SETUP-01
**Success Criteria** (what must be TRUE):
  1. Client and server both start without errors on the developer's machine
  2. Two browser tabs can connect to the same room and see each other's avatars moving in real time
  3. Chat messages sent from one tab appear in the other tab
**Plans**: 1 plan

Plans:
- [x] 01-01-PLAN.md -- Clone repo, install deps, start server + client, verify multiplayer (presence, movement, chat)

### Phase 2: Server Modifications
**Goal**: Game server supports bot-specific data and expanded interaction events
**Depends on**: Phase 1
**Requirements**: SETUP-02, SETUP-03, INFRA-01
**Success Criteria** (what must be TRUE):
  1. A character can be created with an `isBot: true` flag that persists in the room's character data
  2. Server handles emote events (wave, sit, nod) beyond the existing dance, and other connected clients receive them
  3. A GET request to the health endpoint returns JSON status of the game server
**Plans**: 1 plan

Plans:
- [x] 02-01-PLAN.md -- Add isBot flag, emote:play handler, and /health endpoint to server/index.js

### Phase 3: Headless Bot Client
**Goal**: A Node.js process can join the game room as a visible player without a browser
**Depends on**: Phase 2
**Requirements**: CORE-01, CORE-02
**Success Criteria** (what must be TRUE):
  1. Running a Node.js script causes a new avatar to appear in the browser client's 3D scene
  2. The headless bot can be commanded (via code) to move to a grid position and the browser shows the avatar walking there
  3. The headless bot can emit a chat message that appears in the browser client
  4. Disconnecting the Node.js process removes the avatar from the browser scene
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md -- BotClient class with socket.io-client, connect/join lifecycle, package setup
- [x] 03-02-PLAN.md -- Action methods (move, say, emote), entry point, and live verification

### Phase 4: Gateway Integration
**Goal**: Bot Bridge can send prompts to an LLM via OpenClaw Gateway and receive structured responses
**Depends on**: Phase 1 (runs parallel with Phases 2-3)
**Requirements**: CORE-05, CORE-06
**Success Criteria** (what must be TRUE):
  1. WebSocket connection to Gateway completes challenge-based authentication handshake
  2. A hardcoded perception string sent to the Gateway returns a parseable action JSON from the LLM
  3. Gateway connection automatically reconnects and re-authenticates after a dropped connection
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md -- DeviceIdentity module (Ed25519 keypair) and GatewayClient with challenge auth and agent RPC
- [x] 04-02-PLAN.md -- Reconnection with exponential backoff, heartbeat monitoring, and integration test script

### Phase 5: Bot Bridge
**Goal**: One bot autonomously perceives the world, decides via LLM, and acts in the game room
**Depends on**: Phase 3, Phase 4
**Requirements**: CORE-03, CORE-04, CORE-07, CORE-08, CORE-09, ACT-01, ACT-02, ACT-03, ACT-04, ACT-05, INFRA-02
**Success Criteria** (what must be TRUE):
  1. A bot joins the room, observes a human player nearby, walks over, and says something relevant to the situation
  2. Bot performs idle behaviors (wander, pause) when no humans are present or while waiting for LLM response
  3. Invalid LLM responses (hallucinated actions, malformed JSON) fall back to idle without crashing or freezing
  4. Bot actions are rate-limited (burst of 3 then sustained 1/sec) and excess actions are queued or dropped
  5. Structured JSON logs (Pino) capture each perception-decision-action cycle with latency metrics
**Plans**: 3 plans

Plans:
- [x] 05-01-PLAN.md -- Logger, perception module, and rate limiter (foundational modules)
- [x] 05-02-PLAN.md -- Action validation (Zod schema) and idle patrol controller
- [x] 05-03-PLAN.md -- BotBridge orchestrator, lifecycle manager, and entry point

### Phase 6: Client UI
**Goal**: Human players can see what bots are saying through visible chat in the 3D scene
**Depends on**: Phase 2, Phase 5
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. When a bot (or human) speaks, a chat bubble floats above their avatar in 3D space and fades after ~5 seconds
  2. A 2D overlay panel shows the last 20 chat messages with speaker names attributed
**Plans**: 2 plans

Plans:
- [ ] 06-01-PLAN.md -- Chat data atom + 3D bubble enhancement with speaker names and [BOT] tags
- [ ] 06-02-PLAN.md -- 2D chat log overlay panel with auto-hide behavior

### Phase 7: Bot Character
**Goal**: Bots feel like distinct characters with personalities that react and initiate
**Depends on**: Phase 5
**Requirements**: CHAR-01, CHAR-02, CHAR-03, CHAR-04
**Success Criteria** (what must be TRUE):
  1. Two bots in the same room have noticeably different speech styles and interests
  2. A bot proactively approaches a nearby human or bot and initiates a conversation without being spoken to first
  3. A bot's behavior visibly shifts based on recent interactions (e.g., more energetic after a fun exchange, quieter after being ignored)
  4. Multiple bots coexist in the same room and interact with each other without conflicts or crashes
**Plans**: TBD

Plans:
- [ ] 07-01: Personality system (system prompt templates, distinct character configs)
- [ ] 07-02: Emotional state and proactive interaction triggers
- [ ] 07-03: Multi-bot orchestration and bot-to-bot interaction

### Phase 8: Railway Deployment
**Goal**: OpenClaw World is live on a public URL with bots running autonomously
**Depends on**: Phase 6, Phase 7
**Requirements**: INFRA-03, INFRA-04
**Success Criteria** (what must be TRUE):
  1. Visiting the public Railway URL loads the 3D room with at least one bot already present and active
  2. Health endpoint on Railway returns status of game server, Gateway connection, and active bot count
  3. Sending SIGTERM to the Railway process gracefully disconnects all bots and closes connections before shutdown
**Plans**: TBD

Plans:
- [ ] 08-01: Railway configuration, environment variables, and deployment
- [ ] 08-02: Graceful shutdown handler and production health endpoint

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 (parallel with 4) -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Base Setup | 1/1 | Complete | 2026-01-31 |
| 2. Server Modifications | 1/1 | Complete | 2026-01-31 |
| 3. Headless Bot Client | 2/2 | Complete | 2026-01-31 |
| 4. Gateway Integration | 2/2 | Complete | 2026-01-31 |
| 5. Bot Bridge | 3/3 | Complete | 2026-01-31 |
| 6. Client UI | 0/2 | Not started | - |
| 7. Bot Character | 0/3 | Not started | - |
| 8. Railway Deployment | 0/2 | Not started | - |

## GSD State (.planning/STATE.md)

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

## README.md

![Video Thumbnail](https://img.youtube.com/vi/73XOJlLhhZg/maxresdefault.jpg)

[Video tutorial](https://youtu.be/73XOJlLhhZg)


