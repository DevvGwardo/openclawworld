# Technology Stack

**Project:** OpenClaw World
**Researched:** 2026-01-31
**Overall Confidence:** HIGH

## Existing Stack (from base repo)

These are already in the project via the wass08/r3f-sims-online-final template. Do not change them.

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.x | UI framework |
| Three.js | 0.153 | 3D rendering engine |
| React Three Fiber (R3F) | 8.13 | React renderer for Three.js |
| Drei | 9.75 | R3F helper components |
| Socket.IO (server) | 4.7.x | Real-time multiplayer server |
| socket.io-client | 4.7.x | Browser client for multiplayer |
| Jotai | latest | Atomic state management |
| Vite | latest | Build tool and dev server |
| Tailwind CSS | latest | Utility-first CSS |
| pathfinding | latest | Grid-based A* navigation |

---

## Recommended Additions

### Server-Side: Bot Bridge and Gateway Integration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `ws` | 8.19.0 | WebSocket client for OpenClaw Gateway | The standard Node.js WebSocket library. 24K+ dependents. OpenClaw Gateway speaks raw WebSocket, not Socket.IO -- so `ws` is the right tool. Do NOT use `socket.io-client` for Gateway; it adds Socket.IO framing the Gateway does not understand. | HIGH |
| `socket.io-client` | 4.8.1 | Headless bot clients connecting to the game server | Bots connect to the same Socket.IO game server that browser clients use. Using `socket.io-client` from Node.js is officially supported and works headless -- no browser needed. Must match the server's Socket.IO major version (4.x). | HIGH |
| `zod` | 4.3.5 | Action schema validation | TypeScript-first schema validation. 84M weekly downloads. Use Zod to define and validate the action schemas bots produce (move, say, emote, idle, etc.) before execution. Zod 4 is stable since May 2025 with significant improvements over v3. | HIGH |
| `pino` | 10.2.0 | Structured JSON logging | 5x faster than alternatives (winston, bunyan). Outputs NDJSON by default, which Railway ingests natively. Async I/O via worker threads keeps the event loop clean. Supports Node.js 22 native TypeScript type stripping. | HIGH |
| `pino-pretty` | 13.1.3 | Human-readable dev logs | Dev dependency only. Formats Pino's JSON output into color-coded readable lines during local development. Never use in production. | HIGH |
| `limiter` | 3.0.0 | Token bucket rate limiting | Provides both `RateLimiter` and `TokenBucket` classes. Configurable burst rate and drip rate -- maps directly to the project requirement of "3 actions/sec burst, 1/sec refill." No Redis needed for single-server v1. Lightweight, no dependencies. | HIGH |
| `nanoid` | 5.1.6 | Unique ID generation | 118 bytes, crypto-secure, URL-friendly. Use for bot session IDs, request correlation IDs, action IDs. No dependencies. 75M weekly downloads. | HIGH |

### Shared / Validation Layer

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `zod` | 4.3.5 | (same package, shared between client and server) | Define action schemas once, validate on bot side before sending, validate on server side before executing. Single source of truth for the action protocol. | HIGH |

### DevOps and Deployment

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | 22 LTS | Runtime | Required by OpenClaw. Railway supports Node.js 22. Use the LTS line for stability. | HIGH |
| Railway | N/A | Deployment platform | Single-server deployment. Auto-detects Node.js via `package.json`. Injects env vars at runtime. Handles SSL/TLS automatically. Supports WebSocket connections (needed for both Socket.IO and Gateway). | HIGH |
| `dotenv` | 17.2.3 | Local env var loading | For local development only. Node.js 22 has native `--env-file` support, but dotenv is more ergonomic during dev with `dotenv.config()`. Railway injects env vars directly in production, so dotenv is dev-only. | MEDIUM |

### Environment Variables Needed

```
OPENCLAW_GATEWAY_TOKEN=<gateway auth token>
OPENCLAW_GATEWAY_URL=ws://localhost:18789 (or wss:// in production)
NODE_ENV=production (set by Railway)
PORT=3000 (set by Railway)
```

---

## Architecture Rationale: Two WebSocket Protocols

This is the critical architectural distinction in the stack:

```
Browser Clients                    OpenClaw Gateway
      |                                  |
  Socket.IO 4.x                    Raw WebSocket (ws)
      |                                  |
      v                                  v
 +------------------------------------------+
 |            Node.js Server                 |
 |                                           |
 |  Socket.IO Server  <-->  Bot Bridge  <--> ws Client
 |   (game state)       (translates)     (Gateway protocol)
 +------------------------------------------+
```

- **Socket.IO** handles the multiplayer game state (positions, chat, interactions) between all clients (browsers AND headless bots).
- **`ws`** handles the raw WebSocket connection to OpenClaw Gateway for LLM decision-making.
- The **Bot Bridge** is custom code that translates between these two protocols: it reads game state from Socket.IO, serializes it as perception for the Gateway, receives LLM actions back, validates them with Zod, and executes them via Socket.IO.

Do NOT try to make the Gateway speak Socket.IO or make the game server speak raw WebSocket. They are different protocols for different purposes.

---

## What NOT to Use

| Technology | Why Not |
|------------|---------|
| **Playroom Kit** | Base repo uses Socket.IO. Migration would be a rewrite with zero value for v1. Out of scope per PROJECT.md. |
| **Winston / Bunyan** | Slower than Pino by 5x+. Winston's transport system adds complexity. Pino's NDJSON output is what Railway expects. |
| **express-rate-limit** | Designed for HTTP middleware, not in-process bot action throttling. `limiter` gives direct token bucket control per bot instance. |
| **uuid** | Overkill for this use case. nanoid is smaller, faster, and URL-friendly. UUID v4 strings are 36 chars; nanoid is 21 chars with equivalent collision resistance. |
| **axios / node-fetch** | Not needed. Gateway communication is WebSocket (persistent connection), not HTTP request/response. The `ws` library handles everything. |
| **Bull / BullMQ** | Job queue is premature for v1. The perception-decision-action loop is a simple setInterval, not a distributed job. Add queuing only if scaling to many bots later. |
| **Redis** | Single server, single room, few bots. All state fits in memory. Redis adds operational complexity for zero v1 benefit. |
| **Prisma / Drizzle / any ORM** | No database in v1. World state is ephemeral in-memory. Persistence is a post-v1 concern. |
| **tRPC** | No API layer needed. Communication is Socket.IO events and WebSocket frames, not HTTP endpoints. |
| **dotenv in production** | Railway injects env vars directly. Using dotenv in prod is an anti-pattern that masks missing configuration. |
| **Zod v3** | Zod 4 has been stable since May 2025. v3 is maintenance-only. Start with v4 for better performance and features. |

---

## Installation Commands

```bash
# Server-side additions (production dependencies)
npm install ws zod pino limiter nanoid socket.io-client

# Server-side additions (dev dependencies)
npm install -D pino-pretty @types/ws

# Local dev only
npm install -D dotenv
```

Note: `socket.io-client` is installed as a server dependency because headless bots import it from Node.js to connect to the game server programmatically.

---

## Version Pinning Strategy

For v1, pin to exact versions in `package.json` to avoid surprise breakage:

```json
{
  "dependencies": {
    "ws": "8.19.0",
    "zod": "4.3.5",
    "pino": "10.2.0",
    "limiter": "3.0.0",
    "nanoid": "5.1.6",
    "socket.io-client": "4.8.1"
  },
  "devDependencies": {
    "pino-pretty": "13.1.3",
    "@types/ws": "^8.5.0",
    "dotenv": "17.2.3"
  }
}
```

---

## Node.js 22 Considerations

- **Native `.env` file support**: `node --env-file=.env server.js` works without dotenv. Consider this for production start script.
- **Native TypeScript type stripping**: Node.js 22 can run `.ts` files with type annotations stripped at runtime (no transpilation). Pino 10.2 explicitly supports this. Evaluate whether the base repo's Vite build can leverage this for server code.
- **ESM by default**: Ensure `"type": "module"` in `package.json` or use `.mjs` extensions. All recommended packages (ws, zod, pino, limiter, nanoid) support ESM.
- **Performance**: V8 v12.4 in Node.js 22 brings improved performance for WebSocket operations and JSON serialization, both critical for the perception loop.

---

## Sources

- [Zod on npm](https://www.npmjs.com/package/zod) -- v4.3.5 verified
- [Zod v4 release notes](https://zod.dev/v4)
- [Pino on npm](https://www.npmjs.com/package/pino) -- v10.2.0 verified
- [Pino on GitHub](https://github.com/pinojs/pino)
- [pino-pretty on npm](https://www.npmjs.com/package/pino-pretty) -- v13.1.3 verified
- [ws on npm](https://www.npmjs.com/package/ws) -- v8.19.0 verified
- [ws on GitHub](https://github.com/websockets/ws)
- [socket.io-client on npm](https://www.npmjs.com/package/socket.io-client) -- v4.8.1 verified
- [Socket.IO client installation docs](https://socket.io/docs/v4/client-installation/)
- [limiter on npm](https://www.npmjs.com/package/limiter) -- v3.0.0 verified
- [limiter on GitHub](https://github.com/jhurliman/node-rate-limiter)
- [nanoid on npm](https://www.npmjs.com/package/nanoid) -- v5.1.6 verified
- [dotenv on npm](https://www.npmjs.com/package/dotenv) -- v17.2.3 verified
- [Node.js 22 native .env support](https://infisical.com/blog/stop-using-dotenv-in-nodejs-v20.6.0+)
- [Railway Node.js deployment guide](https://docs.railway.com/guides/deploy-node-express-api-with-auto-scaling-secrets-and-zero-downtime)
- [Railway Express deployment docs](https://docs.railway.com/guides/express)
