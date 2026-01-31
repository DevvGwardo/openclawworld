# Phase 4: Gateway Integration - Research

**Researched:** 2026-01-31
**Domain:** WebSocket protocol client, challenge-based auth, Gateway RPC
**Confidence:** MEDIUM (protocol structure HIGH, agent method details MEDIUM, some specifics LOW)

## Summary

Phase 4 connects the bot to the OpenClaw Gateway via a typed WebSocket protocol with JSON text frames. The Gateway uses a challenge-based authentication handshake where the server sends a nonce, the client signs it with an Ed25519 private key, and the server responds with a device token for future reconnections.

The Gateway exposes two key RPC methods for agent operations: `agent` (submits work, returns a `runId` immediately) and `agent.wait` (polls for completion). Between submission and completion, the Gateway emits streaming events (`lifecycle`, `assistant`, `tool`) that the client can subscribe to.

The project runs Node.js 22.15.1 with plain JavaScript (ESM). The `ws` library (v8.19.0) is the standard choice for WebSocket clients in Node.js -- while Node 22 has a built-in WebSocket client, `ws` is more battle-tested and offers finer control over ping/pong, binary frames, and error handling. Node's built-in `crypto` module provides Ed25519 key generation and nonce signing with zero additional dependencies.

**Primary recommendation:** Use `ws` for the WebSocket client, Node.js `crypto` for Ed25519 keypair generation and challenge signing, and implement request/response correlation with a pending-request map keyed by request ID.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ws` | ^8.19.0 | WebSocket client | 24k+ dependents, battle-tested, full protocol control, ping/pong support |
| `node:crypto` | built-in | Ed25519 keypair + nonce signing | Native, no dependencies, supports `generateKeyPairSync('ed25519')` and `sign(null, data, key)` |
| `node:events` | built-in | EventEmitter for Gateway events | Already used in BotClient pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `uuid` | ^9.0.0 | Request IDs and idempotency keys | Side-effecting methods require idempotency keys; `crypto.randomUUID()` is also viable |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ws` | Node.js native WebSocket (built-in since v21) | Native WS mirrors browser API -- less control over ping/pong frames; `ws` gives raw frame access needed for protocol compliance |
| `uuid` | `crypto.randomUUID()` | Zero-dep alternative; both produce v4 UUIDs; recommend `crypto.randomUUID()` to avoid extra dependency |

**Installation:**
```bash
npm install ws
```

No other dependencies needed -- `crypto.randomUUID()` replaces `uuid`, and `node:crypto` handles all cryptographic operations.

## Architecture Patterns

### Recommended Project Structure
```
bot/
├── BotClient.js           # Existing game server client (Socket.IO)
├── GatewayClient.js       # NEW: WebSocket client for OpenClaw Gateway
├── DeviceIdentity.js      # NEW: Ed25519 keypair management + challenge signing
├── index.js               # Entry point (existing)
└── .device-keys.json      # NEW: Persisted device keypair + device token (gitignored)
```

### Pattern 1: Request/Response Correlation Map
**What:** Map pending requests by ID to resolve/reject Promise callbacks
**When to use:** Every Gateway RPC call (`agent`, `agent.wait`, `device.token.rotate`, etc.)
**Example:**
```javascript
// Source: standard WebSocket RPC pattern
class GatewayClient extends EventEmitter {
  constructor() {
    super();
    this._pending = new Map(); // id -> { resolve, reject, timer }
    this._nextId = 1;
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = String(this._nextId++);
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, 30000);

      this._pending.set(id, { resolve, reject, timer });

      this._ws.send(JSON.stringify({
        type: 'req',
        id,
        method,
        params
      }));
    });
  }

  _handleMessage(raw) {
    const msg = JSON.parse(raw);
    if (msg.type === 'res') {
      const pending = this._pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this._pending.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.payload);
        } else {
          pending.reject(new Error(msg.error?.message || 'Request failed'));
        }
      }
    } else if (msg.type === 'event') {
      this.emit(msg.event, msg.payload);
    }
  }
}
```

### Pattern 2: Challenge-Response Authentication
**What:** Ed25519 keypair generated once, persisted locally, used to sign server nonces
**When to use:** Every connection/reconnection to the Gateway
**Example:**
```javascript
// Source: Node.js crypto docs + OpenClaw protocol docs
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

function loadOrCreateIdentity(path) {
  if (existsSync(path)) {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return {
      publicKey: crypto.createPublicKey(data.publicKey),
      privateKey: crypto.createPrivateKey(data.privateKey),
      fingerprint: data.fingerprint,
      deviceToken: data.deviceToken || null
    };
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const fingerprint = createHash('sha256').update(pubDer).digest('hex');

  const identity = {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fingerprint,
    deviceToken: null
  };
  writeFileSync(path, JSON.stringify(identity, null, 2));
  return {
    publicKey, privateKey, fingerprint,
    deviceToken: null
  };
}

function signChallenge(nonce, privateKey) {
  const nonceBuffer = Buffer.from(nonce, 'base64');
  const signature = sign(null, nonceBuffer, privateKey);
  return signature.toString('base64');
}
```

### Pattern 3: Reconnection with Exponential Backoff
**What:** Auto-reconnect on close/error with increasing delays, re-authenticate, re-queue in-flight requests
**When to use:** Any dropped WebSocket connection
**Example:**
```javascript
// Source: ws best practices
const BACKOFF = { initial: 1000, max: 30000, factor: 2, jitter: true };

_scheduleReconnect() {
  if (this._reconnectAttempt >= this._maxReconnectAttempts) {
    this.emit('reconnectFailed');
    return;
  }
  const delay = Math.min(
    BACKOFF.initial * Math.pow(BACKOFF.factor, this._reconnectAttempt),
    BACKOFF.max
  );
  const jitter = BACKOFF.jitter ? delay * 0.2 * Math.random() : 0;
  this._reconnectAttempt++;
  setTimeout(() => this.connect(), delay + jitter);
}
```

### Pattern 4: Agent RPC (Submit + Wait)
**What:** Two-step agent invocation: `agent` submits, `agent.wait` polls for result
**When to use:** Sending LLM prompts through the Gateway
**Example:**
```javascript
// Source: docs.openclaw.ai/concepts/agent-loop
async invokeAgent(prompt, options = {}) {
  const idempotencyKey = crypto.randomUUID();

  // Step 1: Submit agent work
  const { runId, acceptedAt } = await this.request('agent', {
    message: prompt,
    idempotencyKey,
    ...options
  });

  // Step 2: Wait for completion
  const result = await this.request('agent.wait', {
    runId,
    timeoutMs: options.timeoutMs || 60000
  });

  // result: { status: 'ok'|'error'|'timeout', startedAt, endedAt, error? }
  return result;
}
```

### Anti-Patterns to Avoid
- **Sending any frame before receiving `connect.challenge`:** Gateway will hard-close the connection. Always wait for the challenge event first.
- **Using `createSign()`/`createVerify()` with Ed25519:** These do NOT work with Ed25519 in Node.js. Must use the one-shot `crypto.sign(null, data, key)` and `crypto.verify(null, data, key, sig)` functions.
- **Hardcoding auth tokens:** All credentials via environment variables (`OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`).
- **Ignoring idempotency keys on side-effecting methods:** Gateway deduplicates by key; omitting them makes retries unsafe.
- **Blocking on `agent.wait` without timeout:** Agent execution can hang; always set a timeout.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ed25519 key generation | Custom crypto | `crypto.generateKeyPairSync('ed25519')` | Built-in, audited, handles encoding |
| UUID generation | Custom ID generator | `crypto.randomUUID()` | Built-in v4 UUID, cryptographically random |
| Nonce signing | Manual buffer manipulation | `crypto.sign(null, buffer, privateKey)` | Ed25519 one-shot API handles padding/hashing |
| WebSocket protocol | Raw TCP/HTTP upgrade | `ws` library | Handles masking, framing, ping/pong, extensions |
| JSON frame parsing | Custom parser | `JSON.parse()` + type checking | Protocol uses standard JSON text frames |

**Key insight:** The entire crypto stack is built into Node.js -- zero external dependencies for authentication. Only `ws` is needed as an external dependency.

## Common Pitfalls

### Pitfall 1: First Frame Must Be connect After Challenge
**What goes wrong:** Client sends a request before completing the handshake
**Why it happens:** Developer wires up message sending before auth completes
**How to avoid:** Gate all `request()` calls behind a `connected` state flag; queue requests until `hello-ok` is received
**Warning signs:** Immediate disconnection after connection opens

### Pitfall 2: Ed25519 sign() Requires null Algorithm
**What goes wrong:** `TypeError: EdDSA algorithm not supported` or similar
**Why it happens:** Passing `'ed25519'` as algorithm to `crypto.sign()` instead of `null`
**How to avoid:** Always use `crypto.sign(null, data, privateKey)` -- Ed25519 has built-in hashing
**Warning signs:** Signature generation throws at runtime

### Pitfall 3: Device Token Not Persisted After First Pairing
**What goes wrong:** Bot requires manual pairing approval on every restart
**Why it happens:** `hello-ok` response contains `auth.deviceToken` but client doesn't save it
**How to avoid:** After receiving `hello-ok`, persist `deviceToken` to `.device-keys.json` immediately
**Warning signs:** Repeated pairing approval requests to the operator

### Pitfall 4: In-Flight Requests Lost on Reconnect
**What goes wrong:** Promises hang forever after a disconnection
**Why it happens:** Pending request map not cleaned up on connection close
**How to avoid:** On WebSocket `close`, reject all pending requests with a reconnection error; let callers retry
**Warning signs:** Unhandled promise rejections, memory leaks in pending map

### Pitfall 5: No Heartbeat Detection for Stale Connections
**What goes wrong:** Connection appears open but is actually dead (half-open TCP)
**Why it happens:** No ping/pong monitoring
**How to avoid:** Use `ws` ping/pong mechanism; if no pong received within tick interval (15s default), terminate and reconnect
**Warning signs:** Bot appears connected but never receives events

### Pitfall 6: Nonce Encoding Mismatch
**What goes wrong:** Signature verification fails on server
**Why it happens:** Nonce is base64-encoded but client signs the string instead of the decoded buffer
**How to avoid:** Decode nonce from base64 to Buffer before signing: `Buffer.from(nonce, 'base64')`
**Warning signs:** Auth handshake fails with signature verification error

## Code Examples

### Complete Handshake Flow
```javascript
// Source: docs.openclaw.ai/gateway/protocol + node:crypto docs
_handleOpen() {
  // Don't send anything -- wait for connect.challenge from server
  this._state = 'awaiting_challenge';
}

_handleMessage(raw) {
  const msg = JSON.parse(raw.toString());

  if (this._state === 'awaiting_challenge' && msg.type === 'event' && msg.event === 'connect.challenge') {
    this._respondToChallenge(msg.payload);
    return;
  }

  if (msg.type === 'hello-ok') {
    this._state = 'connected';
    this._reconnectAttempt = 0;

    if (msg.auth?.deviceToken) {
      this._identity.deviceToken = msg.auth.deviceToken;
      this._persistIdentity();
    }

    this.emit('connected', msg);
    this._flushQueue();  // Send any queued requests
    return;
  }

  // Normal message handling (req/res/event)
  if (msg.type === 'res') {
    this._handleResponse(msg);
  } else if (msg.type === 'event') {
    this.emit(msg.event, msg.payload);
  }
}

_respondToChallenge({ nonce, ts }) {
  const nonceBuffer = Buffer.from(nonce, 'base64');
  const signature = crypto.sign(null, nonceBuffer, this._identity.privateKey);
  const pubKeyPem = this._identity.publicKey.export({ type: 'spki', format: 'pem' });

  const connectFrame = {
    type: 'req',
    id: '0',
    method: 'connect',
    params: {
      protocol: 3,
      client: { name: 'openclawworld-bot', version: '0.1.0' },
      role: 'node',
      auth: {
        token: process.env.OPENCLAW_GATEWAY_TOKEN || undefined,
        deviceToken: this._identity.deviceToken || undefined
      },
      device: {
        id: this._identity.fingerprint,
        publicKey: pubKeyPem,
        signature: signature.toString('base64'),
        signedAt: Date.now(),
        nonce
      }
    }
  };

  this._ws.send(JSON.stringify(connectFrame));
  this._state = 'awaiting_hello';
}
```

### WebSocket Connection Setup with ws
```javascript
// Source: ws npm docs + reconnection best practices
import WebSocket from 'ws';

_createSocket() {
  const url = process.env.OPENCLAW_GATEWAY_URL;
  this._ws = new WebSocket(url);

  this._ws.on('open', () => this._handleOpen());
  this._ws.on('message', (data) => this._handleMessage(data));
  this._ws.on('close', (code, reason) => {
    this._state = 'disconnected';
    this._rejectAllPending(new Error(`Connection closed: ${code}`));
    if (code !== 1000) { // 1000 = normal closure
      this._scheduleReconnect();
    }
  });
  this._ws.on('error', (err) => {
    this.emit('error', err);
  });

  // Heartbeat via ping/pong
  this._ws.on('pong', () => { this._alive = true; });
  this._heartbeat = setInterval(() => {
    if (!this._alive) {
      this._ws.terminate(); // Force close, triggers reconnect
      return;
    }
    this._alive = false;
    this._ws.ping();
  }, 15000); // Match tick interval
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ws` only option for WS client | Node.js built-in WebSocket client available | Node 21 (Oct 2023) | Could drop `ws` dep, but `ws` has better low-level control |
| `crypto.createSign()` for all algos | `crypto.sign()` one-shot for Ed25519 | Node 16+ | Must use one-shot API, `createSign` does not support EdDSA |
| `uuid` package for IDs | `crypto.randomUUID()` built-in | Node 19+ | No external dependency needed |

**Deprecated/outdated:**
- Node.js native WebSocket client is stable in v22 but lacks `ping()` method -- `ws` remains preferred for protocol-level control

## Open Questions

1. **Exact `agent` method parameters**
   - What we know: Method is called `agent`, returns `{ runId, acceptedAt }`. Requires an idempotency key. `agent.wait` polls with `{ runId, timeoutMs }` and returns `{ status, startedAt, endedAt, error? }`
   - What's unclear: Exact parameter names for the prompt/message field, whether session ID is required, what optional parameters exist (model selection, tool permissions, etc.)
   - Recommendation: Start with `{ message: prompt, idempotencyKey }` as minimal params; iterate based on actual Gateway error responses during integration testing. The Gateway source TypeBox schemas (`src/gateway/protocol/schema.ts`) would be the definitive reference.

2. **Streaming events during agent execution**
   - What we know: Three event streams exist: `lifecycle` (start/end/error), `assistant` (text deltas), `tool` (tool execution). These emit as WebSocket events during a run.
   - What's unclear: Whether the client needs to explicitly subscribe to these events, or if they're pushed automatically after an `agent` request. Event payload structure is not fully documented.
   - Recommendation: For Phase 4 success criteria (hardcoded prompt returns parseable JSON), `agent.wait` polling is sufficient. Streaming can be added later.

3. **connect request node capabilities format**
   - What we know: Nodes declare `caps`, `commands`, and `permissions` instead of scopes
   - What's unclear: What capabilities a bot node should declare, format of these fields
   - Recommendation: Start with empty/minimal capabilities; Gateway should reject with a descriptive error if required fields are missing.

4. **Nonce encoding format**
   - What we know: Server sends nonce in `connect.challenge` payload
   - What's unclear: Whether nonce is base64, hex, or raw string
   - Recommendation: Try base64 first (most common for binary nonces); fall back to raw Buffer.from(nonce) if signature verification fails.

## Sources

### Primary (HIGH confidence)
- [docs.openclaw.ai/gateway/protocol](https://docs.openclaw.ai/gateway/protocol) - Frame types, handshake flow, roles, device identity
- [docs.openclaw.ai/concepts/architecture](https://docs.openclaw.ai/concepts/architecture) - Gateway role, node authentication model
- [docs.openclaw.ai/concepts/agent-loop](https://docs.openclaw.ai/concepts/agent-loop) - Agent RPC methods (`agent`, `agent.wait`), streaming events
- [Node.js crypto API](https://nodejs.org/api/crypto.html) - Ed25519 key generation, sign/verify

### Secondary (MEDIUM confidence)
- [docs.openclaw.ai/concepts/agent](https://docs.openclaw.ai/concepts/agent) - Agent runtime, session management
- [docs.openclaw.ai/concepts/session](https://docs.openclaw.ai/concepts/session) - Session lifecycle, policies
- [ws npm package](https://www.npmjs.com/package/ws) - v8.19.0, WebSocket client/server
- [GitHub websockets/ws](https://github.com/websockets/ws) - API reference, ping/pong examples

### Tertiary (LOW confidence)
- [WebSearch: reconnection best practices](https://medium.com/voodoo-engineering/websockets-on-production-with-node-js-bdc82d07bb9f) - Heartbeat patterns, backoff strategies
- [WebSearch: Node.js native WebSocket](https://nodejs.org/en/learn/getting-started/websocket) - Built-in WS client status in Node 22
- Agent method exact parameter names -- inferred from documentation patterns, not explicitly documented

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - `ws` is clearly the standard, `node:crypto` Ed25519 support is documented
- Architecture: HIGH - Protocol frame types and handshake flow are well-documented
- Agent method details: MEDIUM - Method names and flow confirmed, exact params partially documented
- Pitfalls: MEDIUM - Mix of documented gotchas (Ed25519 sign API) and inferred (nonce encoding)

**Research date:** 2026-01-31
**Valid until:** 2026-02-28 (protocol is stable, unlikely to change in 30 days)
