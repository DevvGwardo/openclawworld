# Architecture Patterns

**Domain:** 3D social sandbox with autonomous AI bot inhabitants
**Researched:** 2026-01-31

## System Overview

OpenClaw World is a five-component system where a React Three Fiber client renders a 3D room, a Node.js server owns game state over Socket.IO, headless bot clients impersonate players via Socket.IO, a Bot Bridge module runs the perception-decision-action loop per bot, and an OpenClaw Gateway provides LLM decisions via WebSocket.

```
┌──────────────────────────────────────────────────────────────────┐
│                        Railway Server                            │
│                                                                  │
│  ┌─────────────┐   Socket.IO   ┌──────────────────────────────┐ │
│  │  Game Server │◄────────────►│  Bot Bridge                   │ │
│  │  (Node.js)   │              │  ┌──────┐ ┌──────┐ ┌──────┐  │ │
│  │              │              │  │Bot 1 │ │Bot 2 │ │Bot N │  │ │
│  │  - state     │              │  │Agent │ │Agent │ │Agent │  │ │
│  │  - pathfind  │              │  └──┬───┘ └──┬───┘ └──┬───┘  │ │
│  │  - rooms     │              │     │        │        │       │ │
│  │  - chat      │              │     └────────┴────────┘       │ │
│  └──────┬───────┘              │            │                  │ │
│         │                      └────────────┼──────────────────┘ │
│         │                                   │ WebSocket           │
│         │                      ┌────────────▼──────────────────┐ │
│         │                      │  OpenClaw Gateway              │ │
│         │                      │  (ws://127.0.0.1:18789)       │ │
│         │                      │  - challenge auth              │ │
│         │                      │  - LLM routing                 │ │
│         │                      └────────────────────────────────┘ │
└─────────┼────────────────────────────────────────────────────────┘
          │ Socket.IO (public)
          │
    ┌─────▼─────────┐
    │  R3F Client    │
    │  (Browser)     │
    │  - 3D render   │
    │  - Jotai state │
    │  - UI overlay  │
    └────────────────┘
```

## Component Boundaries

### Component 1: Game Server (existing, modified)

**Source:** Forked from `wass08/r3f-sims-online-final/server/`
**Runtime:** Node.js process, entry point `index.js`
**Owns:** Authoritative game state -- player positions, room layout, chat, pathfinding grid

| Responsibility | Details |
|---------------|---------|
| Player registry | Track connected players (human + bot) by socket ID |
| Pathfinding | A* on grid with walkability checks (existing `pathfinding` library v0.4.18) |
| Room state | Items, grid, characters array, persisted to `rooms.json` |
| Event broadcast | Relay movements, chat, dance, emotes to all room members |
| Bot indifference | Server treats bot connections identically to human connections. No special bot logic here. |

**Socket.IO events (existing from base repo):**

| Direction | Event | Payload |
|-----------|-------|---------|
| S->C | `welcome` | Room list, shop items |
| S->C | `roomJoined` | Map data, characters, player ID |
| S->C | `characters` | Updated character list |
| S->C | `playerMove` | Character movement + path |
| S->C | `playerDance` | Dance animation trigger |
| S->C | `playerChatMessage` | Chat message + sender ID |
| S->C | `mapUpdate` | Room items after edit |
| C->S | `joinRoom` | Room ID, avatar URL |
| C->S | `leaveRoom` | -- |
| C->S | `move` | From/to grid coordinates |
| C->S | `dance` | -- |
| C->S | `chatMessage` | Message text |

**New events to add for bot support:**

| Direction | Event | Payload |
|-----------|-------|---------|
| C->S | `emote` | Emote name (new action type) |
| C->S | `interact` | Target object/player ID (new action type) |
| S->C | `playerEmote` | Emote broadcast |

**Modifications needed:**
- Add `isBot: boolean` flag to character data (for client-side visual distinction)
- Add emote/interact event handlers
- Expose health endpoint (`GET /health`)
- CORS config for production deploy

**What stays the same:** Pathfinding, room management, grid system, item placement, Socket.IO transport. The server must not have bot-specific game logic -- bots are just players.

### Component 2: R3F Client (existing, modified)

**Source:** Forked from `wass08/r3f-sims-online-final/client/`
**Runtime:** Browser, Vite dev server / static build
**Owns:** 3D rendering, local UI state, user input

| Responsibility | Details |
|---------------|---------|
| 3D scene | Room rendering, avatar models, furniture (existing R3F + Drei) |
| Player rendering | Render all characters including bots (existing) |
| Bot distinction | Visual indicator on bot avatars (badge, color, name tag) |
| Chat bubbles | Floating 3D text above avatars, auto-fade after N seconds (new) |
| Chat log panel | 2D overlay showing last 20 messages (new) |
| Jotai state | Client-side state atoms synced from Socket.IO events (existing) |

**Modifications needed:**
- Chat bubble component (3D Billboard using Drei `<Html>` or `<Text>`)
- Chat log panel (React 2D overlay)
- Bot visual distinction (check `isBot` flag on character data)
- Emote animations (if avatars support them)

**What stays the same:** Scene setup, camera, lighting, avatar loading (Ready Player Me), pathfinding visualization, room builder, shop.

### Component 3: Headless Bot Client

**Source:** New code, lives in `server/bot-client/` or `server/bots/`
**Runtime:** Node.js, same process as game server (colocated on Railway)
**Owns:** Socket.IO connection lifecycle per bot

This is a thin layer. Each bot is a `socket.io-client` instance connecting to the game server's Socket.IO endpoint. It connects as if it were a browser client but skips all rendering.

```
BotClient {
  socket: SocketIOClient       // socket.io-client connection
  id: string                   // assigned by server on connect
  roomId: string               // which room joined
  state: BotState              // current position, inventory, etc.

  connect()                    // io("http://localhost:PORT")
  joinRoom(roomId, avatarUrl)  // emit("joinRoom", ...)
  onWorldState(callback)       // listen for characters, playerMove, etc.
  move(from, to)               // emit("move", ...)
  say(message)                 // emit("chatMessage", ...)
  dance()                      // emit("dance")
  emote(name)                  // emit("emote", ...)
  disconnect()                 // graceful leave + disconnect
}
```

**Key design decision:** Connect via localhost Socket.IO, not internal function calls. This means the game server genuinely cannot tell bots from humans at the protocol level. Keeps the architecture honest and testable -- you can point a bot client at a remote server for testing.

**Confidence:** HIGH -- `socket.io-client` works in Node.js out of the box, this is a well-documented pattern.

### Component 4: Bot Bridge (core new code)

**Source:** New code, lives in `server/bot-bridge/`
**Runtime:** Node.js, same process, orchestrates all bot agents
**Owns:** The perception-decision-action loop, rate limiting, lifecycle management

This is the brain. For each bot, it runs a continuous loop:

```
┌──────────────────────────────────────────────────────┐
│                  Bot Bridge (per bot)                  │
│                                                       │
│  ┌─────────┐    ┌──────────┐    ┌─────────────────┐  │
│  │ Perceive │───►│ Decide   │───►│ Act             │  │
│  │          │    │          │    │                 │  │
│  │ Read     │    │ Serialize│    │ Validate (Zod)  │  │
│  │ world    │    │ + send   │    │ Rate limit      │  │
│  │ state    │    │ to LLM   │    │ Execute via     │  │
│  │ from     │    │ via      │    │ BotClient       │  │
│  │ Socket.IO│    │ Gateway  │    │                 │  │
│  └─────────┘    └──────────┘    └─────────────────┘  │
│       ▲                                    │          │
│       └────────────────────────────────────┘          │
│                   2-4 Hz loop                         │
└──────────────────────────────────────────────────────┘
```

#### 4a. Perception Module

Reads game state accumulated from Socket.IO events on the BotClient:

```typescript
interface Perception {
  self: {
    position: [number, number]
    id: string
    name: string
  }
  nearbyPlayers: Array<{
    id: string
    name: string
    position: [number, number]
    isBot: boolean
    distance: number
  }>
  recentChat: Array<{
    speaker: string
    message: string
    timestamp: number
  }>
  nearbyObjects: Array<{
    name: string
    position: [number, number]
    interactable: boolean
  }>
  availableActions: string[]  // what the bot CAN do right now
}
```

**Serialization strategy:** Convert to a concise natural language string for the LLM prompt. Keep token count low. Example:

```
You are Bot_Alice at position (3, 4).
Nearby: Human_Bob at (5, 4) [2 tiles away], Bot_Charlie at (1, 2) [3 tiles away].
Recent chat: Human_Bob said "hello everyone" (5s ago).
Objects: Couch at (6, 4), Table at (3, 6).
You can: move, say, emote, dance, interact, idle.
```

#### 4b. Decision Module (Gateway Integration)

Sends serialized perception to OpenClaw Gateway and receives an action decision.

**Gateway communication flow:**

```
Bot Bridge                        OpenClaw Gateway
    │                                    │
    │──── WS connect ──────────────────►│
    │◄─── connect.challenge {nonce} ────│
    │──── connect {role:operator,       │
    │      token, signed nonce} ───────►│
    │◄─── connect OK ──────────────────│
    │                                    │
    │  (per decision request)            │
    │──── req {method:"llm.decide",     │
    │      params:{perception}} ───────►│
    │◄─── res {ok:true,                 │
    │      payload:{action}} ──────────│
```

**Single persistent WebSocket connection** to Gateway, multiplexed for all bots. Each request gets a unique `id` for correlation. The Gateway handles LLM routing internally.

**Confidence:** MEDIUM -- The exact Gateway method names (`llm.decide`) are hypothetical. The Gateway protocol frames (req/res/event) are verified from official docs. The actual method to invoke LLM completion needs verification against OpenClaw docs.

#### 4c. Action Validation and Execution

LLM responses are validated with Zod before execution:

```typescript
const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), target: z.tuple([z.number(), z.number()]) }),
  z.object({ type: z.literal("say"), message: z.string().max(200) }),
  z.object({ type: z.literal("emote"), name: z.enum(["wave", "laugh", "think", "shrug"]) }),
  z.object({ type: z.literal("dance") }),
  z.object({ type: z.literal("interact"), targetId: z.string() }),
  z.object({ type: z.literal("idle") }),
])
```

**Rate limiting:** Token bucket per bot (3 actions/sec burst, 1/sec sustained refill). If over limit, action is dropped and bot idles.

**Execution:** Validated action is translated to BotClient method calls:
- `move` -> `botClient.move(currentPos, targetPos)`
- `say` -> `botClient.say(message)`
- `dance` -> `botClient.dance()`
- `idle` -> no-op, wait for next perception cycle

#### 4d. Lifecycle Manager

Manages bot spawning, health monitoring, and cleanup:

```
BotLifecycle {
  spawn(botConfig)     // create BotClient + BotAgent, connect, join room
  monitor(botId)       // check heartbeat, reconnect if dropped
  despawn(botId)       // graceful disconnect, cleanup state
  despawnAll()         // shutdown hook
}
```

States: `spawning -> active -> idle -> disconnecting -> disconnected`

### Component 5: OpenClaw Gateway (external, unmodified)

**Source:** OpenClaw project, deployed as a process on Railway
**Runtime:** Separate Node.js process, port 18789
**Owns:** LLM routing, authentication, channel management

| Responsibility | Details |
|---------------|---------|
| WebSocket server | Listens on `ws://127.0.0.1:18789` |
| Challenge auth | Nonce-based handshake, operator role |
| LLM routing | Routes decision requests to configured LLM provider |
| Protocol | `{type:"req", id, method, params}` / `{type:"res", id, ok, payload}` / `{type:"event", event, payload}` |

**Bot Bridge connects as an operator** with appropriate scopes. Single connection, multiplexed requests with unique IDs.

**No modifications needed.** Gateway is treated as a black box.

## Data Flow

### Flow 1: Human joins and moves

```
Browser ──emit("joinRoom")──► Game Server
Browser ◄──"roomJoined"────── Game Server
Browser ──emit("move")──────► Game Server (runs A* pathfinding)
Browser ◄──"playerMove"────── Game Server (broadcasts to all including bots)
Bot Client ◄──"playerMove"── Game Server (bot's perception state updates)
```

### Flow 2: Bot perception-decision-action cycle

```
1. Bot Client receives Socket.IO events (playerMove, chatMessage, characters)
2. Bot Bridge Perception module reads accumulated state from Bot Client
3. Perception serialized to natural language string
4. Bot Bridge sends req{method, params:{prompt}} to Gateway via WebSocket
5. Gateway routes to LLM, returns res{payload:{action}}
6. Bot Bridge validates action with Zod schema
7. If valid + within rate limit: Bot Client emits Socket.IO event (move/chatMessage/etc)
8. Game Server processes normally, broadcasts to all clients
9. Browser renders bot's action (movement, chat bubble, etc.)
```

### Flow 3: Bot says something, human sees chat bubble

```
Bot Bridge ──decides "say"──► Bot Client ──emit("chatMessage", "Hello!")──► Game Server
Game Server ──"playerChatMessage"──► All clients (browsers + other bot clients)
Browser receives message ──► renders chat bubble above bot avatar + adds to chat log
Other Bot Client receives ──► updates perception state (may respond next cycle)
```

### Flow 4: Gateway connection lifecycle

```
Server starts ──► spawn Gateway process (port 18789)
Bot Bridge ──► WS connect to ws://127.0.0.1:18789
Gateway ──► sends connect.challenge {nonce, ts}
Bot Bridge ──► sends connect {role:"operator", token, signedNonce, scopes}
Gateway ──► sends connect OK {protocolVersion, deviceToken}
Bot Bridge ──► ready to send LLM requests
```

## Build Order (dependency-driven)

The build order is dictated by what each component needs to be testable.

### Phase 1: Base Setup (no new code needed to test)

**Goal:** Get the existing base repo running.

1. Clone `wass08/r3f-sims-online-final`
2. Install dependencies, run client + server
3. Verify multiplayer works (two browser tabs)
4. Understand the codebase structure and Socket.IO events

**Depends on:** Nothing
**Unlocks:** Everything else

### Phase 2: Game Server Modifications

**Goal:** Server supports bot-related features.

1. Add `isBot` flag to character data
2. Add emote/interact event handlers
3. Add health endpoint
4. CORS and deployment config

**Depends on:** Phase 1 (understanding existing server code)
**Unlocks:** Headless bot client can connect and be distinguished

### Phase 3: Headless Bot Client

**Goal:** A Node.js script connects to the game server as a player.

1. Create `BotClient` class using `socket.io-client`
2. Connect to game server, join room
3. Verify bot appears in browser as a character
4. Implement all action methods (move, say, dance, emote)

**Depends on:** Phase 2 (server accepts bot connections with isBot flag)
**Unlocks:** Bot Bridge can drive bots through BotClient API
**Test:** Run bot client script, see character appear in browser and move when you call `botClient.move()` manually.

### Phase 4: OpenClaw Gateway Integration

**Goal:** Bot Bridge can send prompts and receive LLM decisions.

1. Set up Gateway process (install OpenClaw, configure)
2. Implement Gateway WebSocket client with challenge auth
3. Implement request/response correlation (id-based multiplexing)
4. Test: send a prompt, get a response

**Depends on:** Nothing from Phases 2-3 (can develop in parallel)
**Unlocks:** Decision module has an LLM backend
**Test:** Send a hardcoded perception string, get back a valid action JSON.

### Phase 5: Bot Bridge (core loop)

**Goal:** Full perception-decision-action loop running.

1. Implement Perception module (read BotClient state, serialize)
2. Implement Decision module (send to Gateway, parse response)
3. Implement Action validation (Zod schemas)
4. Implement rate limiter (token bucket)
5. Wire up the loop: perceive -> decide -> validate -> act -> repeat at 2-4 Hz
6. Implement BotLifecycle manager

**Depends on:** Phase 3 (BotClient) + Phase 4 (Gateway integration)
**Unlocks:** Autonomous bot behavior
**Test:** One bot joins, sees a human, walks over and says hello.

### Phase 6: Client UI Enhancements

**Goal:** Browser shows bot activity clearly.

1. Chat bubbles (3D floating text)
2. Chat log panel (2D overlay)
3. Bot visual distinction (badge/color on bot avatars)

**Depends on:** Phase 2 (isBot flag) + Phase 5 (bots are talking/moving)
**Unlocks:** Full user experience
**Test:** Human joins room, sees bot with distinct appearance, sees chat bubbles when bot speaks.

### Phase 7: Deploy

**Goal:** Running on Railway.

1. Dockerfile or Railway config for single server
2. Game server + Gateway + Bot Bridge colocated
3. Client built and served as static files or separate deploy
4. Health endpoint for Railway health checks
5. Environment variables for Gateway token, LLM config

**Depends on:** All previous phases
**Test:** Visit public URL, see bots in the room.

### Build Order Diagram

```
Phase 1 (Base Setup)
    │
    ├──► Phase 2 (Server Mods) ──► Phase 3 (Bot Client) ──┐
    │                                                       │
    └──► Phase 4 (Gateway Integration) ────────────────────┤
                                                            │
                                                            ▼
                                                   Phase 5 (Bot Bridge)
                                                            │
                                              ┌─────────────┤
                                              ▼             ▼
                                     Phase 6 (Client UI)  Phase 7 (Deploy)
```

**Key insight:** Phases 2-3 and Phase 4 can be built in parallel. Phase 4 (Gateway integration) has no dependency on the game server modifications. This is the critical parallelism opportunity.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Server-side bot logic

**What:** Putting bot decision logic inside the game server process, calling LLM directly from game server code.
**Why bad:** Couples bot AI to game server, makes server harder to reason about, bots get special treatment vs humans.
**Instead:** Bots connect via Socket.IO like any other player. Bot Bridge is a separate logical module.

### Anti-Pattern 2: Synchronous LLM calls in the game loop

**What:** Blocking the perception loop while waiting for LLM response.
**Why bad:** LLM calls take 500ms-3s. A synchronous call would freeze the bot for that duration, missing state updates.
**Instead:** Async loop. Fire perception request, continue accumulating state updates, apply action when response arrives. If state changed significantly, discard stale action and re-perceive.

### Anti-Pattern 3: Sending full world state every tick

**What:** Serializing the entire room state (all objects, all players, full chat history) on every perception cycle.
**Why bad:** Wastes tokens, increases LLM latency, most of the state hasn't changed.
**Instead:** Send delta-aware perception. Include only nearby entities (within N tiles), recent chat (last 5 messages), and things that changed since last decision.

### Anti-Pattern 4: No action validation

**What:** Trusting LLM output directly and executing it.
**Why bad:** LLMs hallucinate invalid coordinates, invent actions that don't exist, produce malformed JSON.
**Instead:** Zod validation on every LLM response. Invalid actions fall back to `idle`. Log failures for prompt tuning.

### Anti-Pattern 5: One Gateway connection per bot

**What:** Each bot opens its own WebSocket to the Gateway.
**Why bad:** Unnecessary connection overhead. Gateway connection management complexity.
**Instead:** Single persistent Gateway connection, multiplexed with request IDs. All bots share one connection.

## Scalability Considerations

| Concern | v1 (1-3 bots) | v2 (10 bots) | Future (50+ bots) |
|---------|----------------|---------------|---------------------|
| Socket.IO connections | Trivial | Fine, single server handles hundreds | May need connection pooling |
| LLM calls | Sequential OK | Need request queuing | Need batching or multiple Gateway connections |
| Perception serialization | Full state OK | Limit to nearby entities | Spatial indexing, LOD-style perception |
| Token usage | ~200 tokens/perception | Budget awareness needed | Token budgets per bot, prompt compression |
| Server memory | Negligible | Monitor with 10 bot clients | May need to separate bot processes |
| Tick rate | 2-4 Hz fine | 1-2 Hz may be needed | Adaptive tick rate based on load |

## Directory Structure (recommended)

```
openclawworld/
├── client/                    # Forked from base repo
│   ├── src/
│   │   ├── components/        # Existing R3F components
│   │   │   ├── ChatBubble.jsx     # NEW: 3D floating chat
│   │   │   ├── ChatLog.jsx        # NEW: 2D overlay panel
│   │   │   └── BotIndicator.jsx   # NEW: visual bot badge
│   │   ├── hooks/             # Existing hooks
│   │   ├── assets/            # Existing assets
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
│
├── server/                    # Forked from base repo
│   ├── index.js               # MODIFIED: add isBot, emote, health endpoint
│   ├── default.json           # Existing room config
│   ├── package.json           # MODIFIED: add new dependencies
│   │
│   ├── bot-client/            # NEW: headless Socket.IO bot
│   │   ├── BotClient.js       # Socket.IO client wrapper
│   │   └── index.js           # exports
│   │
│   ├── bot-bridge/            # NEW: perception-decision-action orchestrator
│   │   ├── BotBridge.js       # Main orchestrator, manages all bot agents
│   │   ├── BotAgent.js        # Per-bot loop (perceive/decide/act)
│   │   ├── perception.js      # World state -> serialized text
│   │   ├── decision.js        # Gateway client, send/receive LLM decisions
│   │   ├── action.js          # Zod schemas, validation, execution
│   │   ├── rate-limiter.js    # Token bucket implementation
│   │   ├── lifecycle.js       # Spawn/monitor/despawn
│   │   └── index.js           # exports
│   │
│   └── gateway/               # NEW: OpenClaw Gateway integration
│       ├── GatewayClient.js   # WebSocket client with challenge auth
│       ├── protocol.js        # Frame builders, ID correlation
│       └── index.js           # exports
│
├── .planning/                 # Project planning (this research)
└── README.md
```

## Sources

- [wass08/r3f-sims-online-final](https://github.com/wass08/r3f-sims-online-final) -- base repo structure and Socket.IO events (HIGH confidence)
- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol) -- WebSocket frame format, challenge auth, roles (HIGH confidence)
- [Wawa Sensei tutorial series](https://wawasensei.dev/tuto/build-a-multiplayer-game-with-react-three-fiber-and-socket-io) -- R3F + Socket.IO architecture patterns (HIGH confidence)
- [DEV Community: Multiplayer Game Server with Socket.IO](https://dev.to/dowerdev/building-a-real-time-multiplayer-game-server-with-socketio-and-redis-architecture-and-583m) -- server-authoritative patterns (MEDIUM confidence)
- [arXiv: Survey on LLM-Based Game Agents](https://arxiv.org/abs/2404.02039) -- perception-decision-action loop patterns (MEDIUM confidence)
- [DEV Community: LLM BattleTech Bot](https://dev.to/antonmakarevich/how-i-teach-llms-to-play-battletech-part-1-architecture-agents-and-tools-18om) -- headless bot client as standalone app pattern (MEDIUM confidence)
- [Socket.IO Client Installation](https://socket.io/docs/v4/client-installation/) -- Node.js headless client usage (HIGH confidence)
- Gateway method names (`llm.decide`, exact request params) -- hypothetical, needs verification against actual OpenClaw API (LOW confidence)
