import { useCallback } from "react";
import soundManager from "./SoundManager";

/**
 * Hook that returns a play function for a given sound key.
 * Usage: const playClick = useSound("button_click");
 */
export function useSound(key) {
  return useCallback(() => {
    soundManager.play(key);
  }, [key]);
}

/**
 * Hook that returns the soundManager for direct control.
 */
export function useSoundManager() {
  return soundManager;
}
