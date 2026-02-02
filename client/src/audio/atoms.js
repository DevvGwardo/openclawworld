import { atom } from "jotai";

// Helper to read persisted volume from localStorage
const getStored = (key, fallback) => {
  const v = localStorage.getItem(key);
  return v !== null ? parseFloat(v) : fallback;
};

// Volume atoms (0-1 range) — persisted to localStorage
export const masterVolumeAtom = atom(getStored("clawland_vol_master", 0.7));
export const musicVolumeAtom = atom(getStored("clawland_vol_music", 0.5));
export const sfxVolumeAtom = atom(getStored("clawland_vol_sfx", 0.7));
export const uiVolumeAtom = atom(getStored("clawland_vol_ui", 0.6));
export const mutedAtom = atom(localStorage.getItem("clawland_muted") === "true");
