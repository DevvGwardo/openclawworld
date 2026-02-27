import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import { masterVolumeAtom, musicVolumeAtom, sfxVolumeAtom, uiVolumeAtom, mutedAtom } from "./atoms";
import { activeDrawerAtom } from "../components/ui-atoms";
import Drawer from "../components/Drawer";
import soundManager from "./SoundManager";

const VolumeSlider = ({ label, value, onChange }) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-slate-400 w-12 flex-shrink-0">{label}</span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="flex-1 h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-orange-500"
    />
    <span className="text-[10px] text-slate-500 w-7 text-right">{Math.round(value * 100)}%</span>
  </div>
);

const AudioSettingsPanel = () => {
  const [activeDrawer, setActiveDrawer] = useAtom(activeDrawerAtom);
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
    <Drawer
      isOpen={activeDrawer === "audio"}
      onClose={() => setActiveDrawer(null)}
      maxHeight="30vh"
      title="Audio Settings"
    >
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold text-white">Volume</p>
          <button
            onClick={toggleMute}
            className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${
              muted ? "bg-red-900/60 text-red-300 border border-red-700/50" : "bg-green-900/60 text-green-300 border border-green-700/50"
            }`}
          >
            {muted ? "Muted" : "On"}
          </button>
        </div>
        <div className="space-y-3">
          <VolumeSlider label="Master" value={master} onChange={(v) => updateVolume("master", v, setMaster)} />
          <VolumeSlider label="Music" value={music} onChange={(v) => updateVolume("music", v, setMusic)} />
          <VolumeSlider label="SFX" value={sfx} onChange={(v) => updateVolume("sfx", v, setSfx)} />
          <VolumeSlider label="UI" value={ui} onChange={(v) => updateVolume("ui", v, setUi)} />
        </div>
        <p className="text-[10px] text-slate-500 mt-3 text-center">
          Press <kbd className="px-1 py-0.5 bg-slate-700 rounded text-slate-400 font-mono">M</kbd> to mute
        </p>
      </div>
    </Drawer>
  );
};

export default AudioSettingsPanel;
