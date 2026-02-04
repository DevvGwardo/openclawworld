// Currency and quest system
// Extracted from index.js

import { DEFAULT_COINS, getUser, setUserCoins, updateUserCoins } from "./userStore.js";

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

export const activeQuests = new Map(); // `${socketId}-${questId}` -> assignment data

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
      // Quest complete!
      const reward = quest.reward_coins || 50;
      await updateCoins(userId, reward, ioRef, userSockets);
      ioRef.to(socketId).emit("questCompleted", {
        questId: quest.id,
        title: quest.title,
        reward,
        coins: (playerCoins.get(userId) || DEFAULT_COINS),
      });
      activeQuests.delete(questKey);
    }
  }
};
