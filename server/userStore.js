// Persistent user store (DB when available, JSON fallback)

import fs from "fs";
import crypto from "crypto";
import {
  isDbAvailable,
  getUserById,
  upsertUser,
  setUserCoins as dbSetUserCoins,
  touchUser as dbTouchUser,
  validateSessionToken as dbValidateSessionToken,
  setSessionToken as dbSetSessionToken,
  updateUserCoinsAtomic as dbUpdateUserCoinsAtomic,
} from "./db.js";

export const DEFAULT_COINS = 100;

const USERS_FILE = "users.json";
const users = new Map(); // userId -> user record

const nowMs = () => Date.now();

export const createUserId = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
};

export const createSessionToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

const persistUsers = () => {
  if (isDbAvailable()) return;
  const payload = [...users.values()];
  fs.writeFileSync(USERS_FILE, JSON.stringify(payload, null, 2));
};

export const loadUserStore = () => {
  if (isDbAvailable()) return;
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      data.forEach((u) => {
        if (u && u.id) users.set(u.id, u);
      });
    }
  } catch {
    // No users.json yet, that's fine
  }
};

export const getUser = async (userId) => {
  if (!userId) return null;
  if (isDbAvailable()) {
    return await getUserById(userId);
  }
  return users.get(userId) || null;
};

export const ensureUser = async ({ userId, name = null, isBot = false } = {}) => {
  if (!userId) return null;
  if (isDbAvailable()) {
    // Check if user exists first to determine if we need a new session token
    const existingUser = await getUserById(userId);
    const sessionToken = existingUser ? undefined : createSessionToken();
    const record = await upsertUser({
      id: userId,
      name,
      isBot: !!isBot,
      coins: DEFAULT_COINS,
      sessionToken,
    });
    return record;
  }

  const existing = users.get(userId);
  if (!existing) {
    const createdAt = nowMs();
    const sessionToken = createSessionToken();
    const record = {
      id: userId,
      name: name || null,
      isBot: !!isBot,
      coins: DEFAULT_COINS,
      sessionToken,
      createdAt,
      updatedAt: createdAt,
      lastSeenAt: createdAt,
    };
    users.set(userId, record);
    persistUsers();
    return record;
  }

  let changed = false;
  if (name && existing.name !== name) {
    existing.name = name;
    changed = true;
  }
  if (existing.isBot !== !!isBot) {
    existing.isBot = !!isBot;
    changed = true;
  }
  existing.lastSeenAt = nowMs();
  if (changed) existing.updatedAt = existing.lastSeenAt;
  if (changed) persistUsers();
  return existing;
};

export const touchUser = async (userId) => {
  if (!userId) return;
  if (isDbAvailable()) {
    await dbTouchUser(userId);
    return;
  }
  const existing = users.get(userId);
  if (!existing) return;
  existing.lastSeenAt = nowMs();
  existing.updatedAt = existing.lastSeenAt;
  persistUsers();
};

export const setUserCoins = async (userId, coins) => {
  if (!userId || typeof coins !== "number") return null;
  if (isDbAvailable()) {
    const updated = await dbSetUserCoins(userId, coins);
    return updated;
  }
  const existing = users.get(userId);
  if (!existing) return null;
  existing.coins = coins;
  existing.updatedAt = nowMs();
  existing.lastSeenAt = existing.updatedAt;
  persistUsers();
  return coins;
};

export const updateUserCoins = async (userId, delta) => {
  if (!userId || typeof delta !== "number") return null;
  if (isDbAvailable()) {
    return await dbUpdateUserCoinsAtomic(userId, delta);
  }
  // JSON fallback - still uses read-modify-write (acceptable for single instance)
  const user = users.get(userId);
  if (!user) return null;
  const current = typeof user.coins === "number" ? user.coins : DEFAULT_COINS;
  const updated = Math.max(0, current + delta);
  user.coins = updated;
  user.updatedAt = nowMs();
  user.lastSeenAt = user.updatedAt;
  persistUsers();
  return updated;
};

export const validateSessionToken = async (userId, token) => {
  if (!userId || !token) return false;
  if (isDbAvailable()) {
    return await dbValidateSessionToken(userId, token);
  }
  const user = users.get(userId);
  return user?.sessionToken === token;
};

export const setSessionToken = async (userId, token) => {
  if (!userId || !token) return false;
  if (isDbAvailable()) {
    return await dbSetSessionToken(userId, token);
  }
  const user = users.get(userId);
  if (!user) return false;
  user.sessionToken = token;
  persistUsers();
  return true;
};

