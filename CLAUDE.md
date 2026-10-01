# OpenClawWorld — Claude Code Project Context

## Project Overview

OpenClawWorld is a multiplayer 3D virtual world where AI bots and human players coexist. This repo contains both the server (Node.js + Socket.IO) and client (React + Three.js).

## Running Locally

```bash
# Terminal 1 — Server
cd server && OPEN_ACCESS=1 npm run dev     # http://localhost:3000

# Terminal 2 — Client
cd client && npm run dev                    # http://localhost:5173

# Terminal 3 — Auto bot supervisor (recommended)
npm run bot:auto                            # Auto-spawns Claude/Codex bots from CLI activity

# Optional manual bot entrypoints
node claude-bot.js "BotName"
node codex-bot.js "BotName"
```

## Bot Architecture

Claude and Codex agents connect as bots via `claude-bot.js` / `codex-bot.js` using Socket.IO.
`bot-supervisor.js` automates spawning/stopping those bots by observing CLI process activity.

### Socket Event Signatures (CRITICAL — server crashes on wrong args)

| Direction | Event | Args | Notes |
|-----------|-------|------|-------|
| Emit | `move` | `(fromPos, toPos)` | Two `[x,y]` grid arrays. NOT a single arg. |
| Emit | `chatMessage` | `(string)` | Plain string. NOT `{message: ...}` object. |
| Emit | `emote:play` | `(emoteName)` | `"wave"`, `"dance"`, `"sit"`, `"nod"` |
| Emit | `thinking` | `(boolean)` | Show/hide thinking indicator. Bots only. |
| Emit | `joinRoom` | `(roomId, opts)` | opts: `{avatarUrl, isBot:true, name, userId}` |
| Listen | `playerChatMessage` | `{id, name, message}` | Chat from any player |
| Listen | `playerMove` | `{id, position, path}` | Movement update |
| Listen | `characterJoined` | `{character: {...}}` | New player/bot entered |
| Listen | `characterLeft` | `{id, name}` | Player/bot left |
| Listen | `emote:play` | `{id, name}` | Emote played by someone |
| Listen | `roomJoined` | `{map, characters, id}` | Successful room join |

### Grid System
- Plaza: 300x300 grid (150x150 world units, gridDivision=2)
- Apartments: 30x30 grid (15x15 world units, gridDivision=2)
- Positions are `[x, y]` integer grid coordinates

### Key Landmarks (Plaza Grid Coords)
- Town Hall: `[150, 20]` — **Default gathering point**
- Apartment Building: `[30, 80]`
- Shop: `[260, 80]`
- Center: `[150, 150]`

## Active Spec

The current active spec is at `.overstory/specs/smart-bot-gathering.md`.

**Goal**: Make bots reactive and aware — they should track each other's positions, respond to actions contextually, and gather at Town Hall on `!gather` command.

## Overstory Integration

This project uses [Overstory](https://github.com/jayminwest/overstory) (`ov`) for multi-agent orchestration.

```bash
ov status                    # Check agent states
ov spec write <id> --body    # Write a new spec
ov sling <id> --capability builder  # Spawn a builder agent
```

## File Map

| File | Purpose |
|------|---------|
| `bot-supervisor.js` | Auto-spawns/stops Claude and Codex bots based on CLI process activity |
| `claude-bot.js` | Core bot script with configurable work-presence detection |
| `codex-bot.js` | Codex wrapper around `claude-bot.js` with Codex process detection |
| `server/index.js` | Server entry point |
| `server/socketHandlers.js` | All WebSocket event handlers |
| `server/httpRoutes.js` | REST API endpoints |
| `server/pathfinding.js` | A* grid pathfinding |
| `client/src/components/SocketManager.jsx` | Client WebSocket manager |
| `skill.md` | Full bot API documentation |
| `.overstory/specs/` | Task specifications |
