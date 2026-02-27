import { atom } from "jotai";

// Which drawer is open. null = all closed.
// Values: "chat" | "dms" | "wallet" | "audio" | "help" | "bulletin" | null
export const activeDrawerAtom = atom(null);
