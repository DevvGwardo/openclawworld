# Domain Pitfalls

**Domain:** 3D social sandbox with autonomous AI bot integration (LLM-powered perception-decision-action loop)
**Researched:** 2026-01-31

---

## Critical Pitfalls

Mistakes that cause rewrites, broken core loops, or unrecoverable production failures.

---

### Pitfall 1: LLM Latency vs. Game Tick Rate Mismatch — The "Frozen Bot" Problem

**What goes wrong:** The perception loop runs at 2-4 Hz (every 250-500ms), but LLM responses take 1-5 seconds (first token latency alone for Claude Sonnet is ~2s). If the bot blocks on LLM response before taking any action, it stands frozen for seconds at a time. Worse, if the perception loop queues multiple LLM calls while waiting, you get a backlog of stale perception snapshots being processed — the bot acts on world state from 10+ seconds ago.

**Why it happens:** Developers treat the LLM call like a synchronous game AI function: perceive, decide, act, repeat. But LLM inference is 100-1000x slower than a game tick. The perception-decision-action loop is not a tight loop — it is an asynchronous pipeline with vastly different stage durations.

**Consequences:**
- Bot appears frozen or unresponsive for 1-5 seconds between actions
- Stale perception data leads to nonsensical actions (walking toward a player who already left)
- Multiple queued LLM requests waste tokens and money on obsolete world states
- If bot waits for LLM before sending any Socket.IO heartbeat/activity, server may consider it idle

**Prevention:**
1. **Decouple perception from decision.** Perception loop runs independently at 2-4 Hz, always updating a "latest world snapshot" buffer. Decision loop runs asynchronously — when the LLM responds, it reads the *latest* snapshot, not the one that triggered the request.
2. **One-in-flight rule.** Only one LLM request in flight at a time per bot. If a new perception tick fires while waiting, just update the snapshot buffer — do not queue another LLM call.
3. **Idle behavior while waiting.** Bot should have a simple deterministic behavior (continue current path, idle animation, face nearest player) that runs while waiting for LLM response. The bot should never appear frozen.
4. **Timeout and fallback.** If LLM response exceeds 5 seconds, cancel and fall back to a random idle action. Do not let the bot hang indefinitely.

**Detection:** Bot stands motionless for >2 seconds with no action. Multiple pending LLM requests in the queue. Growing memory from accumulated promise chains.

**Phase mapping:** Must be solved in the initial bot bridge architecture (Phase 1-2). This is the core loop — getting it wrong here means rewriting the entire bot system.

**Confidence:** HIGH — well-documented in LLM game agent research (arXiv 2512.17250, OpenAI latency optimization guide).

---

### Pitfall 2: Socket.IO Event Listener Accumulation on Reconnection

**What goes wrong:** When a headless bot client reconnects to the game server (which happens on network hiccups, server restarts, deploys), event handlers registered inside the `connect` callback get re-registered without removing the old ones. After a few reconnections, the bot has 5x duplicate handlers for every event, causing duplicate action processing, memory growth, and eventually `MaxListenersExceededWarning`.

**Why it happens:** The natural pattern is:
```javascript
socket.on('connect', () => {
  socket.on('gameState', handleGameState);  // BUG: re-registered every reconnect
  socket.on('chat', handleChat);
});
```
This is the single most common Socket.IO memory leak pattern, and it is especially dangerous for headless bots that run 24/7 and reconnect frequently.

**Consequences:**
- Memory grows linearly with each reconnection
- Duplicate event processing (bot receives same message N times, responds N times)
- `MaxListenersExceededWarning` in Node.js logs
- Eventually OOM crash on Railway's memory-limited containers

**Prevention:**
1. **Register handlers once, outside `connect`.** Socket.IO v4 preserves handlers across reconnections — you do not need to re-register them.
```javascript
const socket = io(serverUrl, { transports: ['websocket'] });
// Register ONCE, outside connect
socket.on('gameState', handleGameState);
socket.on('chat', handleChat);
socket.on('connect', () => {
  console.log('Connected/reconnected');
  // Only do handshake/auth here, NOT event registration
});
```
2. **Explicit cleanup on disconnect.** When intentionally disconnecting a bot, call `socket.removeAllListeners()` then `socket.disconnect()`.
3. **Monitor listener count.** In development, periodically log `socket.listenerCount('gameState')` — it should always be 1.

**Detection:** `MaxListenersExceededWarning` in logs. `socket.listenerCount()` returning >1 for any event. Memory steadily increasing in Railway metrics without corresponding load increase.

**Phase mapping:** Must be correct from the first headless client implementation (Phase 1). Fixing this retroactively means auditing every event registration.

**Confidence:** HIGH — documented across Socket.IO GitHub issues (#4708, #3477, #407) and official docs.

---

### Pitfall 3: OpenClaw Gateway Auth Token Expiry During Reconnection

**What goes wrong:** The OpenClaw Gateway uses challenge-based auth with nonce signing. When the WebSocket connection drops and the bot tries to reconnect, the previous auth state is invalid. If the reconnection logic replays the old handshake or uses a stale token, the connection is rejected. If the reconnection takes longer than the token TTL, the token expires entirely and the bot enters a permanent reconnection failure loop.

**Why it happens:** Developers implement the happy path (initial connection works) and treat reconnection as "just reconnect." But challenge-based auth requires a fresh challenge-response on each new connection. The reconnection path is fundamentally different from the initial connection path.

**Consequences:**
- Bot silently loses Gateway connection and stops receiving LLM responses
- Reconnection loop burns CPU without ever succeeding
- No error visible to the game — bot just stops acting intelligently
- If using a shared Gateway connection for multiple bots, all bots go down simultaneously

**Prevention:**
1. **Full re-auth on every reconnection.** Do not cache or reuse challenge responses. On WebSocket `close` event, the reconnection handler must perform the complete `connect.challenge` handshake from scratch.
2. **Pre-emptive token refresh.** If the Gateway token has a known TTL, refresh it at 80% of TTL rather than waiting for expiry.
3. **Connection health monitoring.** Send periodic pings to the Gateway. If no pong within 5 seconds, assume connection is dead and initiate reconnection immediately rather than waiting for the TCP timeout.
4. **Separate Gateway connection from bot lifecycle.** The Gateway connection should be a singleton service with its own reconnection logic, not embedded in individual bot code.

**Detection:** Bot continues to move (local pathfinding works) but stops speaking or making intelligent decisions. Gateway WebSocket `readyState` is not `OPEN`. Reconnection attempts in logs with auth errors.

**Phase mapping:** Critical for the Gateway integration phase. Must be designed correctly from the start — the connection lifecycle is the foundation of the entire LLM integration.

**Confidence:** MEDIUM — WebSocket reconnection + auth is a well-known general pattern (Twitch, Refinitiv, etc.), but specific OpenClaw Gateway behavior needs verification against its docs.

---

### Pitfall 4: Action-Perception Mismatch — Bot Promises What the Game Cannot Deliver

**What goes wrong:** The LLM tells the bot to "pick up the coffee cup and bring it to the player" or "open the door to the garden" — actions that sound natural but do not exist in the game's action space. The base R3F Sims repo supports: move to grid position, rotate, say text, emote (dance), and interact with specific furniture. The LLM does not intrinsically know these constraints.

**Why it happens:** LLMs are trained on general conversation. They will naturally suggest actions that make sense in real life or in richer game worlds. Without strict constraints, the LLM output will regularly include actions the game engine has no concept of. This is the #1 reported problem in LLM-powered NPC research.

**Consequences:**
- Bot says "I'll come sit next to you" but the sit action does not exist — bot just stands there
- Zod validation rejects the action, bot does nothing (appears frozen)
- If validation is too loose, invalid actions crash the bot bridge
- Players lose immersion immediately when bots promise things they cannot do

**Prevention:**
1. **Strict action schema in the prompt.** The system prompt must enumerate every possible action with exact parameters:
```
You can ONLY output these actions:
- move: {x: number, y: number} — grid coordinates
- say: {text: string} — speak (max 100 chars)
- emote: {type: "dance"|"wave"|"idle"}
- interact: {target: string} — furniture ID
- idle: {} — do nothing
You CANNOT pick up items, open doors, sit, or do anything not listed above.
```
2. **Zod validation as a hard gate.** Every LLM response is parsed through Zod before execution. Invalid actions are silently replaced with `idle`, not retried.
3. **Never expose raw LLM text as bot speech without review.** The LLM might say "Let me open this door for you" — which implies a capability the game lacks. Consider a post-filter that rejects speech referencing non-existent actions.
4. **Function-calling mode if available.** Use structured output / function calling to constrain the LLM to a fixed action schema rather than parsing free-form text.

**Detection:** Zod validation rejection rate >20%. Bot frequently idles after LLM responds (response was invalid). Player reports of "the bot said it would do X but didn't."

**Phase mapping:** Must be solved when building the decision loop prompt + action validation. This is a prompt engineering + schema design problem that should be iterated on early.

**Confidence:** HIGH — extensively documented in LLM NPC research (Gigax/HuggingFace NPC-Playground, arXiv 2501.10106, CESCG 2025 papers).

---

## Moderate Pitfalls

Mistakes that cause delays, poor performance, or significant technical debt.

---

### Pitfall 5: Perception Serialization Bloat

**What goes wrong:** The perception loop serializes the entire game state (all player positions, all furniture, all chat history) into JSON and sends it to the LLM on every decision cycle. At 2-4 Hz perception with even 5 players and 20 furniture items, this creates massive token usage. JSON encoding of 3D positions with full floating-point precision (e.g., `{"x": 3.141592653589793, "y": 0, "z": -2.718281828459045}`) wastes tokens on meaningless decimal places.

**Why it happens:** It is the easiest implementation — just `JSON.stringify(gameState)`. Developers optimize for shipping speed and do not think about token costs until the API bill arrives.

**Consequences:**
- Token costs 5-10x higher than necessary
- LLM processing slower (more input tokens = higher latency)
- Prompt exceeds context window if chat history is not truncated
- Redundant information (furniture that has not moved since last tick) re-sent every cycle

**Prevention:**
1. **Spatial filtering.** Only include entities within a perception radius of the bot (e.g., 5 grid tiles). Do not send the entire room.
2. **Delta compression for decision context.** Only send what changed since the last LLM call. "Player Alice moved from (3,2) to (5,2)" not the full state.
3. **Round coordinates.** Grid-based game means positions should be integers. `{x: 3, y: 2}` not `{x: 3.14159, y: 2.71828}`.
4. **Truncate chat history.** Last 5-10 messages, not last 100.
5. **Compact format.** `"Players nearby: Alice(3,2), Bob(7,4)"` instead of verbose JSON arrays.

**Detection:** Token usage per LLM call >500 tokens for perception context alone. LLM response latency increasing over time as context grows. Monthly API costs higher than expected.

**Phase mapping:** Can start simple (full JSON) in Phase 1, but must optimize by Phase 2 before adding multiple bots or extended sessions.

**Confidence:** HIGH — standard LLM optimization practice, well-documented in OpenAI and Anthropic latency guides.

---

### Pitfall 6: Railway Single-Server Resource Contention

**What goes wrong:** Running the game server (Socket.IO), the OpenClaw Gateway, and the bot bridge all in a single Railway container creates resource contention. The game server needs consistent low-latency event processing. The Gateway handles WebSocket connections. The bot bridge runs LLM inference requests. When the LLM response processing spikes CPU (JSON parsing of large responses, Zod validation), it blocks the game server's event loop, causing lag for all connected players.

**Why it happens:** Node.js is single-threaded. All three services share one event loop. A synchronous JSON.parse of a large LLM response or a complex Zod validation can block for 10-50ms, which is an eternity for a 30Hz game server.

**Consequences:**
- Game feels laggy for human players when bot is processing LLM responses
- Socket.IO heartbeat timeouts if event loop is blocked too long
- Memory contention — Node.js V8 defaults to container-aware heap sizing (Node 20+), but three services competing for the same heap leads to more frequent GC pauses
- Railway charges by resource usage — memory-heavy workloads are expensive

**Prevention:**
1. **Use `worker_threads` or child processes for bot bridge.** The bot's LLM processing should run in a separate thread/process so it cannot block the game server's event loop.
2. **Set `--max-old-space-size`** explicitly to prevent V8 from consuming all available container memory. Railway containers default to plan limits (e.g., 8GB on Pro), and Node.js will happily use most of it before GC kicks in.
3. **Monitor event loop lag.** Use `perf_hooks.monitorEventLoopDelay()` to track event loop delays. Alert if p99 exceeds 50ms.
4. **For v1 with 1 bot, this is likely fine.** The real risk emerges when adding more bots or more players. But architect for separation from the start to avoid a rewrite later.
5. **Use `process.env.PORT`** for the game server — Railway assigns this dynamically. Do not hardcode ports.

**Detection:** Event loop lag spikes correlating with LLM response processing. Socket.IO disconnect events increasing. Railway memory metrics showing >80% utilization.

**Phase mapping:** Acceptable to run co-located in Phase 1 (v1, 1 bot). Must architect separation by Phase 2 if adding more bots.

**Confidence:** HIGH — Railway resource behavior well-documented (Railway docs, station.railway.com), Node.js event loop blocking is fundamental knowledge.

---

### Pitfall 7: Rate Limiter vs. LLM Latency — Token Bucket Starvation

**What goes wrong:** The token bucket rate limiter (3/sec burst, 1/sec refill) limits bot actions. But LLM responses arrive in bursts after a 1-5 second delay. When the LLM finally responds with an action, the token bucket may be full (3 tokens accumulated during the wait). The bot executes the action, then immediately requests another LLM decision. If the LLM is fast this time (~1s), the bucket has only refilled 1 token. If the LLM returns a multi-step plan (move then speak), the second action may be rate-limited despite the bot having done nothing for 5 seconds.

Conversely, if the rate limiter is applied *per LLM request* rather than per game action, and the LLM returns a multi-action response, the rate limiter blocks the second action while the first has already been sent to the game — causing inconsistent behavior.

**Why it happens:** Rate limiting and LLM inference have fundamentally different timing models. Rate limiters assume steady request streams. LLM responses are bursty and unpredictable. Applying a rate limiter designed for steady streams to a bursty source creates either under-utilization or blocking.

**Consequences:**
- Bot acts in bursts (3 rapid actions) then goes silent for seconds
- Multi-step actions (move + say) get partially executed
- Rate limiter feels arbitrary to observers — bot moves instantly sometimes, takes 5 seconds other times

**Prevention:**
1. **Rate limit game actions, not LLM requests.** The token bucket gates the final action execution, not the decision-making.
2. **Action queue with rate-limited drain.** LLM returns one action at a time. Queue it. Drain the queue at the rate limit (1/sec sustained). If a new LLM response arrives before the queue is empty, replace the queue (newer context is better).
3. **Do not allow multi-action LLM responses in v1.** Constrain the LLM to return exactly one action per call. Multi-step plans are a Phase 2+ feature.
4. **Adaptive bucket.** Consider tuning the refill rate based on the bot's activity pattern rather than using a fixed rate. If the bot has been idle for 5 seconds, it should be able to act immediately when the LLM responds.

**Detection:** Bot action timestamps show burst-then-silence pattern. Rate limiter rejection logs correlating with LLM response arrival. Queue depth growing unboundedly.

**Phase mapping:** Design the action queue + rate limiter together in Phase 1. Iterate tuning in Phase 2.

**Confidence:** MEDIUM — the specific interaction between token bucket and LLM latency is not well-documented; this is synthesized from rate limiting best practices + LLM serving patterns.

---

### Pitfall 8: Socket.IO Transport Fallback to Polling

**What goes wrong:** Socket.IO defaults to HTTP long-polling as its initial transport, then upgrades to WebSocket. For a headless Node.js bot client, there is no reason to use polling — it adds latency, increases HTTP overhead, and has known memory leak issues in the server-side client library when using polling transport. But if you do not explicitly configure `transports: ['websocket']`, the client will start with polling.

**Why it happens:** Socket.IO's default behavior is designed for browser clients where WebSocket may not be available. Headless Node.js clients do not have this limitation but inherit the same defaults.

**Consequences:**
- Higher latency on initial connection (polling upgrade dance)
- Known memory leak in Socket.IO server-side client with polling transport (GitHub issue #3477)
- Additional HTTP requests for each poll cycle
- Server-side overhead managing polling sessions

**Prevention:**
```javascript
const socket = io(serverUrl, {
  transports: ['websocket'],      // Skip polling entirely
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 10,
});
```

**Detection:** Network logs showing HTTP POST/GET requests to `/socket.io/?transport=polling`. Higher-than-expected request counts in Railway metrics.

**Phase mapping:** One-line fix. Set it when creating the headless client in Phase 1.

**Confidence:** HIGH — explicitly documented in Socket.IO official docs and memory usage guide.

---

## Minor Pitfalls

Mistakes that cause annoyance, wasted time, or small technical debt.

---

### Pitfall 9: Bot Session Cleanup — Orphaned State

**What goes wrong:** When a bot disconnects (crash, restart, Railway deploy), its player state remains in the game server's room. The avatar stands frozen in the 3D world. Other players see a ghost. If the bot reconnects with a new ID, now there are two avatars — one frozen ghost and one active.

**Why it happens:** The game server may not have robust disconnect cleanup for programmatic clients. The base R3F Sims repo handles browser disconnects (tab close), but a headless client that crashes mid-action may not trigger a clean disconnect event.

**Prevention:**
1. **Server-side disconnect timeout.** If no heartbeat from a client for 10 seconds, remove their avatar.
2. **Bot ID persistence.** Bots should reconnect with the same player ID so the server updates the existing avatar rather than creating a new one.
3. **Graceful shutdown handler.** On SIGTERM (Railway sends this before killing the container), disconnect all bot sockets cleanly.
```javascript
process.on('SIGTERM', () => {
  botSocket.disconnect();
  gatewayWs.close();
  process.exit(0);
});
```

**Detection:** Multiple bot avatars in the room. Frozen avatars that persist after server restarts.

**Phase mapping:** Phase 1 — implement alongside the bot session lifecycle.

**Confidence:** HIGH — standard server-side lifecycle management.

---

### Pitfall 10: Railway Deploy Causes Connection Storm

**What goes wrong:** Railway deploys by spinning up the new container, then shutting down the old one. During the transition, all WebSocket connections (game clients + Gateway) disconnect and reconnect simultaneously. If multiple bots are running, they all reconnect at the same time, creating a thundering herd that can overwhelm the new server instance during its startup.

**Why it happens:** Railway does not do graceful WebSocket draining by default. The old container is killed (SIGTERM then SIGKILL after 10s), and all connections drop.

**Prevention:**
1. **Jittered reconnection delays.** Each bot should add a random delay (0-3 seconds) before reconnecting after a disconnect.
2. **Railway health check endpoint.** Implement a `/health` endpoint that only returns 200 after the server is fully initialized (Socket.IO listening, Gateway connected). Railway will not route traffic until the health check passes.
3. **For v1 with 1 bot, this is not a problem.** But design for it if you plan to scale.

**Detection:** Spike in connection errors immediately after deploys. Server logs showing all connections arriving within 100ms of each other.

**Phase mapping:** Minor concern for Phase 1 (1 bot). Address in Phase 2+ if scaling.

**Confidence:** MEDIUM — Railway deploy behavior is documented, but specific WebSocket draining behavior needs testing.

---

### Pitfall 11: `perMessageDeflate` Memory Bloat

**What goes wrong:** Socket.IO's WebSocket compression (`perMessageDeflate`) allocates zlib contexts per connection. For long-running bot connections with frequent messages, these contexts accumulate memory. Under high message throughput, this can cause 50-100MB+ of memory overhead per connection.

**Why it happens:** `perMessageDeflate` is enabled by default in some configurations. It is designed for bandwidth-constrained browser clients, not for colocated server-to-server communication.

**Prevention:**
```javascript
// On the server
const io = new Server(httpServer, {
  perMessageDeflate: false  // Disable for local/colocated connections
});
```

**Detection:** Memory usage climbing steadily over time without corresponding load increase. Heap snapshots showing large zlib allocations.

**Phase mapping:** One-line config fix. Set during server setup in Phase 1.

**Confidence:** HIGH — documented in Socket.IO memory usage guide and multiple GitHub issues (#2775).

---

### Pitfall 12: JSON Serialization Overhead at Scale

**What goes wrong:** The base game likely uses JSON for Socket.IO event payloads. For v1 with 1 bot and a few players, this is fine (~410 bytes per game state snapshot). But JSON's verbosity adds up: at 30 messages/sec with 10 players, you hit ~12.9 KBps per player. Floating-point coordinates like `3.141592653589793` waste bytes when the grid system uses integers.

**Why it happens:** JSON is the path of least resistance. `JSON.stringify()` works out of the box with Socket.IO. Developers do not think about serialization overhead until bandwidth or parsing latency becomes a problem.

**Prevention:**
1. **For v1, use JSON. Do not over-optimize prematurely.** The overhead is negligible at v1 scale.
2. **Round coordinates to integers** since the game uses a grid system.
3. **If scaling later, consider MessagePack** as a drop-in replacement (Socket.IO has a MessagePack parser plugin).
4. **Send delta updates** rather than full state snapshots — only what changed since last tick.

**Detection:** Network bandwidth higher than expected. `JSON.parse()` appearing in CPU profiles.

**Phase mapping:** Not a concern for Phase 1. Optimize in Phase 3+ if scaling to many bots/players.

**Confidence:** HIGH — benchmarked extensively (dev.to serialization comparison, buildnewgames.com bandwidth analysis).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|---|---|---|---|
| Headless bot client setup | Event listener accumulation on reconnect (#2) | Critical | Register handlers once, outside `connect` callback |
| Headless bot client setup | Polling transport default (#8) | Minor | Set `transports: ['websocket']` explicitly |
| Headless bot client setup | `perMessageDeflate` memory (#11) | Minor | Disable compression for server-to-server |
| Gateway WebSocket integration | Auth token expiry on reconnect (#3) | Critical | Full re-auth on every reconnection, health monitoring |
| Perception-decision-action loop | LLM latency freeze (#1) | Critical | Decouple perception from decision, idle behavior while waiting |
| Perception-decision-action loop | Action-perception mismatch (#4) | Critical | Strict action schema, Zod validation, function-calling |
| Perception-decision-action loop | Perception serialization bloat (#5) | Moderate | Spatial filtering, compact format, truncated history |
| Action execution + rate limiting | Token bucket starvation (#7) | Moderate | Single-action responses, action queue with rate-limited drain |
| Bot session lifecycle | Orphaned state on crash (#9) | Minor | Disconnect timeout, persistent bot ID, SIGTERM handler |
| Railway deployment | Resource contention (#6) | Moderate | Worker threads for bot bridge, `--max-old-space-size` |
| Railway deployment | Deploy connection storm (#10) | Minor | Jittered reconnection, health check endpoint |
| Scaling (future) | JSON serialization overhead (#12) | Minor | MessagePack, delta updates — defer to Phase 3+ |

---

## Sources

### Socket.IO Connection & Memory
- [Socket.IO Memory Usage Guide](https://socket.io/docs/v4/memory-usage/) - HIGH confidence
- [Socket.IO Client Options](https://socket.io/docs/v4/client-options/) - HIGH confidence
- [Socket.IO Client Instance Docs](https://socket.io/docs/v4/client-socket-instance/) - HIGH confidence
- [GitHub Issue #4708 — MaxListenersExceededWarning](https://github.com/socketio/socket.io/issues/4708) - HIGH confidence
- [GitHub Issue #3477 — Memory Leak](https://github.com/socketio/socket.io/issues/3477) - HIGH confidence
- [GitHub Issue #407 — Disconnected Socket in Memory](https://github.com/socketio/socket.io/issues/407) - HIGH confidence
- [Common Socket.IO Pitfalls](https://moldstud.com/articles/p-common-pitfalls-when-using-socketio-and-how-to-avoid-them-essential-tips-for-developers) - MEDIUM confidence

### LLM Game Agent Architecture
- [arXiv 2512.17250 — Accelerating Multi-modal LLM Gaming via Input Prediction](https://arxiv.org/abs/2512.17250) - HIGH confidence
- [OpenAI Latency Optimization Guide](https://platform.openai.com/docs/guides/latency-optimization) - HIGH confidence
- [Lil'Log — LLM Powered Autonomous Agents](https://lilianweng.github.io/posts/2023-06-23-agent/) - HIGH confidence
- [arXiv 2501.10106 — LLM Reasoner and Automated Planner NPC Approach](https://arxiv.org/html/2501.10106v1) - HIGH confidence
- [HuggingFace NPC-Playground (Gigax)](https://huggingface.co/blog/npc-gigax-cubzh) - MEDIUM confidence
- [CESCG 2025 — Enhancing Game-Based Learning with LLM-Driven NPCs](https://cescg.org/wp-content/uploads/2025/04/A-Quest-for-Information-Enhancing-Game-Based-Learning-with-LLM-Driven-NPCs-2.pdf) - MEDIUM confidence
- [Clean Architecture for LLM-Based Games](https://medium.com/@m.sherafati7/how-clean-architecture-helped-me-design-an-llm-based-game-67ead68d8967) - LOW confidence

### Railway Deployment
- [Railway WebSocket Deployment Guide](https://station.railway.com/questions/how-to-deploy-socketio-applications-b83533a6) - HIGH confidence
- [Railway WebSocket Connection Failures](https://station.railway.com/questions/web-socket-connection-failed-bec532a2) - MEDIUM confidence
- [Railway Scaling Docs](https://docs.railway.com/reference/scaling) - HIGH confidence
- [Railway Memory Usage Discussion](https://station.railway.com/questions/memory-usage-for-deployed-node-apps-6c2d85b4) - MEDIUM confidence
- [Node.js 20+ Memory Management in Containers (Red Hat)](https://developers.redhat.com/articles/2025/10/10/nodejs-20-memory-management-containers) - HIGH confidence

### WebSocket Auth & Reconnection
- [Ably — Essential Guide to WebSocket Authentication](https://ably.com/blog/websocket-authentication) - MEDIUM confidence
- [Twitch WebSocket Reconnection Discussion](https://discuss.dev.twitch.com/t/websocket-reconnection-question/51406) - MEDIUM confidence

### Serialization & Rate Limiting
- [Performance Analysis: JSON vs Protobuf vs MessagePack for WebSockets](https://dev.to/nate10/performance-analysis-of-json-buffer-custom-binary-protocol-protobuf-and-messagepack-for-websockets-2apn) - MEDIUM confidence
- [Optimizing WebSocket Bandwidth for Games](http://buildnewgames.com/optimizing-websockets-bandwidth/) - MEDIUM confidence
- [Node.js Adaptive Rate Control with Token Buckets](https://medium.com/@2nick2patel2/node-js-adaptive-rate-control-token-buckets-tuned-by-p95-latency-1016a82a28f4) - LOW confidence
- [LLM Serving Bottleneck Strategies](https://medium.com/@kamyashah2018/8-best-strategies-to-overcome-performance-bottlenecks-in-llm-serving-ac516e5b74db) - LOW confidence
