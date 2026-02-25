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
  const [inviteData, setInviteData] = useState(null); // { botName } if valid invite

  useEffect(() => {
    const isOnboarded = localStorage.getItem("clawland_onboarded_v2") === "1";
    const storedName = (localStorage.getItem("clawland_username") || "").trim();
    if (!isOnboarded || storedName) return;
    const fallback = makeFallbackUsername(localStorage.getItem("clawland_role") || "human");
    localStorage.setItem("clawland_username", fallback);
    setUsername(fallback);
  }, [setUsername]);

  // Check for invite token in URL or restore from localStorage
  useEffect(() => {
    // Already onboarded - no need to check invites
    if (localStorage.getItem("clawland_onboarded_v2")) return;

    const apiBase =
      import.meta.env.VITE_API_URL ||
      import.meta.env.VITE_SERVER_URL ||
      "http://localhost:3000";
    const params = new URLSearchParams(window.location.search);
    const urlInviteToken = params.get("invite");

    // Helper to validate and set invite data
    const validateAndSetInvite = (token) => {
      return fetch(`${apiBase}/api/v1/invites/${token}/validate`)
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            // Save to localStorage for future returns
            localStorage.setItem(
              "clawland_pendingInvite",
              JSON.stringify({
                token,
                botName: data.bot_name,
              })
            );
            setInviteData({
              botName: data.bot_name,
            });
            return true;
          }
          // Invalid - clear any stale localStorage
          localStorage.removeItem("clawland_pendingInvite");
          return false;
        })
        .catch(() => {
          localStorage.removeItem("clawland_pendingInvite");
          return false;
        });
    };

    if (urlInviteToken) {
      // URL has invite token - validate it
      validateAndSetInvite(urlInviteToken);
    } else {
      // No URL token - check localStorage for pending invite
      const stored = localStorage.getItem("clawland_pendingInvite");
      if (stored) {
        try {
          const { token } = JSON.parse(stored);
          // Re-validate with server (token may have expired)
          validateAndSetInvite(token);
        } catch {
          localStorage.removeItem("clawland_pendingInvite");
        }
      }
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
            inviteData={inviteData}
            onChoice={(choice, name) => {
              localStorage.setItem("clawland_role", choice);
              localStorage.setItem("clawland_onboarded_v2", "1");
              // Clear pending invite - it's been consumed
              localStorage.removeItem("clawland_pendingInvite");
              const storedName = (localStorage.getItem("clawland_username") || "").trim();
              const resolvedName = (name || "").trim() || storedName || makeFallbackUsername(choice);
              localStorage.setItem("clawland_username", resolvedName);
              setUsername(resolvedName);
              // Clear invite param from URL after successful entry
              if (window.location.search.includes("invite=")) {
                window.history.replaceState({}, "", window.location.pathname);
              }
              setShowWelcome(false);
            }}
          />
        </>
      )}
    </>
  );
}

export default App;
