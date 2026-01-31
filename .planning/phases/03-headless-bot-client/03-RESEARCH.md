# Phase 3: Headless Bot Client - Research

**Researched:** 2026-01-31
**Domain:** Node.js headless Socket.IO client — connecting to a game server as a visible player without a browser
**Confidence:** HIGH

## Summary

Phase 3 creates a `BotClient` class that uses `socket.io-client` from a Node.js process to connect to the game server, join a room, and appear as a fully functional player alongside browser-connected humans. The bot must replicate the exact same Socket.IO event sequence that the browser client performs: connect, receive `welcome`, emit `joinRoom` with options (including `isBot: true`), receive `roomJoined`, then emit actions (`move`, `chatMessage`, `emote:play`).

The server (`server/index.js`) already supports everything needed from Phase 2: the `isBot` flag in join options, the `emote:play` handler, and the health endpoint. No server changes are required. The bot is purely a client-side addition — a new Node.js module in the `bot/` directory that depends only on `socket.io-client`.

The key technical challenge is correctly tracking position state. The `move` event requires both `from` (current grid position) and `to` (target grid position) as arguments. The server computes the A* path and broadcasts it. The bot must track its own position locally by updating it when the server confirms the path (via `playerMove` events), since the server's `findPath` uses the `from` parameter the client sends.

**Primary recommendation:** Create a `BotClient` class in `bot/BotClient.js` using `socket.io-client` ^4.7.2. Keep the class focused on connection lifecycle and action methods. The bot process will be a separate entry point (`bot/index.js`) that imports and uses `BotClient`. No new dependencies beyond `socket.io-client`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| socket.io-client | ^4.7.2 | Socket.IO client for Node.js | Same version the browser client uses; official client library for socket.io server ^4.7.2 |
| Node.js EventEmitter | built-in | Event-based API for BotClient consumers | Standard Node.js pattern for exposing internal events to callers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | - | Phase 3 requires only socket.io-client as an external dependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| socket.io-client | Raw WebSocket (ws) | Would need to implement Socket.IO's protocol (packet framing, engine.io handshake, polling upgrade). Not worth it. |
| EventEmitter for BotClient API | Callback-based API | EventEmitter is more idiomatic for Node.js and allows multiple listeners; callbacks are simpler but less flexible |
| Separate bot/ package.json | Install in server/ | Bot is a separate process with different concerns; own package.json keeps deps clean |

**Installation:**
```bash
mkdir -p bot
cd bot
npm init -y --scope=openclawworld
npm install socket.io-client@^4.7.2
```

## Architecture Patterns

### Recommended Project Structure
```
bot/
├── package.json          # type: "module", socket.io-client dependency
├── BotClient.js          # Core class: connection, state tracking, action methods
├── index.js              # Entry point: creates BotClient, demonstrates usage
└── README.md             # (optional) usage notes
```

The `bot/` directory is a sibling to `server/` and `client/`, establishing the project's three-process architecture:
```
openclawworld/
├── client/               # React/R3F browser app (Vite)
├── server/               # Socket.IO game server (Node.js)
└── bot/                  # Headless bot client (Node.js)
```

### Pattern 1: Socket.IO Connection Lifecycle
**What:** The exact sequence of events between client connection and being a visible player in a room.
**When to use:** Implementing the BotClient connect/join flow.
**Protocol sequence (derived from codebase inspection):**

```
1. Client connects to server
   → Server emits "welcome" with { rooms: [{id, name, nbCharacters}], items: {...} }

2. Client emits "joinRoom" (roomId, { avatarUrl, isBot: true, name: "BotName" })
   → Server creates character object with random position
   → Server emits "roomJoined" to client with { map: {gridDivision, size, items}, characters: [...], id: socketId }
   → Server broadcasts "characters" to all clients in room

3. Client is now in the room and can:
   - Emit "move" (fromGridPos, toGridPos) → Server broadcasts "playerMove" with path
   - Emit "chatMessage" (string) → Server broadcasts "playerChatMessage" with {id, message}
   - Emit "emote:play" (emoteName) → Server broadcasts "emote:play" with {id, emote}
   - Emit "dance" () → Server broadcasts "playerDance" with {id}
   - Emit "leaveRoom" () → Server removes character, broadcasts update

4. On disconnect:
   → Server removes character from room
   → Server broadcasts updated "characters" to remaining clients
```

**Source:** Direct inspection of `server/index.js` lines 136-289 and `client/src/components/SocketManager.jsx`.

### Pattern 2: BotClient Class Structure
**What:** An EventEmitter-based class that wraps socket.io-client and provides a clean API.
**When to use:** This is the core deliverable of Phase 3.
**Example:**

```javascript
// bot/BotClient.js
import { io } from "socket.io-client";
import { EventEmitter } from "node:events";

export class BotClient extends EventEmitter {
  constructor({ serverUrl, avatarUrl, name }) {
    super();
    this.serverUrl = serverUrl;
    this.avatarUrl = avatarUrl;
    this.name = name;
    this.socket = null;
    this.id = null;           // socket.id assigned by server
    this.room = null;         // current room data (map, characters)
    this.position = null;     // current grid position [x, y]
    this.rooms = [];          // available rooms from welcome
  }

  connect() { /* create socket, attach listeners, return promise */ }
  join(roomId) { /* emit joinRoom, return promise resolving on roomJoined */ }
  move(toGridPos) { /* emit move from current position to target */ }
  say(message) { /* emit chatMessage */ }
  emote(emoteName) { /* emit emote:play */ }
  dance() { /* emit dance (legacy) */ }
  leave() { /* emit leaveRoom */ }
  disconnect() { /* socket.disconnect() */ }
}
```

### Pattern 3: Position Tracking
**What:** The bot must track its own grid position to correctly emit `move` events.
**When to use:** Every time the bot needs to move.
**Critical detail from server code:**

```javascript
// server/index.js line 208-215
socket.on("move", (from, to) => {
  const path = findPath(room, from, to);
  if (!path) return;          // invalid path = silently ignored
  character.position = from;  // server sets position to FROM, not TO
  character.path = path;      // path includes intermediate grid cells
  io.to(room.id).emit("playerMove", character);
});
```

**Important observations:**
1. The server sets `character.position = from` (the START position), not the end position
2. The server stores the full `path` array on the character object
3. The client (Avatar.jsx) animates walking along the path and implicitly arrives at the final position
4. For the bot, `position` should be updated to the LAST element of the path after emitting move, since that is where the avatar will end up visually
5. If `findPath` returns an empty array (unreachable), the move is silently dropped

**Position tracking strategy:**
```javascript
// After joining, position comes from roomJoined data
this.position = roomJoinedData.characters.find(c => c.id === this.id).position;

// After moving, update position to path destination
move(toGridPos) {
  if (!this.position) throw new Error("Not in a room");
  this.socket.emit("move", this.position, toGridPos);
  // Optimistically update to destination (server will broadcast the path)
  this.position = toGridPos;
}
```

### Pattern 4: Promise-based Connection and Join
**What:** Wrapping Socket.IO events in promises for cleaner async/await usage.
**When to use:** For the `connect()` and `join()` methods.
**Example:**

```javascript
connect() {
  return new Promise((resolve, reject) => {
    this.socket = io(this.serverUrl, {
      autoConnect: true,
      reconnection: true,
    });

    this.socket.on("welcome", (data) => {
      this.rooms = data.rooms;
      this.emit("welcome", data);
      resolve(data);
    });

    this.socket.on("connect_error", (err) => {
      reject(err);
    });

    // Forward relevant events
    this.socket.on("characters", (chars) => this.emit("characters", chars));
    this.socket.on("playerMove", (char) => this.emit("playerMove", char));
    this.socket.on("playerChatMessage", (msg) => this.emit("chatMessage", msg));
    this.socket.on("emote:play", (data) => this.emit("emote", data));
    this.socket.on("disconnect", () => this.emit("disconnected"));
  });
}

join(roomId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Join timeout")), 5000);

    this.socket.once("roomJoined", (data) => {
      clearTimeout(timeout);
      this.id = data.id;
      this.room = data.map;
      const me = data.characters.find(c => c.id === this.id);
      this.position = me.position;
      this.emit("joined", data);
      resolve(data);
    });

    this.socket.emit("joinRoom", roomId, {
      avatarUrl: this.avatarUrl,
      isBot: true,
      name: this.name,
    });
  });
}
```

### Anti-Patterns to Avoid
- **Using the browser client's source directly:** The client code (SocketManager.jsx) is tightly coupled to React/Jotai. Do not try to extract it. Reimplement the socket protocol in a clean Node.js class.
- **Sending move events without tracking position:** The server requires both `from` and `to`. If `from` does not match the bot's actual grid position, pathfinding may fail or produce weird paths.
- **Polling for state instead of listening to events:** Socket.IO is event-driven. Listen for `characters`, `playerMove`, `playerChatMessage` events rather than periodically querying.
- **Connecting multiple bots on a single socket:** Each bot needs its own socket connection. Socket.IO assigns a unique `socket.id` per connection, and the server creates one character per connection.
- **Hard-coding room ID:** Use the `welcome` event to discover available rooms dynamically.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Socket.IO protocol | Raw WebSocket + packet parser | socket.io-client | Engine.IO handshake, protocol framing, auto-reconnect are complex |
| Connection state machine | Custom state tracking | socket.io-client built-in states + reconnection | The library handles connect/disconnect/reconnect cycles |
| Pathfinding on the bot side | A* implementation | Server-side pathfinding (already implemented) | The server computes paths; the bot just sends from/to and the server does the rest |

**Key insight:** The bot does NOT need pathfinding logic. The server already runs A* pathfinding when it receives a `move` event. The bot simply says "I'm at [x1,y1], I want to go to [x2,y2]" and the server computes the path and broadcasts it. The bot only needs to track its current position.

## Common Pitfalls

### Pitfall 1: Stale Position After Move
**What goes wrong:** Bot sends `move(from, to)` but does not update its local position. Next move sends old `from`, server computes path from wrong location.
**Why it happens:** The server sets `character.position = from` on each move (not the destination). The path array contains intermediate steps. The actual final position is `path[path.length - 1]`.
**How to avoid:** After emitting a move, update `this.position` to `toGridPos` (the destination). This works because the server's pathfinding will find a path from `from` to `to`, and the last element of the path is always `to` (if reachable).
**Warning signs:** Bot appears to teleport or move backwards.

### Pitfall 2: Moving Before roomJoined Resolves
**What goes wrong:** Calling `move()` before the `roomJoined` event fires means `this.position` is null and `this.id` is unknown.
**Why it happens:** Socket events are asynchronous. `joinRoom` is emitted, but `roomJoined` arrives later.
**How to avoid:** Make `join()` return a promise that resolves on `roomJoined`. Only allow actions after the promise resolves.
**Warning signs:** `Cannot read property '0' of null` when accessing position coordinates.

### Pitfall 3: CORS Rejection from Node.js Client
**What goes wrong:** socket.io-client in Node.js gets rejected by the server's CORS policy.
**Why it happens:** The server sets `cors: { origin: "http://localhost:5173" }` which only allows the Vite dev server.
**How to avoid:** socket.io-client in Node.js does NOT send an `Origin` header by default (it is not a browser). Socket.IO's CORS handling only applies to HTTP requests with an `Origin` header. Node.js clients using WebSocket transport bypass CORS entirely. If using long-polling transport first (default), the HTTP requests may be affected. Two options: (a) rely on WebSocket-only transport (`transports: ["websocket"]`) to bypass CORS, or (b) update the server CORS to also allow the bot's origin. Option (a) is simpler and recommended.
**Warning signs:** Connection fails with CORS error in server logs.

### Pitfall 4: Bot Not Appearing in Browser Client
**What goes wrong:** Bot connects and joins room but no avatar appears in the browser's 3D scene.
**Why it happens:** Multiple possible causes: (a) `avatarUrl` is missing or invalid — the client's `useGLTF` fails to load the model silently; (b) bot joined a different room than the browser client; (c) CORS prevented the connection entirely.
**How to avoid:** Use a known-valid Ready Player Me avatar URL (the default one from the codebase: `https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb`). Join the same room the browser is in. Check the server's `/health` endpoint to verify the bot is counted.
**Warning signs:** Health endpoint shows 0 bots, or browser's character list does not include the bot's socket.id.

### Pitfall 5: Multiple Position Updates from Other Players' Moves
**What goes wrong:** The bot listens for `playerMove` events to track movement but processes OTHER players' moves as its own, corrupting its position.
**Why it happens:** `playerMove` is broadcast to everyone in the room, including moves from all players.
**How to avoid:** Filter `playerMove` events by `character.id === this.id` to only process the bot's own move confirmations.
**Warning signs:** Bot's position jumps to random locations matching other players' movements.

### Pitfall 6: Grid Coordinate System Misunderstanding
**What goes wrong:** Bot sends move coordinates that are out of bounds or reference wrong locations.
**Why it happens:** Room size is `[7, 7]` with `gridDivision: 2`, creating a grid of `14 x 14` cells (indices 0-13). Confusing room-space coordinates with grid coordinates.
**How to avoid:** All positions in Socket.IO events are grid coordinates (integers in range `[0, 13]` for the default 7x7 room with gridDivision 2). The bot should always work in grid coordinates. The 3D position conversion is only needed on the client (browser) side.
**Warning signs:** Moves silently fail (server's `findPath` returns empty path for out-of-bounds coordinates).

## Code Examples

### Complete BotClient Usage (Entry Point)
```javascript
// bot/index.js
import { BotClient } from "./BotClient.js";

const bot = new BotClient({
  serverUrl: "http://localhost:3000",
  avatarUrl: "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
  name: "ClawBot",
});

// Connect and join
const welcomeData = await bot.connect();
console.log("Available rooms:", welcomeData.rooms);

const roomData = await bot.join(welcomeData.rooms[0].id);
console.log("Joined room. Position:", bot.position);

// Listen for chat from other players
bot.on("chatMessage", (msg) => {
  console.log(`[Chat] ${msg.id}: ${msg.message}`);
});

// Perform actions
await bot.say("Hello everyone!");

// Move to grid position [5, 5]
bot.move([5, 5]);

// Emote after a delay
setTimeout(() => bot.emote("wave"), 2000);

// Disconnect after 10 seconds
setTimeout(() => {
  bot.disconnect();
  console.log("Bot disconnected");
}, 10000);
```

### Socket.IO Client Connection Options for Node.js
```javascript
// Source: socket.io-client documentation
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  transports: ["websocket"],    // Skip long-polling, go straight to WebSocket
  autoConnect: true,             // Connect immediately
  reconnection: true,            // Auto-reconnect on disconnect
  reconnectionAttempts: 5,       // Retry 5 times
  reconnectionDelay: 1000,       // Wait 1 second between retries
});
```

### Move Event with Position Tracking
```javascript
// Source: derived from server/index.js move handler (line 208-215)
move(toGridPos) {
  if (!this.position) {
    throw new Error("Cannot move: not in a room (position unknown)");
  }
  if (!Array.isArray(toGridPos) || toGridPos.length !== 2) {
    throw new Error("Invalid target position: must be [x, y] array");
  }
  this.socket.emit("move", this.position, toGridPos);
  this.position = toGridPos; // Optimistic update
}
```

### Chat Message Emission
```javascript
// Source: server/index.js line 234-239
say(message) {
  if (!this.socket || !this.id) {
    throw new Error("Cannot say: not connected or not in a room");
  }
  this.socket.emit("chatMessage", message);
}
```

### Verification via Health Endpoint
```javascript
// Quick check that the bot appeared in the server's state
const res = await fetch("http://localhost:3000/health");
const health = await res.json();
console.log("Total players:", health.totalPlayers);
console.log("Total bots:", health.totalBots);
// health.rooms[0].bots should be 1 after bot joins
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| socket.io-client 2.x with `io.connect()` | socket.io-client 4.x with `io()` | Socket.IO 3.0 (2020) | `io()` replaces `io.connect()`, breaking change in import |
| Callback-based connection | Promise-wrappable events | Socket.IO 4.x | Events can be wrapped in promises for async/await |
| Default transport: polling → upgrade | Can specify `transports: ["websocket"]` | Socket.IO 3.x+ | Skipping polling avoids CORS issues in Node.js clients |

**Deprecated/outdated:**
- `socket.io-client` 2.x `io.connect()` — replaced by `io()` in v3+
- `socket.binary(false)` — removed in v3, binary data handled automatically
- `socket.compress()` — still available but rarely needed for small game events

## Open Questions

1. **Should the bot track the full path array or just the destination?**
   - What we know: The server broadcasts `playerMove` with the full `character` object including `path` (array of grid cells). The browser client animates along this path.
   - What's unclear: Whether the bot needs to simulate walking (updating position cell-by-cell over time) for accurate collision detection, or if jumping to the destination is sufficient.
   - Recommendation: For Phase 3, track only the destination (last cell of path). The bot is a headless client; visual animation is irrelevant. Collision awareness comes in Phase 5 (perception module).

2. **Should the BotClient support multiple rooms (leave and rejoin)?**
   - What we know: The server supports `leaveRoom` and subsequent `joinRoom`. Phase 5 may need room-switching.
   - Recommendation: Implement `leave()` method that emits `leaveRoom` and resets internal state. Full support is cheap to add and useful for testing.

3. **What avatar URL should bots use?**
   - What we know: The codebase uses Ready Player Me URLs. The default URL `https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb` works and is preloaded by the client.
   - Recommendation: Use the default avatar URL for Phase 3. Phase 7 (Bot Character) can introduce unique avatars per bot personality.

4. **Should the bot directory have its own package.json or share the server's?**
   - What we know: The bot is a separate process with a single dependency (socket.io-client). The server's package.json has socket.io (server-side). These are distinct packages.
   - Recommendation: Own `package.json` in `bot/`. Keeps the dependency tree clean and makes it clear the bot is an independent process.

## Sources

### Primary (HIGH confidence)
- **Direct codebase inspection** — `server/index.js` (289 lines): full Socket.IO event protocol, `move` handler with `from`/`to` parameters, `joinRoom` with `isBot` support, pathfinding grid system
- **Direct codebase inspection** — `client/src/components/SocketManager.jsx`: client-side event listeners confirming the protocol (`welcome`, `roomJoined`, `characters`, `playerMove`, `playerChatMessage`)
- **Direct codebase inspection** — `client/src/components/Avatar.jsx`: movement animation logic showing how `playerMove` paths are consumed
- **Direct codebase inspection** — `client/src/components/Lobby.jsx`: room join flow (`socket.emit("joinRoom", roomId, { avatarUrl })`)
- **Direct codebase inspection** — `client/src/hooks/useGrid.jsx`: grid-to-vector conversion formula (confirms grid coordinates are integers, gridDivision=2)
- **Direct codebase inspection** — `server/default.json`: room data structure (4 rooms, IDs 1-4, all 7x7)
- **socket.io-client ^4.7.2** — Already a dependency in `client/package.json`, confirming version compatibility with server's `socket.io` ^4.7.2

### Secondary (MEDIUM confidence)
- Socket.IO 4.x documentation on Node.js client usage and transport options — well-established patterns for server-to-server and headless client connections

### Tertiary (LOW confidence)
- None — all findings based on direct code inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — socket.io-client is the only dependency; same version already in use by browser client
- Architecture: HIGH — Protocol fully mapped from inspecting both server and client code; every event, payload shape, and sequence documented
- Pitfalls: HIGH — All pitfalls derived from analyzing specific code patterns in server/index.js (move handler, position tracking, CORS config)

**Research date:** 2026-01-31
**Valid until:** 2026-03-02 (stable — pinned dependencies, no moving targets)
