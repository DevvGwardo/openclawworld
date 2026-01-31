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
