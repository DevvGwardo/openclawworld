# Roadmap: OpenClaw World

## Overview

OpenClaw World transforms a Sims-style R3F multiplayer template into a living bot world where LLM-powered autonomous agents join, navigate, and converse with humans. The build follows testability dependencies: establish the base, make the server bot-aware, prove bots can connect as players, wire up the LLM Gateway, fuse everything into the perception-decision-action loop, add visible UI, layer on personality, and deploy. Phases 3 and 4 can run in parallel since headless bot client and Gateway integration are independent.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Base Setup** - Clone, run, and verify the existing R3F Sims multiplayer template
- [ ] **Phase 2: Server Modifications** - Make game server bot-aware with isBot flag, emotes, and health endpoint
- [ ] **Phase 3: Headless Bot Client** - Bot connects to game server as a first-class player via socket.io-client
- [ ] **Phase 4: Gateway Integration** - Connect to OpenClaw Gateway via WebSocket with challenge auth
- [ ] **Phase 5: Bot Bridge** - Wire perception-decision-action loop with validation and rate limiting
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
- [ ] 01-01-PLAN.md -- Clone repo, install deps, start server + client, verify multiplayer (presence, movement, chat)

### Phase 2: Server Modifications
**Goal**: Game server supports bot-specific data and expanded interaction events
**Depends on**: Phase 1
**Requirements**: SETUP-02, SETUP-03, INFRA-01
**Success Criteria** (what must be TRUE):
  1. A character can be created with an `isBot: true` flag that persists in the room's character data
  2. Server handles emote events (wave, sit, nod) beyond the existing dance, and other connected clients receive them
  3. A GET request to the health endpoint returns JSON status of the game server
**Plans**: TBD

Plans:
- [ ] 02-01: Add isBot flag to character schema and emote event handlers
- [ ] 02-02: Add health endpoint to game server

### Phase 3: Headless Bot Client
**Goal**: A Node.js process can join the game room as a visible player without a browser
**Depends on**: Phase 2
**Requirements**: CORE-01, CORE-02
**Success Criteria** (what must be TRUE):
  1. Running a Node.js script causes a new avatar to appear in the browser client's 3D scene
  2. The headless bot can be commanded (via code) to move to a grid position and the browser shows the avatar walking there
  3. The headless bot can emit a chat message that appears in the browser client
  4. Disconnecting the Node.js process removes the avatar from the browser scene
**Plans**: TBD

Plans:
- [ ] 03-01: BotClient class with socket.io-client connecting to game server
- [ ] 03-02: Action methods (move, say, emote) and connection lifecycle

### Phase 4: Gateway Integration
**Goal**: Bot Bridge can send prompts to an LLM via OpenClaw Gateway and receive structured responses
**Depends on**: Phase 1 (runs parallel with Phases 2-3)
**Requirements**: CORE-05, CORE-06
**Success Criteria** (what must be TRUE):
  1. WebSocket connection to Gateway completes challenge-based authentication handshake
  2. A hardcoded perception string sent to the Gateway returns a parseable action JSON from the LLM
  3. Gateway connection automatically reconnects and re-authenticates after a dropped connection
**Plans**: TBD

Plans:
- [ ] 04-01: Gateway WebSocket client with challenge auth and request/response correlation
- [ ] 04-02: Reconnection logic and connection health monitoring

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
**Plans**: TBD

Plans:
- [ ] 05-01: Perception module (world state snapshot, serialization to compact text)
- [ ] 05-02: Decision module (Gateway request, Zod validation, rate limiter)
- [ ] 05-03: Action execution and bot lifecycle manager (spawn, idle, disconnect, cleanup)

### Phase 6: Client UI
**Goal**: Human players can see what bots are saying through visible chat in the 3D scene
**Depends on**: Phase 2, Phase 5
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. When a bot (or human) speaks, a chat bubble floats above their avatar in 3D space and fades after ~5 seconds
  2. A 2D overlay panel shows the last 20 chat messages with speaker names attributed
**Plans**: TBD

Plans:
- [ ] 06-01: 3D chat bubbles (Billboard text, auto-fade)
- [ ] 06-02: 2D chat log overlay panel

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
| 1. Base Setup | 0/1 | Not started | - |
| 2. Server Modifications | 0/2 | Not started | - |
| 3. Headless Bot Client | 0/2 | Not started | - |
| 4. Gateway Integration | 0/2 | Not started | - |
| 5. Bot Bridge | 0/3 | Not started | - |
| 6. Client UI | 0/2 | Not started | - |
| 7. Bot Character | 0/3 | Not started | - |
| 8. Railway Deployment | 0/2 | Not started | - |
