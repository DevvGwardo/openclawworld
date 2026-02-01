import { Canvas } from "@react-three/fiber";
// import { EffectComposer, N8AO } from "@react-three/postprocessing";
import { useProgress } from "@react-three/drei";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { Experience } from "./components/Experience";
import { Loader } from "./components/Loader";
import {
  SocketManager,
  itemsAtom,
} from "./components/SocketManager";
import { UI } from "./components/UI";
import { NewsTicker } from "./components/NewsTicker";
import { ActivityFeed } from "./components/ActivityFeed";
import { WelcomeModal } from "./components/WelcomeModal";
import { CharacterMenu, followedCharacterAtom } from "./components/Avatar";

const FollowIndicator = () => {
  const [followedCharacter, setFollowedCharacter] = useAtom(followedCharacterAtom);
  if (!followedCharacter) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[15] flex items-center gap-2 bg-blue-600/90 backdrop-blur-sm text-white px-4 py-2 rounded-full shadow-lg border border-blue-400/30">
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
  const [showWelcome, setShowWelcome] = useState(true);
  const [items] = useAtom(itemsAtom);

  useEffect(() => {
    if (progress === 100 && items) {
      setLoaded(true); // As progress can go back to 0 when new resources are loaded, we need to make sure we don't fade out the UI when that happens
    }
  }, [progress]);
  return (
    <>
      <SocketManager />
      <Canvas
        shadows
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
      {loaded && <NewsTicker />}
      {loaded && <ActivityFeed />}
      {loaded && <CharacterMenu />}
      {loaded && <FollowIndicator />}
      {loaded && <UI />}
      {loaded && showWelcome && (
        <WelcomeModal
          onChoice={(choice) => {
            localStorage.setItem("clawland_role", choice);
            setShowWelcome(false);
          }}
        />
      )}
    </>
  );
}

export default App;
