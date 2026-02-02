## Energy + Eating Plan (OpenClawWorld)

### Goals
- Fix the player HUD energy bar so it reliably decreases over time (and reflects server truth quickly, not in chunky/laggy steps).
- Add an "Eat" interaction for players when they are inside an apartment room: walk to the stove if present; otherwise walk to the center of the room; then perform the eat/cook interaction.
- Update tired/need icons so that once energy is depleted the visuals clearly reflect "exhausted" (and the other need symbols remain consistent).

### Current Observations (Likely Root Causes)
- Server-side decay runs at 1Hz and clamps motives: `server/motiveSystem.js`.
- The server only broadcasts `motives:update` when a motive crosses a 10% bucket boundary (every ~10s with current `DECAY_RATES.energy = 1`): `server/motiveSystem.js`.
- The HUD energy bar in `client/src/components/UI.jsx` is driven by `characterMotivesAtom[user].energy`. With 10% threshold broadcasts, the bar can look “stuck” for long stretches.
- Current decay rates are extremely fast (energy drains from 100 -> 0 in ~100 seconds), which can also feel “bugged” even when it’s technically working.

### Success Criteria
- Energy bar changes smoothly (at least every second visually) while still respecting server authority.
- Energy value is correct after:
  - joining a room
  - switching rooms
  - canceling/finishing an interaction
  - reconnecting
- "Eat" is available in apartment rooms (generated rooms or `room-*`), and:
  - uses `kitchenStove` if present
  - otherwise uses a center-of-room eat spot
  - visibly walks the player to the target area before the interaction starts
- Tired/exhausted icon behavior is unambiguous:
  - low energy => tired
  - zero energy => exhausted

---

## Implementation Plan

### 1) Reproduce + Confirm Data Flow
- Run client + server.
- In an apartment room, watch:
  - server motive values (temporary logging in `server/motiveSystem.js` for a single character)
  - client `characterMotivesAtom` updates (React DevTools / console)
  - HUD bar in `client/src/components/UI.jsx`
- Confirm whether the issue is:
  - no decay happening, or
  - decay happening but HUD not updating smoothly (most likely), or
  - decay too fast / unreadable.

### 2) Make HUD Energy Update Smoothly (Without Spamming the Network)
Recommended approach: client-side interpolation for the local HUD only.

- Add a small "motive baseline" state for the local player:
  - store last server-received motives + timestamp
  - compute displayed energy as: `energy - DECAY_RATES.energy * dt` (clamped)
  - reset baseline whenever a server `motives:update` or `character:stateChange` arrives for the local player.
- Wire this into `client/src/components/UI.jsx` so `myEnergy` is derived from the interpolated value.
- Keep other players/bots on the existing bucketed updates (no extra load).

Files likely touched:
- `client/src/components/UI.jsx`
- `client/src/components/SocketManager.jsx` (or a small new client hook/module to track baseline timestamps)
- `shared/roomConstants.js` (import `DECAY_RATES` client-side for consistent math)

### 3) Normalize Decay Rates (So “Working” Doesn’t Feel “Broken”)
- Reduce motive decay to human-timescale:
  - e.g. energy drain over ~10-20 minutes instead of ~100 seconds.
- Update constants in BOTH:
  - `shared/roomConstants.js`
  - `server/shared/roomConstants.js`
- Ensure interactions still feel meaningful with new rates (bed/stove gains vs drain).

### 4) Add "Eat" Flow for Apartment Rooms
We already have server support for object interactions:
- `server/socketHandlers.js` supports `interact:object` and validates the item exists in the room.
- `shared/roomConstants.js` has affordances for `kitchenStove` and `kitchenFridge`.

Client behavior requirements:
- Show an "Eat" button only when in an apartment room (generated room or `room-*`).
- When clicked:
  1. Choose target:
     - if room has `kitchenStove`, target it
     - else target a center-of-room "eat spot"
  2. Walk to a valid nearby walkable tile.
  3. Once arrived, trigger the interaction.

Design choice (recommended for correctness): add a small “arrived” handshake.
- Client local avatar already knows when its path completes (`client/src/components/Avatar.jsx`).
- Add a local-only queued interaction atom/state:
  - UI sets "I want to eat".
  - Room initiates movement to the computed destination.
  - Avatar, when it detects path completion for the local player, emits `socket.emit("interact:object", { itemName: "kitchenStove" })`.

Handling no-stove case:
- Option A (recommended): add a synthetic, invisible affordance `eatSpot`.
  - Add `eatSpot` to `OBJECT_AFFORDANCES`.
  - Allow `interact:object` to accept `eatSpot` without an item present OR auto-insert an invisible marker item into apartment rooms at spawn.
  - This keeps the server authoritative and avoids client-only “fake eating”.
- Option B: fallback to `kitchenFridge` if present; if neither stove nor fridge exists, show a toast explaining no food source is available.

Files likely touched:
- `client/src/components/UI.jsx` (button)
- `client/src/components/Room.jsx` (compute targets + initiate move)
- `client/src/components/Avatar.jsx` (emit interaction on path completion)
- `server/socketHandlers.js` (support synthetic eat spot if used)
- `shared/roomConstants.js` and `server/shared/roomConstants.js` (if adding `eatSpot` affordance)

### 5) Update Tired/Need Symbols
- Update the icon logic in `client/src/components/Avatar.jsx`:
  - Add explicit handling for `energy <= 0` (exhausted icon) vs `energy < threshold` (tired icon).
  - Keep the interaction-based emoji mapping for sleeping/cooking/etc.
- Update the player HUD (energy bar area) to show a tired/exhausted indicator when energy is low/empty.

---

## Verification Checklist
- Join an apartment room and confirm the energy bar visibly decreases every second.
- Confirm server motive values match the HUD (allowing for small interpolation error, corrected at each server update).
- Confirm "Eat" button:
  - appears only in apartment rooms
  - walks you to stove if present
  - otherwise walks you to center (or the configured eat spot)
  - starts the interaction at the end of the walk
- Confirm icons:
  - low energy shows tired
  - zero energy shows exhausted
  - cooking/sleeping icons still show when interacting

## Notes / Open Decisions
- Whether "Eat" should restore only `hunger` (Sims-like) or also a small amount of `energy`.
- If we implement `eatSpot`, decide whether to:
  - allow interaction without a real item present (server exception), or
  - auto-place an invisible marker item in every generated apartment.

---

## Bot Inbox + DM Replies Plan

### Scope Goals
- Add an inbox-style DM entry point with a message icon button and a red badge showing count of unique senders (users + bots) with unread messages.
- Allow bots to DM users and reply to user DMs, but only for bots connected via the skill integration or official bot flow.

### Plan
- [x] Inspect current DM flow and bot connection/auth paths to determine how to identify allowed bot senders (skill-based vs official).
- [x] Define inbox state shape (threads, unread counts) and map it to existing `directMessage` events without breaking current DM panel.
- [x] Add UI message button + badge and wire it to open inbox/DM panel with unread clearing rules.
- [x] Route direct messages to bots so the bot bridge can reply to DMs (new event handler + action mapping).
- [x] Enforce allowed bot sender checks in server DM path and client display logic.
- [ ] Verify DM replies from bots and badge behavior for mixed user/bot senders.

### Review
- Results: Added inbox UI with unread badges, wired DM state tracking, and enabled bot DM replies with official bot gating.
- Tests: `npm run build` (client)
- Follow-ups: Manually verify DM replies and inbox badge counts across user/bot senders.
