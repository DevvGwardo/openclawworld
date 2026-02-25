// Bond system — persistent relationship tracking between character pairs
// Extracted from index.js — self-contained state with file I/O

import fs from "fs";

export const bonds = new Map();
const BONDS_FILE = "bonds.json";

export const BOND_LEVELS = [
  { threshold: 0, label: "Stranger" },
  { threshold: 3, label: "Acquaintance" },
  { threshold: 8, label: "Friend" },
  { threshold: 15, label: "Close Friend" },
  { threshold: 25, label: "Best Friend" },
  { threshold: 40, label: "Bonded" },
];

export const bondKey = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join("::");

export const getBondLevel = (score) => {
  for (let i = BOND_LEVELS.length - 1; i >= 0; i--) {
    if (score >= BOND_LEVELS[i].threshold) return i;
  }
  return 0;
};

export const loadBonds = () => {
  try {
    const data = fs.readFileSync(BONDS_FILE, "utf8");
    const entries = JSON.parse(data);
    for (const [key, value] of entries) {
      bonds.set(key, value);
    }
    console.log(`Loaded ${bonds.size} bond records`);
  } catch {
    // No bonds file yet, that's fine
  }
};

export const saveBonds = () => {
  fs.writeFileSync(BONDS_FILE, JSON.stringify([...bonds], null, 2));
};

const normalizeBondRecord = (record = {}) => ({
  score: typeof record.score === "number" ? record.score : 0,
  lastWave: typeof record.lastWave === "number" ? record.lastWave : 0,
  lastInteractionAt: typeof record.lastInteractionAt === "number" ? record.lastInteractionAt : 0,
  cooldowns: record.cooldowns && typeof record.cooldowns === "object" ? { ...record.cooldowns } : {},
});

export const applyBondProgress = ({
  bondsMap,
  senderName,
  targetName,
  eventType,
  baseDelta,
  cooldownMs,
  now = Date.now(),
}) => {
  if (!senderName || !targetName) return null;
  if (senderName.toLowerCase() === targetName.toLowerCase()) return null;
  if (typeof baseDelta !== "number" || baseDelta <= 0) return null;

  const key = bondKey(senderName, targetName);
  const bond = normalizeBondRecord(bondsMap.get(key));
  const cooldownKey = String(eventType || "social");
  const lastAt = typeof bond.cooldowns[cooldownKey] === "number" ? bond.cooldowns[cooldownKey] : 0;
  if (cooldownMs > 0 && now - lastAt < cooldownMs) return null;

  const delta = Math.max(0.1, Math.round(baseDelta * 100) / 100);
  const prevScore = bond.score;

  bond.score = Math.max(0, Math.round((bond.score + delta) * 100) / 100);
  bond.lastInteractionAt = now;
  bond.cooldowns[cooldownKey] = now;
  if (cooldownKey === "wave") {
    bond.lastWave = now;
  }

  bondsMap.set(key, bond);

  const level = getBondLevel(bond.score);
  const maxLevel = level === BOND_LEVELS.length - 1;
  const nextThreshold = maxLevel ? null : BOND_LEVELS[level + 1].threshold;

  return {
    key,
    bond,
    prevScore,
    delta,
    level,
    levelLabel: BOND_LEVELS[level].label,
    maxLevel,
    nextThreshold,
    reachedMaxThisEvent:
      !maxLevel
        ? false
        : prevScore < BOND_LEVELS[BOND_LEVELS.length - 1].threshold &&
          bond.score >= BOND_LEVELS[BOND_LEVELS.length - 1].threshold,
  };
};
