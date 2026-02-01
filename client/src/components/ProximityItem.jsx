import { useFrame, useThree } from "@react-three/fiber";
import { useAtom } from "jotai";
import { useRef } from "react";
import { mapAtom, userAtom } from "./SocketManager";

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

  const [map] = useAtom(mapAtom);
  const [user] = useAtom(userAtom);
  const scene = useThree((state) => state.scene);

  // Pre-compute world position of this item
  const width = rotation === 1 || rotation === 3 ? size[1] : size[0];
  const height = rotation === 1 || rotation === 3 ? size[0] : size[1];
  const worldX =
    width / map.gridDivision / 2 + gridPosition[0] / map.gridDivision;
  const worldZ =
    height / map.gridDivision / 2 + gridPosition[1] / map.gridDivision;

  useFrame(() => {
    if (!groupRef.current) return;

    const character = scene.getObjectByName(`character-${user}`);
    if (!character) {
      groupRef.current.visible = false;
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

    groupRef.current.visible = revealedRef.current;
  });

  return (
    <group ref={groupRef} visible={false}>
      {children}
    </group>
  );
};
