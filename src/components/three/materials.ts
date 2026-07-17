'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  makeBreadAlbedo,
  makeBreadNormal,
  makeCheeseAlbedo,
  makeLettuceAlbedo,
  makeNormalTexture,
  makePattyAlbedo,
  makeRoughnessTexture,
  makeTomatoRoughness,
  makeTomatoTexture,
} from './textures';

export interface BurgerMaterials {
  bun: THREE.MeshPhysicalMaterial;
  patty: THREE.MeshPhysicalMaterial;
  cheese: THREE.MeshPhysicalMaterial;
  tomato: THREE.MeshPhysicalMaterial;
  lettuce: THREE.MeshPhysicalMaterial;
  sesame: THREE.MeshPhysicalMaterial;
  ketchup: THREE.MeshPhysicalMaterial;
  mayo: THREE.MeshPhysicalMaterial;
  grease: THREE.MeshPhysicalMaterial;
}

/** Builds every burger material once — juicy PBR with procedural albedo/normal/roughness detail. */
export function useBurgerMaterials(): BurgerMaterials {
  const materials = useMemo<BurgerMaterials>(() => {
    // --- procedural maps -----------------------------------------------------
    const breadAlbedo = makeBreadAlbedo(1024);
    breadAlbedo.repeat.set(1.6, 1.6);
    const breadNormal = makeBreadNormal(1024, 1.6);
    breadNormal.repeat.set(2, 2);
    const bunRough = makeRoughnessTexture({ size: 512, scale: 7, low: 0.5, high: 0.92 });
    bunRough.repeat.set(1.6, 1.6);

    const pattyAlbedo = makePattyAlbedo(1024);
    const charNormal = makeNormalTexture({ size: 512, scale: 16, octaves: 7, strength: 4.0 });
    charNormal.repeat.set(2.2, 2.2);
    const pattyRough = makeRoughnessTexture({
      size: 512,
      scale: 8,
      low: 0.5,
      high: 0.95,
      spotsThreshold: 0.6,
      spotsLow: 0.3, // rendered-fat sheen patches
      spotsScale: 9,
    });

    const cheeseAlbedo = makeCheeseAlbedo(512);
    const cheeseRough = makeRoughnessTexture({
      size: 512,
      scale: 5,
      low: 0.16,
      high: 0.48,
      spotsThreshold: 0.58,
      spotsLow: 0.08, // oily melt pools
      spotsScale: 8,
    });

    const lettuceAlbedo = makeLettuceAlbedo(1024);
    const lettuceRough = makeRoughnessTexture({ size: 512, scale: 5, low: 0.35, high: 0.72 });

    const tomatoMap = makeTomatoTexture(1024);
    const tomatoRough = makeTomatoRoughness(512);

    // --- buns: baked, soft-sheen brioche ------------------------------------
    const bun = new THREE.MeshPhysicalMaterial({
      map: breadAlbedo,
      normalMap: breadNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 1,
      roughnessMap: bunRough,
      metalness: 0,
      clearcoat: 0.15,
      clearcoatRoughness: 0.5,
      sheen: 0.5,
      sheenColor: new THREE.Color('#e7a765'),
      sheenRoughness: 0.8,
      envMapIntensity: 0.8,
    });

    // --- patty: seared beef, charred crust, grease sheen --------------------
    const patty = new THREE.MeshPhysicalMaterial({
      map: pattyAlbedo,
      normalMap: charNormal,
      normalScale: new THREE.Vector2(1.8, 1.8),
      roughness: 1,
      roughnessMap: pattyRough,
      metalness: 0,
      clearcoat: 0.22, // grease film
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.55,
    });

    // --- cheese: glossy molten cheddar with oil pools -----------------------
    const cheese = new THREE.MeshPhysicalMaterial({
      map: cheeseAlbedo,
      roughness: 1,
      roughnessMap: cheeseRough,
      metalness: 0,
      clearcoat: 0.75,
      clearcoatRoughness: 0.15,
      transmission: 0.08,
      thickness: 0.5,
      ior: 1.3,
      sheen: 0.3,
      sheenColor: new THREE.Color('#ffd27a'),
      envMapIntensity: 1.1,
    });

    // --- tomato: juicy translucent slice ------------------------------------
    const tomato = new THREE.MeshPhysicalMaterial({
      map: tomatoMap,
      color: '#ff6a54',
      roughness: 1,
      roughnessMap: tomatoRough,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.12,
      transmission: 0.34,
      thickness: 0.35,
      ior: 1.4,
      attenuationColor: new THREE.Color('#8f1d12'),
      attenuationDistance: 0.5,
      envMapIntensity: 1.0,
    });

    // --- lettuce: fresh, wet, veined translucent leaf -----------------------
    const lettuce = new THREE.MeshPhysicalMaterial({
      map: lettuceAlbedo,
      bumpMap: lettuceAlbedo,
      bumpScale: 0.015,
      roughness: 1,
      roughnessMap: lettuceRough,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.3,
      transmission: 0.16,
      thickness: 0.22,
      ior: 1.2,
      sheen: 0.35,
      sheenColor: new THREE.Color('#b6e07a'),
      side: THREE.DoubleSide,
      envMapIntensity: 0.8,
    });

    // --- sesame: lightly toasted, per-instance tint set in Burger -----------
    const sesame = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', // instanceColor carries the actual tint
      roughness: 0.35,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.3,
    });

    // --- sauces & grease -----------------------------------------------------
    const ketchup = new THREE.MeshPhysicalMaterial({
      color: '#7e1206', // deep cooked ketchup — saturated red reads as plastic
      roughness: 0.26,
      metalness: 0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.7,
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
        mat.roughnessMap?.dispose();
        mat.bumpMap?.dispose();
        mat.dispose();
      });
    };
  }, [materials]);

  return materials;
}
