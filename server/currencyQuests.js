// Currency and quest system
// Extracted from index.js

import { DEFAULT_COINS, getUser, setUserCoins, updateUserCoins, transferCoinsAtomic, hasCompletedQuest, recordCompletedQuest } from "./userStore.js";

export { DEFAULT_COINS };

// userId -> coin balance (cache)
export const playerCoins = new Map();

export const getCoins = async (userId) => {
  if (!userId) return DEFAULT_COINS;
  const cached = playerCoins.get(userId);
  if (typeof cached === "number") return cached;
  const user = await getUser(userId);
  if (!user) return DEFAULT_COINS;
  const coins = typeof user.coins === "number" ? user.coins : DEFAULT_COINS;
  playerCoins.set(userId, coins);
  return coins;
};

export const setCoins = async (userId, coins, ioRef, userSockets) => {
  if (!userId || typeof coins !== "number") return null;
  playerCoins.set(userId, coins);
  await setUserCoins(userId, coins);
  if (ioRef && userSockets) {
    const sockets = userSockets.get(userId);
    if (sockets) {
      for (const socketId of sockets) {
        ioRef.to(socketId).emit("coinsUpdate", { coins });
      }
    }
  }
  return coins;
};

export const updateCoins = async (userId, delta, ioRef, userSockets) => {
  if (!userId || typeof delta !== "number") return null;
  const updated = await updateUserCoins(userId, delta);
  if (typeof updated === "number") {
    playerCoins.set(userId, updated);
    if (ioRef && userSockets) {
      const sockets = userSockets.get(userId);
      if (sockets) {
        for (const socketId of sockets) {
          ioRef.to(socketId).emit("coinsUpdate", { coins: updated });
        }
      }
    }
  }
  return updated;
};

export const transferCoins = async (fromUserId, toUserId, amount, ioRef, userSockets) => {
  if (!fromUserId || !toUserId || typeof amount !== "number") {
    return { ok: false, error: "invalid_amount" };
  }
  const result = await transferCoinsAtomic(fromUserId, toUserId, amount);
  if (!result || result.ok !== true) return result;

  if (typeof result.fromBalance === "number") {
    playerCoins.set(fromUserId, result.fromBalance);
  }
  if (typeof result.toBalance === "number") {
    playerCoins.set(toUserId, result.toBalance);
  }

  if (ioRef && userSockets) {
    const senderSockets = userSockets.get(fromUserId);
    if (senderSockets) {
      for (const socketId of senderSockets) {
        ioRef.to(socketId).emit("coinsUpdate", { coins: result.fromBalance });
      }
    }
    const recipientSockets = userSockets.get(toUserId);
    if (recipientSockets) {
      for (const socketId of recipientSockets) {
        ioRef.to(socketId).emit("coinsUpdate", { coins: result.toBalance });
      }
    }
  }

  return result;
};

export const activeQuests = new Map(); // `${socketId}-${questId}` -> assignment data

export { hasCompletedQuest };

export const checkQuestCompletion = async (socketId, userId, room, ioRef, userSockets) => {
  for (const [questKey, assignment] of activeQuests) {
    if (assignment.socketId !== socketId) continue;
    const quest = assignment.quest;
    if (!quest.required_items || quest.required_items.length === 0) continue;
    // Check if all required items are present in the room
    const allPlaced = quest.required_items.every(itemName =>
      room.items.some(i => i.name === itemName)
    );
    if (allPlaced) {
      // Delete BEFORE awaiting to prevent race condition —
      // JS is single-threaded between await points, so no concurrent
      // call can find this quest once we delete it synchronously.
      activeQuests.delete(questKey);

      // Safety net: skip if already recorded as completed
      if (userId && await hasCompletedQuest(userId, quest.id)) {
        // Notify client so the quest doesn't silently disappear
        ioRef.to(socketId).emit("questError", { error: "Quest already completed" });
        continue;
      }

      const reward = quest.reward_coins || 50;
      let coinsAwarded = false;
      try {
        await updateCoins(userId, reward, ioRef, userSockets);
        coinsAwarded = true;
      } catch (err) {
        console.error("[checkQuestCompletion] Failed to award coins:", err);
      }

      // Only persist completion if coins were successfully awarded —
      // otherwise leave the quest unrecorded so a retry can succeed.
      if (coinsAwarded) {
        try {
          await recordCompletedQuest(userId, quest.id, reward);
        } catch (err) {
          console.error("[checkQuestCompletion] Failed to record completion:", err);
        }
      }

      ioRef.to(socketId).emit("questCompleted", {
        questId: quest.id,
        title: quest.title,
        reward,
        coins: (playerCoins.get(userId) || DEFAULT_COINS),
      });
    }
  }
};
