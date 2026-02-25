## Energy + Eating Plan (OpenClawWorld) - COMPLETE

### Goals
- [x] Fix the player HUD energy bar so it reliably decreases over time (and reflects server truth quickly, not in chunky/laggy steps).
- [x] Add an "Eat" interaction for players when they are inside an apartment room: walk to the stove if present; otherwise walk to the center of the room; then perform the eat/cook interaction.
- [x] Update tired/need icons so that once energy is depleted the visuals clearly reflect "exhausted" (and the other need symbols remain consistent).

---

## Implementation Status

### 1) Reproduce + Confirm Data Flow - DONE
- Issue confirmed: HUD not updating smoothly due to 10% bucket broadcasts + fast decay rates.

### 2) Make HUD Energy Update Smoothly - DONE
- Client-side interpolation implemented in `client/src/components/UI.jsx:1287-1315`
- Baseline timestamp tracking with `energyBaselineRef` resets on each server update
- Interpolated energy: `baseline - (ENERGY_DECAY_PER_SEC * dt)`, clamped 0-100
- Display updates every 500ms via `setInterval`
- Only applies to local player; other characters use bucketed server updates

### 3) Normalize Decay Rates - DONE
- Updated in both `shared/roomConstants.js:82-83` and `server/shared/roomConstants.js:82-83`
- `DECAY_RATES = { energy: 0.11, social: 0.09, fun: 0.09, hunger: 0.06 }`
- Energy drains 100 to 0 in ~15 minutes (was ~100 seconds)
- Hunger drains in ~28 minutes, social/fun in ~18 minutes

### 4) Add "Eat" Flow for Apartment Rooms - DONE
- Eat button shows only in apartment rooms (`client/src/components/UI.jsx:1761-1771`)
- `handleEat` (`UI.jsx:1373-1398`): targets kitchenStove > kitchenFridge > eatSpot (room center fallback)
- Walk-then-interact: emits `move` then sets `pendingInteraction`
- Avatar fires `interact:object` on path completion (`Avatar.jsx:864-870`)
- Server validates affordance and allows `eatSpot` without a physical item (`socketHandlers.js:500-533`)
- `eatSpot` affordance: hunger +30, energy +5, 5s duration, interruptible (`roomConstants.js:79`)
- Interaction completion applies motive gains server-side (`motiveSystem.js:23-37`)

### 5) Update Tired/Need Symbols - DONE
- HUD badge (`UI.jsx:1462-1486`): energy<=0 shows exhausted (red bar), <20 shows tired (orange gradient), normal shows blue-green
- Avatar mood emoji (`Avatar.jsx:1005-1046`): energy<=0 shows exhausted, <20 shows tired, lowest-deficit-based emoji otherwise
- Interaction emojis override mood: sleeping, cooking, eating (eatSpot) all have distinct icons

---

## Verification Checklist
- [x] Energy bar visibly decreases smoothly (interpolation at 500ms ticks)
- [x] Server motive values match HUD (baseline resets on server update)
- [x] "Eat" button appears only in apartment rooms
- [x] Eat walks to stove/fridge if present, otherwise to room center (eatSpot)
- [x] Interaction fires at end of walk (pendingInteraction pattern)
- [x] Low energy (<20) shows tired icon
- [x] Zero energy shows exhausted icon
- [x] Cooking/sleeping/eating icons show during interactions

## Resolved Decisions
- "Eat" restores hunger +30 AND a small amount of energy +5 (via `eatSpot` affordance)
- `eatSpot` uses server exception: `interact:object` allows `eatSpot` without a physical room item (no invisible marker needed)

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
