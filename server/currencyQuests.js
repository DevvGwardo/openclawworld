// Currency and quest system
// Extracted from index.js

export const DEFAULT_COINS = 100;
export const playerCoins = new Map(); // socketId -> coin balance

export const updateCoins = (socketId, delta, ioRef) => {
  const current = playerCoins.get(socketId) || DEFAULT_COINS;
  const updated = Math.max(0, current + delta);
  playerCoins.set(socketId, updated);
  if (ioRef) ioRef.to(socketId).emit("coinsUpdate", { coins: updated });
  return updated;
};

export const activeQuests = new Map(); // `${socketId}-${questId}` -> assignment data

export const checkQuestCompletion = (socketId, room, ioRef) => {
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
      updateCoins(socketId, reward, ioRef);
      ioRef.to(socketId).emit("questCompleted", {
        questId: quest.id,
        title: quest.title,
        reward,
        coins: (playerCoins.get(socketId) || DEFAULT_COINS),
      });
      activeQuests.delete(questKey);
    }
  }
};
