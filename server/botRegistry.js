// Bot registry — in-memory store of registered bots and webhook delivery
// Extracted from index.js

import fs from "fs";
import crypto from "crypto";
import { hashApiKey } from "./rateLimiter.js";
import * as db from "./db.js";

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
        // Migration: normalize all existing bots to verified.
        if (!value.status || value.status === "pending") {
          value.status = "verified";
          value.verifiedAt = value.verifiedAt || new Date().toISOString();
          migrated = true;
        }
        botRegistry.set(hashed, value);
        migrated = true;
      } else {
        // Migration: normalize all existing bots to verified.
        if (!value.status || value.status === "pending") {
          value.status = "verified";
          value.verifiedAt = value.verifiedAt || new Date().toISOString();
          migrated = true;
        }
        botRegistry.set(key, value);
      }
    }
    // One-time cleanup of test bots
    const CLEANUP_BOTS = ["TestVerifyBot", "TestVerifyBot2"];
    for (const [key, value] of botRegistry) {
      if (CLEANUP_BOTS.includes(value.name)) {
        botRegistry.delete(key);
        migrated = true;
        console.log(`Cleaned up test bot: ${value.name}`);
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

/**
 * Reverse sync: load active agents from DB into botRegistry and normalize them.
 * Recovers bots when bot-registry.json is lost (e.g. ephemeral filesystem on deploy).
 * Call this at server startup after loadBotRegistry().
 */
export const syncAgentsToBotRegistry = async () => {
  const verifiedAgents = await db.listVerifiedAgentsWithHashes();
  let restored = 0;
  for (const agent of verifiedAgents) {
    if (botRegistry.has(agent.apiKeyHash)) continue;
    botRegistry.set(agent.apiKeyHash, {
      name: agent.name,
      createdAt: agent.createdAt,
      avatarUrl: agent.avatarUrl || null,
      webhookUrl: agent.webhookUrl || null,
      webhookSecret: agent.webhookSecret || crypto.randomBytes(32).toString("hex"),
      quests: [],
      shop: [],
      status: "verified",
      verifiedAt: agent.verifiedAt || new Date().toISOString(),
      roomId: agent.roomId || null,
    });
    restored++;
  }
  if (restored > 0) {
    saveBotRegistry();
    console.log(`[agents] Restored ${restored} verified bots from DB into registry`);
  }
};

/**
 * Sync bot registry to agents storage.
 * Creates agent records for all verified bots that don't have one yet.
 * Call this at server startup after loadBotRegistry().
 */
export const syncBotRegistryToAgents = async () => {
  let synced = 0;
  for (const [hashedKey, bot] of botRegistry) {
    if (bot.status !== "verified") continue;

    // Check if agent already exists
    const existing = await db.getAgentByApiKeyHash(hashedKey);
    if (existing) {
      // Fix stale status in DB (e.g. verified in registry but pending in DB)
      if (existing.status !== bot.status) {
        await db.updateAgent(existing.id, {
          status: bot.status,
          verifiedAt: bot.verifiedAt ? new Date(bot.verifiedAt) : null,
        });
        synced++;
      }
      continue;
    }

    // Create agent record
    await db.createAgent({
      name: bot.name,
      displayName: bot.name,
      description: "",
      apiKeyHash: hashedKey,
      avatarUrl: bot.avatarUrl || null,
      webhookUrl: bot.webhookUrl || null,
      webhookSecret: bot.webhookSecret || null,
      status: "verified",
    });
    synced++;
  }
  if (synced > 0) {
    console.log(`[agents] Synced ${synced} bots to agent storage`);
  }
};
