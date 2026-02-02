import { Howl, Howler } from "howler";
import { SOUNDS } from "./sounds";

class SoundManager {
  constructor() {
    this._howls = {};
    this._initialized = false;
    this._masterVolume = 0.7;
    this._categoryVolumes = { music: 0.5, sfx: 0.7, ui: 0.6 };
    this._muted = false;
    this._currentMusic = null;
  }

  /** Initialize all Howl instances — call once after first user interaction */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    // Restore persisted settings
    const stored = (k, fb) => {
      const v = localStorage.getItem(k);
      return v !== null ? parseFloat(v) : fb;
    };
    this._masterVolume = stored("clawland_vol_master", 0.7);
    this._categoryVolumes.music = stored("clawland_vol_music", 0.5);
    this._categoryVolumes.sfx = stored("clawland_vol_sfx", 0.7);
    this._categoryVolumes.ui = stored("clawland_vol_ui", 0.6);
    this._muted = localStorage.getItem("clawland_muted") === "true";

    Howler.mute(this._muted);

    for (const [key, def] of Object.entries(SOUNDS)) {
      this._howls[key] = new Howl({
        src: [def.src],
        loop: def.loop || false,
        volume: this._computeVolume(def),
        preload: def.category === "ui", // preload UI sounds, lazy-load others
      });
    }
  }

  _computeVolume(def) {
    const catVol = this._categoryVolumes[def.category] ?? 1;
    return (def.volume ?? 1) * catVol * this._masterVolume;
  }

  /** Play a sound by key. Returns the Howl sound ID. */
  play(key) {
    if (!this._initialized) return;
    const howl = this._howls[key];
    if (!howl) return;
    return howl.play();
  }

  /** Stop a sound by key */
  stop(key) {
    if (!this._initialized) return;
    this._howls[key]?.stop();
  }

  /** Play background music with crossfade */
  playMusic(key) {
    if (!this._initialized) return;
    if (this._currentMusic === key) return;

    // Fade out current music
    if (this._currentMusic && this._howls[this._currentMusic]) {
      const old = this._howls[this._currentMusic];
      old.fade(old.volume(), 0, 1500);
      const oldKey = this._currentMusic;
      setTimeout(() => {
        if (this._currentMusic !== oldKey) {
          this._howls[oldKey]?.stop();
        }
      }, 1500);
    }

    this._currentMusic = key;
    const howl = this._howls[key];
    if (!howl) return;

    const def = SOUNDS[key];
    const targetVol = this._computeVolume(def);
    howl.volume(0);
    howl.play();
    howl.fade(0, targetVol, 1500);
  }

  /** Update volume for a category and recompute all affected Howl volumes */
  setVolume(category, value) {
    if (category === "master") {
      this._masterVolume = value;
      localStorage.setItem("clawland_vol_master", value);
    } else {
      this._categoryVolumes[category] = value;
      localStorage.setItem(`clawland_vol_${category}`, value);
    }
    this._updateAllVolumes();
  }

  _updateAllVolumes() {
    for (const [key, def] of Object.entries(SOUNDS)) {
      const howl = this._howls[key];
      if (howl) howl.volume(this._computeVolume(def));
    }
  }

  /** Toggle global mute */
  setMuted(muted) {
    this._muted = muted;
    localStorage.setItem("clawland_muted", muted);
    Howler.mute(muted);
  }

  get muted() {
    return this._muted;
  }

  get initialized() {
    return this._initialized;
  }
}

// Singleton instance — lives outside React lifecycle
const soundManager = new SoundManager();
export default soundManager;
