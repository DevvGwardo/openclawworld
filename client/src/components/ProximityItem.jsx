import { useFrame, useThree } from "@react-three/fiber";
import { useAtom } from "jotai";
import { useRef } from "react";
import { mapAtom, userAtom } from "./SocketManager";

const lerp = (a, b, t) => a + (b - a) * t;

export const ProximityItem = ({
  children,
  gridPosition,
  size = [1, 1],
  rotation = 0,
  revealRadius = 14,
  hideRadius = 17,
}) => {
  const groupRef = useRef();
  const revealedRef = useRef(false);
  const progressRef = useRef(0); // 0 = hidden, 1 = fully visible

  const [map] = useAtom(mapAtom);
  const [user] = useAtom(userAtom);
  const scene = useThree((state) => state.scene);

  // Pre-compute world position of this item
  const width = rotation === 1 || rotation === 3 ? size[1] : size[0];
  const height = rotation === 1 || rotation === 3 ? size[0] : size[1];
  const worldX =
    width / map.gridDivision / 2 + gridPosition[0] / map.gridDivision;
  const worldY = 0;
  const worldZ =
    height / map.gridDivision / 2 + gridPosition[1] / map.gridDivision;

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const character = scene.getObjectByName(`character-${user}`);
    if (!character) {
      // If no character yet, keep hidden
      groupRef.current.scale.setScalar(0);
      return;
    }

    const dx = character.position.x - worldX;
    const dz = character.position.z - worldZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Hysteresis: reveal at revealRadius, hide at hideRadius
    if (dist < revealRadius) {
      revealedRef.current = true;
    } else if (dist > hideRadius) {
      revealedRef.current = false;
    }

    const target = revealedRef.current ? 1 : 0;
    const speed = 5; // lerp speed
    progressRef.current = lerp(progressRef.current, target, speed * delta);

    // Clamp to avoid tiny floating point oscillations
    if (Math.abs(progressRef.current - target) < 0.001) {
      progressRef.current = target;
    }

    const p = progressRef.current;
    groupRef.current.scale.setScalar(p);
    groupRef.current.position.y = (1 - p) * -0.5 + worldY;
  });

  // Position the scaled group at the item's world coords so scaling
  // happens around the item's center (not the world origin).
  // The inner offset group negates the Item's own positioning so
  // the net local position is (0,0,0) within the scaled group.
  return (
    <group ref={groupRef} scale={0} position={[worldX, -0.5, worldZ]}>
      <group position={[-worldX, 0, -worldZ]}>
        {children}
      </group>
    </group>
  );
};
