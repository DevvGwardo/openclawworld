// Persistent user store (DB when available, JSON fallback)

import fs from "fs";
import crypto from "crypto";
import * as db from "./db.js";

const {
  isDbAvailable,
  getUserById,
  upsertUser,
  setUserCoins: dbSetUserCoins,
  touchUser: dbTouchUser,
  validateSessionToken: dbValidateSessionToken,
  updateUserCoinsAtomic: dbUpdateUserCoinsAtomic,
  transferCoinsAtomic: dbTransferCoinsAtomic,
  hasCompletedQuest: dbHasCompletedQuest,
  recordCompletedQuest: dbRecordCompletedQuest,
} = db;
const dbSetSessionToken = db.setSessionToken;

export const DEFAULT_COINS = 100;

const USERS_FILE = "users.json";
const COMPLETED_QUESTS_FILE = "completed_quests.json";
const users = new Map(); // userId -> user record
const completedQuests = new Map(); // `${userId}-${questId}` -> { userId, questId, reward, completedAt }

const nowMs = () => Date.now();
const SESSION_TOKEN_HASH_PREFIX = "sha256:";
const hashSessionToken = (token) =>
  `${SESSION_TOKEN_HASH_PREFIX}${crypto.createHash("sha256").update(token).digest("hex")}`;

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
  let migratedTokens = false;
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      data.forEach((u) => {
        if (!u || !u.id) return;
        if (typeof u.sessionToken === "string" && !u.sessionToken.startsWith(SESSION_TOKEN_HASH_PREFIX)) {
          u.sessionToken = hashSessionToken(u.sessionToken);
          migratedTokens = true;
        }
        users.set(u.id, u);
      });
    }
  } catch {
    // No users.json yet, that's fine
  }
  if (migratedTokens) persistUsers();
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
      sessionToken: hashSessionToken(sessionToken),
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

export const transferCoinsAtomic = async (fromUserId, toUserId, amount) => {
  if (!fromUserId || !toUserId || typeof amount !== "number" || amount <= 0) {
    return { ok: false, error: "invalid_amount" };
  }
  if (fromUserId === toUserId) {
    return { ok: false, error: "self_transfer" };
  }

  if (isDbAvailable() && typeof dbTransferCoinsAtomic === "function") {
    return await dbTransferCoinsAtomic(fromUserId, toUserId, amount);
  }

  const sender = users.get(fromUserId);
  if (!sender) return { ok: false, error: "sender_not_found" };
  const recipient = users.get(toUserId);
  if (!recipient) return { ok: false, error: "recipient_not_found" };

  const senderCoins = typeof sender.coins === "number" ? sender.coins : DEFAULT_COINS;
  if (senderCoins < amount) return { ok: false, error: "insufficient", have: senderCoins };

  const recipientCoins = typeof recipient.coins === "number" ? recipient.coins : DEFAULT_COINS;
  const newSender = senderCoins - amount;
  const newRecipient = recipientCoins + amount;

  const now = nowMs();
  sender.coins = newSender;
  sender.updatedAt = now;
  sender.lastSeenAt = now;
  recipient.coins = newRecipient;
  recipient.updatedAt = now;
  recipient.lastSeenAt = now;
  persistUsers();

  return { ok: true, fromBalance: newSender, toBalance: newRecipient };
};

export const validateSessionToken = async (userId, token) => {
  if (!userId || !token) return false;
  if (isDbAvailable()) {
    return await dbValidateSessionToken(userId, token);
  }
  const user = users.get(userId);
  if (!user?.sessionToken) return false;
  const hashed = hashSessionToken(token);
  if (user.sessionToken === hashed) return true;

  // Backward compatibility for legacy plaintext tokens; upgrade on first valid use.
  if (user.sessionToken === token) {
    user.sessionToken = hashed;
    persistUsers();
    return true;
  }
  return false;
};

export const setSessionToken = async (userId, token) => {
  if (!userId || !token) return false;
  if (isDbAvailable() && typeof dbSetSessionToken === "function") {
    return await dbSetSessionToken(userId, token);
  }
  const user = users.get(userId);
  if (!user) return false;
  user.sessionToken = hashSessionToken(token);
  persistUsers();
  return true;
};

// --- Completed Quests (prevents re-acceptance for infinite coins) ---

const persistCompletedQuests = () => {
  if (isDbAvailable()) return;
  fs.writeFileSync(COMPLETED_QUESTS_FILE, JSON.stringify([...completedQuests.values()], null, 2));
};

export const loadCompletedQuests = () => {
  if (isDbAvailable()) return;
  try {
    const raw = fs.readFileSync(COMPLETED_QUESTS_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      data.forEach((entry) => {
        if (entry && entry.userId && entry.questId) {
          completedQuests.set(`${entry.userId}-${entry.questId}`, entry);
        }
      });
    }
  } catch {
    // No completed_quests.json yet, that's fine
  }
};

export const hasCompletedQuest = async (userId, questId) => {
  if (!userId || !questId) return false;
  if (isDbAvailable()) {
    return await dbHasCompletedQuest(userId, questId);
  }
  return completedQuests.has(`${userId}-${questId}`);
};

export const recordCompletedQuest = async (userId, questId, reward) => {
  if (!userId || !questId) return;
  if (isDbAvailable()) {
    await dbRecordCompletedQuest(userId, questId, reward);
    return;
  }
  const key = `${userId}-${questId}`;
  completedQuests.set(key, { userId, questId, reward, completedAt: Date.now() });
  persistCompletedQuests();
};
