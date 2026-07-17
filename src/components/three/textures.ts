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

/** Shared height-field → tangent-space normal map conversion (real micro-relief, not just bump). */
function normalFromHeights(
  heights: Float64Array,
  size: number,
  strength: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const stride = size + 2;
  const h = (x: number, y: number) => heights[(y + 1) * stride + (x + 1)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
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

/** Procedural tangent-space normal map derived from fbm height. */
export function makeNormalTexture({
  size = 512,
  scale = 10,
  octaves = 5,
  strength = 2.2,
}: { size?: number; scale?: number; octaves?: number; strength?: number } = {}): THREE.CanvasTexture {
  // Height field precomputed once over [-1..size]² so the four neighbour taps
  // in normalFromHeights read from memory instead of re-evaluating fbm 4× per pixel.
  // Float64 keeps the output bit-identical to the direct evaluation.
  const stride = size + 2;
  const heights = new Float64Array(stride * stride);
  for (let hy = -1; hy <= size; hy++) {
    for (let hx = -1; hx <= size; hx++) {
      heights[(hy + 1) * stride + (hx + 1)] = fbm((hx / size) * scale, (hy / size) * scale, octaves);
    }
  }
  return normalFromHeights(heights, size, strength);
}

/**
 * Brioche-crust normal map: fine baked grain + actual pore depressions, so the
 * crumb texture reads in the specular, not only in the albedo.
 */
export function makeBreadNormal(size = 1024, strength = 1.6): THREE.CanvasTexture {
  const stride = size + 2;
  const heights = new Float64Array(stride * stride);
  for (let hy = -1; hy <= size; hy++) {
    for (let hx = -1; hx <= size; hx++) {
      heights[(hy + 1) * stride + (hx + 1)] =
        fbm((hx / size) * 9, (hy / size) * 9, 5) * 0.7 +
        fbm((hx / size) * 30 + 7, (hy / size) * 30, 3) * 0.3;
    }
  }
  // Pores: small gaussian dips scattered over the crust.
  const pores = Math.floor(size * 0.4);
  for (let i = 0; i < pores; i++) {
    const px = Math.floor(Math.random() * size);
    const py = Math.floor(Math.random() * size);
    const r = 1.5 + Math.random() * (size / 256) * 3;
    const depth = 0.3 + Math.random() * 0.45;
    const r2 = r * r;
    const rad = Math.ceil(r * 2);
    for (let oy = -rad; oy <= rad; oy++) {
      for (let ox = -rad; ox <= rad; ox++) {
        const d2 = ox * ox + oy * oy;
        if (d2 > r2 * 4) continue;
        const x = px + ox;
        const y = py + oy;
        if (x < -1 || x > size || y < -1 || y > size) continue;
        heights[(y + 1) * stride + (x + 1)] -= depth * Math.exp(-d2 / r2);
      }
    }
  }
  return normalFromHeights(heights, size, strength);
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

/** Warm, unevenly-baked bread albedo: golden base, toasted patches, pores, darker crust band. */
export function makeBreadAlbedo(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  // base golden brioche + toasted highlights
  const base = { r: 198, g: 134, b: 73 };
  const dark = { r: 118, g: 68, b: 30 };
  const light = { r: 228, g: 180, b: 110 };
  const crust = { r: 146, g: 88, b: 40 };
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
      // Lathe UV: v runs along the bun profile. Toast the extremities (rim /
      // apex brown faster in the oven) and keep the belly golden.
      const vy = y / size;
      const edgeToast =
        THREE.MathUtils.smoothstep(vy, 0.28, 0.0) * 0.5 +
        THREE.MathUtils.smoothstep(vy, 0.72, 1.0) * 0.35;
      r = THREE.MathUtils.lerp(r, crust.r, edgeToast);
      g = THREE.MathUtils.lerp(g, crust.g, edgeToast);
      b = THREE.MathUtils.lerp(b, crust.b, edgeToast);
      const speck = (fine - 0.5) * 26;
      const idx = (y * size + x) * 4;
      img.data[idx] = THREE.MathUtils.clamp(r + speck, 0, 255);
      img.data[idx + 1] = THREE.MathUtils.clamp(g + speck * 0.8, 0, 255);
      img.data[idx + 2] = THREE.MathUtils.clamp(b + speck * 0.6, 0, 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Baked pores — small dark pinholes that break the CG-perfect surface.
  const pores = Math.floor(size * 0.9);
  for (let i = 0; i < pores; i++) {
    const px = Math.random() * size;
    const py = Math.random() * size;
    const pr = (0.6 + Math.random() * 1.8) * (size / 512);
    ctx.fillStyle = `rgba(96, 54, 24, ${0.1 + Math.random() * 0.22})`;
    ctx.beginPath();
    ctx.ellipse(px, py, pr, pr * (0.6 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
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

/* ---------------------------------------------------------------------------
   Realism maps — albedo + roughness per ingredient. All one-time canvas
   renders; the fbm fields are precomputed into typed arrays so the per-pixel
   passes are plain array reads.
--------------------------------------------------------------------------- */

/**
 * Seared beef patty albedo. Dark caramelised crust ring, juicy mottled centre,
 * near-black char patches, lighter fat veins and salt/pepper speckle.
 * Cylinder UVs: caps are planar circles (radial crust ring), the side wraps
 * (vertical toast bands near the seared faces).
 */
export function makePattyAlbedo(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  const px = size * size;
  const mottle = new Float64Array(px); // large juicy patches
  const charF = new Float64Array(px); // char blotches
  const ridge = new Float64Array(px); // fat veins (ridged noise)
  for (let y = 0; y < size; y++) {
    const fy = y / size;
    for (let x = 0; x < size; x++) {
      const fx = x / size;
      const i = y * size + x;
      mottle[i] = fbm(fx * 9, fy * 9, 5);
      charF[i] = fbm(fx * 16 + 40, fy * 16, 4);
      const r = fbm(fx * 13 + 80, fy * 13, 3);
      ridge[i] = 1 - Math.abs(2 * r - 1);
    }
  }

  const deep = { r: 42, g: 20, b: 12 }; // #2a140c base shadow meat
  const mid = { r: 96, g: 50, b: 32 }; // seared brown
  const juicy = { r: 128, g: 70, b: 42 }; // lighter juicy highs
  const charc = { r: 16, g: 8, b: 5 }; // near-black char
  const crustC = { r: 24, g: 12, b: 7 }; // hard crust ring
  const fat = { r: 158, g: 108, b: 70 }; // rendered fat veins

  for (let y = 0; y < size; y++) {
    const ny = y / size - 0.5;
    for (let x = 0; x < size; x++) {
      const nx = x / size - 0.5;
      const i = y * size + x;
      const m = mottle[i];
      // base: deep → mid by mottle, then juicy highs
      let r = THREE.MathUtils.lerp(deep.r, mid.r, m);
      let g = THREE.MathUtils.lerp(deep.g, mid.g, m);
      let b = THREE.MathUtils.lerp(deep.b, mid.b, m);
      const jw = THREE.MathUtils.clamp((m - 0.55) / 0.45, 0, 1) * 0.8;
      r = THREE.MathUtils.lerp(r, juicy.r, jw);
      g = THREE.MathUtils.lerp(g, juicy.g, jw);
      b = THREE.MathUtils.lerp(b, juicy.b, jw);
      // fat veins
      const vw = THREE.MathUtils.clamp((ridge[i] - 0.88) / 0.12, 0, 1) * 0.55;
      r = THREE.MathUtils.lerp(r, fat.r, vw);
      g = THREE.MathUtils.lerp(g, fat.g, vw);
      b = THREE.MathUtils.lerp(b, fat.b, vw);
      // char blotches
      const cw = THREE.MathUtils.clamp((charF[i] - 0.6) / 0.4, 0, 1);
      r = THREE.MathUtils.lerp(r, charc.r, cw * 0.9);
      g = THREE.MathUtils.lerp(g, charc.g, cw * 0.9);
      b = THREE.MathUtils.lerp(b, charc.b, cw * 0.9);
      // crust ring (caps read radially) + seared bands top/bottom (side wrap)
      const rad = Math.hypot(nx, ny) * 2;
      const ring = THREE.MathUtils.smoothstep(rad, 0.6, 0.98);
      const band = THREE.MathUtils.smoothstep(Math.abs(ny) * 2, 0.55, 0.95) * 0.55;
      const dark = Math.max(ring, band) * 0.8;
      r = THREE.MathUtils.lerp(r, crustC.r, dark);
      g = THREE.MathUtils.lerp(g, crustC.g, dark);
      b = THREE.MathUtils.lerp(b, crustC.b, dark);
      const idx = i * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // seasoning: salt (pale) + pepper (dark) pin-points
  const grains = Math.floor(size * 1.4);
  for (let i = 0; i < grains; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const s = (0.5 + Math.random() * 0.9) * (size / 512);
    ctx.fillStyle =
      Math.random() < 0.45
        ? `rgba(214, 198, 170, ${0.25 + Math.random() * 0.4})`
        : `rgba(12, 7, 5, ${0.3 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface RoughnessOptions {
  size?: number;
  scale?: number;
  octaves?: number;
  /** roughness at the low/high ends of the fbm field (0..1) */
  low?: number;
  high?: number;
  /** optional glossy patches (oil/grease): fbm above this threshold drops to spotsLow */
  spotsThreshold?: number;
  spotsLow?: number;
  spotsScale?: number;
}

/**
 * Grayscale roughness map. three.js multiplies roughnessMap × material.roughness,
 * so materials using one set `roughness: 1` and bake absolute values here.
 */
export function makeRoughnessTexture({
  size = 512,
  scale = 6,
  octaves = 4,
  low = 0.45,
  high = 0.9,
  spotsThreshold = 0,
  spotsLow = 0.15,
  spotsScale = 11,
}: RoughnessOptions = {}): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const px = size * size;
  const field = new Float64Array(px);
  const spots = spotsThreshold > 0 ? new Float64Array(px) : null;
  for (let y = 0; y < size; y++) {
    const fy = y / size;
    for (let x = 0; x < size; x++) {
      const fx = x / size;
      const i = y * size + x;
      field[i] = fbm(fx * scale, fy * scale, octaves);
      if (spots) spots[i] = fbm(fx * spotsScale + 33, fy * spotsScale, 3);
    }
  }
  for (let i = 0; i < px; i++) {
    let v = THREE.MathUtils.lerp(low, high, field[i]);
    if (spots) {
      const w = THREE.MathUtils.clamp((spots[i] - spotsThreshold) / (1 - spotsThreshold), 0, 1);
      v = THREE.MathUtils.lerp(v, spotsLow, Math.min(1, w * 2.5));
    }
    const c = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255);
    const idx = i * 4;
    img.data[idx] = c;
    img.data[idx + 1] = c;
    img.data[idx + 2] = c;
    img.data[idx + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Tomato roughness: wet pulpy centre, slightly matte skin rim. */
export function makeTomatoRoughness(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const ny = y / size - 0.5;
    for (let x = 0; x < size; x++) {
      const nx = x / size - 0.5;
      const rad = Math.hypot(nx, ny) * 2;
      const n = fbm((x / size) * 8, (y / size) * 8, 3);
      let v = THREE.MathUtils.lerp(0.1, 0.48, THREE.MathUtils.smoothstep(rad, 0.55, 1.0));
      v += (n - 0.5) * 0.16;
      const c = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255);
      const idx = (y * size + x) * 4;
      img.data[idx] = c;
      img.data[idx + 1] = c;
      img.data[idx + 2] = c;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

/**
 * Lettuce leaf albedo. Bright heart fading to deep green edges, curved radial
 * veins with finer side veins, and yellowish blight touches. RingGeometry UVs
 * are planar, so polar coordinates around (0.5, 0.5) map onto the leaf disc.
 */
export function makeLettuceAlbedo(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  const px = size * size;
  const blotch = new Float64Array(px);
  const spots = new Float64Array(px);
  for (let y = 0; y < size; y++) {
    const fy = y / size;
    for (let x = 0; x < size; x++) {
      const fx = x / size;
      const i = y * size + x;
      blotch[i] = fbm(fx * 7, fy * 7, 4);
      spots[i] = fbm(fx * 5 + 60, fy * 5, 3);
    }
  }

  const heart = { r: 150, g: 205, b: 96 }; // pale crunchy heart
  const mid = { r: 96, g: 166, b: 64 }; // leaf green
  const edge = { r: 54, g: 118, b: 42 }; // deep outer green
  const vein = { r: 196, g: 228, b: 148 }; // pale veins
  const blight = { r: 196, g: 205, b: 110 }; // yellow touches

  for (let y = 0; y < size; y++) {
    const ny = y / size - 0.5;
    for (let x = 0; x < size; x++) {
      const nx = x / size - 0.5;
      const i = y * size + x;
      const rad = Math.hypot(nx, ny) * 2;
      const ang = Math.atan2(ny, nx);
      // tonal gradient heart → edge
      let r: number, g: number, b: number;
      if (rad < 0.45) {
        const t = rad / 0.45;
        r = THREE.MathUtils.lerp(heart.r, mid.r, t);
        g = THREE.MathUtils.lerp(heart.g, mid.g, t);
        b = THREE.MathUtils.lerp(heart.b, mid.b, t);
      } else {
        const t = THREE.MathUtils.clamp((rad - 0.45) / 0.55, 0, 1);
        r = THREE.MathUtils.lerp(mid.r, edge.r, t);
        g = THREE.MathUtils.lerp(mid.g, edge.g, t);
        b = THREE.MathUtils.lerp(mid.b, edge.b, t);
      }
      // large tonal blotches
      const bl = (blotch[i] - 0.5) * 0.35;
      r *= 1 + bl;
      g *= 1 + bl;
      b *= 1 + bl;
      // primary veins: curved radial lines, strongest mid-leaf
      const curve = ang + rad * 0.9;
      const prim = Math.pow(Math.abs(Math.sin(curve * 10)), 0.55);
      const veinMask = (1 - THREE.MathUtils.smoothstep(rad, 0.7, 1.05)) * THREE.MathUtils.smoothstep(rad, 0.02, 0.12);
      const vw = (1 - prim) * 0.4 * veinMask;
      r = THREE.MathUtils.lerp(r, vein.r, vw);
      g = THREE.MathUtils.lerp(g, vein.g, vw);
      b = THREE.MathUtils.lerp(b, vein.b, vw);
      // yellowish touches, mostly toward the rim
      const sw =
        THREE.MathUtils.clamp((spots[i] - 0.66) / 0.34, 0, 1) *
        THREE.MathUtils.smoothstep(rad, 0.4, 0.95) * 0.5;
      r = THREE.MathUtils.lerp(r, blight.r, sw);
      g = THREE.MathUtils.lerp(g, blight.g, sw);
      b = THREE.MathUtils.lerp(b, blight.b, sw);
      const idx = i * 4;
      img.data[idx] = THREE.MathUtils.clamp(r, 0, 255);
      img.data[idx + 1] = THREE.MathUtils.clamp(g, 0, 255);
      img.data[idx + 2] = THREE.MathUtils.clamp(b, 0, 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Molten cheddar albedo — subtle tonal drift + tiny darker holes. */
export function makeCheeseAlbedo(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const base = { r: 242, g: 168, b: 59 }; // #f2a83b
  const dark = { r: 224, g: 142, b: 40 };
  const light = { r: 250, g: 190, b: 92 };
  for (let y = 0; y < size; y++) {
    const fy = y / size;
    for (let x = 0; x < size; x++) {
      const fx = x / size;
      const n = fbm(fx * 6, fy * 6, 4);
      const t = THREE.MathUtils.clamp((n - 0.35) / 0.3, 0, 1);
      let r: number, g: number, b: number;
      if (n < 0.5) {
        r = THREE.MathUtils.lerp(base.r, dark.r, 1 - t);
        g = THREE.MathUtils.lerp(base.g, dark.g, 1 - t);
        b = THREE.MathUtils.lerp(base.b, dark.b, 1 - t);
      } else {
        r = THREE.MathUtils.lerp(base.r, light.r, t);
        g = THREE.MathUtils.lerp(base.g, light.g, t);
        b = THREE.MathUtils.lerp(base.b, light.b, t);
      }
      const idx = (y * size + x) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // small melt holes / bubbles
  const holes = Math.floor(size / 8);
  for (let i = 0; i < holes; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = (1 + Math.random() * 2.5) * (size / 512);
    ctx.fillStyle = `rgba(196, 122, 30, ${0.15 + Math.random() * 0.2})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
