<!-- written-by: claude-lead -->
# Smart Bot Gathering — Reactive Claude Code Agents

## Objective

Transform the existing `claude-bot.js` autonomous bots into **reactive, aware agents** that:
1. Know what other Claude bots are doing (perceiving actions, positions, chat)
2. React to each other's behavior (follow movement, respond to chat contextually, mirror emotes)
3. Gather at a designated **meeting point** on command — all bots converge to Town Hall

## Current State

- `claude-bot.js` connects bots via Socket.IO to the OpenClawWorld server
- Bots act randomly (move, chat, emote, think) on a 4-6 second tick
- Bots receive `characterJoined`, `characterLeft`, `playerChatMessage`, `playerMove` events
- Bots do NOT currently track what other bots are doing
- Bots do NOT coordinate or gather

## Requirements

### 1. Shared Awareness System
- Each bot must maintain a **world state** object tracking all other characters:
  - Name, position, last action, last chat message, current emote
- On receiving `playerMove` events, update tracked positions
- On receiving `playerChatMessage`, store last message per character
- On receiving `emote:play` events, store current emote per character

### 2. Reactive Behavior
- **Follow behavior**: If a bot sees another bot moving nearby (within 50 grid units), there's a chance it follows toward that bot's destination
- **Chat reactions**: Bots respond contextually to what other bots say (not just generic responses)
- **Emote mirroring**: If a nearby bot dances, other bots have a chance to dance too
- **Greeting chains**: When a new player/bot joins, all nearby bots wave

### 3. Gathering Protocol
- Define a **gathering point**: Town Hall at grid `[150, 20]`
- A special chat command `"!gather"` triggers ALL bots to converge on Town Hall
- When gathering:
  - Bots move to positions around Town Hall (spread within 20 grid units)
  - Once arrived, bots wave, then sit
  - After 10 seconds sitting together, one bot says "Meeting started!"
  - Bots take turns saying predefined meeting lines
- A `"!disperse"` command sends bots back to random wandering

### 4. Awareness-Driven Decision Making
Replace the pure-random `decide()` function with a weighted system:
- **If alone**: Wander toward landmarks (current behavior)
- **If near others**: Increase social actions (chat, emote, look)
- **If others are gathering**: Join the group
- **If someone chatted recently**: Higher chance to respond or move closer
- **If another bot is dancing**: Join the dance party

## Architecture

### Files to Modify
- `claude-bot.js` — Main bot script (rewrite decision engine + add awareness)

### Key Data Structures

```javascript
// Per-character tracking
const worldState = new Map(); // characterId -> { name, position, lastAction, lastChat, emote, lastSeen }

// Gathering state
let gatheringActive = false;
const GATHER_POINT = [150, 20]; // Town Hall
const GATHER_RADIUS = 20;
```

### Event Flow
```
Server Events → Update worldState → Weighted Decision Engine → Action
                                          ↓
                                   Check gathering mode
                                          ↓
                                   Check nearby bots
                                          ↓
                                   Choose contextual action
```

## Acceptance Criteria

- [ ] All bots track each other's positions and actions in real-time
- [ ] Bots visibly react to nearby bot actions (follow, mirror emotes, contextual chat)
- [ ] Typing `!gather` in the client chat causes all bots to converge on Town Hall
- [ ] Bots spread out around Town Hall (not stacking on one tile)
- [ ] After gathering, bots perform a coordinated sequence (wave → sit → meeting chat)
- [ ] `!disperse` returns bots to normal wandering behavior
- [ ] No server crashes — all socket events use correct signatures
- [ ] Works with 2-5 concurrent bots

## Socket Event Reference (Correct Signatures)

- `socket.emit("move", fromPosition, toPosition)` — two array args `[x,y]`
- `socket.emit("chatMessage", "string")` — plain string, NOT object
- `socket.emit("emote:play", "wave"|"dance"|"sit"|"nod")` — emote name string
- `socket.emit("thinking", true|false)` — bot thinking indicator
- Listen: `playerChatMessage` (has .id, .name, .message)
- Listen: `playerMove` (has .id, .position, .path)
- Listen: `characterJoined` (has .character object)
- Listen: `characterLeft` (has .id, .name)
- Listen: `emote:play` (has .id, .name — emote name)
