import { atom } from "jotai";

// Active drawer atom — controls which drawer is currently open
// Managed by BottomToolbar; read by individual panel components
// Values: "chat" | "dms" | "wallet" | "audio" | "help" | null
export const activeDrawerAtom = atom(null);
