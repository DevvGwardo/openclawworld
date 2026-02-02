# Project Context Brief

**Generated:** 2026-02-02
**Project:** openclawworld
**Root:** /Users/devgwardo/openclawworld

## Tech Stack
- **Language:** JavaScript (ES Modules)
- **Server:** Node.js + Socket.IO + PostgreSQL (fallback: in-memory + JSON file)
- **Client:** React 18 + Vite + Three.js (R3F) + Jotai + Tailwind + Framer Motion
- **Bots:** Separate Node.js clients connecting via Socket.IO or REST API
- **Build:** Vite (client), nodemon (server dev)

## Architecture
- **Pattern:** Real-time multiplayer with Socket.IO event-driven architecture
- **Server:** `server/index.js` (entry), `server/socketHandlers.js` (all socket events), `server/httpRoutes.js` (REST API), `server/db.js` (PostgreSQL), `server/roomCache.js` (in-memory cache), `server/botRegistry.js` (bot auth)
- **Client:** `client/src/components/UI.jsx` (main UI/modals), `client/src/components/SocketManager.jsx` (socket state), `client/src/components/Room.jsx` (3D renderer)

## Room System
- **Schema:** `rooms` table — `id TEXT PK, name TEXT, size_x INT, size_y INT, grid_division INT, items JSONB, generated BOOL, claimed_by TEXT, password TEXT, created_at, updated_at`
- **Types:** Plaza (persistent), Generated (`room-{N}`, auto-created on access), Bot rooms (`bot-room-{ts}-{rand}`, created via API)
- **Creation:** Generated rooms created on first `switchRoom` access. Bot rooms via `POST /api/v1/rooms` (requires API key). No user creation flow exists yet.
- **Claiming:** Bots can `claimApartment` on generated rooms, sets `claimedBy` and renames to `{BotName}'s Apartment`
- **Joining:** `joinRoom` socket event, optional password protection (bcrypt)
- **Caching:** Hot rooms in memory (`roomCache.js`), evicted after 5min empty, lazy-loaded from DB
- **Persistence:** Upsert to PostgreSQL on changes; fallback saves to `rooms.json`

## Bot System
- **Registration:** `POST /api/v1/bots/register` → returns `ocw_` API key
- **Auth:** SHA-256 hashed keys stored in `bot-registry.json`
- **Connection:** REST bridge (server creates virtual socket) or direct Socket.IO
- **Bot rooms:** `POST /api/v1/rooms` creates `bot-room-{ts}-{rand}`, no limit currently enforced
- **Ownership:** `claimedBy` field tracks which bot claimed a room. No bot-owner (human) linking exists.

## Socket Events (Room-related)
- `joinRoom`, `switchRoom`, `leaveRoom`, `roomJoined`, `characterJoined`, `characterLeft`
- `requestRooms` (paginated browser), `roomsUpdate` (broadcast)
- `claimApartment` (bot claiming), `itemsUpdate`, `placeItem`, `mapUpdate`
- `passwordCheck`, `passwordCheckSuccess`, `passwordCheckFail`

## UI Components
- `RoomSelectorModal` — paginated room browser with search, main/generated sections
- `InviteModal` — invite users from other rooms (recently enhanced with browse)
- Main HUD bar: room name, player count, coins, energy, room switch button

## Conventions
- Socket events: camelCase, noun-based (`roomJoined`) or action-based (`joinRoom`)
- Server validation: manual with early returns, parameterized SQL
- Client state: Jotai atoms for global, useState for local
- ES Modules throughout, async/await preferred
- Error logging: `console.error("[tag]", err)`
