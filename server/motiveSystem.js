// Motive decay system — 1Hz loop for needs decay and interaction completion
// Extracted from index.js

export const _prevMotiveBuckets = new Map(); // charId -> { energy, social, fun, hunger }

export const startMotiveDecayLoop = (deps) => {
  const { io, getAllCachedRooms, DECAY_RATES, MOTIVE_CLAMP, OBJECT_AFFORDANCES } = deps;

  setInterval(() => {
    for (const room of getAllCachedRooms()) {
      if (!room.characters) continue;
      for (const char of room.characters) {
        if (!char.motives) continue;

        // 1. Apply decay
        for (const key of Object.keys(DECAY_RATES)) {
          char.motives[key] = Math.max(
            MOTIVE_CLAMP.min,
            Math.min(MOTIVE_CLAMP.max, char.motives[key] - DECAY_RATES[key])
          );
        }

        // 2. Check interaction completion
        if (char.interactionState && Date.now() >= char.interactionState.endsAt) {
          const aff = OBJECT_AFFORDANCES[char.interactionState.interactionType];
          if (aff) {
            for (const [key, amount] of Object.entries(aff.satisfies)) {
              char.motives[key] = Math.min(MOTIVE_CLAMP.max, char.motives[key] + amount);
            }
          }
          char.interactionState = null;
          io.to(room.id).emit("character:stateChange", {
            id: char.id,
            state: null,
            motives: char.motives,
          });
        }

        // 3. Threshold-based broadcast (every 10% crossing)
        const prevBuckets = _prevMotiveBuckets.get(char.id) || {};
        let crossed = false;
        const newBuckets = {};
        for (const key of Object.keys(DECAY_RATES)) {
          const bucket = Math.floor(char.motives[key] / 10);
          newBuckets[key] = bucket;
          if (prevBuckets[key] !== undefined && prevBuckets[key] !== bucket) {
            crossed = true;
          }
        }
        _prevMotiveBuckets.set(char.id, newBuckets);
        if (crossed) {
          io.to(room.id).emit("motives:update", {
            id: char.id,
            motives: char.motives,
          });
        }
      }
    }
  }, 1000);
};
