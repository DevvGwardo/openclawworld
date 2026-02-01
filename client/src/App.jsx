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

function App() {
  const { progress } = useProgress();
  const [loaded, setLoaded] = useState(false);
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
      {loaded && <UI />}
    </>
  );
}

export default App;
