import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import { motion, AnimatePresence } from "framer-motion";
import { masterVolumeAtom, musicVolumeAtom, sfxVolumeAtom, uiVolumeAtom, mutedAtom } from "./atoms";
import soundManager from "./SoundManager";

const VolumeSlider = ({ label, value, onChange }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs text-gray-500 w-12 flex-shrink-0">{label}</span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="flex-1 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-slate-700"
    />
    <span className="text-[10px] text-gray-400 w-7 text-right">{Math.round(value * 100)}%</span>
  </div>
);

const AudioSettingsPanel = () => {
  const [open, setOpen] = useState(false);
  const [master, setMaster] = useAtom(masterVolumeAtom);
  const [music, setMusic] = useAtom(musicVolumeAtom);
  const [sfx, setSfx] = useAtom(sfxVolumeAtom);
  const [ui, setUi] = useAtom(uiVolumeAtom);
  const [muted, setMuted] = useAtom(mutedAtom);

  const updateVolume = (category, value, setter) => {
    setter(value);
    soundManager.setVolume(category, value);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundManager.setMuted(next);
  };

  // M key to toggle mute
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "m" && !e.ctrlKey && !e.metaKey && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        toggleMute();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [muted]);

  return (
    <div className="fixed bottom-3 left-3 z-[15]">
      {/* Speaker icon button */}
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm border border-gray-200 shadow-md flex items-center justify-center hover:bg-white transition-colors cursor-pointer"
        title={muted ? "Unmute (M)" : "Mute (M)"}
      >
        {muted ? (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-gray-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-gray-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
        )}
      </button>

      {/* Settings panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-12 left-0 bg-white/95 backdrop-blur-md rounded-xl shadow-xl border border-gray-200 p-3 w-60"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-gray-700">Audio</p>
              <button
                onClick={toggleMute}
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${
                  muted ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
                }`}
              >
                {muted ? "Muted" : "On"}
              </button>
            </div>
            <div className="space-y-2.5">
              <VolumeSlider label="Master" value={master} onChange={(v) => updateVolume("master", v, setMaster)} />
              <VolumeSlider label="Music" value={music} onChange={(v) => updateVolume("music", v, setMusic)} />
              <VolumeSlider label="SFX" value={sfx} onChange={(v) => updateVolume("sfx", v, setSfx)} />
              <VolumeSlider label="UI" value={ui} onChange={(v) => updateVolume("ui", v, setUi)} />
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-center">Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-gray-500 font-mono">M</kbd> to mute</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AudioSettingsPanel;
