'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { makeSmokeTexture } from './smokeTexture';

interface Puff {
  x: number;
  z: number;
  drift: number;
  phase: number;
  speed: number;
  size: number;
  tint: THREE.Color;
}

/**
 * Billboarded grill smoke rising behind the burger. Soft, wispy, warm-grey puffs
 * that rise, grow and fade on a staggered loop. Cheap (a handful of planes) and
 * self-contained (procedural sprite). Frozen entirely under reduced motion.
 */
export default function Smoke({
  count = 14,
  frozen = false,
  origin = [0, -1.4, -1.1] as [number, number, number],
}: {
  count?: number;
  frozen?: boolean;
  origin?: [number, number, number];
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const tex = useMemo(() => makeSmokeTexture(256), []);

  const puffs = useMemo<Puff[]>(() => {
    const warm = new THREE.Color('#7a6a5c');
    const cool = new THREE.Color('#4d4640');
    return Array.from({ length: count }, (_, i) => ({
      x: (Math.random() - 0.5) * 2.4,
      z: origin[2] - Math.random() * 0.9,
      drift: 0.3 + Math.random() * 0.5,
      phase: i / count + Math.random() * 0.05,
      speed: 0.05 + Math.random() * 0.04,
      size: 1.1 + Math.random() * 1.3,
      tint: warm.clone().lerp(cool, Math.random()),
    }));
  }, [count, origin]);

  const meshes = useRef<THREE.Mesh[]>([]);

  useLayoutEffect(() => {
    const arr = meshes.current;
    return () => {
      arr.forEach((m) => (m.material as THREE.Material)?.dispose());
      tex.dispose();
    };
  }, [tex]);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group || frozen) return;
    const t = state.clock.elapsedTime;
    // bound by puffs: when `count` shrinks (breakpoint crossed on resize),
    // meshes.current still holds stale trailing refs for one frame
    for (let i = 0; i < puffs.length; i++) {
      const m = meshes.current[i];
      const p = puffs[i];
      if (!m || !p) continue;
      const life = (t * p.speed + p.phase) % 1;
      const y = origin[1] + life * 3.4;
      const x = origin[0] + p.x + Math.sin(life * 3 + p.phase * 6) * p.drift;
      m.position.set(x, y, p.z);
      const sc = p.size * (0.6 + life * 1.3);
      m.scale.set(sc, sc, sc);
      m.quaternion.copy(camera.quaternion); // billboard
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.sin(life * Math.PI) * 0.18;
    }
  });

  return (
    <group ref={groupRef}>
      {puffs.map((p, i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) meshes.current[i] = el;
          }}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={tex}
            color={p.tint}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.NormalBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
