import fs from "fs";
import http from "http";
import pathfinding from "pathfinding";
import bcrypt from "bcrypt";
import { Server } from "socket.io";
import { ROOM_ZONES, scaleZoneArea } from "./shared/roomConstants.js";
import { initDb, isDbAvailable, listRooms as dbListRooms, countRooms as dbCountRooms, getNextApartmentNumber as dbGetNextApartmentNumber } from "./db.js";
import {
  getCachedRoom, setCachedRoom, getAllCachedRooms, getOrLoadRoom,
  persistRoom, scheduleEviction, cancelEviction
} from "./roomCache.js";

// --- Extracted modules ---
import { createRateLimiter, isValidWebhookUrl, isSafeWebhookUrl, hashApiKey } from "./rateLimiter.js";
import { items, itemsCatalog, ALLOWED_EMOTES, randomAvatarUrl, sanitizeAvatarUrl } from "./itemCatalog.js";
import { ensureSeatMaps, getSitSpots, unsitCharacter, normalizeAngle, DEFAULT_SIT_FACING_OFFSET } from "./sittingSystem.js";
import { findPath, updateGrid, addItemToGrid, removeItemFromGrid } from "./pathfinding.js";
import { bonds, BOND_LEVELS, bondKey, getBondLevel, loadBonds, saveBonds, applyBondProgress } from "./bondSystem.js";
import { playerCoins, DEFAULT_COINS, updateCoins, getCoins, setCoins, transferCoins } from "./currencyQuests.js";
import { botRegistry, botSockets, loadBotRegistry, saveBotRegistry, sendWebhook, syncAgentsToBotRegistry, syncBotRegistryToAgents } from "./botRegistry.js";
import { loadUserStore, loadCompletedQuests, ensureUser, getUser, createUserId, touchUser, validateSessionToken, setSessionToken, createSessionToken } from "./userStore.js";
import { initObjectives, checkBondMilestones, objectivesPayload, cleanupObjectives } from "./objectiveSystem.js";
import { createHttpHandler } from "./httpRoutes.js";
import { registerSocketHandlers } from "./socketHandlers.js";

// --- Configuration ---
const origin = process.env.CLIENT_URL || "http://localhost:5173";
const EXTRA_ALLOWED_ORIGIN = process.env.EXTRA_ALLOWED_ORIGIN || "";
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const DEV_MODE = process.env.DEV_MODE === "1"; // Enables extra local-only diagnostics in health output
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const OPEN_ACCESS =
  process.env.OPEN_ACCESS != null
    ? process.env.OPEN_ACCESS !== "0"
    : !IS_PRODUCTION; // secure-by-default in production; local-first in dev
const TRUST_PROXY = process.env.TRUST_PROXY === "1"; // only enable behind a trusted reverse proxy

const ALLOWED_ORIGINS = [
  origin,
  EXTRA_ALLOWED_ORIGIN,
  SERVER_URL,
  "http://localhost:3000",
].filter(Boolean);

// --- Rate limiters ---
const limitHttp = createRateLimiter(120, 60_000);
const limitBotRegister = createRateLimiter(5, 3600_000);
const limitChat = createRateLimiter(15, 10_000);
const limitBotKeyRotate = createRateLimiter(3, 3600_000);
const limitTransfer = createRateLimiter(8, 10_000);

// --- Load persisted data ---
loadBotRegistry();
loadBonds();
loadUserStore();
loadCompletedQuests();

// Restore verified bots from DB into registry (recovers from lost JSON), then sync registry to DB
syncAgentsToBotRegistry()
  .then(() => syncBotRegistryToAgents())
  .catch(err => console.error("[agents] Sync failed:", err));

// --- Shared helpers (used by multiple modules) ---

// Online user socket tracking
const socketUserIds = new Map(); // socketId -> userId
const userSockets = new Map(); // userId -> Set(socketId)

// Agent thoughts for bulletin board (in-memory, max 50)
const agentThoughts = [];
const MAX_AGENT_THOUGHTS = 50;

const addAgentThought = (agentId, agentName, content) => {
  const thought = {
    id: `thought_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    agentName,
    content: content.slice(0, 500), // Max 500 chars
    createdAt: new Date().toISOString(),
  };
  agentThoughts.unshift(thought);
  if (agentThoughts.length > MAX_AGENT_THOUGHTS) {
    agentThoughts.pop();
  }
  // Broadcast to all connected clients
  io.emit("agentThought", thought);
  return thought;
};

// Strip volatile fields (path) from character objects before broadcasting.
const stripCharacters = (chars) =>
  chars.map(({ path, ...rest }) => rest);

const generateRandomPosition = (room) => {
  for (let i = 0; i < 100; i++) {
    const x = Math.floor(Math.random() * room.size[0] * room.gridDivision);
    const y = Math.floor(Math.random() * room.size[1] * room.gridDivision);
    if (room.grid.isWalkableAt(x, y)) {
      return [x, y];
    }
  }
};

// Compute a style analysis of a room's current furnishing state
const computeRoomStyle = (room) => {
  const totalCells = room.size[0] * room.gridDivision * room.size[1] * room.gridDivision;
  const totalItems = room.items.length;

  const zones = ROOM_ZONES.map((zone) => {
    const scaled = scaleZoneArea(zone.area, room);
    const zoneItems = room.items.filter((item) => {
      const [ix, iy] = item.gridPosition;
      return (
        ix >= scaled.x[0] && ix < scaled.x[1] &&
        iy >= scaled.y[0] && iy < scaled.y[1]
      );
    });
    const zoneCells =
      (scaled.x[1] - scaled.x[0]) * (scaled.y[1] - scaled.y[0]);
    return {
      name: zone.name,
      area: scaled,
      items: zoneItems.map((i) => i.name),
      itemCount: zoneItems.length,
      coverage: zoneCells > 0 ? +(zoneItems.length / zoneCells).toFixed(4) : 0,
    };
  });

  const dominantZone =
    zones.reduce((best, z) => (z.itemCount > best.itemCount ? z : best), zones[0])?.name || null;
  const emptyZones = zones.filter((z) => z.itemCount === 0).map((z) => z.name);
  const furnishedZones = zones.filter((z) => z.itemCount > 0).map((z) => z.name);

  return { zones, totalItems, density: totalCells > 0 ? +(totalItems / totalCells).toFixed(4) : 0, dominantZone, emptyZones, furnishedZones };
};

const tryPlaceItemInRoom = (room, itemName, area) => {
  const itemDef = items[itemName];
  if (!itemDef) return false;
  const rot = itemDef.rotation ?? 0;
  const width = rot === 1 || rot === 3 ? itemDef.size[1] : itemDef.size[0];
  const height = rot === 1 || rot === 3 ? itemDef.size[0] : itemDef.size[1];
  const maxGrid = room.size[0] * room.gridDivision;
  for (let attempt = 0; attempt < 20; attempt++) {
    const gx = area.x[0] + Math.floor(Math.random() * (area.x[1] - area.x[0] - width));
    const gy = area.y[0] + Math.floor(Math.random() * (area.y[1] - area.y[0] - height));
    if (gx < 0 || gy < 0 || gx + width > maxGrid || gy + height > maxGrid) continue;
    if (!itemDef.walkable && !itemDef.wall) {
      let blocked = false;
      for (let x = 0; x < width && !blocked; x++) {
        for (let y = 0; y < height && !blocked; y++) {
          if (!room.grid.isWalkableAt(gx + x, gy + y)) blocked = true;
        }
      }
      if (blocked) continue;
    }
    const newItem = { name: itemDef.name, size: itemDef.size, gridPosition: [gx, gy], rotation: rot };
    if (itemDef.walkable) newItem.walkable = true;
    if (itemDef.wall) newItem.wall = true;
    room.items.push(newItem);
    addItemToGrid(room, newItem);
    return true;
  }
  return false;
};

// --- Rooms Proxy (compatibility layer over cache) ---
const rooms = new Proxy([], {
  get(target, prop) {
    const allRooms = getAllCachedRooms();
    if (prop === "length") return allRooms.length;
    if (prop === "find") return allRooms.find.bind(allRooms);
    if (prop === "filter") return allRooms.filter.bind(allRooms);
    if (prop === "map") return allRooms.map.bind(allRooms);
    if (prop === "reduce") return allRooms.reduce.bind(allRooms);
    if (prop === "push") return (room) => setCachedRoom(room);
    if (prop === "forEach") return allRooms.forEach.bind(allRooms);
    if (prop === Symbol.iterator) return allRooms[Symbol.iterator].bind(allRooms);
    if (typeof prop === "string" && !isNaN(prop)) return allRooms[Number(prop)];
    return Reflect.get(allRooms, prop);
  },
});

// --- Room persistence ---
const persistRooms = (room) => {
  if (room && isDbAvailable()) {
    persistRoom(room).catch(err => console.error("[persistRoom] Error:", err));
    return;
  }
  const allRooms = getAllCachedRooms();
  const toPersist = allRooms
    .filter(r => !r.generated || (r.generated && (r.claimedBy || (r.items && r.items.length > 0))))
    .map(({ characters, grid, seatOccupancy, characterSeats, ...rest }) => rest);
  fs.writeFileSync("rooms.json", JSON.stringify(toPersist, null, 2));
};

// --- Room hydration & loading ---
const hydrateRoom = (dbRoom) => {
  const room = { ...dbRoom, characters: [] };
  room.grid = new pathfinding.Grid(
    room.size[0] * room.gridDivision,
    room.size[1] * room.gridDivision
  );
  updateGrid(room);
  return room;
};

const loadRooms = async () => {
  if (isDbAvailable()) {
    try {
      await initDb();
      const plazaRoom = await getOrLoadRoom("plaza", hydrateRoom);
      if (!plazaRoom) {
        console.log("No plaza room found in DB, falling back to file-based loading");
        await loadRoomsFromFile();
        return;
      }
      console.log(`Loaded plaza from DB, ${await dbCountRooms()} total rooms in DB`);
      return;
    } catch (err) {
      console.error("[loadRooms] DB connection failed, falling back to file-based loading:", err.message);
    }
  }
  await loadRoomsFromFile();
};

const loadRoomsFromFile = async () => {
  let data;
  try {
    data = fs.readFileSync("rooms.json", "utf8");
  } catch {
    console.log("No rooms.json file found, using default file");
    try {
      data = fs.readFileSync("default.json", "utf8");
    } catch {
      console.log("No default.json file found, exiting");
      process.exit(1);
    }
  }
  data = JSON.parse(data);

  const savedGeneratedRooms = new Map();
  for (const roomItem of data) {
    if (roomItem.password && !roomItem.password.startsWith("$2b$")) {
      roomItem.password = await bcrypt.hash(roomItem.password, 10);
    }
    if (roomItem.generated) {
      savedGeneratedRooms.set(roomItem.id, roomItem);
    } else {
      // Use room's own size if available, otherwise default to plaza size (150x150)
      const roomSize = roomItem.size || [150, 150];
      const roomGridDivision = roomItem.gridDivision || 2;
      const room = { ...roomItem, size: roomSize, gridDivision: roomGridDivision, characters: [] };
      room.grid = new pathfinding.Grid(room.size[0] * room.gridDivision, room.size[1] * room.gridDivision);
      updateGrid(room);
      setCachedRoom(room);
    }
  }

  // Note: Test rooms (room-1 to room-100) are no longer auto-created.
  // Only user-created rooms and Open Cloud bot-claimed rooms persist.
  // Load any previously claimed/saved generated rooms from file
  for (const [roomId, saved] of savedGeneratedRooms) {
    if (saved.claimedBy || (saved.items && saved.items.length > 0)) {
      const room = {
        id: roomId,
        name: saved.name || roomId,
        size: [15, 15],
        gridDivision: 2,
        items: saved.items || [],
        characters: [],
        generated: true,
        claimedBy: saved.claimedBy || null,
      };
      room.grid = new pathfinding.Grid(room.size[0] * room.gridDivision, room.size[1] * room.gridDivision);
      updateGrid(room);
      setCachedRoom(room);
    }
  }
  const allCached = getAllCachedRooms();
  const claimedCount = [...savedGeneratedRooms.values()].filter(r => r.claimedBy).length;
  console.log(`Loaded ${allCached.length} rooms (${claimedCount} claimed by bots)`);
};

await loadRooms();

// --- Create HTTP server + Socket.IO ---
const broadcastToRoom = (roomId, event, data) => {
  io.to(roomId).emit(event, data);
};

// Shared pending-invites map: targetSocketId -> { fromId, fromName, fromIsBot, roomId, timer }
const pendingInvites = new Map();

const httpHandler = createHttpHandler({
  io: null, // will be set after io is created (handler captures reference lazily)
  rooms, items, itemsCatalog, botRegistry, botSockets, saveBotRegistry,
  sendWebhook, hashApiKey, isValidWebhookUrl, isSafeWebhookUrl, limitHttp, limitBotRegister, limitBotKeyRotate,
  randomAvatarUrl, ALLOWED_EMOTES, ALLOWED_ORIGINS, SERVER_URL,
  ROOM_ZONES, scaleZoneArea, findPath, updateGrid, addItemToGrid, persistRooms,
  computeRoomStyle, tryPlaceItemInRoom, getCachedRoom, generateRandomPosition, stripCharacters,
  pendingInvites, DEV_MODE, OPEN_ACCESS,
  TRUST_PROXY,
  addAgentThought,
});

const httpServer = http.createServer(async (req, res) => {
  return httpHandler(req, res);
});

const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS },
});

// Patch the io reference into httpHandler's deps (it was null during construction)
// The httpHandler closure captures deps by reference, so we mutate the object.
httpHandler._deps.io = io;

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT);
console.log(`Server started on port ${PORT}, allowed cors origin: ${origin}`);
if (OPEN_ACCESS) {
  console.log(`[OPEN_ACCESS] Enabled: API auth is optional for local/community use`);
}
if (IS_PRODUCTION && OPEN_ACCESS) {
  console.warn("[security] OPEN_ACCESS is enabled in production. Set OPEN_ACCESS=0 unless this is intentional.");
}
if (IS_PRODUCTION && !TRUST_PROXY) {
  console.warn("[security] TRUST_PROXY=0 in production. Set TRUST_PROXY=1 behind a trusted proxy for accurate per-client rate limits.");
}
if (IS_PRODUCTION && ALLOWED_ORIGINS.some((allowedOrigin) => /^https?:\/\/localhost(?::\d+)?$/i.test(allowedOrigin))) {
  console.warn("[security] Localhost is present in ALLOWED_ORIGINS in production. Set CLIENT_URL/SERVER_URL to public origins only.");
}
if (DEV_MODE) {
  console.log(`\n[DEV_MODE] Development mode enabled!`);
  console.log(`[DEV_MODE] - Local entry flow is enabled (open client and enter directly)\n`);
}

// --- Register socket handlers ---
const socketHelpers = registerSocketHandlers({
  io, rooms, items, itemsCatalog, findPath, updateGrid, addItemToGrid,
  persistRooms, broadcastToRoom, stripCharacters, generateRandomPosition,
  unsitCharacter: (room, charId) => unsitCharacter(room, charId, broadcastToRoom),
  ensureSeatMaps, getSitSpots, normalizeAngle, DEFAULT_SIT_FACING_OFFSET,
  sanitizeAvatarUrl, ALLOWED_EMOTES,
  bonds, bondKey, getBondLevel, BOND_LEVELS, saveBonds, applyBondProgress,
  botRegistry, botSockets, sendWebhook, saveBotRegistry,
  playerCoins, DEFAULT_COINS, updateCoins, getCoins, setCoins, transferCoins,
  tryPlaceItemInRoom,
  initObjectives, checkBondMilestones, objectivesPayload, cleanupObjectives,
  getCachedRoom, getAllCachedRooms, getOrLoadRoom, setCachedRoom,
  scheduleEviction, cancelEviction, hydrateRoom,
  isDbAvailable, dbListRooms, dbCountRooms, dbGetNextApartmentNumber, limitChat, limitTransfer, hashApiKey,
  ensureUser, getUser, createUserId, touchUser, validateSessionToken, setSessionToken, createSessionToken,
  socketUserIds, userSockets,
  pendingInvites,
  OPEN_ACCESS,
  TRUST_PROXY,
  agentThoughts, addAgentThought,
});

// Patch socketHelpers into httpHandler's deps for agent messaging
httpHandler._deps.socketHelpers = socketHelpers;
