// Objective system — bond milestones only.
// All state is per-socket and resets on disconnect (no persistence for v1)

const BOND_MILESTONES = [
  { id: "bond_1", label: "Reach Acquaintance", level: 1, reward: 20 },
  { id: "bond_2", label: "Reach Friend", level: 2, reward: 40 },
  { id: "bond_3", label: "Reach Close Friend", level: 3, reward: 60 },
  { id: "bond_4", label: "Reach Best Friend", level: 4, reward: 80 },
  { id: "bond_5", label: "Reach Bonded", level: 5, reward: 100 },
];

const objectivesState = new Map();

export function initObjectives(socketId) {
  const bondMilestones = BOND_MILESTONES.map(m => ({
    ...m,
    completed: false,
  }));

  const state = { bondMilestones };
  objectivesState.set(socketId, state);
  return state;
}

// Legacy API retained for compatibility; daily tasks are disabled.
export function trackDaily(socketId, trackKey, uniqueValue) {
  void socketId;
  void trackKey;
  void uniqueValue;
  return [];
}

// Legacy API retained for compatibility; room goals are disabled.
export function checkRoomGoals(socketId, itemName) {
  void socketId;
  void itemName;
  return [];
}

/**
 * Check bond milestones against a bond level.
 * Bond milestones are cumulative — reaching level 3 auto-completes 1 and 2.
 * @param {string} socketId
 * @param {number} bondLevel - current bond level (0-5)
 * @returns {Array} newly completed objectives
 */
export function checkBondMilestones(socketId, bondLevel) {
  const state = objectivesState.get(socketId);
  if (!state) return [];

  const completed = [];
  for (const milestone of state.bondMilestones) {
    if (milestone.completed) continue;
    if (bondLevel >= milestone.level) {
      milestone.completed = true;
      completed.push({ id: milestone.id, label: milestone.label, reward: milestone.reward, type: "bond" });
    }
  }
  return completed;
}

/**
 * Build a JSON-safe payload for sending to the client.
 * @param {string} socketId
 * @returns {object|null}
 */
export function objectivesPayload(socketId) {
  const state = objectivesState.get(socketId);
  if (!state) return null;

  return {
    dailies: [],
    roomGoals: [],
    bondMilestones: state.bondMilestones.map(m => ({
      id: m.id,
      label: m.label,
      level: m.level,
      reward: m.reward,
      completed: m.completed,
    })),
  };
}

/**
 * Clean up objectives state on disconnect.
 * @param {string} socketId
 */
export function cleanupObjectives(socketId) {
  objectivesState.delete(socketId);
}
