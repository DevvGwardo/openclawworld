# LLM Planning Session

**Topic:** bots have general understanding of room layout they are in
**Rounds:** 2
**Date:** Sun Feb  1 13:48:10 EST 2026

---

## Round 1 — Claude (Architect)

## Round 1: Architecture Proposal — Bot Room Layout Awareness

### Problem

Bots currently have **minimal spatial understanding**. The perception module gives them:
- Their own position
- Nearby players (within 6 units)  
- A flat list of furniture items with positions
- Raw grid bounds (e.g., "Grid 0-299")

They have **no concept of**:
- Room type (plaza vs. small room)
- Building locations and what they represent
- Functional zones (kitchen, bedroom, etc.)
- Landmarks / points of interest
- Where entrances/exits are
- Spatial regions ("near the town hall", "in the kitchen area")

### Proposed Architecture: **Room Layout Descriptor**

Create a **`RoomLayout`** module that generates a structured spatial description for each room, injected into bot perception.

#### Key Components

**1. `bot/roomLayout.js` — Layout Descriptor Generator**
- Takes room metadata (size, items, type) and produces a structured layout object
- For **plaza rooms** (size > 30): describes buildings, entrance zone, open areas
- For **generated rooms** (15×15): describes functional zones based on placed furniture

**2. Layout Data Structure**
```js
{
  roomType: "plaza" | "apartment",    // semantic room type
  landmarks: [                         // named points of interest
    { name: "Town Hall", position: [75,0], area: [12,10], description: "center building" },
    { name: "Entrance Zone", position: [46,52], area: [6,6] }
  ],
  zones: [                            // functional areas (derived from furniture clusters)
    { name: "Kitchen", bounds: {x:[55,90], y:[5,30]}, items: ["kitchenFridge","kitchenStove",...] }
  ],
  navigation: {                        // key waypoints
    center: [75, 75],
    entrances: [[48,48]],
    edges: { north: 0, south: 149, east: 149, west: 0 }
  }
}
```

**3. Perception Integration** — Extend `serialize()` with a `[Layout]` section:
```
[Layout] Plaza (150×150). Landmarks: Town Hall at [75,0], Apartment at [0,75], Shop at [142,75].
Zones: Entrance at [46-52, 46-52]. Open areas: NW quadrant, SE quadrant.
```

**4. Server-Side Room Metadata** — Enrich room objects with static layout data:
- Plaza: building footprints already defined in server code (lines ~1800+)
- Generated rooms: derive zones from `ROOM_ZONES` constant or cluster analysis of placed items

### Where Changes Go

| File | Change |
|------|--------|
| `bot/roomLayout.js` | **New** — layout descriptor generator |
| `bot/perception.js` | Add `roomLayout` to snapshot + serialize |
| `server/index.js` | Expose room layout metadata via socket events (buildings, zones) |
| `bot/BotBridge.js` | Pass layout context into LLM prompt |

### Design Decisions to Discuss

1. **Static vs. Dynamic zones** — Should zones update as furniture moves, or use the fixed `ROOM_ZONES` template?
2. **Token budget** — How compact should the layout text be? Current perception is ~500 tokens; layout adds ~100-200 more.
3. **Relative directions** — Should bots get relative descriptions ("Town Hall is 30 units north") or just absolute coordinates?

What aspects would you like me to refine for round 2?

---

## Round 1 — Kimi (Reviewer)

Now I have a comprehensive understanding of the system. Let me provide my critical technical review for **Round 1 of 2** on the topic of bots having a general understanding of room layout.

---

## Technical Review: Bot Room Layout Understanding
**Round 1 of 2 | Focus: High-Level Architecture**

### Critical Gaps

**1. No Semantic Zone Awareness**
The server defines `ROOM_ZONES` (living area, kitchen, bedroom, bathroom zones) but this spatial semantics layer is **not exposed** to bots. Bots see item coordinates but lack the "this is the kitchen area" context needed for contextual behavior (cooking near stove, sleeping near bed).

**2. Missing Navigational Understanding**
Bots don't receive the walkability grid or obstacle map. They can't pathfind intelligently in their "mind" — every move is either random or requires a server round-trip. No ability to reason about "go around the sofa" or "stand near the window."

**3. No Relative Spatial Language**
Coordinates like `[42, 67]` are meaningless to LLMs. The system lacks a **relative positioning layer**: "near the north wall," "center of room," "between the sofa and TV." Bots can't describe locations naturally or understand directional queries.

**4. Static Snapshot, No Change Memory**
Perception is a single frame. Bots don't track: "someone moved the couch," "a new lamp appeared," "the kitchen is more complete than yesterday." No temporal layout memory prevents cumulative reasoning about room evolution.

### Architecture Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Hallucinated Coordinates** | HIGH | LLM may generate invalid positions (negative, out-of-bounds, inside obstacles) because it lacks a mental model of constraints |
| **Inefficient Movement** | MEDIUM | Without spatial reasoning, bots make random walks instead of purposeful navigation to zones |
| **Token Bloat** | MEDIUM | Listing 50+ items as `[name]@[x,y]` consumes ~500-800 tokens; compressible with spatial clustering |
| **Inconsistent Building** | MEDIUM | No zone awareness → bots place kitchen items in bedroom areas |

### Missed Edge Cases

1. **Multi-room portals** — Bots don't know where entrances/exits are; can't reason about "near the door"
2. **Dynamic obstacles** — Other players blocking paths not reflected in layout understanding
3. **Item orientation** — `rotation` field is ignored in perception; bots can't tell if a sofa faces the TV
4. **Scale ambiguity** — Grid size varies by room; bots may misjudge distances without normalization

### Concrete Improvements

**1. Add Spatial Semantics Layer**
```javascript
// Expose zones to perception
zones: [
  { name: "kitchen", bounds: [[55,5], [90,30]], items: ["fridge", "stove"], completeness: 0.6 },
  { name: "living", bounds: [[10,10], [40,35]], items: ["sofa", "tv"], completeness: 0.8 }
]
```

**2. Implement Relative Position Encoder**
Convert `[x,y]` → natural language: `"southwest corner"`, `"center"`, `"near kitchen zone"`. Reduces tokens and improves LLM reasoning.

**3. Surface Walkability Summary**
Provide a low-res "occupancy map" (10x10 cells) indicating open space density. Bots can reason about crowded vs open areas without full grid data.

**4. Track Room Delta**
Include `itemsAddedSinceLastTick` and `itemsRemoved` in perception. Enables bot commentary: *"Someone added a new rug since I was here last."*

**5. Zone-Based Action Hints**
In the prompt, suggest zone-appropriate actions: *"You're in the kitchen zone — you could cook, get a drink, or sit at the bar."*

### Round 2 Focus Request

For the next round, I need to see:
- **Data flow diagram** of how room layout propagates from server → BotClient → PerceptionModule → LLM
- **Specific schema** for the proposed spatial extensions (zones, relative positions)
- **Token budget analysis** comparing current vs. proposed perception serialization

---

## Round 1 — Codex (Implementer)

Below is a high‑level, implementation‑focused review for Round 1. I’m keeping it architectural while still proposing concrete file/function touchpoints.

---

## Feasibility Stress‑Test (Architecture‑Level)

**Core feasibility:** High. The server already owns authoritative room maps (`rooms`, `grid`, `items`) and pathfinding. Bots can gain “layout understanding” by ingesting room metadata once on join and maintaining a lightweight semantic map. The main risk is **keeping bot knowledge in sync** with dynamic build updates and room switches.

**Risks / constraints**
- **Staleness:** Rooms can change (items added/removed). Bots must subscribe to `mapUpdate` and update their local map cache, or they’ll navigate into blocked zones.
- **Scale:** If you persist per‑bot layout as full grids, memory will balloon. Use sparse features (items + walkable bounds + entrances + zones).
- **Room switching:** Bots already switch rooms; layout knowledge must be per room and cached.
- **Determinism:** The server should remain the source of truth; bots can plan using cached layout but must validate with server grid.

---

## Proposed System Design (High‑Level)

**Components**
1. **Layout Knowledge Service (bot-side)**  
   - Maintains per‑room semantic map: walkable bounds, entrances, key items, zones, and a derived graph (e.g., room zones linked by open cells).
2. **Layout Inference Pipeline**  
   - On `roomJoined` / `mapUpdate`, parse `room.items` and `room.size/gridDivision` into semantic zones.
3. **Behavior Layer**  
   - Bot behaviors (idle, social, build) consult layout knowledge for goals (e.g., “go to kitchen zone”) rather than raw coordinates.
4. **Sync & Validation**  
   - When a bot picks a target, validate against current server grid via pathfinding; if path fails, refresh layout for that room.

---

## Concrete File/Function Touchpoints

- `server/index.js`  
  - Already broadcasts `mapUpdate` and handles pathfinding. Keep authoritative map here. Consider adding a lightweight `roomLayout` payload (zones + entrances) to `mapUpdate` to reduce bot compute.
- `bot/idle.js`  
  - Replace random waypoints with zone‑aware waypoints (e.g., “wander within living zone”).  
  - Add dependency on a new `LayoutKnowledge` module.
- New: `bot/LayoutKnowledge.js`  
  - Functions: `ingestMap(roomId, map)`, `ingestUpdate(roomId, mapUpdate)`, `getZones(roomId)`, `pickTarget(zoneName)`, `invalidate(roomId)`.
- `client/src/components/SocketManager.jsx`  
  - If bots run in client context, route `mapUpdate` to the new layout module. If server‑side bots, ignore.

---

## Sequencing (Pragmatic)

1. **Minimal viable knowledge**  
   - Infer zones from item clusters and static templates (e.g., “bathroom” zone if items include `toiletSquare`/`bathtub`).
2. **Sync loop**  
   - Listen for `mapUpdate` and rebuild only affected zones; cache by `roomId`.
3. **Behavior integration**  
   - Swap idle target selection to use zones.
4. **Validation & fallback**  
   - If pathfinding fails, downgrade to random nearby walkable cell and trigger layout refresh.

---

## Round 1 Questions / Assumptions

- Are bots **server‑side** (Node process) or **client‑side**? The architecture is cleaner server‑side.
- Do you want **semantic labels** (kitchen, bathroom) or just “zones of interest”?
- Are layouts **static templates** or fully player‑built? That impacts inference depth.

---

If you want, I can draft the `LayoutKnowledge` module API and the first minimal inference rules for Round 2.

---

## Round 2 — Claude (Architect)

Now I have a thorough understanding of the codebase. Let me write the Round 2 plan.

## Round 2: Implementation Specification — Bot Room Layout Awareness

### Answering Open Questions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Static vs dynamic zones? | **Static template + event-driven refresh**. Use `ROOM_ZONES` as base; rebuild on `mapUpdate` | Zones don't move, but item *completeness* within them changes. Rebuild is cheap (~30 items max) |
| Server-side or client-side bots? | **Both**. Headless bots (`bot/`) connect via socket. Moltbook bots live in-process on server. Layout module must work for both | See `BotClient.js` (socket) and `moltbookBotTick()` (server-side) |
| Walkability summary needed? | **No**. Zone + landmark + entrance info is sufficient. Bots already use server pathfinding for `move` | Adding occupancy maps bloats tokens for minimal LLM reasoning benefit |
| Temporal memory? | **Deferred**. Out of scope. Track `itemCount` per zone for "completeness" only | Full delta tracking adds complexity; bots don't need "the couch moved" yet |
| Item rotation surfaced? | **No**. Rotation is irrelevant to LLM spatial reasoning | "Sofa faces east" doesn't help bot decision-making |
| Token budget? | **150 tokens hard ceiling** for layout section. Current perception is ~400-600 tokens | Total perception stays under ~800 tokens |
| Zone action hints? | **Inject minimal hints**. 1 line: `"Zone actions: cook, eat"` per current zone only | Reduces LLM inference load without bloating prompt |

### Data Flow

```
Server (rooms, items, grid, ROOM_ZONES, buildingFootprints)
  │
  ├─► [roomJoined / mapUpdate] socket event ─► BotClient.js ─► roomLayout.js (cache)
  │                                                                    │
  │                                                                    ▼
  │                                                          perception.js serialize()
  │                                                              adds [Layout] block
  │                                                                    │
  │                                                                    ▼
  │                                                          BotBridge.js → LLM prompt
  │
  └─► moltbookBotTick() ─► roomLayout.js (same module, called directly with room data)
                                   │
                                   ▼
                           Zone-aware target selection
                           (replace random waypoints)
```

### File Changes

#### 1. `bot/roomLayout.js` (NEW — ~120 lines)

```js
// Core API
function buildLayout(room) → LayoutDescriptor
function serializeLayout(layout, selfPosition) → string  // ~150 tokens
function getZoneAt(layout, position) → Zone | null
function getZoneHints(zone) → string

// LayoutDescriptor schema
{
  roomType: "plaza" | "room",
  dimensions: [w, h],
  landmarks: [{ name: string, center: [x,y], bounds: {x:[min,max], y:[min,max]} }],
  zones: [{ 
    name: string,           // "Kitchen", "Living Area"
    bounds: {x:[min,max], y:[min,max]},
    itemCount: number,      // how many items placed
    maxItems: number,       // from ROOM_ZONES template
  }],
  entrances: [[x, y]],     // portal positions
}
```

**Plaza layout**: Derived from `getBuildingFootprints()`. Map footprints to named landmarks:
```js
const PLAZA_LANDMARKS = [
  { name: "Town Hall", footprintIndex: 0 },
  { name: "Apartment", footprintIndex: 1 },
  { name: "Shop", footprintIndex: 2 },
  { name: "Small Building NW", footprintIndex: 3 },
  { name: "Small Building NE", footprintIndex: 4 },
];
```

**Generated room layout**: Map `ROOM_ZONES` indices to semantic names, count placed items per zone by checking `room.items` positions against zone bounds.

#### 2. `bot/perception.js` — Extend `serialize()`

Add after the `[Room]` line (~line 155):
```js
// New: layout section
const layout = roomLayout.buildLayout(room);
const layoutText = roomLayout.serializeLayout(layout, self.position);
lines.push(layoutText);
```

**Serialized output examples:**

Plaza:
```
[Layout] Plaza (150×150). Buildings: Town Hall (center-north), Apartment (west), Shop (east), 
2 small buildings (NW, NE). Entrance zone: center [46-52]. You are near the Town Hall.
```

Generated room:
```
[Layout] Room (15×15). Zones: Kitchen (NE, 6/10 items), Living (W, 4/8 items), 
Bedroom (SW, 3/8 items), Bathroom (SE, 2/6 items). You are in the Kitchen zone.
Zone actions: cook, store food, prepare drinks.
```

#### 3. `bot/perception.js` — Extend `snapshot()`

Add `roomLayout` field to the snapshot object (~line 97):
```js
roomLayout: roomLayout.buildLayout({
  size: room.size, items: room.items, gridDivision: room.gridDivision, id: room.id
}),
```

#### 4. `bot/BotClient.js` — Cache layout on room events

```js
// In constructor or init:
this._layoutCache = new Map(); // roomId → LayoutDescriptor

// On 'roomJoined' handler (~line 92):
this._layoutCache.set(data.id, roomLayout.buildLayout(data.map));

// On 'mapUpdate' handler (~line 108):  
this._layoutCache.set(this.roomId, roomLayout.buildLayout(data.map));
```

#### 5. `server/index.js` — Moltbook bot zone-aware movement

In `moltbookBotTick()` (~line 500, the 40% random move branch), replace random offset with zone-aware targeting:

```js
// Before: random offset within range 8
// After: pick a zone, move toward its center
const layout = buildLayout(room);
const targetZone = layout.zones[Math.floor(Math.random() * layout.zones.length)];
const tx = randInt(targetZone.bounds.x[0], targetZone.bounds.x[1]);
const ty = randInt(targetZone.bounds.y[0], targetZone.bounds.y[1]);
```

#### 6. `server/index.js` — Export `ROOM_ZONES` and building footprints

The `roomLayout.js` module needs access to zone templates. Two options:
- **Option A**: Extract `ROOM_ZONES` and `getBuildingFootprints` to a shared `shared/roomConstants.js`
- **Option B**: Include the layout data in `roomJoined`/`mapUpdate` payloads

**Recommendation: Option A** — cleaner, no protocol changes, both bot systems can import directly.

### Relative Position Encoding

The `serializeLayout()` function converts absolute coords to natural language:

```js
function describeRelativePosition(selfPos, targetCenter, roomSize) {
  // Returns: "north", "southwest corner", "nearby", "center", etc.
  const dx = targetCenter[0] - selfPos[0];
  const dy = targetCenter[1] - selfPos[1];
  // Quadrant + distance bucket (near/far) → 9 possible labels
}

function describePlayerZone(selfPos, zones) {
  // Returns the zone the player is currently in, or "open area"
  for (const zone of zones) {
    if (inBounds(selfPos, zone.bounds)) return zone.name;
  }
  return "open area";
}
```

### Zone Action Hints (Compact)

```js
const ZONE_ACTIONS = {
  Kitchen: "cook, store food, make drinks",
  "Living Area": "relax, watch TV, chat",
  Bedroom: "rest, read, organize",
  Bathroom: "wash up",
  "Office": "work, read, study",
  "Dining": "eat, gather, chat",
};
```

Only the bot's **current zone** gets action hints injected — 1 line, ~10 tokens.

### Implementation Sequence

1. Create `shared/roomConstants.js` — extract `ROOM_ZONES`, `getBuildingFootprints`, `PLAZA_LANDMARKS`
2. Create `bot/roomLayout.js` — `buildLayout()`, `serializeLayout()`, `getZoneAt()`
3. Update `bot/perception.js` — add layout to snapshot + serialize
4. Update `bot/BotClient.js` — cache layout on room events
5. Update `server/index.js` — import shared constants, wire Moltbook bots to use zone-aware movement

---

## Round 2 — Kimi (Reviewer)

## Technical Review: Bot Room Layout Understanding
**Round 2 of 2 | Focus: Implementation Details & Data Flow**

---

### Critical Gaps in Current Implementation

**1. Missing Room Layout Exposure in `roomJoined`/`mapUpdate`**

The server emits room data without any derived layout context:

```javascript
// server/index.js:1877-1886
socket.emit("roomJoined", {
  map: {
    gridDivision: room.gridDivision,
    size: room.size,
    items: room.items,  // flat list — no zone semantics
  },
  characters: stripCharacters(room.characters),
  id: socket.id,
});
```

**Gap:** `ROOM_ZONES` (lines 224-237) and `getBuildingFootprints` (lines 1664-1685) exist server-side but are **never transmitted**. Bots must reverse-engineer zones from item positions.

**2. Perception Module Lacks Layout Integration**

`perception.js` receives raw items but doesn't inject zone context:

```javascript
// bot/perception.js:81-86 — room items have no zone association
const roomItems = (this._bot.room?.items ?? []).map(item => ({
  name: item.name,
  position: item.gridPosition,
  size: item.size,
  rotation: item.rotation ?? 0,
}));
```

**Risk:** Every bot independently clusters items to infer zones = redundant computation + inconsistent semantics.

**3. Hardcoded Grid Assumptions**

`idle.js` uses fixed `mapWidth=15` (small room default) but plaza rooms are 150×150:

```javascript
// bot/idle.js:16-17
this._mapWidth = options.mapWidth ?? 15;   // WRONG for plaza (150)
this._mapHeight = options.mapHeight ?? 15; // Bots will hit bounds immediately
```

**Risk:** Idle waypoints out-of-bounds in plaza; `BotBridge` doesn't update `IdleController` dimensions on room switch.

---

### Concrete Data Flow Proposal

**Server → Bot Layout Payload**

```javascript
// server/index.js — enrich roomJoined/mapUpdate
const deriveLayout = (room) => {
  const isPlaza = room.size[0] > 30;
  return {
    roomType: isPlaza ? "plaza" : "apartment",
    bounds: { x: [0, room.size[0]*room.gridDivision-1], y: [0, room.size[1]*room.gridDivision-1] },
    landmarks: isPlaza ? getBuildingFootprints(room.size).map(b => ({
      name: b.name || `Building@${b.x},${b.z}`,
      area: { x: [b.x, b.x+b.w], y: [b.z, b.z+b.d] }
    })) : [],
    zones: isPlaza ? [] : ROOM_ZONES.map(z => ({
      name: inferZoneName(z.items), // "kitchen", "bedroom", etc.
      bounds: z.area,
      items: z.items
    })),
    entrances: isPlaza ? [{ x: [46,52], y: [46,52] }] : [{ x: [0,5], y: [0,5] }],
  };
};
```

**Bot Layout Cache Module**

```javascript
// bot/roomLayout.js
export class RoomLayoutCache {
  constructor() {
    this._cache = new Map(); // roomId -> layout
    this._currentRoomId = null;
  }
  
  ingest(roomId, mapData, layoutPayload) {
    this._cache.set(roomId, {
      roomType: layoutPayload.roomType,
      landmarks: layoutPayload.landmarks,
      zones: layoutPayload.zones,
      entrances: layoutPayload.entrances,
      itemsSnapshot: mapData.items,
      cachedAt: Date.now(),
    });
    this._currentRoomId = roomId;
  }
  
  getZoneForPosition(position) {
    const layout = this._cache.get(this._currentRoomId);
    if (!layout) return null;
    return layout.zones.find(z => 
      position[0] >= z.bounds.x[0] && position[0] <= z.bounds.x[1] &&
      position[1] >= z.bounds.y[0] && position[1] <= z.bounds.y[1]
    );
  }
  
  // Called on mapUpdate to check if items changed significantly
  needsRefresh(newItems) {
    // Compare item count or hash; return boolean
  }
}
```

**Perception Integration Point**

```javascript
// bot/perception.js:snapshot() — add layout context
snapshot() {
  const snap = { /* ... existing ... */ };
  
  // Inject zone context for items
  if (this._roomLayoutCache) {
    snap.zones = this._roomLayoutCache.getZones();
    snap.self.zone = this._roomLayoutCache.getZoneForPosition(this._bot.position);
  }
  
  return snap;
}
```

---

### Token Budget Analysis

| Component | Current Tokens | With Layout | Delta |
|-----------|----------------|-------------|-------|
| Self position | ~10 | ~15 (+zone) | +5 |
| Nearby players | ~50-100 | ~50-100 | 0 |
| Chat | ~50-150 | ~50-150 | 0 |
| Own actions | ~30-60 | ~30-60 | 0 |
| Room items | ~200-400 | ~100-200 (clustered by zone) | **-100 to -200** |
| **Layout metadata** | 0 | **~80-120** | **+100** |
| **TOTAL** | ~340-720 | **~330-645** | **-10 to -75** |

**Net savings** from item clustering by zone outweighs layout overhead.

---

### Specific Implementation Tasks

| Priority | Task | File | Lines |
|----------|------|------|-------|
| P0 | Add `layout` field to `roomJoined`/`mapUpdate` payloads | `server/index.js` | ~1880, ~437 |
| P0 | Create `RoomLayoutCache` class | `bot/roomLayout.js` | new |
| P0 | Wire cache to `BotClient` `mapUpdate` handler | `bot/BotClient.js` | ~75-84 |
| P0 | Inject layout into `PerceptionModule` | `bot/perception.js` | ~14, ~49 |
| P0 | Serialize compact `[Layout]` section | `bot/perception.js` | ~105 |
| P1 | Update `IdleController` bounds on room switch | `bot/BotBridge.js` | ~123 |
| P1 | Add zone-aware waypoint selection to `IdleController` | `bot/idle.js` | ~90 |
| P2 | Add `itemsChanged` delta detection in cache | `bot/roomLayout.js` | new |

---

### Final Open Question Resolution

**Dynamic vs Static Zones:** Start with **static** (`ROOM_ZONES` template). Dynamic re-clustering on every `mapUpdate` is expensive and rarely needed. Add `version` field to layout payload for future opt-in dynamic updates.

**Server vs Client Bots:** The current architecture is **client-side bots** (separate Node process via Socket.IO). This is correct — layout computation happens once server-side, cached client-side.

**Token Ceiling:** Target **max 800 tokens** total perception. Current ~720 + layout ~100 = ~820; offset by item clustering to stay under.

---

## Round 2 — Codex (Implementer)

Below is Round 2 with concrete implementation detail, sequencing, and explicit answers to the open questions. Focus stays on how to build it, not just what.

---

## Implementation Plan (Round 2 / 2)

### Data Flow (Server → Bot → Perception → LLM)
1) **Server emits room snapshot + map updates**  
   - `server/index.js`: extend `mapUpdate` payload with optional `layoutHint` (zones + building footprints if plaza) to avoid recompute.
2) **Bot layout cache updates on events**  
   - `bot/RoomLayoutCache.js` holds `Map<roomId, layout>`.
3) **Perception serialization includes compact text layout**  
   - `bot/perception.js` adds `[Layout]` block from `RoomLayoutCache.get(roomId)`.

---

## File/Function Changes (Concrete)

### New: `bot/RoomLayoutCache.js`
```js
export function ingestRoomSnapshot(roomId, roomData) {}
export function ingestMapUpdate(roomId, mapUpdate) {}
export function getLayoutText(roomId, selfPos) {}
export function invalidateRoom(roomId) {}
```
- Stores layout object + cached text for serialization.
- Rebuilds only when `mapUpdate` changes items or roomId.

### New: `bot/RoomLayoutBuilder.js`
```js
export function buildLayout(roomData) {} // returns {roomType, zones, landmarks, entrances, waypoints}
export function summarizeLayout(layout, selfPos, tokenBudget) {}
```
- Plaza: use building footprints (from server layoutHint or known constants).
- Generated rooms: zones from `ROOM_ZONES` + furniture cluster heuristics.

### Update: `bot/perception.js`
- `serialize()` adds:
  ```
  [Layout] {text}
  ```

### Optional: `server/index.js`
- Add `layoutHint` to `mapUpdate` for plaza footprints / static zones.

---

## Open Questions — Proposed Decisions

1) **Static vs dynamic zones**  
   - **Hybrid**: Start from `ROOM_ZONES` (static bounds). Dynamically re-score zone “completeness” and “center” based on item clusters.  
   - Rationale: stable semantics + reflects moved furniture.

2) **Bot architecture**  
   - **Assume server-side Node bots**; if client-side, reuse same module but wire via `SocketManager.jsx`.

3) **Walkability summary**  
   - **Yes, coarse 10×10 occupancy grid** for LLM: `walkability: "10x10: 72% open, dense: NE"`  
   - Cheap to compute and aids navigation reasoning without full grid.

4) **Temporal layout memory**  
   - **Defer** to phase 2. For now, only “since last update” deltas in perception: `itemsAdded/Removed` lists.

5) **Item orientation/rotation**  
   - **Include only for key items** (sofa, bed, TV) as `orientation: N/E/S/W`. Don’t list for all.

6) **Token budget**  
   - Target **<=150 tokens** for layout block. Hard cap at **200**.  
   - `summarizeLayout()` truncates zones/landmarks to top 3 by relevance.

7) **Action hints**  
   - **No explicit hints** in prompt. Let LLM infer from zones; avoid biasing behaviors early.

---

## Sequencing (Tight)

1) Implement `RoomLayoutBuilder` (plaza + generated).  
2) Implement `RoomLayoutCache` + event wiring on `roomJoined` and `mapUpdate`.  
3) Add `serialize()` block with token cap.  
4) Add optional `walkability` summary.  
5) Behavior integration (idle target picks `zone.center`).

---

If you want, I can draft the schema + concrete serialization format next (with sample output and hard token cap logic).

---

## Final Synthesized Plan

# Implementation Plan

## Summary
Create a room layout awareness system for bots by building a `bot/roomLayout.js` module that generates structured spatial descriptions from existing server data (`ROOM_ZONES`, building footprints). This layout knowledge is cached per room, injected into bot perception serialization as a compact text block (~150 tokens), and used to enable zone-aware bot movement. The system uses static zone templates with event-driven refresh on `mapUpdate`, keeping server as the source of truth while providing bots with semantic spatial understanding.

## Steps

1. **Extract shared room constants** — Create `shared/roomConstants.js` to export `ROOM_ZONES`, `getBuildingFootprints()`, and a new `PLAZA_LANDMARKS` constant mapping building footprints to semantic names (Town Hall, Apartment, Shop, etc.). This allows both server and bot code to access the same layout definitions without protocol changes.

2. **Create room layout module** — Build `bot/roomLayout.js` with three core functions: `buildLayout(room)` generates a `LayoutDescriptor` object containing `roomType`, `landmarks`, `zones`, `entrances`, and `dimensions`; `serializeLayout(layout, selfPosition)` produces a compact ~150 token text description with relative positioning ("near Town Hall", "in Kitchen zone"); `getZoneAt(layout, position)` returns the zone containing a given position or null.

3. **Implement plaza layout derivation** — In `buildLayout()`, detect plaza rooms (size > 30) and map `getBuildingFootprints()` results to named landmarks using the `PLAZA_LANDMARKS` constant. Include entrance zone bounds `[46-52, 46-52]` and identify open quadrants (NW, SE) as navigation hints.

4. **Implement generated room layout derivation** — For small rooms (size ≤ 30), iterate through `ROOM_ZONES` template to create zone objects with bounds, semantic names (Kitchen, Living Area, Bedroom, Bathroom, Office, Dining), and item counts. Calculate zone completeness by counting items with positions inside each zone's bounds.

5. **Add relative position encoding** — Implement helper functions `describeRelativePosition(selfPos, targetCenter, roomSize)` returning strings like "north", "southwest corner", "nearby", "center" based on distance and direction; and `describePlayerZone(selfPos, zones)` to identify which zone contains the bot's current position or return "open area".

6. **Integrate layout into perception snapshot** — Update `bot/perception.js` `snapshot()` method (around line 97) to add a `roomLayout` field by calling `roomLayout.buildLayout()` with room data (size, items, gridDivision, id).

7. **Integrate layout into perception serialization** — Update `bot/perception.js` `serialize()` method (after line 155 where `[Room]` is added) to generate and append the layout text block by calling `roomLayout.serializeLayout(layout, self.position)`. Format examples: Plaza: `"[Layout] Plaza (150×150). Buildings: Town Hall (center-north), Apartment (west), Shop (east), 2 small buildings (NW, NE). Entrance zone: center [46-52]. You are near the Town Hall."` — Generated room: `"[Layout] Room (15×15). Zones: Kitchen (NE, 6/10 items), Living (W, 4/8 items), Bedroom (SW, 3/8 items), Bathroom (SE, 2/6 items). You are in the Kitchen zone."`

8. **Cache layout in BotClient** — Add `this._layoutCache = new Map()` in `bot/BotClient.js` constructor. On `roomJoined` event handler (around line 92), call `this._layoutCache.set(data.id, roomLayout.buildLayout(data.map))`. On `mapUpdate` handler (around line 108), rebuild layout with `this._layoutCache.set(this.roomId, roomLayout.buildLayout(data.map))` to keep cache in sync.

9. **Fix IdleController grid bounds** — Update `bot/BotBridge.js` to pass correct map dimensions to `IdleController` when switching rooms. Extract room dimensions from the current room object and pass `mapWidth` and `mapHeight` options to ensure bots don't generate out-of-bounds waypoints in plaza rooms (150×150 vs hardcoded 15×15).

10. **Enable zone-aware Moltbook bot movement** — In `server/index.js` `moltbookBotTick()` function (around line 500, the 40% random movement branch), replace random offset generation with zone-aware targeting: build layout for current room, select a random zone from `layout.zones`, and pick a random position within that zone's bounds as the movement target.

11. **Add optional zone action hints** — Create a `ZONE_ACTIONS` constant mapping zone names to action suggestions (Kitchen: "cook, store food, make drinks", Living Area: "relax, watch TV, chat", etc.). In `serializeLayout()`, append a single line with actions for the bot's current zone only to keep token overhead minimal (~10 tokens).

## Files to Change

- `shared/roomConstants.js` — create: extract `ROOM_ZONES` constant, `getBuildingFootprints()` function, and new `PLAZA_LANDMARKS` constant from server code for shared access
- `bot/roomLayout.js` — create: implement `buildLayout()`, `serializeLayout()`, `getZoneAt()`, relative position encoding helpers, and `ZONE_ACTIONS` constant
- `bot/perception.js` — extend `snapshot()` to add `roomLayout` field; extend `serialize()` to inject `[Layout]` text block after `[Room]` section
- `bot/BotClient.js` — add `_layoutCache` Map property; populate cache on `roomJoined` and `mapUpdate` events
- `bot/BotBridge.js` — update `IdleController` instantiation to pass correct map dimensions from current room object
- `server/index.js` — import shared constants from `shared/roomConstants.js`; update `moltbookBotTick()` to use zone-aware movement targeting instead of random offsets
- `bot/idle.js` — remove hardcoded `mapWidth=15` default assumption (fix will come from BotBridge passing correct dimensions)
