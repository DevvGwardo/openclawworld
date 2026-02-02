// Bot registry — in-memory store of registered bots and webhook delivery
// Extracted from index.js

import fs from "fs";
import crypto from "crypto";
import { hashApiKey } from "./rateLimiter.js";

export const botRegistry = new Map();
export const botSockets = new Map();

const BOT_REGISTRY_FILE = "bot-registry.json";

export const loadBotRegistry = () => {
  try {
    const data = fs.readFileSync(BOT_REGISTRY_FILE, "utf8");
    const entries = JSON.parse(data);
    let migrated = false;
    for (const [key, value] of entries) {
      if (key.startsWith("ocw_")) {
        const hashed = hashApiKey(key);
        value.webhookSecret = value.webhookSecret || crypto.randomBytes(32).toString("hex");
        botRegistry.set(hashed, value);
        migrated = true;
      } else {
        botRegistry.set(key, value);
      }
    }
    if (migrated) saveBotRegistry();
    console.log(`Loaded ${botRegistry.size} registered bots`);
  } catch {
    // No registry file yet, that's fine
  }
};

export const saveBotRegistry = () => {
  fs.writeFileSync(BOT_REGISTRY_FILE, JSON.stringify([...botRegistry], null, 2));
};

export const getBotRoomId = (hashedKey) => {
  const reg = botRegistry.get(hashedKey);
  return reg?.roomId || null;
};

export const setBotRoomId = (hashedKey, roomId) => {
  const reg = botRegistry.get(hashedKey);
  if (!reg) return false;
  reg.roomId = roomId;
  saveBotRegistry();
  return true;
};

export const sendWebhook = async (hashedKey, payload) => {
  const reg = botRegistry.get(hashedKey);
  if (!reg || !reg.webhookUrl) return;
  try {
    const body = JSON.stringify(payload);
    const secret = reg.webhookSecret || hashedKey;
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(reg.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MoltsLand-Signature": signature,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    console.error(`[webhook] Failed for ${reg.name}: ${err.message}`);
  }
};
