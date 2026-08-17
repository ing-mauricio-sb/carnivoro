import * as THREE from 'three';
import { createCheeseburgerModel } from './createBurgerModel';
import { applyOrganicRefinements } from './organicRefinements';

/**
 * Adapter between the img2threejs factory output and the scroll choreography in
 * Burger.tsx. The factory already builds one pivot Group per stratum (userData
 * .sculptRuntime.nodes / destructionGroups), so no re-parenting is needed: the
 * rig measures each stratum's as-built Y (assembledY), authors the exploded
 * target, strips any stray lights, and owns disposal.
 */

/** Strata bottom → top; must match the spec's destruction groups. */
export const STRATA = [
  'bottomBun',
  'lettuce',
  'tomato',
  'onion',
  'pickles',
  'patty',
  'cheese',
  'topBun',
] as const;
export type StratumKey = (typeof STRATA)[number];

/* TODO(Mauri): coreografía del despiece — cuánto se aparta cada capa de su
 * posición armada (unidades de mundo, tras scale). Ajusta al gusto. */
const EXPLODE_OFFSET: Record<StratumKey, number> = {
  bottomBun: -1.05,
  lettuce: -0.78,
  tomato: -0.52,
  onion: -0.26,
  pickles: -0.02,
  patty: 0.3,
  cheese: 0.66,
  topBun: 1.1,
};

/** Uniform fit against the previous hand-built burger's envelope (camera,
 * smoke and shadow positions in the scene assume that size). */
const FIT_SCALE = 0.95;

export interface BurgerLayer {
  key: StratumKey;
  node: THREE.Object3D;
  assembledY: number;
  explodedY: number;
}

export interface BurgerRig {
  model: THREE.Group;
  layers: BurgerLayer[];
  dispose(): void;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) {
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        for (const value of Object.values(m)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        m.dispose();
      }
    }
  });
}

export function buildBurgerRig(opts: { mobile?: boolean } = {}): BurgerRig {
  const model = applyOrganicRefinements(
    createCheeseburgerModel({ castShadow: true, receiveShadow: true }),
  );
  model.scale.setScalar(FIT_SCALE);

  // Scene lighting is owned by Lighting.tsx — drop any light the factory added.
  const strayLights: THREE.Object3D[] = [];
  model.traverse((o) => {
    if ((o as THREE.Light).isLight) strayLights.push(o);
  });
  for (const light of strayLights) light.parent?.remove(light);

  if (opts.mobile) {
    // Mobile budget: halve the shadow-casting micro detail (instanced seeds).
    model.traverse((o) => {
      const inst = o as THREE.InstancedMesh;
      if (inst.isInstancedMesh && inst.name.endsWith('-sesame')) {
        inst.count = Math.ceil(inst.count * 0.5);
        inst.castShadow = false;
      }
    });
  }

  // Small decorative parts skip the shadow pass (their shadows are invisible
  // against the layer contacts, and the 2048-map pass pays per mesh).
  for (const name of ['knotLoop', 'onionRingB', 'onionRingC', 'cheeseLobeF', 'cheeseLobeFL',
    'cheeseLobeFR', 'cheeseLobeR', 'cheeseLobeRL']) {
    model.getObjectByName(name)?.traverse((o) => { o.castShadow = false; });
  }

  const nodes = (model.userData.sculptRuntime?.nodes ?? {}) as Record<string, THREE.Object3D>;
  const layers: BurgerLayer[] = [];
  for (const key of STRATA) {
    const node = nodes[key] ?? model.getObjectByName(key);
    if (!node) continue; // factory contract violation — despiece degrades gracefully
    layers.push({
      key,
      node,
      assembledY: node.position.y,
      explodedY: node.position.y + EXPLODE_OFFSET[key],
    });
  }

  return {
    model,
    layers,
    dispose() {
      disposeObject(model);
    },
  };
}
