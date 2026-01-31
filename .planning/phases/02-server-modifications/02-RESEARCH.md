# Phase 2: Server Modifications - Research

**Researched:** 2026-01-31
**Domain:** Node.js Socket.IO game server — bot-awareness, emote events, HTTP health endpoint
**Confidence:** HIGH

## Summary

Phase 2 modifies the existing game server (`server/index.js`) to support three new capabilities: an `isBot` flag on character data, expanded emote events beyond the existing `dance`, and an HTTP health endpoint. The server is a single-file Node.js application using Socket.IO 4.7 with no HTTP framework — it relies on `io.listen(3000)` which creates an internal `http.Server` under the hood.

The modifications are straightforward because: (a) the character object is already a plain JS object extended at join time, so adding `isBot` is a one-line addition; (b) the existing `dance` event handler is a clean pattern to replicate for other emotes; (c) Socket.IO's underlying HTTP server can be accessed to attach a health route without adding Express or any framework.

**Primary recommendation:** Extend the existing patterns in `server/index.js` directly. No new dependencies needed. Use the same `joinRoom` event with `isBot` in the options payload. Use a single `emote:play` event with an emote name string validated against an allowlist. Attach a health route handler to Socket.IO's internal HTTP server.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| socket.io | ^4.7.2 | Real-time bidirectional communication | Already in project, handles all game events |
| Node.js http module | built-in | HTTP server for health endpoint | Socket.IO already creates one internally |
| pathfinding | ^0.4.18 | A* grid navigation | Already in project, no changes needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | - | - | This phase requires zero new dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw http handler for health | Express.js | Overkill for a single endpoint; adds dependency, middleware overhead. Raw handler is 15 lines. |
| Separate `bot:join` event | `isBot` flag in existing `joinRoom` opts | Separate event duplicates join logic and diverges bot/human paths unnecessarily |
| Per-emote events (`wave`, `sit`, `nod`) | Single `emote:play` with name param | Per-emote events create N handlers; single event with validation is cleaner and extensible |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Existing Server Structure
```
server/
├── index.js          # Single-file server: Socket.IO setup, pathfinding, room management, event handlers
├── default.json      # Default room layout data
├── package.json      # socket.io ^4.7.2, pathfinding ^0.4.18
├── rooms.json        # Runtime room state (created on first itemsUpdate)
└── node_modules/
```

The server is a single `index.js` (~250 lines) structured as:
1. **Socket.IO server creation** (lines 1-14) — `new Server()` with CORS, `io.listen(3000)`
2. **Pathfinding utilities** (lines 16-55) — AStarFinder, grid management
3. **Room management** (lines 57-103) — Loading rooms from JSON, random position generation
4. **Socket event handlers** (lines 105-248) — Connection, joinRoom, move, dance, chat, disconnect
5. **Shop items dictionary** (lines 250-540) — Static item definitions

### Pattern 1: Extending the Join Flow with isBot
**What:** Add `isBot` to the character object created during `joinRoom`, sourced from the client's options payload.
**When to use:** When a bot connects and needs to be distinguishable from human players.
**Example:**
```javascript
// Current join handler (line 121-145)
socket.on("joinRoom", (roomId, opts) => {
  room = rooms.find((room) => room.id === roomId);
  if (!room) return;
  socket.join(room.id);
  character = {
    id: socket.id,
    session: parseInt(Math.random() * 1000),
    position: generateRandomPosition(room),
    avatarUrl: opts.avatarUrl,
    // NEW: bot flag — defaults to false if not provided
    isBot: opts.isBot === true,
    // NEW: optional bot display name
    name: opts.name || null,
  };
  room.characters.push(character);
  // ... rest of join logic unchanged
});
```
**Why this works:** The existing `joinRoom` handler already accepts an `opts` object with `avatarUrl`. Adding `isBot` to that object is the minimal change. The character array is broadcast to all clients via the `characters` event, so the flag automatically propagates to every connected client.

### Pattern 2: Namespaced Emote Event with Validation
**What:** A single `emote:play` event that accepts an emote name string, validates it against an allowlist, and broadcasts to the room.
**When to use:** For all emote interactions (wave, sit, nod, dance).
**Example:**
```javascript
// Emote constants
const ALLOWED_EMOTES = ["dance", "wave", "sit", "nod"];

// Inside io.on("connection") handler:
socket.on("emote:play", (emoteName) => {
  if (!room) return;
  if (!ALLOWED_EMOTES.includes(emoteName)) return; // silent reject
  io.to(room.id).emit("emote:play", {
    id: socket.id,
    emote: emoteName,
  });
});
```
**Why this works:** Follows the namespaced event convention (`domain:action`) from CONTEXT.md. Validation prevents arbitrary strings from being broadcast. The existing `dance` event can be migrated to use this pattern or kept for backward compatibility during transition.

### Pattern 3: HTTP Health Endpoint on Socket.IO's Internal Server
**What:** Attach a raw HTTP request handler to the `http.Server` that Socket.IO creates internally.
**When to use:** When adding HTTP endpoints without introducing Express or another framework.
**Example:**
```javascript
// Socket.IO 4.x: io.listen() returns the io instance, but the underlying
// http server is accessible via io.httpServer after listen()
// Alternative: create the http server explicitly

import http from "http";

const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: { origin },
});

// Health endpoint
httpServer.on("request", (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const health = {
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        players: r.characters.length,
        bots: r.characters.filter((c) => c.isBot).length,
      })),
      totalPlayers: rooms.reduce((sum, r) => sum + r.characters.length, 0),
      totalBots: rooms.reduce((sum, r) => sum + r.characters.filter((c) => c.isBot).length, 0),
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
    return;
  }
  // Let Socket.IO handle everything else (it attaches its own request handler)
});

httpServer.listen(3000);
```
**Why this works:** Socket.IO 4.x can attach to an existing `http.Server`. By creating the server explicitly, we can intercept HTTP requests before Socket.IO handles them. The `/health` route returns JSON while all other requests fall through to Socket.IO's upgrade/polling handlers.

### Anti-Patterns to Avoid
- **Adding Express for one endpoint:** Pulling in Express, body-parser, etc. for a single GET route is massive overkill. The raw `http.createServer` approach is ~10 lines and zero dependencies.
- **Separate event per emote:** Creating `socket.on("wave")`, `socket.on("sit")`, `socket.on("nod")` duplicates handler logic. Use a single parameterized event.
- **Trusting client isBot flag blindly in security contexts:** For Phase 2, simple `opts.isBot === true` is fine. Future phases may need server-side bot authentication (API key, token), but that is out of scope here.
- **Modifying the existing `dance` event in-place:** Keep the old `dance` event handler working for now to avoid breaking existing client code. The new `emote:play` event runs alongside it. Migration of the client to use `emote:play` for dance can happen in Phase 6.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP server | Express app | `http.createServer()` + Socket.IO attach | Zero deps, one endpoint needed |
| Event validation | Custom schema parser | Simple allowlist array + `includes()` | Only validating a string against a fixed list |
| Bot authentication | JWT/session system | Boolean flag in join opts | Phase 2 just marks bots, auth comes later if needed |

**Key insight:** This phase is about adding ~50 lines of code to an existing single-file server. The temptation to over-architect (add Express, add middleware, add config files, split into modules) should be resisted. Keep changes minimal and co-located in `index.js`.

## Common Pitfalls

### Pitfall 1: Socket.IO's `io.listen()` Hides the HTTP Server
**What goes wrong:** Calling `io.listen(3000)` creates an HTTP server internally, but does not expose it in a way that lets you add custom routes.
**Why it happens:** `io.listen()` is a convenience method. The returned value is the `io` instance, not the HTTP server. Accessing `io.httpServer` may work but is not part of the public API.
**How to avoid:** Create the `http.Server` explicitly with `http.createServer()`, then pass it to `new Server(httpServer, opts)`, then call `httpServer.listen(3000)`. This gives full control.
**Warning signs:** Health endpoint returns 404 or Socket.IO upgrade response instead of JSON.

### Pitfall 2: Health Route Intercepting Socket.IO Requests
**What goes wrong:** If the health handler does not properly fall through for non-health requests, Socket.IO's long-polling transport breaks.
**Why it happens:** `httpServer.on("request")` fires for ALL requests including Socket.IO's `/socket.io/` polling requests.
**How to avoid:** Only handle `GET /health` explicitly. For all other requests, do nothing (let Socket.IO's own handler process them). When using `http.createServer((req, res) => {...})`, the callback becomes the default handler — make sure to NOT call `res.end()` for non-health requests. Instead, use the event-based approach or handle the default case by delegating to Socket.IO.
**Warning signs:** Socket.IO clients fail to connect after adding the health endpoint. Long-polling fallback stops working.

### Pitfall 3: Broadcasting isBot to Clients Exposes Internal Flags
**What goes wrong:** The entire `character` object is broadcast via `io.to(room.id).emit("characters", room.characters)`. Any field added to the character object goes to all clients.
**Why it happens:** The existing code broadcasts the full character array without filtering.
**How to avoid:** This is actually desirable for Phase 2 — clients need `isBot` to display bot badges (Phase 6). Just be aware that anything on the character object is public. Do NOT put secrets (API keys, tokens) on the character object.
**Warning signs:** Sensitive data appearing in browser devtools network tab.

### Pitfall 4: Forgetting to Handle the `emote:play` Event on Existing Clients
**What goes wrong:** New server emits `emote:play` but existing client code only listens for `playerDance`. Nothing happens visually.
**Why it happens:** The client Avatar component (Avatar.jsx line 100-102) listens for `playerDance`, not `emote:play`.
**How to avoid:** For Phase 2, keep the old `dance` handler working. Add the new `emote:play` handler alongside it. Client updates happen in Phase 6. For testing Phase 2, use a simple socket.io-client script or browser console.
**Warning signs:** Emotes fire server-side but no visual feedback on any client.

### Pitfall 5: `http.createServer()` Callback vs Event Listener Conflict
**What goes wrong:** Passing a callback to `http.createServer(callback)` and also calling `httpServer.on("request", handler)` causes double-handling.
**Why it happens:** The callback passed to `createServer` IS the `request` event handler. Adding another `on("request")` creates a second handler.
**How to avoid:** Use one approach or the other. Recommended: pass the callback to `createServer()` and handle health there, letting Socket.IO attach its own listener.
**Warning signs:** Health endpoint called twice, Socket.IO handlers firing unexpectedly.

## Code Examples

### Complete Health Endpoint Setup
```javascript
// Source: Node.js http module + Socket.IO 4.x documentation
import http from "http";
import { Server } from "socket.io";

const origin = process.env.CLIENT_URL || "http://localhost:5173";

const httpServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const health = {
      status: "ok",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        players: r.characters.length,
        bots: r.characters.filter((c) => c.isBot).length,
      })),
      totalPlayers: rooms.reduce((sum, r) => sum + r.characters.length, 0),
      totalBots: rooms.reduce(
        (sum, r) => sum + r.characters.filter((c) => c.isBot).length,
        0
      ),
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
    return;
  }
  // All other HTTP requests: return 404
  // Socket.IO attaches its own listener and will handle /socket.io/* paths
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: { origin },
});

// ... all existing Socket.IO event handlers stay the same ...

httpServer.listen(3000);
console.log("Server started on port 3000, allowed cors origin: " + origin);
```

### Complete emote:play Handler
```javascript
// Source: existing dance handler pattern in server/index.js
const ALLOWED_EMOTES = ["dance", "wave", "sit", "nod"];

// Inside io.on("connection", (socket) => { ... })
socket.on("emote:play", (emoteName) => {
  if (!room) return;
  if (typeof emoteName !== "string") return;
  if (!ALLOWED_EMOTES.includes(emoteName)) return;
  io.to(room.id).emit("emote:play", {
    id: socket.id,
    emote: emoteName,
  });
});

// Keep existing dance handler for backward compatibility with current client
socket.on("dance", () => {
  io.to(room.id).emit("playerDance", {
    id: socket.id,
  });
});
```

### Modified joinRoom with isBot
```javascript
// Source: existing joinRoom handler in server/index.js (line 121)
socket.on("joinRoom", (roomId, opts) => {
  room = rooms.find((room) => room.id === roomId);
  if (!room) return;
  socket.join(room.id);
  character = {
    id: socket.id,
    session: parseInt(Math.random() * 1000),
    position: generateRandomPosition(room),
    avatarUrl: opts.avatarUrl,
    isBot: opts.isBot === true,       // NEW: bot flag, strict boolean
    name: opts.name || null,           // NEW: optional display name for bots
  };
  room.characters.push(character);

  socket.emit("roomJoined", {
    map: {
      gridDivision: room.gridDivision,
      size: room.size,
      items: room.items,
    },
    characters: room.characters,
    id: socket.id,
  });
  onRoomUpdate();
});
```

### Test Script for Verifying Server Modifications
```javascript
// test-bot.mjs — run with: node test-bot.mjs
import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

socket.on("welcome", (data) => {
  console.log("Connected. Rooms:", data.rooms);
  // Join first room as a bot
  socket.emit("joinRoom", data.rooms[0].id, {
    avatarUrl: "https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb",
    isBot: true,
    name: "TestBot",
  });
});

socket.on("roomJoined", (data) => {
  console.log("Joined room. Characters:", data.characters);
  const me = data.characters.find((c) => c.id === data.id);
  console.log("My character:", me);
  console.log("isBot flag:", me.isBot); // Should be true

  // Test emote
  socket.emit("emote:play", "wave");
});

socket.on("emote:play", (data) => {
  console.log("Emote received:", data); // { id: socket.id, emote: "wave" }
});

// Test health endpoint
setTimeout(async () => {
  const res = await fetch("http://localhost:3000/health");
  const health = await res.json();
  console.log("Health:", health);
  socket.disconnect();
}, 2000);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `io.listen(port)` convenience | Explicit `http.createServer()` + `new Server(httpServer)` | Socket.IO 3.x+ | Needed for custom HTTP routes alongside WebSocket |
| Per-action events (`dance`, `wave`, `sit`) | Single parameterized event (`emote:play` + name) | Common pattern | More extensible, less handler duplication |
| No event naming convention | Namespaced `domain:action` events | Project decision | Better organization as event surface grows |

**Deprecated/outdated:**
- Socket.IO 2.x `io.origins()` for CORS — replaced by `cors` option in constructor (already using new approach)
- Socket.IO `socket.rooms` as array — now a `Set` in v4 (not relevant to this phase but worth knowing)

## Open Questions

1. **Should the old `dance` event handler be removed or kept?**
   - What we know: The client (Avatar.jsx) listens for `playerDance`. Removing the handler breaks the existing dance button.
   - What's unclear: Whether Phase 6 (Client UI) will migrate all emotes to `emote:play` or keep legacy events.
   - Recommendation: Keep both handlers in Phase 2. The old handler is 3 lines. Remove it when the client migrates in Phase 6.

2. **Should `emote:play` also broadcast to the sender?**
   - What we know: The existing dance uses `io.to(room.id).emit()` which sends to ALL clients in the room including the sender.
   - Recommendation: Use the same pattern (`io.to(room.id).emit`). The sender needs to know their emote was accepted so they can play the animation locally.

3. **What additional fields should bots carry beyond isBot?**
   - What we know: Phase 3 (Headless Bot Client) needs `name` for display. Phase 7 (Bot Character) needs personality data, but that lives in the bot process, not the server.
   - Recommendation: Add `name` (string, optional) and `isBot` (boolean). That is sufficient. Bot personality and state are managed by the bot process, not stored on the server character object.

## Sources

### Primary (HIGH confidence)
- **Direct codebase inspection** — `server/index.js` (248 lines), `server/package.json`, `client/src/components/SocketManager.jsx`, `client/src/components/Avatar.jsx`, `client/src/components/UI.jsx`
- **Socket.IO 4.x documentation** — Server initialization with `http.createServer()`, room broadcasting with `io.to().emit()`
- **Node.js http module** — `http.createServer()` callback pattern for handling HTTP requests

### Secondary (MEDIUM confidence)
- Socket.IO best practices for mixing HTTP and WebSocket on the same port — established community pattern

### Tertiary (LOW confidence)
- None — all findings based on direct code inspection and official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — No new libraries needed, all changes use existing dependencies
- Architecture: HIGH — Patterns directly derived from inspecting existing code in `server/index.js`
- Pitfalls: HIGH — All pitfalls identified from analyzing the specific code patterns in use

**Research date:** 2026-01-31
**Valid until:** 2026-03-02 (stable — no moving targets, existing codebase with pinned deps)
