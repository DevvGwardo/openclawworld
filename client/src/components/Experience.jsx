import { CameraControls, Environment, Sky } from "@react-three/drei";

import { useFrame, useThree } from "@react-three/fiber";
import { useAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { Room } from "./Room";
import { mapAtom, roomIDAtom, userAtom } from "./SocketManager";
import { buildModeAtom, shopModeAtom } from "./UI";

const MIN_ZOOM = 8;
const MAX_ZOOM = 40;
const ZOOM_SPEED = 2;
const DEFAULT_ZOOM = 12;

export const Experience = ({ loaded }) => {
  const [buildMode] = useAtom(buildModeAtom);
  const [shopMode] = useAtom(shopModeAtom);

  const controls = useRef();
  const zoomLevel = useRef(DEFAULT_ZOOM);
  const [roomID] = useAtom(roomIDAtom);
  const [map] = useAtom(mapAtom);
  const [user] = useAtom(userAtom);

  // Handle scroll wheel for zoom
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const handleWheel = (e) => {
      if (buildMode || shopMode || !roomID) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? ZOOM_SPEED : -ZOOM_SPEED;
      zoomLevel.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel.current + delta));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [gl, buildMode, shopMode, roomID]);

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
    const z = zoomLevel.current;
    controls.current.setTarget(
      character.position.x,
      0,
      character.position.z,
      true
    );
    controls.current.setPosition(
      character.position.x + z,
      character.position.y + z,
      character.position.z + z,
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
