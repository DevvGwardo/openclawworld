# Phase 4: Gateway Integration - Context

**Gathered:** 2026-01-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Connect the bot to the OpenClaw Gateway via WebSocket, complete the challenge-based authentication handshake, send LLM prompts via the `agent` method, and receive structured action responses. Handle reconnection on dropped connections.

**Correction from original roadmap:** The roadmap mentioned "WebSocket with challenge auth" which is accurate. An earlier discussion explored a REST/moltbook pattern — that was a reference example only. The actual Gateway uses a **typed WebSocket protocol** with JSON frames.

</domain>

<decisions>
## Implementation Decisions

### Connection target
- Gateway is **remote** (not localhost) — accessed via Tailscale or SSH tunnel
- Connection URL and port provided via environment variables
- Device pairing will require manual approval (not auto-approved since non-local)
- Remote token (`gateway.remote.token`) needed for authentication

### Authentication mode
- **Claude's discretion** — choose between token-based (`OPENCLAW_GATEWAY_TOKEN`) or password-based based on what works best with the protocol
- Auth credential stored as environment variable, never hardcoded

### Gateway protocol (from docs.openclaw.ai)
- **Transport:** WebSocket with text frames containing JSON
- **Handshake flow:**
  1. Server sends `connect.challenge` event with nonce + timestamp
  2. Client sends `connect` request with: protocol version (3), client info, role, scopes, auth token, device identity (fingerprint, public key, signed nonce)
  3. Server responds with `hello-ok` including tick interval and policy
  4. On first pairing: response includes `auth.deviceToken` for future reconnections
- **Frame types:**
  - Request: `{type:"req", id, method, params}`
  - Response: `{type:"res", id, ok, payload|error}`
  - Event: `{type:"event", event, payload, seq?, stateVersion?}`
- **Role:** "node" (bot is a node client, not an operator)
- **Side-effecting methods require idempotency keys** for safe retry

### LLM prompt method
- The `agent` method is used for agent operations (sending prompts, receiving decisions)
- **Exact method params and response format: discover during research** — check Gateway source/docs for the `agent` method schema
- This is a known unknown that the researcher needs to resolve

### API key lifecycle
- Keys expire periodically — need token rotation support
- Device claim is one-time (human approves pairing once, then bot reconnects with device token)
- Device token rotation via `device.token.rotate` method

### Subscribable events
- `tick` — periodic heartbeat (15s default interval)
- `agent` — agent execution updates
- `presence` — availability changes
- `shutdown` — system halt notifications

### Claude's Discretion
- WebSocket client library choice (ws, undici, etc.)
- Exact reconnection backoff strategy
- Device key generation approach (crypto keypair for challenge signing)
- How to handle in-flight requests during reconnection

</decisions>

<specifics>
## Specific Ideas

- Reference docs: https://docs.openclaw.ai/concepts/architecture and https://docs.openclaw.ai/gateway/protocol
- Protocol is defined by TypeBox schemas in the Gateway source — researcher should look for these
- The `www.moltbook.com` pattern (register → claim → Bearer REST) was a reference example for how bots connect to services generally, NOT the actual Gateway protocol
- Security: non-local connections must cryptographically sign the server-provided nonce

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-gateway-integration*
*Context gathered: 2026-01-31*
