import { Canvas } from "@react-three/fiber";
// import { EffectComposer, N8AO } from "@react-three/postprocessing";
import { useProgress } from "@react-three/drei";
import { useAtom } from "jotai";
import { useEffect, useState, useRef } from "react";
import { Experience } from "./components/Experience";
import { Loader, BubblesBackground } from "./components/Loader";
import {
  SocketManager,
  itemsAtom,
  usernameAtom,
} from "./components/SocketManager";
import { UI } from "./components/UI";
import { ActivityFeed } from "./components/ActivityFeed";
import { WelcomeModal } from "./components/WelcomeModal";
import { CharacterMenu, followedCharacterAtom } from "./components/Avatar";
import { Minimap } from "./components/Minimap";
import soundManager from "./audio/SoundManager";
import AudioSettingsPanel from "./audio/AudioSettingsPanel";
import { BulletinBoardPanel } from "./components/BulletinBoard";

const makeFallbackUsername = (role = "human") => {
  const prefix = role === "agent" ? "Agent" : "Guest";
  return `${prefix}-${Math.random().toString(36).slice(2, 6)}`;
};

const FollowIndicator = () => {
  const [followedCharacter, setFollowedCharacter] = useAtom(followedCharacterAtom);
  if (!followedCharacter) return null;
  return (
    <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[35] flex items-center gap-2 bg-blue-600/90 backdrop-blur-sm text-white px-4 py-2 rounded-full shadow-lg border border-blue-400/30">
      <span className="text-sm font-medium">Following {followedCharacter.name}</span>
      <button
        onClick={() => setFollowedCharacter(null)}
        className="ml-1 bg-white/20 hover:bg-white/30 rounded-full w-6 h-6 flex items-center justify-center text-xs transition-colors"
      >
        ✕
      </button>
    </div>
  );
};

function App() {
  const { progress } = useProgress();
  const [loaded, setLoaded] = useState(false);
  const [username, setUsername] = useAtom(usernameAtom);
  const [showWelcome, setShowWelcome] = useState(
    !localStorage.getItem("clawland_onboarded_v2")
  );
  const [items] = useAtom(itemsAtom);
  const soundInitRef = useRef(false);

  useEffect(() => {
    const isOnboarded = localStorage.getItem("clawland_onboarded_v2") === "1";
    const storedName = (localStorage.getItem("clawland_username") || "").trim();
    if (!isOnboarded || storedName) return;
    const fallback = makeFallbackUsername(localStorage.getItem("clawland_role") || "human");
    localStorage.setItem("clawland_username", fallback);
    setUsername(fallback);
  }, [setUsername]);

  // Cleanup legacy invite-link state from previous builds.
  useEffect(() => {
    localStorage.removeItem("clawland_pendingInvite");
    if (window.location.search.includes("invite=")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (progress === 100 && items) {
      setLoaded(true); // As progress can go back to 0 when new resources are loaded, we need to make sure we don't fade out the UI when that happens
    }
  }, [progress]);

  // Initialize sound system on first user interaction (browser autoplay policy)
  useEffect(() => {
    const initSound = () => {
      if (!soundInitRef.current) {
        soundInitRef.current = true;
        soundManager.init();
        soundManager.playMusic("ambient_room");
      }
    };
    window.addEventListener("click", initSound, { once: true });
    window.addEventListener("keydown", initSound, { once: true });
    return () => {
      window.removeEventListener("click", initSound);
      window.removeEventListener("keydown", initSound);
    };
  }, []);

  return (
    <>
      <SocketManager />
      <Canvas
        shadows
        dpr={[1, 2]}
        frameloop={loaded && showWelcome ? "never" : "always"}
        camera={{
          position: [0, 8, 2],
          fov: 30,
        }}
      >
        <color attach="background" args={["#ffffff"]} />
        <Experience loaded={loaded} />
        {/* Impact badly performances without a noticeable good result */}
        {/* <EffectComposer>
          <N8AO intensity={0.42} />
        </EffectComposer> */}
      </Canvas>
      <Loader loaded={loaded} />

      {loaded && <ActivityFeed />}
      {loaded && <CharacterMenu />}
      {loaded && <FollowIndicator />}
      {loaded && <UI />}
      {loaded && <Minimap />}
      {loaded && <AudioSettingsPanel />}
      {loaded && <BulletinBoardPanel />}
      {loaded && showWelcome && (
        <>
          <BubblesBackground />
          <WelcomeModal
            onChoice={(choice, name) => {
              localStorage.setItem("clawland_role", choice);
              localStorage.setItem("clawland_onboarded_v2", "1");
              const storedName = (localStorage.getItem("clawland_username") || "").trim();
              const resolvedName = (name || "").trim() || storedName || makeFallbackUsername(choice);
              localStorage.setItem("clawland_username", resolvedName);
              setUsername(resolvedName);
              setShowWelcome(false);
            }}
          />
        </>
      )}
    </>
  );
}

export default App;
