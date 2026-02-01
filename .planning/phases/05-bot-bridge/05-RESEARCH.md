# Phase 5: Bot Bridge - Research

**Researched:** 2026-01-31
**Domain:** Autonomous agent perception-decision-action loop, runtime validation, rate limiting, structured logging
**Confidence:** HIGH

## Summary

Phase 5 wires the core autonomy loop: the bot perceives the world state from BotClient events, serializes it into a compact text prompt, sends it to the Gateway's LLM via `GatewayClient.invokeAgent()`, validates the returned action JSON with Zod, rate-limits execution, and dispatches actions through BotClient methods. All three building blocks already exist (BotClient for game I/O, GatewayClient for LLM invocation); this phase bridges them with perception, validation, rate limiting, idle behavior, lifecycle management, and structured logging.

The standard stack for this is minimal: Zod for action schema validation, the `limiter` npm package for token-bucket rate limiting, and Pino for structured JSON logging. The perception-decision-action loop itself is a bespoke orchestrator -- no framework needed because the game protocol (Socket.IO events) and LLM protocol (Gateway RPC) are already abstracted by earlier phases.

**Primary recommendation:** Build a single `BotBridge` orchestrator class that owns the loop, with thin helper modules for perception serialization, action validation (Zod schema), rate limiting (limiter TokenBucket), and logging (Pino). Keep it simple -- one file per concern, no framework.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | ^3.24 | Discriminated union schema for LLM action validation | Industry standard runtime validation; works in plain JS ESM; discriminatedUnion optimizes parsing by discriminator key |
| pino | ^10.3 | Structured JSON logging for perception-decision-action cycles | 5x faster than Winston; JSON by default; child logger support for per-bot context; Fastify's default logger |
| limiter | ^3.0 | Token bucket rate limiting for bot actions | Mature, ESM-compatible; provides both async `removeTokens()` and sync `tryRemoveTokens()` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino-pretty | ^13.0 | Human-readable log output in development | Development only -- never in production; activated via `BOT_LOG_PRETTY=1` env var |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| zod | ajv / joi | Zod has cleaner discriminatedUnion API; works without TypeScript; smaller API surface for this use case |
| limiter | Custom token bucket | Token bucket looks simple but edge cases (concurrent access, timer drift) make a library worthwhile |
| pino | winston / console.log | Pino's JSON-by-default and child logger pattern match the structured logging requirement perfectly |

**Installation:**
```bash
cd bot && npm install zod pino pino-pretty limiter
```

Note: `pino-pretty` is a devDependency for local development only.

## Architecture Patterns

### Recommended Project Structure
```
bot/
├── BotClient.js          # [existing] Game server socket.io client
├── GatewayClient.js      # [existing] OpenClaw Gateway WebSocket client
├── DeviceIdentity.js     # [existing] Ed25519 identity management
├── BotBridge.js          # [new] Main orchestrator: perception-decision-action loop
├── perception.js         # [new] World state snapshot + serialization to text
├── actions.js            # [new] Zod schema, validation, action execution
├── rateLimiter.js        # [new] Token bucket wrapper for bot actions
├── logger.js             # [new] Pino logger factory (root + child loggers)
├── idle.js               # [new] Idle patrol behavior (random waypoint walking)
├── index.js              # [modified] Entry point: create BotBridge, start loop
├── gateway-test.js       # [existing] Gateway integration test
└── package.json          # [modified] New dependencies
```

### Pattern 1: Perception-Decision-Action Loop (Orchestrator)
**What:** A single orchestrator class (`BotBridge`) owns the main loop. It calls perception, sends to Gateway, validates response, rate-limits, and executes. The loop runs on a hybrid timer: fixed interval baseline (e.g., 3 seconds) plus immediate triggers on incoming chat directed at the bot.

**When to use:** This is THE pattern for Phase 5 -- it is the phase.

**Example:**
```javascript
// BotBridge.js -- simplified loop structure
class BotBridge {
  constructor({ botClient, gatewayClient, logger }) {
    this.bot = botClient;
    this.gw = gatewayClient;
    this.log = logger.child({ component: 'bridge' });
    this.rateLimiter = new TokenBucket({ bucketSize: 3, tokensPerInterval: 1, interval: 'second' });
    this.recentActions = [];  // Last 5 own actions (self-memory)
    this.chatBuffer = [];     // Recent chat messages with timestamps
    this.loopTimer = null;
    this.state = 'idle';      // idle | deciding | executing
  }

  async tick() {
    const perception = this.buildPerception();
    if (!perception.nearbyPlayers.length && this.state === 'idle') {
      this.patrol();           // No one around, keep wandering
      return;
    }

    this.state = 'deciding';
    const startMs = Date.now();
    try {
      const prompt = serializePerception(perception);
      const result = await this.gw.invokeAgent(prompt);
      const latencyMs = Date.now() - startMs;

      const parsed = actionSchema.safeParse(result);
      if (!parsed.success) {
        // Retry once
        const retry = await this.gw.invokeAgent(prompt);
        const retryParsed = actionSchema.safeParse(retry);
        if (!retryParsed.success) {
          this.log.warn({ errors: retryParsed.error.issues }, 'Invalid LLM action after retry, falling back to patrol');
          this.patrol();
          return;
        }
        parsed = retryParsed;
      }

      this.log.info({ perception: prompt.length, action: parsed.data, latencyMs }, 'decision-cycle');
      await this.executeAction(parsed.data);
    } catch (err) {
      this.log.error({ err }, 'Decision cycle failed');
      this.patrol();
    } finally {
      this.state = 'idle';
    }
  }
}
```

### Pattern 2: Discriminated Union for Action Validation
**What:** All LLM actions share a `type` discriminator field. Zod's `discriminatedUnion` parses efficiently by checking the type first, then validating the specific shape.

**When to use:** Every LLM response must pass through this schema before execution.

**Example:**
```javascript
// actions.js
import { z } from 'zod';

const moveAction = z.object({
  type: z.literal('move'),
  target: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
});

const sayAction = z.object({
  type: z.literal('say'),
  message: z.string().min(1).max(200),
});

const emoteAction = z.object({
  type: z.literal('emote'),
  emote: z.enum(['wave', 'dance', 'sit', 'nod']),
});

const lookAction = z.object({
  type: z.literal('look'),
  targetPlayerId: z.string(),
});

export const actionSchema = z.discriminatedUnion('type', [
  moveAction,
  sayAction,
  emoteAction,
  lookAction,
]);
```

### Pattern 3: Token Bucket Rate Limiter Wrapper
**What:** Wrap the `limiter` TokenBucket to queue excess actions rather than drop them, matching the "rate-limited actions: queue and execute later" decision.

**When to use:** Every action execution must go through the rate limiter.

**Example:**
```javascript
// rateLimiter.js
import { TokenBucket } from 'limiter';

export class ActionRateLimiter {
  constructor({ burst = 3, sustained = 1 } = {}) {
    this.bucket = new TokenBucket({
      bucketSize: burst,
      tokensPerInterval: sustained,
      interval: 'second',
    });
    this.queue = [];
    this.processing = false;
  }

  async execute(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._drain();
    });
  }

  async _drain() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      await this.bucket.removeTokens(1);
      const { fn, resolve, reject } = this.queue.shift();
      try { resolve(await fn()); } catch (e) { reject(e); }
    }
    this.processing = false;
  }
}
```

### Pattern 4: Pino Child Logger Per Bot
**What:** Create a root Pino logger, then derive child loggers with `botId` context for each bot instance. Every log line from that bot automatically includes its ID.

**When to use:** Logger factory called once at startup; child created per BotBridge instance.

**Example:**
```javascript
// logger.js
import pino from 'pino';

export function createLogger(opts = {}) {
  const level = process.env.BOT_LOG_LEVEL || 'info';
  const pretty = process.env.BOT_LOG_PRETTY === '1';

  return pino({
    level,
    ...(pretty && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
    base: { service: 'openclaw-bot' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
```

### Pattern 5: Perception Snapshot with Nearby Filter
**What:** At each tick, snapshot the world state from BotClient's cached data (characters, chat buffer), filter to nearby players within a radius, and serialize to compact text.

**When to use:** Called at the start of every perception-decision-action cycle.

**Example:**
```javascript
// perception.js
const PERCEPTION_RADIUS = 6; // grid units -- roughly half the 14x14 grid

export function buildPerception(bot, chatBuffer, recentActions) {
  const pos = bot.position;
  const nearby = bot.characters
    .filter(c => c.id !== bot.id)
    .filter(c => gridDistance(pos, c.position) <= PERCEPTION_RADIUS)
    .map(c => ({
      name: c.name || `Player-${c.id.slice(0, 4)}`,
      position: c.position,
      isBot: c.isBot,
      moving: Array.isArray(c.path) && c.path.length > 0,
    }));

  const recentChat = chatBuffer
    .filter(m => Date.now() - m.timestamp < 60_000)
    .map(m => `${m.name}: ${m.message}`);

  return { nearby, recentChat, selfActions: recentActions.slice(-5), selfPosition: pos };
}

export function serializePerception(perception) {
  const lines = [];
  lines.push(`You are at position [${perception.selfPosition}].`);
  if (perception.nearby.length) {
    lines.push('Nearby:');
    for (const p of perception.nearby) {
      lines.push(`- ${p.name} at [${p.position}]${p.moving ? ' (moving)' : ''}`);
    }
  } else {
    lines.push('No one is nearby.');
  }
  if (perception.recentChat.length) {
    lines.push('Recent chat:');
    for (const msg of perception.recentChat) {
      lines.push(`- ${msg}`);
    }
  }
  if (perception.selfActions.length) {
    lines.push('Your recent actions:');
    for (const a of perception.selfActions) {
      lines.push(`- ${a.type}: ${JSON.stringify(a)}`);
    }
  }
  return lines.join('\n');
}

function gridDistance(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); // Chebyshev distance
}
```

### Anti-Patterns to Avoid
- **Polling the server for state:** BotClient already receives push events via Socket.IO. Don't add HTTP polling -- use the event-driven state that BotClient caches in `this.characters` and `this.position`.
- **Blocking the loop on LLM response:** The idle patrol must continue while waiting for the Gateway response. Use an async pattern where patrol runs on its own timer and the LLM response interrupts it when ready.
- **Giant monolithic file:** The loop, perception, validation, rate limiting, and logging should be separate modules. The BotBridge orchestrator composes them.
- **Parsing LLM text output as JSON manually:** The Gateway's `invokeAgent` returns a structured result. Rely on Zod `.safeParse()` for validation, not manual `JSON.parse()` with try/catch.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token bucket rate limiting | Custom setInterval counter | `limiter` TokenBucket | Handles concurrent token removal, sub-second precision, edge cases around timer drift |
| Action schema validation | if/else chains or manual JSON.parse | Zod discriminatedUnion | Type-safe, exhaustive validation, clear error messages, handles nested objects cleanly |
| Structured JSON logging | console.log with JSON.stringify | Pino | Automatic timestamps, levels, child logger context, async transports, 5x faster |
| Backoff/retry for LLM failures | Manual setTimeout chains | Already built into GatewayClient reconnect | Reconnection is handled; only need simple "retry once then fallback" for bad JSON |

**Key insight:** The complexity in this phase is in the orchestration and edge cases (LLM timeout, invalid JSON, gateway disconnect mid-decision, rate limiter queue draining), not in any single component. Using established libraries for validation, rate limiting, and logging frees you to focus on the orchestration logic.

## Common Pitfalls

### Pitfall 1: LLM Response Not Being Valid JSON
**What goes wrong:** The LLM returns markdown-wrapped JSON (```json\n{...}\n```), or prose with embedded JSON, or completely hallucinated actions.
**Why it happens:** LLMs are probabilistic -- even with structured prompts, they occasionally deviate.
**How to avoid:** Parse the Gateway response with `JSON.parse()` first (handle non-JSON), then validate with Zod `safeParse()`. On first failure, retry once with same prompt. On second failure, fall back to idle patrol. Never crash.
**Warning signs:** Frequent "Invalid LLM action after retry" warnings in logs.

### Pitfall 2: Repetitive Bot Behavior
**What goes wrong:** Bot says "Hello!" over and over, or walks to the same spot repeatedly.
**Why it happens:** Without self-memory, each LLM call has no context about what the bot just did.
**How to avoid:** Include last 5 bot actions in the perception text. The LLM sees what it recently did and can vary behavior.
**Warning signs:** Log shows identical actions in consecutive cycles.

### Pitfall 3: Bot Freezes While Waiting for LLM
**What goes wrong:** Bot stands still for 5-30 seconds while the LLM processes, looking broken to human players.
**Why it happens:** The decision cycle blocks the bot's visible behavior.
**How to avoid:** Run idle patrol on a separate timer that continues during LLM invocation. When the LLM response arrives, it interrupts the current patrol waypoint. The bot looks alive even when "thinking."
**Warning signs:** Bot has long stationary periods visible in the game.

### Pitfall 4: Chat Buffer Memory Leak
**What goes wrong:** Chat buffer grows unbounded over long bot sessions.
**Why it happens:** Messages are added but never pruned.
**How to avoid:** Prune chat buffer entries older than 60 seconds at every tick. Use a time-bounded ring buffer or simple filter-on-read.
**Warning signs:** Memory usage growing linearly over time in long sessions.

### Pitfall 5: Race Condition Between Patrol and LLM Action
**What goes wrong:** Bot is mid-patrol-move when LLM says "move to [3,5]" -- bot tries to execute two moves simultaneously.
**Why it happens:** Patrol and decision loops run concurrently without coordination.
**How to avoid:** When an LLM action arrives, cancel the current patrol waypoint before executing the LLM action. Use a simple state flag (`idle` | `deciding` | `executing`) to coordinate.
**Warning signs:** Bot path visually "snaps" or server rejects rapid sequential moves.

### Pitfall 6: Gateway Disconnect During Decision
**What goes wrong:** Gateway drops mid-invokeAgent, the promise rejects, bot enters error state and stops.
**Why it happens:** Network instability or Gateway restart.
**How to avoid:** Catch invokeAgent errors, fall back to idle patrol, rely on GatewayClient's auto-reconnect. Check `gw.connected` before attempting decisions. When gateway is down, bot should silently patrol.
**Warning signs:** Repeated "Decision cycle failed" errors followed by bot inactivity.

## Code Examples

### Complete Perception Serialization (Token-Aware)
```javascript
// Target: ~500 tokens max perception text
// Rough estimate: 1 token ~= 4 characters
const MAX_PERCEPTION_CHARS = 2000; // ~500 tokens

export function serializePerception(perception) {
  const lines = [];
  lines.push(`You are at [${perception.selfPosition}].`);

  // Nearby players (most important -- always included)
  if (perception.nearby.length) {
    for (const p of perception.nearby) {
      const status = p.moving ? ' moving' : '';
      lines.push(`${p.name} at [${p.position}]${status}`);
    }
  } else {
    lines.push('No one nearby.');
  }

  // Recent chat (second priority)
  if (perception.recentChat.length) {
    lines.push('Chat:');
    for (const msg of perception.recentChat) {
      lines.push(`> ${msg}`);
    }
  }

  // Self-memory (third priority -- truncate first if over budget)
  if (perception.selfActions.length) {
    lines.push('Your recent actions:');
    for (const a of perception.selfActions) {
      lines.push(`- ${a.type}${a.message ? ': ' + a.message : ''}`);
    }
  }

  let text = lines.join('\n');
  if (text.length > MAX_PERCEPTION_CHARS) {
    // Truncate self-actions first, then chat, preserving nearby players
    text = text.slice(0, MAX_PERCEPTION_CHARS);
  }
  return text;
}
```

### Action Execution Dispatcher
```javascript
// actions.js -- execute validated action via BotClient
export async function executeAction(bot, action, rateLimiter, log) {
  await rateLimiter.execute(async () => {
    switch (action.type) {
      case 'move':
        bot.move(action.target);
        log.info({ action: 'move', target: action.target }, 'bot-action');
        break;
      case 'say':
        bot.say(action.message);
        log.info({ action: 'say', message: action.message }, 'bot-action');
        break;
      case 'emote':
        bot.emote(action.emote);
        log.info({ action: 'emote', emote: action.emote }, 'bot-action');
        break;
      case 'look':
        // "look" = face a player without walking over
        // Implementation: emit a lightweight event or just log intent
        // The server doesn't have a native "look at" -- this could be
        // a no-movement-move to a nearby cell facing the target, or
        // a custom socket event added in a future phase.
        log.info({ action: 'look', target: action.targetPlayerId }, 'bot-action');
        break;
    }
  });
}
```

### Bot Lifecycle Manager
```javascript
// BotBridge lifecycle states: spawning -> active -> idle -> disconnecting -> disconnected
async start() {
  this.state = 'spawning';
  this.log.info('Bot bridge starting');

  // Connect to both services
  await this.bot.connect();
  const room = this.bot.rooms[0];
  if (!room) throw new Error('No rooms available');
  await this.bot.join(room.id);

  // Wire up event listeners for perception
  this.bot.on('chatMessage', (msg) => this._onChat(msg));
  this.bot.on('characters', (chars) => this._onCharactersUpdate(chars));
  this.bot.on('disconnected', () => this._onDisconnect());

  this.state = 'active';
  this.log.info({ roomId: room.id, position: this.bot.position }, 'Bot joined room');

  // Start the main loop
  this._startLoop();
}

async stop() {
  this.state = 'disconnecting';
  this._stopLoop();
  this.bot.leave();
  this.bot.disconnect();
  this.gw.disconnect();
  this.state = 'disconnected';
  this.log.info('Bot bridge stopped');
}
```

### Idle Patrol Behavior
```javascript
// idle.js -- random waypoint patrol
export class IdlePatrol {
  constructor(bot, { intervalMs = 4000 } = {}) {
    this.bot = bot;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.active = false;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this._walk();
  }

  stop() {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  _walk() {
    if (!this.active) return;
    const pos = this._randomWalkable();
    if (pos) {
      try { this.bot.move(pos); } catch {}
    }
    this.timer = setTimeout(() => this._walk(), this.intervalMs);
  }

  _randomWalkable() {
    // Room grid is 7*2 = 14 units on each side
    const gridSize = 14;
    for (let i = 0; i < 20; i++) {
      const x = Math.floor(Math.random() * gridSize);
      const y = Math.floor(Math.random() * gridSize);
      // Can't validate walkability client-side without the grid,
      // but the server will reject invalid moves via pathfinding.
      // Just pick random positions within bounds.
      return [x, y];
    }
    return null;
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual JSON.parse + if/else validation | Zod discriminatedUnion | Zod 3.x (2022+) | Type-safe, exhaustive, clear errors |
| Winston/Bunyan logging | Pino structured JSON logging | Pino 7+ (2021+) | 5x performance, worker thread transports |
| Custom rate limiter setInterval | `limiter` TokenBucket | limiter 2+ (2020+) | Handles edge cases, async/sync API |
| ReAct multi-turn agent loops | Simple request/response via Gateway | Project-specific | OpenClaw Gateway handles the LLM orchestration; bot just sends perception, gets action back |

**Deprecated/outdated:**
- Zod 3's `.merge()` is deprecated in Zod 4 -- use `.extend()` instead. For this project, Zod 3.24 is sufficient and avoids Zod 4 ecosystem compatibility issues.
- `console.log` for structured logging -- Pino replaces this entirely in the bot process.

## Discretion Recommendations

These are the areas marked as "Claude's Discretion" in the context, with research-backed recommendations:

### Perception Radius: 6 Grid Units (Chebyshev Distance)
The room grid is 7x7 tiles with gridDivision=2, yielding a 14x14 grid. A radius of 6 grid units means the bot can "see" about 43% of the room's diagonal. This is large enough to notice players approaching but small enough to create a sense of spatial awareness (not omniscient).

### Serialization Format: Line-Based Plain Text
Compact line-based text (not JSON, not XML) minimizes token usage. Each player is one line, each chat message is one line. Target ~500 tokens (~2000 characters). Priority order: self-position > nearby players > recent chat > self-memory.

### Token Budget: 2000 Characters (~500 Tokens)
Based on the requirement of ~500 tokens max. Truncation priority: drop self-actions first, then old chat messages, never drop nearby player info.

### Single vs Multi-Action: Single Action Per Response
Simpler to validate, rate-limit, and execute. One Zod parse, one rate limiter check, one BotClient call. The loop runs frequently enough (every 3s baseline + immediate triggers) that single actions feel responsive.

### Idle-to-Engaged Transition: Distance-Based Trigger
When a player enters perception radius, the next tick automatically includes them in the perception text. The LLM naturally shifts from idle patrol to engagement. No special transition logic needed -- the perception content change drives the behavior change.

### Loop Interval: 3-Second Baseline + Immediate Chat Trigger
3 seconds is fast enough for responsive behavior (2-4 Hz perception per requirement, but LLM round-trips will gate actual decision rate). Immediate trigger on incoming chat gives snappy conversation feel.

### Rate Limiter: Burst 3, Sustained 1/sec
Matches roadmap specification. TokenBucket with `bucketSize: 3, tokensPerInterval: 1, interval: 'second'`.

### Pino Configuration
- Root logger with `service: 'openclaw-bot'` base field
- ISO timestamps for log aggregation
- `BOT_LOG_LEVEL` env var (default: `info`)
- `BOT_LOG_PRETTY` env var for development (default: off)
- Child loggers with `botId`, `component` context fields

## Open Questions

1. **"Look" action server implementation**
   - What we know: The server has no native "look at" or "face direction" socket event. BotClient has `move()`, `say()`, `emote()` but no `look()`.
   - What's unclear: How to implement "look at a player without walking over" given the current server protocol.
   - Recommendation: For v1, implement "look" as a no-op that logs intent but doesn't move. Or, emit a very short move toward the target (1 grid cell in their direction) to simulate facing them. This can be refined in Phase 7 when personality/expressiveness is added. The action schema should still include it so the LLM vocabulary is established.

2. **Gateway invokeAgent response format**
   - What we know: `GatewayClient.invokeAgent(prompt)` returns the agent result payload. The gateway-test.js treats it as a generic object.
   - What's unclear: Whether the Gateway returns raw LLM text (needing JSON.parse), or pre-parsed JSON, or a wrapper with the LLM output nested inside.
   - Recommendation: Add a response extraction step that handles both cases: if result is a string, `JSON.parse()` it; if it's already an object, use directly. Then pass to Zod validation. Test against live Gateway to confirm.

3. **Multi-action LLM responses (future consideration)**
   - What we know: Decision is single action per response for v1.
   - What's unclear: Whether the LLM will naturally try to return multiple actions even when prompted for one.
   - Recommendation: The Zod schema validates a single action object. If the LLM returns an array, take the first element. Log a warning for monitoring.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `bot/BotClient.js`, `bot/GatewayClient.js`, `bot/DeviceIdentity.js`, `server/index.js` -- direct code reading
- [Zod official docs](https://zod.dev/api) -- discriminatedUnion API, safeParse, ESM usage
- [Pino GitHub](https://github.com/pinojs/pino) -- v10.3.0, child loggers, structured JSON output
- [limiter GitHub](https://github.com/jhurliman/node-rate-limiter) -- TokenBucket API, removeTokens/tryRemoveTokens

### Secondary (MEDIUM confidence)
- [Zod release notes](https://zod.dev/v4) -- Zod 3 vs 4 ecosystem status, migration considerations
- [SigNoz Pino guide](https://signoz.io/guides/pino-logger/) -- Pino best practices, dev vs production config
- [Better Stack Pino guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/) -- child logger patterns, structured logging
- [Token bucket pattern articles](https://kendru.github.io/javascript/2018/12/28/rate-limiting-in-javascript-with-a-token-bucket/) -- algorithm confirmation

### Tertiary (LOW confidence)
- [LLM agent architecture patterns](https://lilianweng.github.io/posts/2023-06-23-agent/) -- perception-action loop design patterns (academic, not directly applicable to this specific game protocol)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Zod, Pino, limiter are well-documented, actively maintained, verified via official sources
- Architecture: HIGH -- Architecture patterns derived directly from existing codebase (BotClient/GatewayClient APIs) and locked user decisions
- Pitfalls: HIGH -- Pitfalls derived from the specific codebase constraints (Socket.IO events, Gateway RPC, grid system) and common LLM integration issues

**Research date:** 2026-01-31
**Valid until:** 2026-03-01 (60 days -- stable libraries, no fast-moving dependencies)
