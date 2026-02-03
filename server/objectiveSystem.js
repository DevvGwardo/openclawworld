// Objective system — session-based daily tasks, room goals, and bond milestones
// All state is per-socket and resets on disconnect (no persistence for v1)

const DAILY_TASKS = [
  { id: "wave_2", label: "Wave at 2 different players", trackKey: "wave_targets", target: 2, reward: 25 },
  { id: "place_3", label: "Place 3 items in a room", trackKey: "items_placed", target: 3, reward: 30 },
  { id: "chat_5", label: "Chat with 5 people", trackKey: "chat_targets", target: 5, reward: 35 },
  { id: "use_3", label: "Use 3 different objects", trackKey: "objects_used", target: 3, reward: 25 },
  { id: "sit_2", label: "Sit on 2 pieces of furniture", trackKey: "sits", target: 2, reward: 20 },
];

const ROOM_GOALS = [
  { id: "furnish_bedroom", label: "Furnish the bedroom", match: ["bedSingle", "bedDouble"], reward: 40 },
  { id: "setup_kitchen", label: "Set up the kitchen", match: ["kitchenStove", "kitchenFridge", "kitchenFridgeLarge", "kitchenSink", "kitchenCabinet", "kitchenCabinetCornerRound", "kitchenCabinetCornerInner", "kitchenBar", "kitchenBlender", "kitchenMicrowave"], reward: 40 },
  { id: "add_entertainment", label: "Add entertainment", match: ["televisionVintage", "televisionModern", "speaker", "speakerSmall", "radio"], reward: 35 },
  { id: "create_dining", label: "Create a dining area", match: ["table", "tableCrossCloth", "tableCoffee", "tableCoffeeGlassSquare"], reward: 35 },
];

const BOND_MILESTONES = [
  { id: "bond_1", label: "Reach Acquaintance", level: 1, reward: 20 },
  { id: "bond_2", label: "Reach Friend", level: 2, reward: 40 },
  { id: "bond_3", label: "Reach Close Friend", level: 3, reward: 60 },
  { id: "bond_4", label: "Reach Best Friend", level: 4, reward: 80 },
  { id: "bond_5", label: "Reach Bonded", level: 5, reward: 100 },
];

// Per-socket state
const objectivesState = new Map();

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function initObjectives(socketId) {
  // Pick 3 random dailies
  const picked = shuffleArray(DAILY_TASKS).slice(0, 3);
  const dailies = picked.map(d => ({
    ...d,
    progress: new Set(),
    count: 0,
    completed: false,
  }));

  const roomGoals = ROOM_GOALS.map(g => ({
    ...g,
    completed: false,
  }));

  const bondMilestones = BOND_MILESTONES.map(m => ({
    ...m,
    completed: false,
  }));

  const state = { dailies, roomGoals, bondMilestones };
  objectivesState.set(socketId, state);
  return state;
}

/**
 * Track progress on a daily task.
 * @param {string} socketId
 * @param {string} trackKey - e.g. "wave_targets", "items_placed"
 * @param {string} [uniqueValue] - unique identifier (for set-based tracking). Omit for count-based.
 * @returns {Array} newly completed objectives
 */
export function trackDaily(socketId, trackKey, uniqueValue) {
  const state = objectivesState.get(socketId);
  if (!state) return [];

  const completed = [];
  for (const daily of state.dailies) {
    if (daily.completed || daily.trackKey !== trackKey) continue;

    if (uniqueValue !== undefined) {
      daily.progress.add(uniqueValue);
      daily.count = daily.progress.size;
    } else {
      daily.count++;
    }

    if (daily.count >= daily.target) {
      daily.completed = true;
      completed.push({ id: daily.id, label: daily.label, reward: daily.reward, type: "daily" });
    }
  }
  return completed;
}

/**
 * Check room goals against current room items.
 * @param {string} socketId
 * @param {Array} roomItems - array of { name, ... }
 * @returns {Array} newly completed objectives
 */
export function checkRoomGoals(socketId, roomItems) {
  const state = objectivesState.get(socketId);
  if (!state) return [];

  const itemNames = new Set(roomItems.map(i => i.name));
  const completed = [];

  for (const goal of state.roomGoals) {
    if (goal.completed) continue;
    const hasMatch = goal.match.some(m => itemNames.has(m));
    if (hasMatch) {
      goal.completed = true;
      completed.push({ id: goal.id, label: goal.label, reward: goal.reward, type: "room" });
    }
  }
  return completed;
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
    dailies: state.dailies.map(d => ({
      id: d.id,
      label: d.label,
      target: d.target,
      count: d.count,
      reward: d.reward,
      completed: d.completed,
    })),
    roomGoals: state.roomGoals.map(g => ({
      id: g.id,
      label: g.label,
      reward: g.reward,
      completed: g.completed,
    })),
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
