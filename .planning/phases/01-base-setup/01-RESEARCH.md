# Phase 1: Base Setup - Research

**Researched:** 2026-01-31
**Domain:** Cloning, running, and verifying the wass08/r3f-sims-online-final multiplayer template
**Confidence:** HIGH

## Summary

Phase 1 is about getting the existing R3F Sims multiplayer template running locally and understanding its architecture. The base repo (wass08/r3f-sims-online-final) is a two-process system: a Node.js Socket.IO game server and a Vite-powered React Three Fiber client. They are in separate directories (`server/` and `client/`) with independent `package.json` files and separate `yarn.lock` files. Both use `"type": "module"` (ESM).

The repo was cloned and inspected directly. The server is a single `index.js` file (~250 lines) that manages rooms, pathfinding, and Socket.IO events. The client is a standard Vite + React app with 12 components, Jotai for state management, and Ready Player Me for avatars. The codebase is small, well-structured, and has no build-time complexity.

**Primary recommendation:** Clone the repo, run `yarn install` in both `client/` and `server/`, start both processes, open two browser tabs to the same room, and verify multiplayer works. No code changes needed for Phase 1.

## Standard Stack

The existing repo uses these exact versions. Do not upgrade or change them in Phase 1.

### Server
| Library | Version | Purpose |
|---------|---------|---------|
| socket.io | ^4.7.2 | Real-time multiplayer server |
| pathfinding | ^0.4.18 | A* grid-based navigation |
| nodemon | ^3.0.1 | Dev auto-restart (devDependency) |

### Client
| Library | Version | Purpose |
|---------|---------|---------|
| react | ^18.2.0 | UI framework |
| react-dom | ^18.2.0 | React DOM renderer |
| three | 0.153.0 | 3D rendering engine |
| @react-three/fiber | 8.13.3 | React renderer for Three.js |
| @react-three/drei | 9.75.0 | R3F helper components |
| @react-three/postprocessing | ^2.15.1 | Post-processing effects (commented out in code) |
| socket.io-client | ^4.7.2 | Socket.IO browser client |
| jotai | ^2.2.3 | Atomic state management |
| framer-motion | ^10.16.4 | Animation library |
| framer-motion-3d | ^10.16.4 | 3D animation integration |
| @readyplayerme/react-avatar-creator | ^0.3.0 | Avatar customization |
| lodash | ^4.17.21 | Utility library |
| three-stdlib | ^2.24.1 | Three.js utilities (SkeletonUtils) |
| vite | ^4.1.0 | Build tool and dev server |
| tailwindcss | ^3.3.3 | Utility-first CSS |

### Package Manager
The repo uses **yarn** (both `client/` and `server/` have `yarn.lock` files). Use `yarn install` not `npm install`.

## Architecture Patterns

### Project Structure (Actual Repo)
```
r3f-sims-online-final/
├── README.md                    # Just a YouTube link
├── client/
│   ├── package.json             # "type": "module"
│   ├── yarn.lock
│   ├── vite.config.js           # Minimal - just react plugin
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   ├── public/
│   │   ├── animations/          # 4 GLB animation files (walk, idle, dance, expressions)
│   │   ├── fonts/               # Inter_Bold.json (3D text)
│   │   ├── models/
│   │   │   ├── items/           # 67 GLB furniture models
│   │   │   ├── Skyscraper.glb
│   │   │   └── Tablet.glb
│   │   └── textures/            # venice_sunset_1k.hdr (environment map)
│   └── src/
│       ├── main.jsx             # Entry point
│       ├── App.jsx              # Canvas + SocketManager + UI
│       ├── index.css            # Tailwind imports
│       ├── assets/              # (empty or minimal)
│       ├── hooks/
│       │   └── useGrid.jsx      # Grid<->Vector3 coordinate conversion
│       └── components/
│           ├── SocketManager.jsx # Socket.IO connection + Jotai atoms
│           ├── Experience.jsx    # Scene setup (camera, lighting, sky)
│           ├── Room.jsx          # Room rendering (items, characters, floor)
│           ├── Avatar.jsx        # Character rendering + movement + chat bubbles
│           ├── Item.jsx          # Furniture item rendering
│           ├── Lobby.jsx         # Room selection UI (3D tablet)
│           ├── LobbyAvatar.jsx   # Avatar preview in lobby
│           ├── UI.jsx            # 2D overlay (chat input, buttons, avatar creator)
│           ├── Shop.jsx          # Furniture shop for build mode
│           ├── Tablet.jsx        # 3D tablet model
│           ├── Skyscraper.jsx    # Lobby background building
│           └── Loader.jsx        # Loading screen
└── server/
    ├── package.json             # "type": "module"
    ├── yarn.lock
    ├── .gitignore               # node_modules, rooms.json
    ├── default.json             # Default room configuration (4 rooms)
    └── index.js                 # ENTIRE server in one file (~250 lines)
```

### Pattern 1: Two Independent Processes
**What:** Client and server are completely separate projects. No monorepo tooling, no shared dependencies, no workspace config.
**How to run:**
- Terminal 1: `cd server && yarn install && yarn dev` (starts on port 3000)
- Terminal 2: `cd client && yarn install && yarn dev` (starts on port 5173)
**Key detail:** The client connects to the server URL via `import.meta.env.VITE_SERVER_URL || "http://localhost:3000"` (in SocketManager.jsx line 7). The server accepts CORS from `process.env.CLIENT_URL || "http://localhost:5173"` (server index.js line 5).

### Pattern 2: Server-Authoritative State
**What:** The server owns ALL game state. Rooms, characters, positions, pathfinding all live server-side. Clients send intents (move, chat, dance), server validates and broadcasts results.
**Key files:**
- `server/index.js` -- single file, all logic
- `server/default.json` -- 4 predefined rooms with furniture layouts

### Pattern 3: Jotai Atom State Management
**What:** Client state is entirely managed via Jotai atoms, synced from Socket.IO events.
**Atoms defined in SocketManager.jsx:**
- `charactersAtom` -- array of all characters in current room
- `mapAtom` -- current room map data (grid, size, items)
- `userAtom` -- current user's socket ID
- `itemsAtom` -- shop items catalog
- `roomIDAtom` -- which room user is in (null = lobby)
- `roomsAtom` -- list of all rooms with occupancy counts

### Pattern 4: Chat Already Exists
**What:** Chat is fully implemented. The base repo has chat input (UI.jsx), chat message sending via Socket.IO (`chatMessage` event), and chat bubbles that appear above avatars for 3.5 seconds (Avatar.jsx). This is NOT something to build in Phase 1 -- it already works.

### Anti-Patterns to Avoid
- **Do NOT create a root package.json or monorepo structure in Phase 1.** The repo works as two independent projects. Adding workspace tooling adds complexity for zero Phase 1 value.
- **Do NOT upgrade dependencies in Phase 1.** Some packages are pinned to specific versions (Three.js 0.153.0, R3F 8.13.3, Drei 9.75.0). Upgrading can break the careful version coordination.
- **Do NOT modify any code in Phase 1.** The goal is to verify the existing codebase works as-is.

## Socket.IO Events (Complete Reference)

This is the complete event protocol extracted from the actual server code. Future phases depend on understanding this exactly.

### Server -> Client Events
| Event | Payload | When | Handler |
|-------|---------|------|---------|
| `welcome` | `{ rooms: [{id, name, nbCharacters}], items: {shopCatalog} }` | On connection | Sets room list + shop items |
| `roomJoined` | `{ map: {gridDivision, size, items}, characters: [...], id: socketId }` | After joinRoom | Sets map, characters, user ID |
| `characters` | `[{id, session, position, avatarUrl, path?, hairColor?, topColor?, bottomColor?}]` | On any room change | Updates character list |
| `rooms` | `[{id, name, nbCharacters}]` | On any room change | Updates lobby room list |
| `playerMove` | `{id, session, position, avatarUrl, path: [[x,y],...]}` | After move validated | Character object with computed path |
| `playerDance` | `{id}` | After dance emitted | Triggers dance animation |
| `playerChatMessage` | `{id, message}` | After chat sent | Shows chat bubble above avatar |
| `mapUpdate` | `{map: {gridDivision, size, items}, characters: [...]}` | After room edit | Refreshes room layout |
| `passwordCheckSuccess` | (none) | Password correct | Enables build mode |
| `passwordCheckFail` | (none) | Password wrong | Shows error |

### Client -> Server Events
| Event | Payload | Purpose |
|-------|---------|---------|
| `joinRoom` | `(roomId, { avatarUrl })` | Join a specific room |
| `leaveRoom` | (none) | Leave current room |
| `move` | `(from: [x,y], to: [x,y])` | Request movement (server runs A*) |
| `dance` | (none) | Trigger dance animation |
| `chatMessage` | `(message: string)` | Send chat message |
| `characterAvatarUpdate` | `(avatarUrl: string)` | Update avatar URL |
| `passwordCheck` | `(password: string)` | Check room edit password |
| `itemsUpdate` | `(items: array)` | Update room furniture layout |

### Character Data Shape
```javascript
{
  id: socket.id,          // string - Socket.IO connection ID
  session: parseInt(Math.random() * 1000), // number - random session identifier
  position: [x, y],       // [number, number] - grid coordinates (integers, 0 to size*gridDivision)
  avatarUrl: string,       // Ready Player Me GLB URL
  path: [[x,y], ...],     // array of grid positions (set by move handler)
  canUpdateRoom: boolean,  // set by password check (optional)
}
```

### Room Data Shape
```javascript
{
  id: number,              // 1, 2, 3, 4
  name: string,            // "PARTY ROOM", "BATHROOM", "KITCHEN", "COSY ROOM"
  password: string,        // "WAWA" for all rooms
  items: [{name, size, gridPosition, rotation, walkable?, wall?}],
  // Added at runtime:
  size: [7, 7],            // HARDCODED in server
  gridDivision: 2,         // HARDCODED in server (so grid is 14x14)
  characters: [],          // managed by server
  grid: pathfinding.Grid   // 14x14 pathfinding grid
}
```

### Grid System
- Room size: 7x7 world units
- Grid division: 2 (so 14x14 grid cells)
- Grid coordinates are integers from 0 to 13
- Grid <-> Vector3 conversion: `useGrid.jsx` hook
  - `vector3ToGrid(v3)` = `[Math.floor(v3.x * gridDivision), Math.floor(v3.z * gridDivision)]`
  - `gridToVector3([gx, gy])` = `new Vector3(0.5/gridDiv + gx/gridDiv, 0, 0.5/gridDiv + gy/gridDiv)`

## Don't Hand-Roll

Problems already solved in the base repo -- do not rebuild:

| Problem | Already Exists | Where |
|---------|---------------|-------|
| Pathfinding | A* with diagonal support | `server/index.js` using `pathfinding` library |
| Avatar loading | Ready Player Me GLB loader | `Avatar.jsx` with `useGLTF` |
| Chat bubbles | HTML overlay above avatars | `Avatar.jsx` lines 144-153, auto-fade 3.5s |
| Chat input | Text input + send button | `UI.jsx` lines 94-174 |
| Room selection | Lobby with room list | `Lobby.jsx` |
| Animation system | Walk, idle, dance animations | `Avatar.jsx` with `useAnimations` |
| Coordinate conversion | Grid <-> 3D Vector3 | `hooks/useGrid.jsx` |
| Room furniture | Build mode with drag-and-drop | `Room.jsx` + `Shop.jsx` |

## Common Pitfalls

### Pitfall 1: Wrong Package Manager
**What goes wrong:** Running `npm install` when the repo uses `yarn`. The lock files diverge, causing version mismatches.
**How to avoid:** Use `yarn install` in both `client/` and `server/` directories. Both have `yarn.lock` files.
**Warning signs:** `package-lock.json` appears alongside `yarn.lock`.

### Pitfall 2: Node.js Version Compatibility
**What goes wrong:** The repo was built with older Node.js. Some dependencies (especially native modules used by Three.js tooling) may have issues on Node.js 22.
**How to avoid:** First try with Node.js 22 (project requirement). If there are build errors, note them. Most likely `yarn install` will work fine since the dependencies are all pure JS.
**Warning signs:** `node-gyp` errors during install. `ERR_REQUIRE_ESM` errors.

### Pitfall 3: CORS Mismatch
**What goes wrong:** Client cannot connect to server because the CORS origin does not match.
**How to avoid:** Ensure client runs on port 5173 (Vite default) and server runs on port 3000 (hardcoded). The defaults match: server allows `http://localhost:5173`, client connects to `http://localhost:3000`.
**Warning signs:** Browser console shows CORS errors. Socket.IO connection fails silently.

### Pitfall 4: Missing Public Assets
**What goes wrong:** 3D models fail to load because the `public/` directory has large GLB files tracked in git. If the clone is shallow or LFS is misconfigured, assets are missing.
**How to avoid:** Use a full clone (`git clone` without `--depth`). Verify `client/public/models/items/` has 67 GLB files, `client/public/animations/` has 4 GLB files.
**Warning signs:** 3D scene loads but furniture/avatars are invisible. Console shows 404 errors for `.glb` files.

### Pitfall 5: Port Already in Use
**What goes wrong:** Port 3000 or 5173 already occupied by another process.
**How to avoid:** Check ports before starting: `lsof -i :3000` and `lsof -i :5173`. Kill any conflicting processes.
**Warning signs:** `EADDRINUSE` error on server start. Vite picks a different port (5174, etc.) and CORS fails.

### Pitfall 6: rooms.json Overwrite
**What goes wrong:** The server writes to `rooms.json` when furniture is updated via build mode. If a developer enters build mode, modifies items, then the file gets created and used instead of `default.json` on next restart.
**How to avoid:** `rooms.json` is in `.gitignore` -- this is intentional. If rooms look wrong after restart, delete `rooms.json` to reset to defaults.
**Warning signs:** Room layouts differ from expected defaults. `rooms.json` file appears in server directory.

## Code Examples

### Starting the Server
```bash
cd server
yarn install
yarn dev    # uses nodemon, auto-restarts on changes (ignores *.json)
# OR
yarn start  # NODE_ENV=production node index.js
```
Server logs: `"Server started on port 3000, allowed cors origin: http://localhost:5173"`

### Starting the Client
```bash
cd client
yarn install
yarn dev    # Vite dev server on http://localhost:5173
```

### Verifying Multiplayer (Success Criteria)
1. Open `http://localhost:5173` in Tab 1
2. Open `http://localhost:5173` in Tab 2
3. In Tab 1: click a room (e.g., "PARTY ROOM") -- avatar appears
4. In Tab 2: click the same room -- second avatar appears
5. **Test movement:** Click on the floor in Tab 1 -- avatar walks there. Tab 2 sees the movement in real time.
6. **Test chat:** Type a message in Tab 1's chat input, press Enter -- chat bubble appears above avatar. Tab 2 sees the chat bubble.
7. **Test dance:** Click the music note button in Tab 1 -- avatar dances. Tab 2 sees the dance animation.

### Environment Variables (Optional)
```bash
# Server
CLIENT_URL=http://localhost:5173  # Default, no need to set

# Client (in .env or environment)
VITE_SERVER_URL=http://localhost:3000  # Default, no need to set
```

## State of the Art

| Aspect | Base Repo Approach | Notes |
|--------|-------------------|-------|
| Module system | ESM (`"type": "module"`) | Both client and server, good |
| Socket.IO | v4.7.x | Current stable line |
| React | 18.x | Not React 19, fine for Phase 1 |
| Three.js | 0.153.0 | Pinned, not latest (latest is ~0.170+). Do NOT upgrade -- R3F 8.13 is tested against this version |
| Vite | ^4.1.0 | Not Vite 5/6, fine for Phase 1 |
| Build mode | Room editor with password protection | All rooms use password "WAWA" |

## Open Questions

1. **Ready Player Me avatar URL availability**
   - What we know: The default avatar URL is `https://models.readyplayer.me/64f0265b1db75f90dcfd9e2c.glb`. This is a specific avatar ID.
   - What's unclear: Whether this specific URL is still accessible or if Ready Player Me has changed their CDN/API. If it 404s, avatars will fail to load.
   - Recommendation: If the default avatar fails, find any valid Ready Player Me GLB URL or host a fallback avatar locally.

2. **yarn version compatibility**
   - What we know: The repo has `yarn.lock` files (yarn v1 / classic format).
   - What's unclear: Whether the developer has yarn installed and which version.
   - Recommendation: Use `yarn` (classic). If not installed, `npm install -g yarn`. Alternatively, `npm install` would likely work but creates a divergent lock file.

3. **No root-level package.json**
   - What we know: There is no root package.json, no workspace config. Client and server are fully independent.
   - What's unclear: Whether we should add a root package.json in Phase 1 for convenience scripts.
   - Recommendation: Do NOT add one in Phase 1. Keep the repo structure as-is. Address in Phase 2 if needed.

## Sources

### Primary (HIGH confidence)
- Direct inspection of cloned repo `wass08/r3f-sims-online-final` at commit HEAD -- all file contents, package.json versions, Socket.IO events, data shapes verified by reading actual source code
- `server/index.js` -- complete server logic (250 lines, single file)
- `client/src/components/SocketManager.jsx` -- Socket.IO event handlers and Jotai atoms
- `client/src/components/Avatar.jsx` -- character rendering, movement, chat bubbles
- `client/src/components/Room.jsx` -- room rendering, click-to-move
- `client/src/components/UI.jsx` -- chat input, dance button, build mode
- `client/src/hooks/useGrid.jsx` -- coordinate conversion logic
- `server/default.json` -- 4 rooms with furniture layouts, passwords all "WAWA"

### Secondary (MEDIUM confidence)
- [Wawa Sensei YouTube tutorial](https://youtu.be/73XOJlLhhZg) -- referenced in repo README, tutorial walkthrough of the codebase
- Prior project research in `.planning/research/ARCHITECTURE.md` and `.planning/research/STACK.md`

## Metadata

**Confidence breakdown:**
- Repo structure: HIGH -- cloned and inspected directly
- Socket.IO events: HIGH -- read from actual server source code
- Start scripts: HIGH -- read from package.json
- Data shapes: HIGH -- extracted from server/index.js
- Node.js 22 compatibility: MEDIUM -- dependencies are pure JS so likely fine, but not tested

**Research date:** 2026-01-31
**Valid until:** Indefinite (the base repo is a fixed snapshot, not actively maintained)
