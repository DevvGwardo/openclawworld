# Open Claw World

## Project Overview
Open Claw World is a multiplayer 3D virtual world built with React Three Fiber (client) and Socket.IO (server). Players control avatars that can walk, sit, chat, emote, and interact with furniture items in rooms. AI-controlled bots can also inhabit and furnish rooms.

## Architecture

### Client (Vite + React + R3F)
- **Port**: `5174` (hardcoded in `client/vite.config.js`)
- **Tech**: React 18, Three.js 0.153, @react-three/fiber, @react-three/drei, Jotai (state), Socket.IO client, Tailwind CSS
- **Entry**: `client/src/App.jsx` → `Experience.jsx` → `Room.jsx`, `Avatar.jsx`, `UI.jsx`
- **Server URL**: Set via `VITE_SERVER_URL` env var (defaults to `http://localhost:3000`)
- **Config**: `client/.env` and `client/vite.config.js`

### Server (Node.js + Socket.IO)
- **Port**: `3000` (set via `PORT` env var, defaults to `3000`)
- **CORS origin**: Set via `CLIENT_URL` env var — **must be `http://localhost:5174`** for local dev
- **Entry**: `server/index.js`
- **Config**: `server/.env`
- **Key modules**: `httpRoutes.js`, `socketHandlers.js`, `roomCache.js`, `db.js`, `bondSystem.js`, `botRegistry.js`, `userStore.js`, `objectiveSystem.js`, `sittingSystem.js`, `itemCatalog.js`, `rateLimiter.js`

### Shared
- `shared/roomConstants.js` — Room zones, building footprints, plaza landmarks, Sims-style needs/motives, object affordances, traits

## Running Locally

```bash
# Terminal 1 — Server
cd server
npm install
npm run dev          # nodemon on port 3000

# Terminal 2 — Client
cd client
yarn install
yarn dev             # Vite on port 5174

# Terminal 3 — Auto bot supervisor (recommended)
npm run bot:auto                            # Auto-spawns Claude/Codex bots from CLI activity

# Optional manual bot entrypoints
node claude-bot.js "BotName"
node codex-bot.js "BotName"
```

Open `http://localhost:5174` in your browser.

## Port Configuration (IMPORTANT)
- **Front-end always runs on port `5174`** — configured in `client/vite.config.js`
- **Back-end always runs on port `3000`** — configured via `server/.env` (`PORT=3000`)
- **Server CORS must allow port `5174`** — configured via `server/.env` (`CLIENT_URL=http://localhost:5174`)
- **Client connects to server** via `VITE_SERVER_URL=http://localhost:3000` in `client/.env`

## Bot Agents
Claude and Codex agents connect as bots via `claude-bot.js` / `codex-bot.js` using Socket.IO.
`bot-supervisor.js` automates spawning/stopping those bots by observing CLI process activity.

If CORS errors occur, verify `CLIENT_URL=http://localhost:5174` in `server/.env`.

## 3D Models & Assets

All assets live in `client/public/` and are served as static files:

### Building Models (`client/public/models/`)
| File | Component | Description |
|------|-----------|-------------|
| `TownHall.glb` | `TownHall.jsx` | Central plaza building |
| `Apartment.glb` | `Apartment.jsx` | West-side apartment building |
| `Shop.glb` | `ShopBuilding.jsx` | East-side shop building |
| `Skyscraper.glb` | `Skyscraper.jsx` | Corner skyscraper (instanced at 5 positions) |
| `SmallBuilding.glb` | `SmallBuilding.jsx` | Small buildings (NW, NE) |
| `BackgroundBuilding.glb` | — | Background decoration |
| `Tablet.glb` | `Tablet.jsx` | In-world interactive tablet |
| `sillyNubCat.glb` | — | Fallback avatar model |

### Furniture/Item Models (`client/public/models/items/`)
Each item has a corresponding `.glb` file loaded dynamically via `useGLTF(\`/models/items/${name}.glb\)`:

**Living**: `loungeSofa`, `loungeChair`, `loungeDesignSofa`, `loungeDesignSofaCorner`, `loungeSofaCorner`, `loungeSofaOttoman`, `tableCoffee`, `tableCoffeeGlassSquare`, `televisionModern`, `televisionVintage`, `speaker`, `speakerSmall`, `lampRoundFloor`, `lampRoundTable`, `lampSquareFloor`, `lampSquareTable`, `plant`, `plantSmall`, `rugRectangle`, `rugRound`, `rugRounded`, `rugSquare`, `radio`

**Kitchen**: `kitchenFridge`, `kitchenFridgeLarge`, `kitchenCabinet`, `kitchenCabinetCornerInner`, `kitchenCabinetCornerRound`, `kitchenStove`, `kitchenSink`, `kitchenMicrowave`, `kitchenBar`, `kitchenBlender`, `toaster`, `stoolBar`, `stoolBarSquare`

**Bedroom**: `bedDouble`, `bedSingle`, `cabinetBedDrawer`, `cabinetBedDrawerTable`, `bookcaseClosedWide`, `bookcaseOpenLow`, `coatRackStanding`, `cardboardBoxClosed`

**Bathroom**: `bathtub`, `bathroomSink`, `bathroomCabinet`, `bathroomCabinetDrawer`, `bathroomMirror`, `showerRound`, `toiletSquare`, `trashcan`

**Office/Dining**: `desk`, `deskComputer`, `laptop`, `chair`, `chairCushion`, `chairModernCushion`, `chairModernFrameCushion`, `chairRounded`, `table`, `tableCrossCloth`, `bench`, `benchCushionLow`

**Appliances**: `washer`, `dryer`, `bear`

### Animations (`client/public/animations/`)
| File | Purpose |
|------|---------|
| `M_Walk_001.glb` | Walking animation |
| `M_Standing_Idle_001.glb` | Idle standing animation |
| `M_Sitting_001.glb` | Sitting animation |
| `M_Dances_001.glb` | Dance emote animation |
| `M_Standing_Expressions_001.glb` | Wave/expression animation |

### Avatar System
- Primary avatars: Ready Player Me GLB URLs (`https://models.readyplayer.me/...`)
- Fallback avatar: `/models/sillyNubCat.glb` (local cat model)
- Avatar component: `client/src/components/Avatar.jsx`

## Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `Experience` | `Experience.jsx` | Main 3D scene container |
| `Room` | `Room.jsx` | Renders a room with items, ground, walls |
| `Avatar` | `Avatar.jsx` | Player/bot avatar with animations |
| `Item` | `Item.jsx` | Placeable furniture item |
| `UI` | `UI.jsx` | 2D overlay (chat, inventory, room list) |
| `SocketManager` | `SocketManager.jsx` | Socket.IO connection & event handling |
| `Minimap` | `Minimap.jsx` | Room minimap overlay |
| `WelcomeModal` | `WelcomeModal.jsx` | Entry/login modal |
| `Lobby` | `Lobby.jsx` | Pre-room lobby scene |
| `Shop` | `Shop.jsx` | Item preview in shop UI |

### Bot & Server Files

| File | Purpose |
|------|---------|
| `bot-supervisor.js` | Auto-spawns/stops Claude and Codex bots based on CLI process activity |
| `claude-bot.js` | Core bot script with configurable work-presence detection |
| `codex-bot.js` | Codex wrapper around `claude-bot.js` with Codex process detection |
| `server/index.js` | Server entry point |
| `server/socketHandlers.js` | All WebSocket event handlers |
| `server/httpRoutes.js` | REST API endpoints |
| `server/pathfinding.js` | A* grid pathfinding |
| `client/src/components/SocketManager.jsx` | Client WebSocket manager |
| `skill.md` | Full bot API documentation |
| `.overstory/specs/` | Task specifications |

## Room System
- Rooms have `size` (world units), `gridDivision`, and a pathfinding grid
- Plaza is the main room (~150x150), apartment rooms are 15x15
- Items placed on grid positions; pathfinding uses `pathfinding` npm package
- Room zones defined in `shared/roomConstants.js` (Living, Kitchen, Bedroom, Bathroom, Office, Dining)
- Bot needs/motives system: energy, social, fun, hunger — with decay rates and object affordances

## Bot/Agent System
- Bots register via HTTP API (`/api/bots/register`)
- Bot registry stored in `server/bot-registry.json`
- Webhook-based communication for bot actions
- Bond system tracks relationships between characters
- Objective system for bot goals

## Environment Variables

### Client (`client/.env`)
```
VITE_SERVER_URL=http://localhost:3000
DEV_MODE=1
```

### Server (`server/.env`)
```
PORT=3000
CLIENT_URL=http://localhost:5174
SERVER_URL=http://localhost:3000
DEV_MODE=1
```
