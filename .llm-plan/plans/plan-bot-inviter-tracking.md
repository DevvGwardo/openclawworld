# Implementation Plan: Bot Inviter Tracking & Reply

## Summary
Persist inviter identity when a bot joins a room via invite, expose it through bot perception, and update the LLM prompt so bots greet and respond to their inviter. The key mechanism is a server-side `pendingInvites` map that links invite data to the bot's character when they join/switch rooms, working for both Socket.IO and REST bots.

## Decision Compliance
- User room ID format: Not affected (no room creation changes)
- Bot room limit in registry: Not affected (no registry changes)
- Rate limiting for room creation: Not affected
- User-created rooms not generated: Not affected

All locked decisions respected — this plan only adds inviter metadata to the character join flow.

## Review Integration
Changes from Kimi's review incorporated:
- **Critical fix**: Added `pendingInvites` map to link invite data to the subsequent join/switchRoom (Kimi correctly identified the invite→join gap)
- **Critical fix**: REST bot invite flow now also populates pendingInvites
- **Major fix**: `roomJoined` payloads updated to include `invitedBy`
- **Major fix**: BotClient.js added to file list (was missing)
- **Major fix**: Clear `invitedBy` after first greeting to prevent spam
- **Minor fix**: Specific LLM prompt template instead of vague instructions

## History Awareness
First plan — building on the successfully implemented User & Bot Room Creation plan. No past mistakes to avoid.

## Steps

### 1. Add `pendingInvites` map to server socket handlers
Store invite metadata server-side when `inviteToRoom` fires, keyed by `targetId` (the bot/user being invited). On `switchRoom` or `joinRoom`, check this map and attach `invitedBy` to the character.

**Files:** `server/socketHandlers.js`

**Details:**
- Add `const pendingInvites = new Map()` at module scope (alongside `rooms` etc.)
- In the `inviteToRoom` handler (~line 793), after emitting `roomInvite`, also call:
  ```js
  pendingInvites.set(targetId, { fromId: socket.id, fromName: character.name, fromIsBot: !!character.isBot, roomId: room.id, timestamp: Date.now() });
  ```
- Set a 5-minute TTL: `setTimeout(() => pendingInvites.delete(targetId), 300_000)`
- In `switchRoom` handler (~line 304), after `room.characters.push(character)`, check:
  ```js
  const invite = pendingInvites.get(socket.id);
  if (invite && invite.roomId === room.id) {
    character.invitedBy = { id: invite.fromId, name: invite.fromName, isBot: invite.fromIsBot };
    pendingInvites.delete(socket.id);
  } else {
    character.invitedBy = null;
  }
  ```
- Similarly in `joinRoom` handler (~line 115)
- Include `invitedBy` in the `roomJoined` emit (~line 310):
  ```js
  socket.emit("roomJoined", { ..., invitedBy: character.invitedBy || null });
  ```

### 2. Add pendingInvites support for REST bot invites
The REST invite endpoint (`POST /api/v1/rooms/:id/invite`) also needs to populate pendingInvites, and the REST join endpoint needs to check it.

**Files:** `server/httpRoutes.js`

**Details:**
- Import/share the `pendingInvites` map (pass via `deps` or export from socketHandlers)
- In REST invite handler (~line 999), after emitting `roomInvite`, also set:
  ```js
  pendingInvites.set(targetChar.id, { fromId: conn.botId, fromName: bot.name, fromIsBot: true, roomId: botRoom.id, timestamp: Date.now() });
  ```
- In REST join handler (~line 745), after `botSocket.once("roomJoined")`, capture `invitedBy` from joinData and store on the botSockets entry
- Include `invitedBy` in REST events response and initial join response

### 3. Update BotClient to store invitedBy from roomJoined
When the bot receives `roomJoined`, capture `invitedBy` and make it available.

**Files:** `bot/BotClient.js`

**Details:**
- In the `roomJoined` handler or where room state is stored, add:
  ```js
  this.invitedBy = data.invitedBy || null;
  ```
- Emit a `joined` or `roomJoined` event that BotBridge can listen to

### 4. Update bot perception to include inviter info
Add `invitedBy` to the perception snapshot and serialize it for the LLM.

**Files:** `bot/perception.js`

**Details:**
- In `snapshot()` method (~line 265), add to the return object:
  ```js
  invitedBy: this._bot.invitedBy || null,
  ```
- In `serialize()` method (~line 299), after the Owner section, add:
  ```js
  if (snap.invitedBy) {
    lines.push(`[Invited by] ${snap.invitedBy.name} (${snap.invitedBy.id}) -- they invited you to this room, greet them!`);
  }
  ```
- Add a method `clearInviter()` that sets `this._bot.invitedBy = null` (called after first greeting)

### 5. Update BotBridge prompt and action handling
Add instruction for the bot to greet its inviter, and clear inviter after first greeting.

**Files:** `bot/BotBridge.js`

**Details:**
- In `_buildPrompt()` (~line 374), add after the owner section:
  ```
  - If you see [Invited by] in your senses, that person invited you here. Greet them warmly with a whisper using their ID. Only do this ONCE — after greeting, the tag will disappear.
  ```
- In the action execution callback (after action is executed), if action type is `whisper` and targetId matches invitedBy.id, call `perception.clearInviter()` / set `botClient.invitedBy = null`
- Wire up `roomJoined` event from BotClient to trigger an immediate perception loop (so bot greets inviter promptly)

### 6. Safeguards and cleanup
Ensure invitedBy doesn't persist stale data.

**Files:** `server/socketHandlers.js`, `bot/BotBridge.js`

**Details:**
- Clear `character.invitedBy` on `leaveRoom` / `disconnect`
- On `switchRoom`, only set invitedBy if there's a matching pending invite for the target room
- Bot-side: clear invitedBy on room change (in BotClient switchRoom method)
- Handle edge case: inviter may have left by the time bot joins — bot should still greet (whisper will silently fail if target disconnected, which is fine)

## Files to Change
| File | Action | Rationale |
|------|--------|-----------|
| `server/socketHandlers.js` | Modify | Add pendingInvites map, attach invitedBy on join/switch, include in roomJoined payload |
| `server/httpRoutes.js` | Modify | Populate pendingInvites from REST invite, include invitedBy in REST join response/events |
| `bot/BotClient.js` | Modify | Store invitedBy from roomJoined, expose to perception |
| `bot/perception.js` | Modify | Include invitedBy in snapshot/serialize, add clearInviter method |
| `bot/BotBridge.js` | Modify | Update LLM prompt, clear inviter after first greeting, trigger loop on room join |

## Testing Strategy
- **Socket flow**: Invite a bot from client UI → verify bot's character has `invitedBy` set → verify bot whispers inviter upon joining
- **REST flow**: `POST /api/v1/rooms/:id/invite` → bot joins via REST → verify events include invitedBy → verify bot responds
- **No-invite join**: Bot joins room without invite → verify `invitedBy` is null, no greeting sent
- **Inviter left**: Invite bot, inviter leaves before bot joins → bot still attempts greeting (graceful failure)
- **Re-invite**: Bot invited to new room while in another → old invitedBy cleared, new one set

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| pendingInvites map grows unbounded | Low | 5-minute TTL auto-cleanup via setTimeout |
| Inviter socket ID becomes stale (disconnect) | Low | Whisper to disconnected ID silently fails — acceptable |
| Multiple rapid invites from different users | Medium | Latest invite overwrites in pendingInvites (Map key = targetId) |
| Bot greets repeatedly | Medium | Clear invitedBy after first greeting action |

## New Decisions
- **Pending invites tracked server-side in memory Map**: Lightweight, no DB schema change needed, auto-expires
- **invitedBy cleared after first greeting**: Prevents spam, keeps LLM context clean
- **invitedBy stored on character object, not bot registry**: This is per-session data, not permanent bot config
