import { CameraControls, Environment, Sky } from "@react-three/drei";

import { useFrame, useThree } from "@react-three/fiber";
import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { Room } from "./Room";
import { mapAtom, roomIDAtom, userAtom } from "./SocketManager";
import { buildModeAtom, shopModeAtom } from "./UI";
import { followedCharacterAtom } from "./Avatar";

const MIN_ZOOM = 8;
const MAX_ZOOM = 40;
const ZOOM_SPEED = 2;
const DEFAULT_ZOOM = 12;
const ROTATE_SPEED = 0.005; // radians per pixel of mouse drag
const ROTATE_KEY_SPEED = 2; // radians per second for Q/E keys
const DEFAULT_ANGLE = Math.PI / 4; // 45 degrees — isometric default

export const Experience = ({ loaded }) => {
  const [buildMode] = useAtom(buildModeAtom);
  const [shopMode] = useAtom(shopModeAtom);

  const controls = useRef();
  const zoomLevel = useRef(DEFAULT_ZOOM);
  const cameraAngle = useRef(DEFAULT_ANGLE);
  const isDragging = useRef(false);
  const keysPressed = useRef({});
  const [roomID] = useAtom(roomIDAtom);
  const [map] = useAtom(mapAtom);
  const [user] = useAtom(userAtom);
  const [followedCharacter] = useAtom(followedCharacterAtom);
  const characterRef = useRef(null);
  const followedRef = useRef(null);
  const frameCount = useRef(0);
  // Build mode camera state
  const buildCamTarget = useRef({ x: 0, z: 0 });
  const buildZoom = useRef(30);
  const buildDragging = useRef(false);

  // Clear cached character ref when user changes
  useEffect(() => {
    characterRef.current = null;
  }, [user]);

  // Clear cached followed character ref when follow target changes
  useEffect(() => {
    followedRef.current = null;
  }, [followedCharacter?.id]);

  // Handle scroll wheel for zoom
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const handleWheel = (e) => {
      if (shopMode || !roomID) return;
      e.preventDefault();
      if (buildMode) {
        const delta = e.deltaY > 0 ? 2 : -2;
        buildZoom.current = Math.max(10, Math.min(60, buildZoom.current + delta));
        return;
      }
      const delta = e.deltaY > 0 ? ZOOM_SPEED : -ZOOM_SPEED;
      zoomLevel.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel.current + delta));
    };
    const handleMouseDown = (e) => {
      if (e.button === 2) { // Right-click
        if (buildMode) {
          buildDragging.current = true;
        } else {
          isDragging.current = true;
        }
      }
    };
    const handleMouseMove = (e) => {
      if (buildDragging.current && buildMode) {
        // Pan build camera — scale movement by zoom level for consistent feel
        const panSpeed = buildZoom.current * 0.004;
        buildCamTarget.current.x -= e.movementX * panSpeed;
        buildCamTarget.current.z -= e.movementY * panSpeed;
      } else if (isDragging.current) {
        cameraAngle.current -= e.movementX * ROTATE_SPEED;
      }
    };
    const handleMouseUp = (e) => {
      if (e.button === 2) {
        isDragging.current = false;
        buildDragging.current = false;
      }
    };
    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("contextmenu", handleContextMenu);

    const handleKeyDown = (e) => {
      keysPressed.current[e.key.toLowerCase()] = true;
    };
    const handleKeyUp = (e) => {
      keysPressed.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
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
    if (buildMode) {
      // Center build camera on where the user's character currently is
      const char = characterRef.current;
      const cx = char ? char.position.x : (map ? map.size[0] / 2 : 25);
      const cz = char ? char.position.z : (map ? map.size[1] / 2 : 25);
      buildCamTarget.current = { x: cx, z: cz };
      buildZoom.current = 30;
      controls.current.setPosition(cx + 20, 30, cz + 20, true);
      controls.current.setTarget(cx, 0, cz, true);
      return;
    }

    // ROOM
    if (!buildMode && !shopMode && roomID) {
      controls.current.setPosition(0, 10, 5);
      controls.current.setTarget(0, 10, 0);
      return;
    }
  }, [buildMode, roomID, shopMode, loaded]);

  useFrame(({ scene }, delta) => {
    if (!user) return;

    // Build mode: WASD/arrow key panning + zoom
    if (buildMode) {
      const panSpeed = 30 * delta;
      if (keysPressed.current["w"] || keysPressed.current["arrowup"])
        buildCamTarget.current.z -= panSpeed;
      if (keysPressed.current["s"] || keysPressed.current["arrowdown"])
        buildCamTarget.current.z += panSpeed;
      if (keysPressed.current["a"] || keysPressed.current["arrowleft"])
        buildCamTarget.current.x -= panSpeed;
      if (keysPressed.current["d"] || keysPressed.current["arrowright"])
        buildCamTarget.current.x += panSpeed;

      const z = buildZoom.current;
      const tx = buildCamTarget.current.x;
      const tz = buildCamTarget.current.z;
      controls.current.setTarget(tx, 0, tz, true);
      controls.current.setPosition(tx + z * 0.7, z, tz + z * 0.7, true);
      return;
    }

    if (shopMode) return;

    frameCount.current++;

    // Handle Q/E keyboard rotation
    if (keysPressed.current["q"]) {
      cameraAngle.current += ROTATE_KEY_SPEED * delta;
    }
    if (keysPressed.current["e"]) {
      cameraAngle.current -= ROTATE_KEY_SPEED * delta;
    }

    // Determine which character to follow
    const targetId = followedCharacter?.id || user;
    const isFollowingOther = !!followedCharacter;

    // Use the appropriate ref based on follow mode
    const refToUse = isFollowingOther ? followedRef : characterRef;

    // Only search the scene graph if we don't have a cached ref, or every 60 frames
    if (!refToUse.current || frameCount.current % 60 === 0) {
      refToUse.current = scene.getObjectByName(`character-${targetId}`);
    }

    // Also keep user's own character ref updated for when we unfollow
    if (isFollowingOther && (!characterRef.current || frameCount.current % 60 === 0)) {
      characterRef.current = scene.getObjectByName(`character-${user}`);
    }

    const character = refToUse.current;
    if (!character) {
      return;
    }
    const z = zoomLevel.current;
    const angle = cameraAngle.current;
    const radius = z * Math.SQRT2; // maintain similar distance as before
    controls.current.setTarget(
      character.position.x,
      0,
      character.position.z,
      true
    );
    controls.current.setPosition(
      character.position.x + radius * Math.cos(angle),
      character.position.y + z,
      character.position.z + radius * Math.sin(angle),
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
        shadow-mapSize={[1024, 1024]}
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
