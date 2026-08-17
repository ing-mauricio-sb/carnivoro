import * as THREE from 'three';

/**
 * Organic form refinements applied on top of the img2threejs-generated factory
 * output (form-refinement pass, spec: .img2threejs/object-sculpt-spec.json).
 *
 * The generator's spec vocabulary covers primitives/profiles but not per-vertex
 * organic displacement, so these live here as a post-process keyed by node name
 * — regeneration of the factory never wipes them. Deterministic (seeded hash
 * noise), no Math.random.
 */

const TAU = Math.PI * 2;

/** Deterministic value noise in [0,1] from an integer lattice. */
function hash(x: number, y: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return (((h ^ (h >> 16)) >>> 0) % 10000) / 10000;
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function displaceGeometry(
  mesh: THREE.Mesh,
  fn: (v: THREE.Vector3, radial: number, angle: number) => void,
): void {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const radial = Math.hypot(v.x, v.z);
    const angle = Math.atan2(v.z, v.x);
    fn(v, radial, angle);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

/** Lettuce: angular ruffle — the lathe is radially symmetric; the photo's leaf
 * margin waves in and out around the rim and droops unevenly. */
function ruffleLettuce(mesh: THREE.Mesh): void {
  displaceGeometry(mesh, (v, radial, angle) => {
    if (radial < 0.9) return;
    const t = THREE.MathUtils.smoothstep(radial, 0.9, 1.55);
    const wave = Math.sin(angle * 9) * 0.075 + Math.sin(angle * 4 + 1.7) * 0.05;
    const droop = (vnoise(Math.cos(angle) * 3 + 7, Math.sin(angle) * 3 + 7) - 0.5) * 0.13;
    const k = 1 + wave * t * 0.45;
    v.x *= k;
    v.z *= k;
    v.y += (wave * 0.4 + droop) * t - t * t * 0.03;
  });
}

/** Patty: break the mechanical cylinder — coarse seared-crust noise on the wall
 * and a slight hand-formed ovality. */
function organicPatty(mesh: THREE.Mesh): void {
  displaceGeometry(mesh, (v, radial, angle) => {
    if (radial < 0.6) return;
    const crust =
      (vnoise(Math.cos(angle) * 4 + 20, Math.sin(angle) * 4 + v.y * 6) - 0.5) * 0.09 +
      (vnoise(Math.cos(angle) * 11 + 40, Math.sin(angle) * 11 + v.y * 14) - 0.5) * 0.045;
    const oval = 1 + Math.sin(angle * 2 + 0.6) * 0.018;
    const k = (1 + crust / Math.max(radial, 0.001)) * oval;
    v.x *= k;
    v.z *= k;
  });
}

/** Cheese slab: kill the prismatic extrude edge — curl the rim downward into a
 * melt drape and soften the top face with low-frequency sag. */
function drapeCheese(mesh: THREE.Mesh): void {
  const geo = mesh.geometry as THREE.BufferGeometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox as THREE.Box3;
  // extrude profile lies in XY, depth along Z (node is rotated to lay it flat)
  const rimStart = 0.72;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const maxR = Math.max(
    Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.y), Math.abs(bb.max.y),
  );
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.y) / maxR;
    const angle = Math.atan2(v.y, v.x);
    if (r > rimStart) {
      const t = THREE.MathUtils.smoothstep(r, rimStart, 1.0);
      // +Z in profile space = world down after the node's X-rotation
      const melt = 0.14 + vnoise(Math.cos(angle) * 5 + 3, Math.sin(angle) * 5 + 3) * 0.16;
      v.z += t * t * melt;
      const pull = 1 - t * t * 0.05;
      v.x *= pull;
      v.y *= pull;
    }
    v.z += Math.sin(v.x * 2.2) * Math.cos(v.y * 1.9) * 0.012;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

/** Buns: subtle baked irregularity so the lathe profile isn't perfectly round. */
function organicBun(mesh: THREE.Mesh, seedOffset: number, amount: number): void {
  displaceGeometry(mesh, (v, radial, angle) => {
    if (radial < 0.3) return;
    const n =
      (vnoise(Math.cos(angle) * 3 + seedOffset, Math.sin(angle) * 3 + v.y * 2) - 0.5) * amount;
    const k = 1 + n / Math.max(radial, 0.001);
    v.x *= k;
    v.z *= k;
  });
}

/** Tomato: slight ovality + skin undulation on the slice rim. */
function organicTomato(mesh: THREE.Mesh): void {
  displaceGeometry(mesh, (v, radial, angle) => {
    if (radial < 0.7) return;
    const n = Math.sin(angle * 3 + 1.1) * 0.02 + Math.sin(angle * 7 + 0.4) * 0.012;
    const k = 1 + n;
    v.x *= k;
    v.z *= k;
  });
}

const REFINERS: Record<string, (mesh: THREE.Mesh) => void> = {
  lettuce: ruffleLettuce,
  lettuceInner: (m) => ruffleLettuce(m),
  patty: organicPatty,
  cheese: drapeCheese,
  topBun: (m) => organicBun(m, 11, 0.05),
  bottomBun: (m) => organicBun(m, 29, 0.04),
  tomato: organicTomato,
};

/** Cheese drip lobes: the generated attachment cylinders read as hard cones.
 * Replace each lobe mesh's geometry with a sculpted drip (bulged neck, rounded
 * tip) hanging in cheese-local +Z (world down after the slab's X-rotation). */
function sculptCheeseLobe(mesh: THREE.Mesh, index: number): void {
  const old = mesh.geometry as THREE.BufferGeometry;
  const len = 0.34 + hash(index * 5, 31) * 0.12;
  const bulge = 0.16 + hash(index * 9, 7) * 0.05;
  const profile: THREE.Vector2[] = [];
  const STEPS = 14;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    // wide at the slab, necking, then a rounded hanging tip
    const r =
      bulge * (1 - t * 0.25) * (t < 0.75 ? 1 : Math.sqrt(Math.max(0, 1 - ((t - 0.75) / 0.25) ** 2)));
    profile.push(new THREE.Vector2(Math.max(0.001, r), -t * len));
  }
  const drip = new THREE.LatheGeometry(profile, 20);
  drip.rotateX(-Math.PI / 2); // hang along +Z in the slab's local frame
  drip.translate(0, 0, 0.02);
  mesh.geometry = drip;
  mesh.quaternion.identity();
  old.dispose();
}

function refineCheese(root: THREE.Group, nodes: Record<string, THREE.Object3D>): void {
  ['cheeseLobeF', 'cheeseLobeFL', 'cheeseLobeFR', 'cheeseLobeR', 'cheeseLobeRL'].forEach(
    (name, i) => {
      const node = nodes[name] ?? root.getObjectByName(name);
      if (!node) return;
      node.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) sculptCheeseLobe(o as THREE.Mesh, i + 2);
      });
    },
  );
  const cheese = nodes.cheese ?? root.getObjectByName('cheese');
  cheese?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshPhysicalMaterial;
    if (mat && 'transmission' in mat) {
      // the extracted 0.12 washes the thin slab out against the white env
      mat.transmission = 0.06;
      mat.roughness = Math.min(mat.roughness, 0.3);
    }
  });
}

const SEED_TONES = ['#e8d9a8', '#d4b578', '#c89a58'].map((c) => new THREE.Color(c));

/** Sesame scatter (spec systems sesameFieldTop/sesameFieldHeel, realization:
 * code-instanced). Samples the actual bun mesh vertices so seeds always sit ON
 * the baked surface regardless of profile regeneration. Deterministic. */
function scatterSesame(
  bun: THREE.Object3D,
  opts: { count: number; minY: number; maxY: number; minRadial: number; salt: number;
    scale: number },
): void {
  const mesh = bun.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
  const host = mesh ?? (bun as THREE.Mesh);
  if (!(host as THREE.Mesh).isMesh) return;
  const geo = (host as THREE.Mesh).geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const bb = (geo.boundingBox ?? (geo.computeBoundingBox(), geo.boundingBox)) as THREE.Box3;
  const hSpan = bb.max.y - bb.min.y;
  const candidates: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const yFrac = (v.y - bb.min.y) / hSpan;
    if (yFrac < opts.minY || yFrac > opts.maxY) continue;
    if (Math.hypot(v.x, v.z) < opts.minRadial) continue;
    candidates.push(i);
  }
  if (!candidates.length) return;
  const count = Math.min(opts.count, candidates.length);
  const seedGeo = new THREE.SphereGeometry(1, 6, 5);
  const seedMat = new THREE.MeshPhysicalMaterial({ roughness: 0.55, sheen: 0.2 });
  const inst = new THREE.InstancedMesh(seedGeo, seedMat, count);
  inst.name = `${bun.name}-sesame`;
  inst.userData.explodeWithParent = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zq = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3();
  const s = new THREE.Vector3();
  const center = new THREE.Vector3(0, (bb.min.y + bb.max.y) / 2, 0);
  for (let k = 0; k < count; k++) {
    // deterministic stratified pick
    const pick = candidates[
      Math.floor(hash(k * 7 + opts.salt, k * 13 + 1) * candidates.length) % candidates.length
    ];
    v.fromBufferAttribute(pos, pick);
    n.copy(v).sub(center).normalize();
    q.setFromUnitVectors(up, n);
    zq.setFromAxisAngle(n, hash(k, opts.salt) * TAU);
    q.premultiply(zq);
    const sc = opts.scale * (0.8 + hash(k * 3, opts.salt * 5) * 0.5);
    s.set(sc, sc * 0.55, sc * 0.62);
    // embed slightly into the dough
    const p = v.clone().addScaledVector(n, -sc * 0.25);
    m.compose(p, q, s);
    inst.setMatrixAt(k, m);
    inst.setColorAt(k, SEED_TONES[Math.floor(hash(k * 11, opts.salt) * 3) % 3]);
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.castShadow = true;
  (mesh ?? bun).add(inst);
}

/** Apply all form refinements to a freshly created factory model. Idempotence
 * guard: marks the root so double application (React strict effects) is a no-op. */
export function applyOrganicRefinements(root: THREE.Group): THREE.Group {
  if (root.userData.__organicRefined) return root;
  root.userData.__organicRefined = true;
  const nodes = (root.userData.sculptRuntime?.nodes ?? {}) as Record<string, THREE.Object3D>;
  for (const [name, refine] of Object.entries(REFINERS)) {
    const node = nodes[name] ?? root.getObjectByName(name);
    if (!node) continue;
    node.traverse((o) => {
      // Refine only the node's own mesh, not child components parented under it
      // (e.g. cheese lobes under cheese, skewer under topBun).
      if ((o as THREE.Mesh).isMesh && (o.parent === node || o === node)) {
        refine(o as THREE.Mesh);
      }
    });
  }
  refineCheese(root, nodes);
  const topBun = nodes.topBun ?? root.getObjectByName('topBun');
  if (topBun) {
    scatterSesame(topBun, { count: 150, minY: 0.22, maxY: 0.97, minRadial: 0.25, salt: 3,
      scale: 0.044 });
  }
  const bottomBun = nodes.bottomBun ?? root.getObjectByName('bottomBun');
  if (bottomBun) {
    scatterSesame(bottomBun, { count: 42, minY: 0.35, maxY: 0.8, minRadial: 1.05, salt: 17,
      scale: 0.045 });
  }
  return root;
}
