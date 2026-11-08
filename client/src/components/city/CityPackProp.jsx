import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { SkeletonUtils } from "three-stdlib";

/**
 * Reusable renderer for City Pack GLTF/GLB props.
 * Mirrors Item.jsx robustness patterns (clone scene, set shadows).
 */
export const CityPackProp = ({ src, position, rotationY = 0, scale = 1, y = 0 }) => {
  const { scene } = useGLTF(src);
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);

  useEffect(() => {
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [clone]);

  return (
    <group position={[position[0], y, position[2]]} rotation-y={rotationY}>
      <primitive object={clone} scale={typeof scale === "number" ? [scale, scale, scale] : scale} />
    </group>
  );
};
