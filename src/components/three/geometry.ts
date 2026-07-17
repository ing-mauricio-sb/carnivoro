import * as THREE from 'three';

/* ---------------------------------------------------------------------------
   Procedural burger geometry.
   Every ingredient is built from primitives + hand-shaped profiles so each is
   an independent mesh (required for the exploded "despiece" view) yet still
   reads as an organic, appetizing object.
--------------------------------------------------------------------------- */

const v2 = (x: number, y: number) => new THREE.Vector2(x, y);

/** Displace a lathe surface along its normals with low-freq noise → organic, hand-baked look. */
function organicize(geo: THREE.BufferGeometry, amp: number, freq: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const angle = Math.atan2(v.z, v.x);
    const d =
      (vnoise(angle * freq + v.y * 2.5, v.y * freq + 3) - 0.5) * amp +
      (vnoise(angle * freq * 3 + 11, v.y * freq * 3) - 0.5) * amp * 0.4;
    v.addScaledVector(n, d);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}

/** Bottom bun — squat, rounded belly, flat top where the patty rests. */
export function makeBottomBun(): THREE.LatheGeometry {
  const profile = [
    v2(0.0, -0.27),
    v2(0.45, -0.25),
    v2(0.85, -0.18),
    v2(1.12, -0.05),
    v2(1.3, 0.04),
    v2(1.24, 0.14),
    v2(1.05, 0.2),
    v2(0.75, 0.22),
    v2(0.0, 0.22),
  ];
  const g = new THREE.LatheGeometry(profile, 96);
  g.computeVertexNormals();
  organicize(g, 0.028, 5);
  return g;
}

/** Top bun — domed brioche crown. */
export function makeTopBun(): THREE.LatheGeometry {
  const profile = [
    v2(0.0, 0.0),
    v2(1.3, 0.0),
    v2(1.29, 0.1),
    v2(1.2, 0.26),
    v2(1.02, 0.42),
    v2(0.78, 0.55),
    v2(0.48, 0.64),
    v2(0.0, 0.68),
  ];
  const g = new THREE.LatheGeometry(profile, 96);
  g.computeVertexNormals();
  organicize(g, 0.03, 4.5);
  return g;
}

/* --- lightweight value noise for organic displacement --------------------- */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const w = yf * yf * (3 - 2 * yf);
  const tl = hash(xi, yi);
  const tr = hash(xi + 1, yi);
  const bl = hash(xi, yi + 1);
  const br = hash(xi + 1, yi + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(tl, tr, u),
    THREE.MathUtils.lerp(bl, br, u),
    w,
  );
}

/** Beef patty — thick cylinder with an irregular, grill-seared rim + charred top relief. */
export function makePatty(): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(1.3, 1.27, 0.42, 160, 8, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const vec = new THREE.Vector3();
  const half = 0.21;
  for (let i = 0; i < pos.count; i++) {
    vec.fromBufferAttribute(pos, i);
    const r = Math.hypot(vec.x, vec.z);
    const angle = Math.atan2(vec.z, vec.x);
    if (r > 0.4) {
      // irregular seared, slightly bulging edge
      const n =
        Math.sin(angle * 6) * 0.5 +
        Math.sin(angle * 11 + 1.3) * 0.32 +
        Math.sin(angle * 19) * 0.2 +
        Math.sin(angle * 37) * 0.12 +
        Math.sin(angle * 53 + 2.1) * 0.06;
      const bulge = (1 - Math.abs(vec.y) / half) * 0.065; // barrel out at mid-height
      const push = n * 0.05 + bulge;
      const scale = (r + push) / r;
      vec.x *= scale;
      vec.z *= scale;
    }
    // charred pitted relief on the flat faces
    if (Math.abs(vec.y) > 0.18) {
      const bump =
        (vnoise(vec.x * 4 + 10, vec.z * 4) - 0.5) * 0.05 +
        (vnoise(vec.x * 9, vec.z * 9 + 5) - 0.5) * 0.02;
      vec.y += bump;
    }
    pos.setXYZ(i, vec.x, vec.y, vec.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Melted cheese slice — square that sags and drips past the patty, with hanging tendrils. */
export function makeCheese(): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(1.95, 0.07, 1.95, 40, 1, 40);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const vec = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    vec.fromBufferAttribute(pos, i);
    const d = Math.hypot(vec.x, vec.z) / 1.4; // 0 center → ~1 corner
    const angle = Math.atan2(vec.z, vec.x);
    // droop the rim downward, more at the corners (melt)
    const droop = Math.pow(THREE.MathUtils.clamp(d, 0, 1), 2.0);
    // localized hanging tendrils around the perimeter — two frequencies so the
    // drips never read as a periodic pattern
    const tendril =
      Math.max(0, Math.sin(angle * 6.0) - 0.5) * 2.4 +
      Math.max(0, Math.sin(angle * 11.0 + 1.7) - 0.66) * 1.6;
    if (vec.y < 0 && d > 0.6) {
      vec.y -= droop * 0.18 + tendril * droop * 0.22;
    } else if (vec.y < 0) {
      vec.y -= droop * 0.06;
    }
    vec.y += (vnoise(vec.x * 4, vec.z * 4) - 0.5) * 0.012;
    pos.setXYZ(i, vec.x, vec.y, vec.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Tomato slice — thicker, slightly scalloped juicy round. */
export function makeTomato(): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(1.06, 1.06, 0.18, 72, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const vec = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    vec.fromBufferAttribute(pos, i);
    const r = Math.hypot(vec.x, vec.z);
    if (r > 0.3) {
      const angle = Math.atan2(vec.z, vec.x);
      const scallop = 1 + Math.sin(angle * 12) * 0.015;
      vec.x *= scallop;
      vec.z *= scallop;
    }
    pos.setXYZ(i, vec.x, vec.y, vec.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Lettuce — a voluminous frilly ruffled leaf ring that pokes out past the patty. */
export function makeLettuce(inner = 0.5, outer = 1.58, seed = 0): THREE.RingGeometry {
  const g = new THREE.RingGeometry(inner, outer, 220, 8);
  g.rotateX(-Math.PI / 2); // lay flat in the XZ plane, waves along Y
  const pos = g.attributes.position as THREE.BufferAttribute;
  const vec = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    vec.fromBufferAttribute(pos, i);
    const r = Math.hypot(vec.x, vec.z);
    const angle = Math.atan2(vec.z, vec.x);
    const edge = THREE.MathUtils.smoothstep(r, inner, outer);
    // big primary ruffle + secondary crinkle + micro noise → leafy volume
    const frill =
      Math.sin(angle * 9 + seed) * 0.2 +
      Math.sin(angle * 17 + 0.6 + seed * 1.7) * 0.1 +
      Math.sin(angle * 31 + 1.2 + seed * 2.3) * 0.045;
    const rise = (r - inner) * 0.12; // gentle bowl so leaves cup upward
    vec.y += frill * edge + rise + (vnoise(vec.x * 6 + seed, vec.z * 6) - 0.5) * 0.07 * edge;
    // uneven, non-circular rim
    const ripple =
      1 +
      Math.sin(angle * 12 + seed) * 0.04 * edge +
      Math.sin(angle * 27 + seed * 1.3) * 0.02 * edge;
    vec.x *= ripple;
    vec.z *= ripple;
    pos.setXYZ(i, vec.x, vec.y, vec.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Second, smaller lettuce layer that sits above the main one → frondy volume. */
export function makeLettuceInner(): THREE.RingGeometry {
  return makeLettuce(0.22, 1.08, 2.4);
}

/** Glossy sauce oozing around the patty seam — a thin band whose lower rim drips. */
export function makeSauceRing(radius = 1.3, height = 0.15): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, height, 140, 5, true);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const vec = new THREE.Vector3();
  const half = height / 2;
  for (let i = 0; i < pos.count; i++) {
    vec.fromBufferAttribute(pos, i);
    const angle = Math.atan2(vec.z, vec.x);
    const lowFactor = THREE.MathUtils.clamp((half - vec.y) / height, 0, 1); // 0 top → 1 bottom
    // uneven, dripping lower edge — short, soft blobs (long sharp spikes read fake)
    const drip =
      Math.max(0, Math.sin(angle * 7.0) - 0.15) * 0.55 +
      Math.max(0, Math.sin(angle * 13.0 + 2) - 0.5) * 0.4;
    vec.y -= lowFactor * (0.02 + drip * 0.1);
    // wobble the radius a touch so it isn't a perfect tube
    const wob = 1 + Math.sin(angle * 9) * 0.008;
    vec.x *= wob;
    vec.z *= wob;
    pos.setXYZ(i, vec.x, vec.y, vec.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A teardrop/ooze blob (unit sphere stretched into a hanging drip tail). */
export function makeDrip(): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(1, 16, 14);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y < 0) {
      v.y *= 2.4; // pull the bottom into a tail
      v.x *= 0.55;
      v.z *= 0.55;
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export interface Placed {
  position: [number, number, number];
  scale: number;
  rotation: number;
}

/** Sauce ooze drips hanging around a seam radius. */
export function dripRing(count: number, radius: number, y: number): Placed[] {
  const out: Placed[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const rr = radius + (Math.random() - 0.5) * 0.06;
    const s = 0.07 + Math.random() * 0.06;
    out.push({
      position: [Math.cos(a) * rr, y - Math.random() * 0.06, Math.sin(a) * rr],
      scale: s,
      rotation: a,
    });
  }
  return out;
}

/** Glossy grease/juice droplets scattered across a disc (patty top). */
export function greaseDrops(count: number, radius: number, y: number): Placed[] {
  const out: Placed[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * radius;
    const s = 0.018 + Math.random() * 0.03;
    out.push({
      position: [Math.cos(a) * rr, y, Math.sin(a) * rr],
      scale: s,
      rotation: Math.random() * Math.PI,
    });
  }
  return out;
}

export interface SesameSeed {
  position: [number, number, number];
  normal: [number, number, number];
  scale: number;
  rotation: number;
}

/** Scatter sesame seeds across the top-bun dome, sitting ON the real dome surface. */
export function sesameSeeds(count = 64): SesameSeed[] {
  const seeds: SesameSeed[] = [];
  const rx = 1.3; // dome base radius (matches makeTopBun profile)
  const ry = 0.68; // dome height
  const offset = 0.02; // lift seeds just above the crust
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    // elevation from horizon; avoid the rim (too low) and the exact apex
    const a = THREE.MathUtils.lerp(0.42, 1.48, Math.random()); // ~24°..85°
    const r = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    const x = r * Math.cos(theta);
    const z = r * Math.sin(theta);
    // outward normal on the ellipsoid
    const nx = x / (rx * rx);
    const ny = y / (ry * ry);
    const nz = z / (rx * rx);
    const nl = Math.hypot(nx, ny, nz) || 1;
    const n: [number, number, number] = [nx / nl, ny / nl, nz / nl];
    seeds.push({
      position: [x + n[0] * offset, y + n[1] * offset, z + n[2] * offset],
      normal: n,
      scale: 0.8 + Math.random() * 0.5,
      rotation: Math.random() * Math.PI,
    });
  }
  return seeds;
}
