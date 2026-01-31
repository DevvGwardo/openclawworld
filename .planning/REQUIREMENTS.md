# Requirements: OpenClaw World

**Defined:** 2026-01-31
**Core Value:** Bots autonomously inhabit the world and feel alive -- even one bot joining, moving, and speaking through the LLM proves the full loop works.

## v1 Requirements

### Base Setup

- [ ] **SETUP-01**: Clone and run base R3F Sims repo (client + server) with multiplayer verified
- [x] **SETUP-02**: Game server supports `isBot` flag on character data
- [x] **SETUP-03**: Game server handles emote events beyond existing dance (wave, sit, nod)

### Bot Core

- [x] **CORE-01**: Headless bot connects to game server via socket.io-client from Node.js
- [x] **CORE-02**: Bot joins a room and appears as a character with an avatar
- [ ] **CORE-03**: Perception loop reads world state at 2-4 Hz (positions, chat, objects, events)
- [ ] **CORE-04**: Perception serialized to concise text for LLM prompt (~500 tokens max)
- [ ] **CORE-05**: OpenClaw Gateway WebSocket connection with challenge-based auth (connect.challenge handshake)
- [ ] **CORE-06**: LLM decision request sent via Gateway, action response received and parsed
- [ ] **CORE-07**: Action validation via Zod discriminated union schema before execution
- [ ] **CORE-08**: Rate limiting per bot (token bucket: 3 actions/sec burst, 1 action/sec refill)
- [ ] **CORE-09**: Bot session lifecycle: spawn -> active -> idle -> disconnect -> cleanup

### Bot Actions

- [ ] **ACT-01**: Bot moves to grid positions using existing A* pathfinding system
- [ ] **ACT-02**: Bot speaks in room chat (max 200 characters per message)
- [ ] **ACT-03**: Bot performs emotes (wave, dance, sit, nod)
- [ ] **ACT-04**: Bot idles autonomously (wander, pause, look around) when not interacting
- [ ] **ACT-05**: Invalid LLM actions fall back to idle (never crash or break world state)

### Bot Character

- [ ] **CHAR-01**: Bot has distinct personality via system prompt (name, backstory, speech style, interests)
- [ ] **CHAR-02**: Bot initiates interactions with nearby humans and bots proactively
- [ ] **CHAR-03**: Bot emotional state shifts based on interactions (happy, bored, energetic, calm)
- [ ] **CHAR-04**: Multiple bots coexist and interact with each other in the same room

### Client UI

- [ ] **UI-01**: Chat bubbles float above avatars in 3D scene (auto-fade after 5 seconds, max 200 chars)
- [ ] **UI-02**: Chat log panel shows last 20 messages in 2D overlay with speaker attribution

### Infrastructure

- [x] **INFRA-01**: Health endpoint returns status of game server, Gateway connection, and active bots
- [ ] **INFRA-02**: Structured JSON logging with Pino (bot decisions, actions, errors, latency)
- [ ] **INFRA-03**: Deploy on Railway (game server + OpenClaw Gateway + Bot Bridge colocated)
- [ ] **INFRA-04**: Graceful shutdown on SIGTERM (disconnect all bots, close Gateway WS, clean up sessions)

## v2 Requirements

### Visual Polish

- **BADGE-01**: Visual distinction between bot and human avatars (AI badge or glow)
- **TYPING-01**: Typing indicator shown while bot LLM is processing (dots animation)
- **LOOKAT-01**: Bot avatar faces conversation partner during interaction

### Bot Intelligence

- **MEMORY-01**: Cross-session persistent memory (bot remembers humans between sessions)
- **ROUTINE-01**: Bot follows a loose daily schedule (morning, afternoon, evening behaviors)
- **OBJECT-01**: Bot interacts with furniture contextually (sits on chairs, stands near jukebox)

### Moderation

- **MOD-01**: Admin can configure bot personalities via config file
- **MOD-02**: Admin can spawn/despawn bots via API endpoint

## Out of Scope

| Feature | Reason |
|---------|--------|
| Combat / weapons / damage | Social sandbox, not a combat game |
| Playroom Kit migration | Keeping Socket.IO from base repo, no value in migration |
| Voice / audio chat | Massive complexity (TTS, audio streaming, lip sync), text-only |
| Cross-session memory | HIGH complexity, prove the core loop first |
| Player-customizable bot personalities | Hardcode personalities in system prompts, customization post-v1 |
| Multiple rooms | Single room for v1, room management adds scope |
| Mobile app | Web-only |
| Real-time vision (bot sees 3D render) | Bot perceives via structured data, not screenshots |
| Procedural world generation | Use pre-built rooms, bot behavior is the innovation |
| OAuth / social login | Not needed for bot world |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SETUP-01 | Phase 1 | Complete |
| SETUP-02 | Phase 2 | Complete |
| SETUP-03 | Phase 2 | Complete |
| CORE-01 | Phase 3 | Complete |
| CORE-02 | Phase 3 | Complete |
| CORE-03 | Phase 5 | Pending |
| CORE-04 | Phase 5 | Pending |
| CORE-05 | Phase 4 | Pending |
| CORE-06 | Phase 4 | Pending |
| CORE-07 | Phase 5 | Pending |
| CORE-08 | Phase 5 | Pending |
| CORE-09 | Phase 5 | Pending |
| ACT-01 | Phase 5 | Pending |
| ACT-02 | Phase 5 | Pending |
| ACT-03 | Phase 5 | Pending |
| ACT-04 | Phase 5 | Pending |
| ACT-05 | Phase 5 | Pending |
| CHAR-01 | Phase 7 | Pending |
| CHAR-02 | Phase 7 | Pending |
| CHAR-03 | Phase 7 | Pending |
| CHAR-04 | Phase 7 | Pending |
| UI-01 | Phase 6 | Pending |
| UI-02 | Phase 6 | Pending |
| INFRA-01 | Phase 2 | Complete |
| INFRA-02 | Phase 5 | Pending |
| INFRA-03 | Phase 8 | Pending |
| INFRA-04 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-01-31*
*Last updated: 2026-01-31 after roadmap creation*
