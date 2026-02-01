import { CameraControls, Environment, Sky } from "@react-three/drei";

import { useFrame } from "@react-three/fiber";
import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { Room } from "./Room";
import { mapAtom, roomIDAtom, userAtom } from "./SocketManager";
import { buildModeAtom, shopModeAtom } from "./UI";
export const Experience = ({ loaded }) => {
  const [buildMode] = useAtom(buildModeAtom);
  const [shopMode] = useAtom(shopModeAtom);

  const controls = useRef();
  const [roomID] = useAtom(roomIDAtom);
  const [map] = useAtom(mapAtom);
  const [user] = useAtom(userAtom);

  useEffect(() => {
    // INITIAL POSITION
    if (!loaded) {
      controls.current.setPosition(0, 8, 2);
      controls.current.setTarget(0, 8, 0);
      return;
    }
    if (!roomID) {
      return;
    }
    if (shopMode) {
      controls.current.setPosition(0, 1, 6, true);
      controls.current.setTarget(0, 0, 0, true);
      return;
    }
    if (buildMode) {
      controls.current.setPosition(50, 40, 50, true);
      controls.current.setTarget(25, 0, 25, true);
      return;
    }

    // ROOM
    if (!buildMode && !shopMode && roomID) {
      controls.current.setPosition(0, 10, 5);
      controls.current.setTarget(0, 10, 0);
      return;
    }
  }, [buildMode, roomID, shopMode, loaded]);

  useFrame(({ scene }) => {
    if (!user) {
      return;
    }

    const character = scene.getObjectByName(`character-${user}`);
    if (!character) {
      return;
    }
    controls.current.setTarget(
      character.position.x,
      0,
      character.position.z,
      true
    );
    controls.current.setPosition(
      character.position.x + 12,
      character.position.y + 12,
      character.position.z + 12,
      true
    );
  });

  return (
    <>
      <Sky
        distance={450000}
        sunPosition={[5, 8, 20]}
        inclination={0}
        azimuth={0.25}
        rayleigh={0.1}
      />
      <Environment files={"/textures/venice_sunset_1k.hdr"} />

      <ambientLight intensity={0.1} />
      <directionalLight
        position={[15, 20, -15]}
        castShadow
        intensity={0.35}
        shadow-mapSize={[2048, 2048]}
      >
        <orthographicCamera
          attach={"shadow-camera"}
          args={[-30, 30, 30, -30]}
          far={60}
        />
      </directionalLight>
      <CameraControls
        ref={controls}
        // disable all mouse buttons
        mouseButtons={{
          left: 0,
          middle: 0,
          right: 0,
          wheel: 0,
        }}
        // disable all touch gestures
        touches={{
          one: 0,
          two: 0,
          three: 0,
        }}
      />
      {roomID && map && <Room />}
    </>
  );
};
