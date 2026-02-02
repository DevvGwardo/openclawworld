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
