import { getRoom, saveRoom, isDbAvailable } from './db.js';

const cache = new Map();
const evictionTimers = new Map();

const EVICTION_DELAY = 5 * 60 * 1000; // 5 minutes

export function getCachedRoom(roomId) {
  return cache.get(roomId) || null;
}

export function setCachedRoom(room) {
  cache.set(room.id, room);
}

export function removeCachedRoom(roomId) {
  cache.delete(roomId);
}

export function getAllCachedRooms() {
  return Array.from(cache.values());
}

export async function getOrLoadRoom(roomId, hydrateRoom) {
  const cached = cache.get(roomId);
  if (cached) return cached;

  const dbRoom = await getRoom(roomId);
  if (!dbRoom) return null;

  const room = hydrateRoom(dbRoom);
  cache.set(roomId, room);
  return room;
}

export async function persistRoom(room) {
  if (!isDbAvailable()) return;
  try {
    await saveRoom(room);
  } catch (err) {
    console.error(`[roomCache] Failed to persist room ${room.id}:`, err);
  }
}

export function scheduleEviction(roomId) {
  if (roomId === 'plaza') return;
  cancelEviction(roomId);
  const timer = setTimeout(() => {
    cache.delete(roomId);
    evictionTimers.delete(roomId);
  }, EVICTION_DELAY);
  evictionTimers.set(roomId, timer);
}

export function cancelEviction(roomId) {
  const timer = evictionTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    evictionTimers.delete(roomId);
  }
}

export function getCacheSize() {
  return cache.size;
}
