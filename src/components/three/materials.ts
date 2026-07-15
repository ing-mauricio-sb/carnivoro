'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  makeBreadAlbedo,
  makeNormalTexture,
  makeTomatoTexture,
} from './textures';

export interface BurgerMaterials {
  bun: THREE.MeshPhysicalMaterial;
  patty: THREE.MeshPhysicalMaterial;
  cheese: THREE.MeshPhysicalMaterial;
  tomato: THREE.MeshPhysicalMaterial;
  lettuce: THREE.MeshPhysicalMaterial;
  sesame: THREE.MeshStandardMaterial;
  ketchup: THREE.MeshPhysicalMaterial;
  mayo: THREE.MeshPhysicalMaterial;
  grease: THREE.MeshPhysicalMaterial;
}

/** Builds every burger material once — juicy PBR with procedural albedo/normal detail. */
export function useBurgerMaterials(): BurgerMaterials {
  const materials = useMemo<BurgerMaterials>(() => {
    // --- procedural maps -----------------------------------------------------
    const breadAlbedo = makeBreadAlbedo(512);
    breadAlbedo.repeat.set(1.6, 1.6);
    const breadNormal = makeNormalTexture({ size: 512, scale: 11, octaves: 5, strength: 2.0 });
    breadNormal.repeat.set(2, 2);
    const charNormal = makeNormalTexture({ size: 512, scale: 16, octaves: 6, strength: 3.4 });
    charNormal.repeat.set(2.2, 2.2);
    const tomatoMap = makeTomatoTexture(512);

    // --- buns: baked, soft-sheen brioche ------------------------------------
    const bun = new THREE.MeshPhysicalMaterial({
      map: breadAlbedo,
      normalMap: breadNormal,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.7,
      metalness: 0,
      clearcoat: 0.15,
      clearcoatRoughness: 0.55,
      sheen: 0.45,
      sheenColor: new THREE.Color('#e7a765'),
      sheenRoughness: 0.85,
      envMapIntensity: 0.7,
    });

    // --- patty: dark seared beef with grease sheen --------------------------
    const patty = new THREE.MeshPhysicalMaterial({
      color: '#46231a',
      normalMap: charNormal,
      normalScale: new THREE.Vector2(1.6, 1.6),
      roughness: 0.82,
      metalness: 0,
      clearcoat: 0.22, // grease film
      clearcoatRoughness: 0.45,
      envMapIntensity: 0.5,
    });

    // --- cheese: glossy molten cheddar --------------------------------------
    const cheese = new THREE.MeshPhysicalMaterial({
      color: '#f2a83b',
      roughness: 0.22,
      metalness: 0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
      transmission: 0.08,
      thickness: 0.5,
      ior: 1.3,
      sheen: 0.3,
      sheenColor: new THREE.Color('#ffd27a'),
      envMapIntensity: 1.0,
    });

    // --- tomato: juicy translucent slice ------------------------------------
    const tomato = new THREE.MeshPhysicalMaterial({
      map: tomatoMap,
      color: '#ff6a54',
      roughness: 0.18,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.12,
      transmission: 0.34,
      thickness: 0.35,
      ior: 1.4,
      attenuationColor: new THREE.Color('#8f1d12'),
      attenuationDistance: 0.5,
      envMapIntensity: 0.95,
    });

    // --- lettuce: fresh, wet, translucent leaf ------------------------------
    const lettuce = new THREE.MeshPhysicalMaterial({
      color: '#5aa03f',
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
      transmission: 0.16,
      thickness: 0.22,
      ior: 1.2,
      sheen: 0.6,
      sheenColor: new THREE.Color('#b6e07a'),
      side: THREE.DoubleSide,
      envMapIntensity: 0.7,
    });

    const sesame = new THREE.MeshStandardMaterial({
      color: '#ecd9a2',
      roughness: 0.45,
      metalness: 0,
    });

    // --- sauces & grease -----------------------------------------------------
    const ketchup = new THREE.MeshPhysicalMaterial({
      color: '#b01608',
      roughness: 0.16,
      metalness: 0,
      clearcoat: 0.95,
      clearcoatRoughness: 0.08,
      sheen: 0.2,
      envMapIntensity: 1.1,
    });

    const mayo = new THREE.MeshPhysicalMaterial({
      color: '#f4ead0',
      roughness: 0.28,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.9,
    });

    const grease = new THREE.MeshPhysicalMaterial({
      color: '#e7c79a',
      roughness: 0.04,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      transmission: 0.55,
      thickness: 0.1,
      ior: 1.33,
      transparent: true,
      opacity: 0.85,
      envMapIntensity: 1.2,
    });

    return { bun, patty, cheese, tomato, lettuce, sesame, ketchup, mayo, grease };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(materials).forEach((m) => {
        const mat = m as THREE.MeshPhysicalMaterial;
        mat.map?.dispose();
        mat.normalMap?.dispose();
        mat.dispose();
      });
    };
  }, [materials]);

  return materials;
}
