---
phase: 04-gateway-integration
plan: 01
subsystem: gateway
tags: [ws, ed25519, websocket, rpc, crypto]

requires:
  - phase: 03-headless-bot-client
    provides: "BotClient pattern (EventEmitter, ESM)"
provides:
  - "DeviceIdentity module for Ed25519 keypair management"
  - "GatewayClient with challenge auth and agent RPC"
affects: [04-02-reconnection, 05-bot-bridge]

tech-stack:
  added: [ws]
  patterns: [request-response-correlation, challenge-auth-handshake]

key-files:
  created: [bot/DeviceIdentity.js, bot/GatewayClient.js]
  modified: [bot/package.json, .gitignore]

key-decisions:
  - "Ed25519 signing via crypto.sign(null) -- Ed25519 requires null algorithm parameter"
  - "Connect request uses reserved id '0' to distinguish auth from normal RPC"
  - "Pre-auth request queuing with automatic flush on hello-ok"

duration: 1min
completed: 2026-01-31
---

# Phase 4 Plan 1: DeviceIdentity and GatewayClient Summary

**Ed25519 device identity with challenge-auth WebSocket client and two-step agent RPC via ws library**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~1 min |
| Tasks | 2/2 |
| Deviations | 0 |

## Accomplishments

1. **DeviceIdentity module** -- generates Ed25519 keypairs, persists to disk as PEM, computes SHA-256 fingerprint from SPKI DER export, signs challenge nonces
2. **GatewayClient class** -- full WebSocket client extending EventEmitter with:
   - Challenge-based auth handshake (connect.challenge -> connect -> hello-ok)
   - Request/response correlation via pending map with 30s timeouts
   - Pre-auth request queue that flushes automatically on successful auth
   - Two-step `invokeAgent(prompt)` RPC (agent + agent.wait)
   - Device token persistence after first pairing
   - Graceful disconnect with pending request cleanup

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | DeviceIdentity module and project setup | `2c59537` | bot/DeviceIdentity.js, bot/package.json, .gitignore |
| 2 | GatewayClient with auth handshake and agent RPC | `a0c5738` | bot/GatewayClient.js |

## Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| bot/DeviceIdentity.js | Created | Ed25519 keypair management, challenge signing, disk persistence |
| bot/GatewayClient.js | Created | WebSocket Gateway client with auth and RPC |
| bot/package.json | Modified | Added ws dependency |
| .gitignore | Modified | Added .device-keys.json pattern |

## Decisions Made

1. **Ed25519 signing uses `crypto.sign(null, ...)`** -- Ed25519 does not support createSign/algorithm parameter; must pass null
2. **Connect request uses reserved id "0"** -- distinguishes auth handshake from normal RPC traffic in message routing
3. **Pre-auth queue flush** -- requests made before auth completes are queued and replayed automatically, so callers don't need to wait for connection

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required for module loading. Gateway URL and token are read from environment variables at runtime.

## Next Phase Readiness

- **04-02 (Reconnection):** GatewayClient has clear state management and disconnect handling; reconnection logic can wrap the connect() flow
- **05 (Bot Bridge):** invokeAgent() is ready to be called from the bridge layer that connects BotClient perception to LLM decisions
