import { useFrame, useThree } from "@react-three/fiber";
import { useAtom } from "jotai";
import { useMemo, useRef } from "react";
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
  const characterRef = useRef(null);
  const frameCountRef = useRef(0);

  const [map] = useAtom(mapAtom);
  const [user] = useAtom(userAtom);
  const scene = useThree((state) => state.scene);

  // Pre-compute squared radii to avoid Math.sqrt per check
  const revealRadiusSq = revealRadius * revealRadius;
  const hideRadiusSq = hideRadius * hideRadius;

  // Pre-compute world position of this item
  const { worldX, worldZ } = useMemo(() => {
    const width = rotation === 1 || rotation === 3 ? size[1] : size[0];
    const height = rotation === 1 || rotation === 3 ? size[0] : size[1];
    return {
      worldX:
        width / map.gridDivision / 2 + gridPosition[0] / map.gridDivision,
      worldZ:
        height / map.gridDivision / 2 + gridPosition[1] / map.gridDivision,
    };
  }, [gridPosition, size, rotation, map.gridDivision]);

  useFrame(() => {
    if (!groupRef.current) return;

    // Throttle: only check every 10 frames
    frameCountRef.current++;
    if (frameCountRef.current % 10 !== 0) return;

    // Cache character reference instead of querying scene every frame
    if (!characterRef.current || !characterRef.current.parent) {
      characterRef.current = scene.getObjectByName(`character-${user}`);
    }

    const character = characterRef.current;
    if (!character) {
      groupRef.current.visible = false;
      return;
    }

    const dx = character.position.x - worldX;
    const dz = character.position.z - worldZ;
    const distSq = dx * dx + dz * dz;

    // Hysteresis: reveal at revealRadius, hide at hideRadius (using squared distances)
    if (distSq < revealRadiusSq) {
      revealedRef.current = true;
    } else if (distSq > hideRadiusSq) {
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
