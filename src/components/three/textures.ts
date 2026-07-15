import * as THREE from 'three';

/* ---------------------------------------------------------------------------
   Self-contained procedural textures (no external files → no CORS, no missing
   assets). Multi-octave value noise rendered to a canvas, used as bump/rough
   maps so the buns feel bready and the patty feels charred.
--------------------------------------------------------------------------- */

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
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return (
    a * (1 - u) * (1 - w) +
    b * u * (1 - w) +
    c * (1 - u) * w +
    d * u * w
  );
}
function fbm(x: number, y: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

interface NoiseOptions {
  size?: number;
  scale?: number;
  octaves?: number;
  contrast?: number;
  /** grain: extra fine high-frequency speckle (0..1) */
  grain?: number;
}

/** Procedural tangent-space normal map derived from fbm height — real micro-relief, not just bump. */
export function makeNormalTexture({
  size = 512,
  scale = 10,
  octaves = 5,
  strength = 2.2,
}: { size?: number; scale?: number; octaves?: number; strength?: number } = {}): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const h = (x: number, y: number) => fbm((x / size) * scale, (y / size) * scale, octaves);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hl = h(x - 1, y);
      const hr = h(x + 1, y);
      const hd = h(x, y - 1);
      const hu = h(x, y + 1);
      const dx = (hl - hr) * strength;
      const dy = (hd - hu) * strength;
      const len = Math.hypot(dx, dy, 1);
      const idx = (y * size + x) * 4;
      img.data[idx] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
      img.data[idx + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      img.data[idx + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Radial red pulp / seed pattern for a tomato slice cross-section. */
export function makeTomatoTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  // juicy red base
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, '#d8452f');
  grad.addColorStop(0.55, '#c0392b');
  grad.addColorStop(0.8, '#9d2b20');
  grad.addColorStop(1, '#7e1f16');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  // pale radial locule walls
  ctx.strokeStyle = 'rgba(240,180,120,0.5)';
  ctx.lineWidth = size * 0.012;
  const lobes = 7;
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * c * 0.85, c + Math.sin(a) * c * 0.85);
    ctx.stroke();
  }
  // pale core
  ctx.fillStyle = 'rgba(235,190,140,0.55)';
  ctx.beginPath();
  ctx.arc(c, c, size * 0.09, 0, Math.PI * 2);
  ctx.fill();
  // seeds
  ctx.fillStyle = 'rgba(225,205,140,0.9)';
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + i;
    const rr = c * (0.32 + (i % 3) * 0.16);
    ctx.beginPath();
    ctx.ellipse(c + Math.cos(a) * rr, c + Math.sin(a) * rr, size * 0.012, size * 0.02, a, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Warm, unevenly-baked bread albedo (base golden with darker creases / toasted patches). */
export function makeBreadAlbedo(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  // base golden brioche + toasted highlights
  const base = { r: 196, g: 133, b: 72 };
  const dark = { r: 122, g: 72, b: 34 };
  const light = { r: 224, g: 176, b: 108 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 7;
      const v = (y / size) * 7;
      const n = fbm(u, v, 5); // large baked patches
      const fine = fbm(u * 4 + 20, v * 4, 4); // fine toasting
      let r: number, g: number, b: number;
      if (n < 0.45) {
        const t = THREE.MathUtils.clamp((0.45 - n) / 0.45, 0, 1);
        r = THREE.MathUtils.lerp(base.r, dark.r, t * 0.7);
        g = THREE.MathUtils.lerp(base.g, dark.g, t * 0.7);
        b = THREE.MathUtils.lerp(base.b, dark.b, t * 0.7);
      } else {
        const t = THREE.MathUtils.clamp((n - 0.45) / 0.55, 0, 1);
        r = THREE.MathUtils.lerp(base.r, light.r, t * 0.6);
        g = THREE.MathUtils.lerp(base.g, light.g, t * 0.6);
        b = THREE.MathUtils.lerp(base.b, light.b, t * 0.6);
      }
      const speck = (fine - 0.5) * 26;
      const idx = (y * size + x) * 4;
      img.data[idx] = THREE.MathUtils.clamp(r + speck, 0, 255);
      img.data[idx + 1] = THREE.MathUtils.clamp(g + speck * 0.8, 0, 255);
      img.data[idx + 2] = THREE.MathUtils.clamp(b + speck * 0.6, 0, 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft, wispy smoke puff sprite (white with a noise-broken radial alpha). */
export function makeSmokeTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const d = Math.hypot(dx, dy);
      const radial = 1 - THREE.MathUtils.smoothstep(d, 0.15, 1);
      const wisp = fbm((x / size) * 5, (y / size) * 5, 5);
      const a = THREE.MathUtils.clamp(radial * (0.55 + wisp * 0.7), 0, 1);
      const idx = (y * size + x) * 4;
      img.data[idx] = 255;
      img.data[idx + 1] = 255;
      img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

export function makeNoiseTexture({
  size = 256,
  scale = 6,
  octaves = 5,
  contrast = 1,
  grain = 0,
}: NoiseOptions = {}): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = fbm((x / size) * scale, (y / size) * scale, octaves);
      if (grain > 0) {
        n = n * (1 - grain) + hash(x * 1.7, y * 2.3) * grain;
      }
      n = THREE.MathUtils.clamp((n - 0.5) * contrast + 0.5, 0, 1);
      const c = Math.round(n * 255);
      const idx = (y * size + x) * 4;
      img.data[idx] = c;
      img.data[idx + 1] = c;
      img.data[idx + 2] = c;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
