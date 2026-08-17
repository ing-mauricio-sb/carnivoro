import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const [red, green, blue] = hexToRgb(source);
  return new THREE.Color(red / 255, green / 255, blue / 255);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Cheeseburger
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createCheeseburgerModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Cheeseburger";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 18.0, "aspect": 1.8333, "orientation": {"yaw": 0.0, "pitch": -2.0, "roll": 0.0}, "positionHint": [0.0, 1.25, 10.0], "note": "near-orthographic studio elevation; review renders use this framing"}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["bunCrust"] = createSculptMaterial(
    "bunCrust",
    {"id": "bunCrust", "name": "Top bun glazed crust", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#b5651d", "color": "#b5651d", "albedo": {"dominant": "#a85618", "secondary": ["#a85618", "#e09a4d"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#a85618", "#8f4713", "#c8752a", "#96470f", "#b5651d"], "pattern": "reference-derived pixel palette", "amplitude": 0.14, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.499, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.34, "variation": 0.16, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.25, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.052}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "dome-glaze-gradient", "description": "albedo amber apex -> deep brown skirt; roughness 0.32 apex -> 0.45 skirt", "evidenceRef": "detail-scan/zone-r0c1.png"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "glazed brioche dome; broad softbox specular in reference is lighting, not albedo", "clearcoat": {"base": 0.22}, "clearcoatRoughness": {"base": 0.3}, "sheen": {"base": 0.2}, "sheenColor": "#e7a765", "sheenRoughness": {"base": 0.6}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\bunCrust.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunCrust\\buncrust_albedo.png", "url": "buncrust_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunCrust\\buncrust_roughness.png", "url": "buncrust_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunCrust\\buncrust_height.png", "url": "buncrust_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunCrust\\buncrust_normal.png", "url": "buncrust_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunCrust\\buncrust_ao.png", "url": "buncrust_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 701, "sourceHeight": 260, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 701, "height": 260}, "mask": {"backgroundColor": "#EFC59D", "backgroundNoise": 158.931, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9938}, "mapStats": {"valueRange": 0.6243, "heightP90Gradient": 0.11542, "roughnessBase": 0.756, "roughnessVariation": 0.18, "normalStrength": 0.292, "blurRadius": 21}, "palette": ["#BA560C", "#FACEA7", "#B86A38", "#89360B", "#E6A36D"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural-palette route: the single-view crop cross-contaminates channels (painted seeds / neighbouring-layer pixels), so the maps are evidence only; factory falls back to colorVariation procedural textures"}},
    options
  );
  materialMap["bunHeel"] = createSculptMaterial(
    "bunHeel",
    {"id": "bunHeel", "name": "Bottom bun heel", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#caa96b", "color": "#caa96b", "albedo": {"dominant": "#D4893D", "secondary": ["#B5692A", "#83471A", "#431A06"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#D4893D", "#B5692A", "#83471A", "#431A06", "#C29C7D"], "pattern": "reference-derived pixel palette", "amplitude": 0.23, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.471, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.726, "variation": 0.102, "map": "independent-procedural-field", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.218, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.024}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "heel-toast-ring", "description": "dark toasted band around lower edge + flour speckle", "evidenceRef": "detail-scan/zone-r2c1.png"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\bunHeel.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunHeel\\bunheel_albedo.png", "url": "bunheel_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunHeel\\bunheel_roughness.png", "url": "bunheel_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunHeel\\bunheel_height.png", "url": "bunheel_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunHeel\\bunheel_normal.png", "url": "bunheel_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunHeel\\bunheel_ao.png", "url": "bunheel_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 701, "sourceHeight": 95, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 701, "height": 68}, "mask": {"backgroundColor": "#E6E4E1", "backgroundNoise": 221.745, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.622}, "mapStats": {"valueRange": 0.547, "heightP90Gradient": 0.05229, "roughnessBase": 0.726, "roughnessVariation": 0.102, "normalStrength": 0.218, "blurRadius": 21}, "palette": ["#D4893D", "#B5692A", "#83471A", "#431A06", "#C29C7D"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural route for web: self-contained bundle, no asset fetches"}},
    options
  );
  materialMap["sesameMat"] = createSculptMaterial(
    "sesameMat",
    {"id": "sesameMat", "name": "Sesame seeds", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#e8d9a8", "color": "#e8d9a8", "albedo": {"dominant": "#e8d9a8", "secondary": ["#d4b578", "#c89a58"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#e8d9a8", "#d4b578", "#c89a58"], "pattern": "reference-derived pixel palette", "amplitude": 0.14, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.52, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.55, "variation": 0.08, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.25, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.029}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "3 toast tones distributed per instance", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\sesameMat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\sesameMat\\sesamemat_albedo.png", "url": "sesamemat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\sesameMat\\sesamemat_roughness.png", "url": "sesamemat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\sesameMat\\sesamemat_height.png", "url": "sesamemat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\sesameMat\\sesamemat_normal.png", "url": "sesamemat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\sesameMat\\sesamemat_ao.png", "url": "sesamemat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 220, "sourceHeight": 131, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 220, "height": 131}, "mask": {"backgroundColor": "#AB5616", "backgroundNoise": 94.165, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.6973, "heightP90Gradient": 0.0644, "roughnessBase": 0.741, "roughnessVariation": 0.118, "normalStrength": 0.232, "blurRadius": 21}, "palette": ["#B6530B", "#FCD6A2", "#C9702F", "#792A08", "#E6A165"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural-palette route: the single-view crop cross-contaminates channels (painted seeds / neighbouring-layer pixels), so the maps are evidence only; factory falls back to colorVariation procedural textures"}},
    options
  );
  materialMap["lettuceMat"] = createSculptMaterial(
    "lettuceMat",
    {"id": "lettuceMat", "name": "Lettuce leaf", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#5aa832", "color": "#5aa832", "albedo": {"dominant": "#4d9429", "secondary": ["#8cc85e", "#3f8722"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#4d9429", "#6cae3f", "#3a7d1f", "#5aa832"], "pattern": "reference-derived pixel palette", "amplitude": 0.14, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.465, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.36, "variation": 0.16, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.25, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.035}, "displacement": {"pattern": "radial-ruffle", "amplitude": 0.05, "scale": 9.0, "silhouetteAffects": true}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "semi-translucent margins approximated with sheen, NOT transmission (budget: 1 transmissive total)", "sheen": {"base": 0.25}, "sheenColor": "#bfe6a0", "sheenRoughness": {"base": 0.5}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\lettuceMat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_albedo.png", "url": "lettucemat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_roughness.png", "url": "lettucemat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_height.png", "url": "lettucemat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_normal.png", "url": "lettucemat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_ao.png", "url": "lettucemat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 800, "sourceHeight": 115, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 800, "height": 115}, "mask": {"backgroundColor": "#AE7B31", "backgroundNoise": 77.311, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.5286, "heightP90Gradient": 0.07746, "roughnessBase": 0.74, "roughnessVariation": 0.136, "normalStrength": 0.247, "blurRadius": 21}, "palette": ["#D38C3C", "#E8AC5A", "#BA6A27", "#8F4316", "#F9D39D"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural-palette route: the single-view crop cross-contaminates channels (painted seeds / neighbouring-layer pixels), so the maps are evidence only; factory falls back to colorVariation procedural textures"}, "doubleSided": true},
    options
  );
  materialMap["tomatoMat"] = createSculptMaterial(
    "tomatoMat",
    {"id": "tomatoMat", "name": "Tomato slices", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#d43c2a", "color": "#d43c2a", "albedo": {"dominant": "#271202", "secondary": ["#BBB841", "#8F310A", "#CB551E"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#d43c2a", "#e8604a", "#b92f1f", "#f07a5e"], "pattern": "reference-derived pixel palette", "amplitude": 0.12, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.52, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.3, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.2, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.024}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "tomato-skin-ring", "description": "saturated red skin ring on slice rim; cut face lighter, wet", "evidenceRef": "detail-scan/zone-r2c1.png"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "", "clearcoat": {"base": 0.3}, "clearcoatRoughness": {"base": 0.25}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\tomatoMat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\tomatoMat\\tomatomat_albedo.png", "url": "tomatomat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\tomatoMat\\tomatomat_roughness.png", "url": "tomatomat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\tomatoMat\\tomatomat_height.png", "url": "tomatomat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\tomatoMat\\tomatomat_normal.png", "url": "tomatomat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\tomatoMat\\tomatomat_ao.png", "url": "tomatomat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 701, "sourceHeight": 91, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 701, "height": 91}, "mask": {"backgroundColor": "#CA6D34", "backgroundNoise": 58.949, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.7373, "heightP90Gradient": 0.05283, "roughnessBase": 0.705, "roughnessVariation": 0.094, "normalStrength": 0.218, "blurRadius": 21}, "palette": ["#271202", "#BBB841", "#8F310A", "#CB551E", "#635B0A"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural-palette route: crop includes pickle/lettuce pixels"}},
    options
  );
  materialMap["onionMat"] = createSculptMaterial(
    "onionMat",
    {"id": "onionMat", "name": "Red onion rings", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#d8c7e0", "color": "#d8c7e0", "albedo": {"dominant": "#c48aab", "secondary": ["#c9aed6", "#a56b9a"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#c48aab", "#7a3b6e", "#e3d5ea", "#a56b9a"], "pattern": "reference-derived pixel palette", "amplitude": 0.14, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.456, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.3, "variation": 0.14, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.25, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.024}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "onion-rings-translucent", "description": "vivid purple rims, lavender body; translucency faked via light albedo + clearcoat", "evidenceRef": "detail-scan/zone-r2c1.png"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "", "clearcoat": {"base": 0.2}, "clearcoatRoughness": {"base": 0.3}, "opacity": {"base": 0.96}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\onionMat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\onionMat\\onionmat_albedo.png", "url": "onionmat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\onionMat\\onionmat_roughness.png", "url": "onionmat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\onionMat\\onionmat_height.png", "url": "onionmat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\onionMat\\onionmat_normal.png", "url": "onionmat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\onionMat\\onionmat_ao.png", "url": "onionmat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 451, "sourceHeight": 58, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 451, "height": 58}, "mask": {"backgroundColor": "#C16113", "backgroundNoise": 155.335, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9993}, "mapStats": {"valueRange": 0.5021, "heightP90Gradient": 0.05378, "roughnessBase": 0.72, "roughnessVariation": 0.094, "normalStrength": 0.219, "blurRadius": 21}, "palette": ["#B74717", "#5E0F03", "#BA614F", "#862C15", "#D78985"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural-palette route: the single-view crop cross-contaminates channels (painted seeds / neighbouring-layer pixels), so the maps are evidence only; factory falls back to colorVariation procedural textures"}},
    options
  );
  materialMap["pickleMat"] = createSculptMaterial(
    "pickleMat",
    {"id": "pickleMat", "name": "Crinkle-cut pickles", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#7a8b3a", "color": "#7a8b3a", "albedo": {"dominant": "#7a8b3a", "secondary": ["#9db04c", "#5c6e28"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#7a8b3a", "#9db04c", "#5c6e28", "#8a9c42"], "pattern": "reference-derived pixel palette", "amplitude": 0.14, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.499, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.312, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.32, "variation": 0.14, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.25, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.017}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "", "clearcoat": {"base": 0.25}, "clearcoatRoughness": {"base": 0.35}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\pickleMat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pickleMat\\picklemat_albedo.png", "url": "picklemat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pickleMat\\picklemat_roughness.png", "url": "picklemat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pickleMat\\picklemat_height.png", "url": "picklemat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pickleMat\\picklemat_normal.png", "url": "picklemat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pickleMat\\picklemat_ao.png", "url": "picklemat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 549, "sourceHeight": 68, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 549, "height": 68}, "mask": {"backgroundColor": "#8F4D62", "backgroundNoise": 147.017, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9876}, "mapStats": {"valueRange": 0.6267, "heightP90Gradient": 0.03858, "roughnessBase": 0.71, "roughnessVariation": 0.073, "normalStrength": 0.201, "blurRadius": 21}, "palette": ["#995067", "#2B0A06", "#C5839A", "#6B2D29", "#B49226"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural-palette route: the single-view crop cross-contaminates channels (painted seeds / neighbouring-layer pixels), so the maps are evidence only; factory falls back to colorVariation procedural textures"}},
    options
  );
  materialMap["pattyMat"] = createSculptMaterial(
    "pattyMat",
    {"id": "pattyMat", "name": "Seared beef patty", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#4a2f1e", "color": "#4a2f1e", "albedo": {"dominant": "#7B4C30", "secondary": ["#512C15", "#1E0C05", "#E4AF44"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "public/model/pattymat_albedo.png", "url": "/model/pattymat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#7B4C30", "#512C15", "#1E0C05", "#E4AF44", "#A77346"], "pattern": "reference-derived pixel palette", "amplitude": 0.295, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.52, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.734, "variation": 0.122, "map": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pattyMat\\pattymat_roughness.png", "url": "pattymat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.23, "map": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pattyMat\\pattymat_normal.png", "url": "pattymat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pattyMat\\pattymat_height.png", "url": "pattymat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.028, "map": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pattyMat\\pattymat_height.png", "url": "pattymat_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "granular-crust", "amplitude": 0.06, "scale": 14.0, "silhouetteAffects": true}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pattyMat\\pattymat_ao.png", "url": "pattymat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "patty-char-crust", "description": "char low-value spots ~20% coverage concentrated on rim", "evidenceRef": "detail-scan/zone-r1c1.png"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "grease sheen via low clearcoat; relief must survive grazing light", "clearcoat": {"base": 0.15}, "clearcoatRoughness": {"base": 0.5}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\pattyMat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "public/model/pattymat_albedo.png", "url": "/model/pattymat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "public/model/pattymat_roughness.png", "url": "/model/pattymat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "public/model/pattymat_height.png", "url": "/model/pattymat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "public/model/pattymat_normal.png", "url": "/model/pattymat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "public/model/pattymat_ao.png", "url": "/model/pattymat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 850, "sourceHeight": 170, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 850, "height": 170}, "mask": {"backgroundColor": "#8D732F", "backgroundNoise": 144.423, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9862}, "mapStats": {"valueRange": 0.7034, "heightP90Gradient": 0.06309, "roughnessBase": 0.734, "roughnessVariation": 0.122, "normalStrength": 0.23, "blurRadius": 21}, "palette": ["#7B4C30", "#512C15", "#1E0C05", "#E4AF44", "#A77346"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "web ship: all 5 channels at 512px under public/model/"}},
    options
  );
  materialMap["cheeseMat"] = createSculptMaterial(
    "cheeseMat",
    {"id": "cheeseMat", "name": "Melted cheddar", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#f2a614", "color": "#f2a614", "albedo": {"dominant": "#f7a90c", "secondary": ["#e8990f", "#f7b93a"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#f7a90c", "#e8990f", "#fbbf3a"], "pattern": "reference-derived pixel palette", "amplitude": 0.14, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.52, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.3, "variation": 0.08, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.1, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.028}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "cheese-gradient", "description": "albedo deeper at lobe tips (#e0940f)", "evidenceRef": "detail-scan/zone-r1c1.png"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "THE single transmissive material (budget: max 1)", "transmission": {"base": 0.12}, "ior": 1.4, "clearcoat": {"base": 0.1}, "clearcoatRoughness": {"base": 0.3}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\cheeseMat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\cheeseMat\\cheesemat_albedo.png", "url": "cheesemat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\cheeseMat\\cheesemat_roughness.png", "url": "cheesemat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\cheeseMat\\cheesemat_height.png", "url": "cheesemat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\cheeseMat\\cheesemat_normal.png", "url": "cheesemat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\cheeseMat\\cheesemat_ao.png", "url": "cheesemat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 749, "sourceHeight": 80, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 749, "height": 80}, "mask": {"backgroundColor": "#98490A", "backgroundNoise": 139.115, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9583}, "mapStats": {"valueRange": 0.7144, "heightP90Gradient": 0.06317, "roughnessBase": 0.701, "roughnessVariation": 0.106, "normalStrength": 0.23, "blurRadius": 21}, "palette": ["#E2A721", "#B4760F", "#75410F", "#2A130B", "#DFB570"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural-palette route: the single-view crop cross-contaminates channels (painted seeds / neighbouring-layer pixels), so the maps are evidence only; factory falls back to colorVariation procedural textures"}},
    options
  );
  materialMap["skewerMat"] = createSculptMaterial(
    "skewerMat",
    {"id": "skewerMat", "name": "Bamboo skewer", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#c9a86a", "color": "#c9a86a", "albedo": {"dominant": "#E4C691", "secondary": ["#B4955A", "#CEB175", "#90703F"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#E4C691", "#B4955A", "#CEB175", "#90703F", "#F1E4CF"], "pattern": "reference-derived pixel palette", "amplitude": 0.193, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.441, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.266, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.121, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.68, "variation": 0.051, "map": "independent-procedural-field", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.188, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.012}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\skewerMat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\skewerMat\\skewermat_albedo.png", "url": "skewermat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\skewerMat\\skewermat_roughness.png", "url": "skewermat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\skewerMat\\skewermat_height.png", "url": "skewermat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\skewerMat\\skewermat_normal.png", "url": "skewermat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\skewerMat\\skewermat_ao.png", "url": "skewermat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 44, "sourceHeight": 190, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 10, "width": 44, "height": 141}, "mask": {"backgroundColor": "#F8F8F7", "backgroundNoise": 5.385, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.3098}, "mapStats": {"valueRange": 0.4593, "heightP90Gradient": 0.02752, "roughnessBase": 0.68, "roughnessVariation": 0.051, "normalStrength": 0.188, "blurRadius": 21}, "palette": ["#E4C691", "#B4955A", "#CEB175", "#90703F", "#F1E4CF"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural route for web: self-contained bundle, no asset fetches"}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_bottomBun_0 = null;
  const endpoint_bottomBun_0 = makeAttachmentEndpoint(attachment_bottomBun_0);
  const node_bottomBun_0 = new THREE.Group();
  node_bottomBun_0.name = "Bottom bun heel__pivot";
  node_bottomBun_0.scale.set(1, 1, 1);
  if (endpoint_bottomBun_0) {
    node_bottomBun_0.position.copy(endpoint_bottomBun_0.start);
    node_bottomBun_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bottomBun_0.position.set(0.0, 0.0, 0.0);
    node_bottomBun_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_bottomBun_0.userData.sculptComponent = {"id": "bottomBun", "name": "Bottom bun heel", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "rounded heel disc: lathe of a 9-point profile", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.001, 0.0], [0.9, 0.0], [1.12, 0.028], [1.22, 0.081], [1.26, 0.167], [1.21, 0.236], [1.04, 0.282], [0.48, 0.291], [0.001, 0.291]], "segments": 72}}, "parent": null, "attachment": null, "dimensions": {"width": 2.5, "height": 0.29, "depth": 2.5, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottomBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "bunHeel", "materialLayers": ["bunHeel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "heel-toast-ring", "kind": "material-zone", "description": "toasted band on lower wall", "evidenceRef": "zone-r2c1"}, {"id": "bottomBun.sesameWall", "kind": "fastener", "description": "sparse sesame on heel wall (sesameFieldHeel cluster)", "evidenceRef": "zone-r2c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "crumb pore normal + toast ring albedo band"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "denseMesh": true, "colorMaterialRecipe": {"dominantAlbedo": "rgba(202, 169, 107, 1.0)", "secondaryAlbedo": "rgba(164, 118, 61, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_bottomBun_0.userData.actionProfile = {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottomBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["root"] ?? root).add(node_bottomBun_0);
  nodes["bottomBun"] = node_bottomBun_0;
  const mesh_bottomBun_0Geometry = endpoint_bottomBun_0
    ? new THREE.CylinderGeometry(endpoint_bottomBun_0.endRadius, endpoint_bottomBun_0.baseRadius, endpoint_bottomBun_0.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, 0.0], [0.9, 0.0], [1.12, 0.028], [1.22, 0.081], [1.26, 0.167], [1.21, 0.236], [1.04, 0.282], [0.48, 0.291], [0.001, 0.291]], "segments": 72});
  if (!endpoint_bottomBun_0) {
    mesh_bottomBun_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bottomBun_0 = new THREE.Mesh(
    mesh_bottomBun_0Geometry,
    createSculptMaterial("bunHeel", {"id": "bunHeel", "name": "Bottom bun heel", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#caa96b", "color": "#caa96b", "albedo": {"dominant": "#D4893D", "secondary": ["#B5692A", "#83471A", "#431A06"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#D4893D", "#B5692A", "#83471A", "#431A06", "#C29C7D"], "pattern": "reference-derived pixel palette", "amplitude": 0.23, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.471, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.726, "variation": 0.102, "map": "independent-procedural-field", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.218, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.024}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "heel-toast-ring", "description": "dark toasted band around lower edge + flour speckle", "evidenceRef": "detail-scan/zone-r2c1.png"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\bunHeel.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunHeel\\bunheel_albedo.png", "url": "bunheel_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunHeel\\bunheel_roughness.png", "url": "bunheel_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunHeel\\bunheel_height.png", "url": "bunheel_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunHeel\\bunheel_normal.png", "url": "bunheel_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunHeel\\bunheel_ao.png", "url": "bunheel_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 701, "sourceHeight": 95, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 701, "height": 68}, "mask": {"backgroundColor": "#E6E4E1", "backgroundNoise": 221.745, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.622}, "mapStats": {"valueRange": 0.547, "heightP90Gradient": 0.05229, "roughnessBase": 0.726, "roughnessVariation": 0.102, "normalStrength": 0.218, "blurRadius": 21}, "palette": ["#D4893D", "#B5692A", "#83471A", "#431A06", "#C29C7D"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural route for web: self-contained bundle, no asset fetches"}}, options, true)
  );
  mesh_bottomBun_0.name = "Bottom bun heel";
  if (endpoint_bottomBun_0) {
    mesh_bottomBun_0.position.copy(endpoint_bottomBun_0.midpoint);
    mesh_bottomBun_0.quaternion.copy(endpoint_bottomBun_0.quaternion);
  }
  mesh_bottomBun_0.castShadow = options.castShadow ?? true;
  mesh_bottomBun_0.receiveShadow = options.receiveShadow ?? true;
  mesh_bottomBun_0.userData.sculptComponent = {"id": "bottomBun", "name": "Bottom bun heel", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "rounded heel disc: lathe of a 9-point profile", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.001, 0.0], [0.9, 0.0], [1.12, 0.028], [1.22, 0.081], [1.26, 0.167], [1.21, 0.236], [1.04, 0.282], [0.48, 0.291], [0.001, 0.291]], "segments": 72}}, "parent": null, "attachment": null, "dimensions": {"width": 2.5, "height": 0.29, "depth": 2.5, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bottomBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "bunHeel", "materialLayers": ["bunHeel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "heel-toast-ring", "kind": "material-zone", "description": "toasted band on lower wall", "evidenceRef": "zone-r2c1"}, {"id": "bottomBun.sesameWall", "kind": "fastener", "description": "sparse sesame on heel wall (sesameFieldHeel cluster)", "evidenceRef": "zone-r2c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "crumb pore normal + toast ring albedo band"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "denseMesh": true, "colorMaterialRecipe": {"dominantAlbedo": "rgba(202, 169, 107, 1.0)", "secondaryAlbedo": "rgba(164, 118, 61, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_bottomBun_0.add(mesh_bottomBun_0);
  meshes["bottomBun"] = mesh_bottomBun_0;
  colliders["bottomBun"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["bottomBun"] ??= [];
  destructionGroups["bottomBun"].push(node_bottomBun_0);

  const attachment_lettuce_1 = null;
  const endpoint_lettuce_1 = makeAttachmentEndpoint(attachment_lettuce_1);
  const node_lettuce_1 = new THREE.Group();
  node_lettuce_1.name = "Lettuce leaf__pivot";
  node_lettuce_1.scale.set(1, 1, 1);
  if (endpoint_lettuce_1) {
    node_lettuce_1.position.copy(endpoint_lettuce_1.start);
    node_lettuce_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lettuce_1.position.set(0.0, 0.35, 0.0);
    node_lettuce_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_lettuce_1.userData.sculptComponent = {"id": "lettuce", "name": "Lettuce leaf", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "lathe", "topologyClass": "open-shell", "topologyRationale": "thin drooping sheet: lathe profile with folded-back rim; radial ruffle from displacement", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.001, 0.16], [0.5, 0.184], [0.95, 0.208], [1.4438, 0.184], [1.466, 0.096], [1.567, -0.0224], [1.5165, -0.0672], [1.4091, 0.032], [0.9, 0.096], [0.4, 0.096], [0.001, 0.088]], "segments": 96}}, "parent": null, "attachment": null, "dimensions": {"width": 3.28, "height": 0.3, "depth": 3.28, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0.35, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lettuce", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "lettuceMat", "materialLayers": ["lettuceMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lettuce.ruffleMargin", "kind": "geometry-feature", "description": "sinusoidal ruffled margin protruding 0.05-0.12 D beyond buns; drooping edge; angular ruffle refined in code (displacement)", "evidenceRef": "zone-r2c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "vein bump + waxy sheen; margin translucency faked with sheen"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "denseMesh": true, "colorMaterialRecipe": {"dominantAlbedo": "rgba(90, 168, 50, 1.0)", "secondaryAlbedo": "rgba(140, 200, 94, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_lettuce_1.userData.actionProfile = {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lettuce", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["root"] ?? root).add(node_lettuce_1);
  nodes["lettuce"] = node_lettuce_1;
  const mesh_lettuce_1Geometry = endpoint_lettuce_1
    ? new THREE.CylinderGeometry(endpoint_lettuce_1.endRadius, endpoint_lettuce_1.baseRadius, endpoint_lettuce_1.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, 0.16], [0.5, 0.184], [0.95, 0.208], [1.4438, 0.184], [1.466, 0.096], [1.567, -0.0224], [1.5165, -0.0672], [1.4091, 0.032], [0.9, 0.096], [0.4, 0.096], [0.001, 0.088]], "segments": 96});
  if (!endpoint_lettuce_1) {
    mesh_lettuce_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lettuce_1 = new THREE.Mesh(
    mesh_lettuce_1Geometry,
    createSculptMaterial("lettuceMat", {"id": "lettuceMat", "name": "Lettuce leaf", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#5aa832", "color": "#5aa832", "albedo": {"dominant": "#4d9429", "secondary": ["#8cc85e", "#3f8722"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#4d9429", "#6cae3f", "#3a7d1f", "#5aa832"], "pattern": "reference-derived pixel palette", "amplitude": 0.14, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.465, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.36, "variation": 0.16, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.25, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.035}, "displacement": {"pattern": "radial-ruffle", "amplitude": 0.05, "scale": 9.0, "silhouetteAffects": true}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "semi-translucent margins approximated with sheen, NOT transmission (budget: 1 transmissive total)", "sheen": {"base": 0.25}, "sheenColor": "#bfe6a0", "sheenRoughness": {"base": 0.5}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\lettuceMat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_albedo.png", "url": "lettucemat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_roughness.png", "url": "lettucemat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_height.png", "url": "lettucemat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_normal.png", "url": "lettucemat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_ao.png", "url": "lettucemat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 800, "sourceHeight": 115, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 800, "height": 115}, "mask": {"backgroundColor": "#AE7B31", "backgroundNoise": 77.311, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.5286, "heightP90Gradient": 0.07746, "roughnessBase": 0.74, "roughnessVariation": 0.136, "normalStrength": 0.247, "blurRadius": 21}, "palette": ["#D38C3C", "#E8AC5A", "#BA6A27", "#8F4316", "#F9D39D"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural-palette route: the single-view crop cross-contaminates channels (painted seeds / neighbouring-layer pixels), so the maps are evidence only; factory falls back to colorVariation procedural textures"}, "doubleSided": true}, options, true)
  );
  mesh_lettuce_1.name = "Lettuce leaf";
  if (endpoint_lettuce_1) {
    mesh_lettuce_1.position.copy(endpoint_lettuce_1.midpoint);
    mesh_lettuce_1.quaternion.copy(endpoint_lettuce_1.quaternion);
  }
  mesh_lettuce_1.castShadow = options.castShadow ?? true;
  mesh_lettuce_1.receiveShadow = options.receiveShadow ?? true;
  mesh_lettuce_1.userData.sculptComponent = {"id": "lettuce", "name": "Lettuce leaf", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "lathe", "topologyClass": "open-shell", "topologyRationale": "thin drooping sheet: lathe profile with folded-back rim; radial ruffle from displacement", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.001, 0.16], [0.5, 0.184], [0.95, 0.208], [1.4438, 0.184], [1.466, 0.096], [1.567, -0.0224], [1.5165, -0.0672], [1.4091, 0.032], [0.9, 0.096], [0.4, 0.096], [0.001, 0.088]], "segments": 96}}, "parent": null, "attachment": null, "dimensions": {"width": 3.28, "height": 0.3, "depth": 3.28, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0.35, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lettuce", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "lettuceMat", "materialLayers": ["lettuceMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lettuce.ruffleMargin", "kind": "geometry-feature", "description": "sinusoidal ruffled margin protruding 0.05-0.12 D beyond buns; drooping edge; angular ruffle refined in code (displacement)", "evidenceRef": "zone-r2c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "vein bump + waxy sheen; margin translucency faked with sheen"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "denseMesh": true, "colorMaterialRecipe": {"dominantAlbedo": "rgba(90, 168, 50, 1.0)", "secondaryAlbedo": "rgba(140, 200, 94, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_lettuce_1.add(mesh_lettuce_1);
  meshes["lettuce"] = mesh_lettuce_1;
  colliders["lettuce"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["lettuce"] ??= [];
  destructionGroups["lettuce"].push(node_lettuce_1);

  const attachment_tomato_2 = null;
  const endpoint_tomato_2 = makeAttachmentEndpoint(attachment_tomato_2);
  const node_tomato_2 = new THREE.Group();
  node_tomato_2.name = "Tomato slices (x2)__pivot";
  node_tomato_2.scale.set(1, 1, 1);
  if (endpoint_tomato_2) {
    node_tomato_2.position.copy(endpoint_tomato_2.start);
    node_tomato_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_tomato_2.position.set(0.0, 0.52, 0.0);
    node_tomato_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_tomato_2.userData.sculptComponent = {"id": "tomato", "name": "Tomato slices (x2)", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "two slices as one lathe with a mid groove (they explode together as one stratum)", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.001, 0.0], [1.1, 0.0], [1.17, 0.02], [1.18, 0.1], [1.14, 0.115], [1.14, 0.125], [1.18, 0.14], [1.17, 0.22], [1.1, 0.24], [0.001, 0.24]], "segments": 72}}, "parent": null, "attachment": null, "dimensions": {"width": 2.36, "height": 0.24, "depth": 2.36, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0.52, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tomato", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "tomatoMat", "materialLayers": ["tomatoMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tomato.sliceGroove", "kind": "geometry-feature", "description": "mid-height groove reads as two stacked slices", "evidenceRef": "zone-r2c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(212, 60, 42, 1.0)", "secondaryAlbedo": "rgba(232, 96, 74, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_tomato_2.userData.actionProfile = {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tomato", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["root"] ?? root).add(node_tomato_2);
  nodes["tomato"] = node_tomato_2;
  const mesh_tomato_2Geometry = endpoint_tomato_2
    ? new THREE.CylinderGeometry(endpoint_tomato_2.endRadius, endpoint_tomato_2.baseRadius, endpoint_tomato_2.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, 0.0], [1.1, 0.0], [1.17, 0.02], [1.18, 0.1], [1.14, 0.115], [1.14, 0.125], [1.18, 0.14], [1.17, 0.22], [1.1, 0.24], [0.001, 0.24]], "segments": 72});
  if (!endpoint_tomato_2) {
    mesh_tomato_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_tomato_2 = new THREE.Mesh(
    mesh_tomato_2Geometry,
    materialMap["tomatoMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_tomato_2.name = "Tomato slices (x2)";
  if (endpoint_tomato_2) {
    mesh_tomato_2.position.copy(endpoint_tomato_2.midpoint);
    mesh_tomato_2.quaternion.copy(endpoint_tomato_2.quaternion);
  }
  mesh_tomato_2.castShadow = options.castShadow ?? true;
  mesh_tomato_2.receiveShadow = options.receiveShadow ?? true;
  mesh_tomato_2.userData.sculptComponent = {"id": "tomato", "name": "Tomato slices (x2)", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "two slices as one lathe with a mid groove (they explode together as one stratum)", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.001, 0.0], [1.1, 0.0], [1.17, 0.02], [1.18, 0.1], [1.14, 0.115], [1.14, 0.125], [1.18, 0.14], [1.17, 0.22], [1.1, 0.24], [0.001, 0.24]], "segments": 72}}, "parent": null, "attachment": null, "dimensions": {"width": 2.36, "height": 0.24, "depth": 2.36, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0.52, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "tomato", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "tomatoMat", "materialLayers": ["tomatoMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tomato.sliceGroove", "kind": "geometry-feature", "description": "mid-height groove reads as two stacked slices", "evidenceRef": "zone-r2c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(212, 60, 42, 1.0)", "secondaryAlbedo": "rgba(232, 96, 74, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_tomato_2.add(mesh_tomato_2);
  meshes["tomato"] = mesh_tomato_2;
  colliders["tomato"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["tomato"] ??= [];
  destructionGroups["tomato"].push(node_tomato_2);

  const attachment_onion_3 = null;
  const endpoint_onion_3 = makeAttachmentEndpoint(attachment_onion_3);
  const node_onion_3 = new THREE.Group();
  node_onion_3.name = "Red onion rings__pivot";
  node_onion_3.scale.set(1, 1, 1);
  if (endpoint_onion_3) {
    node_onion_3.position.copy(endpoint_onion_3.start);
    node_onion_3.rotation.set(1.570796, 0.0, 0.0);
  } else {
    node_onion_3.position.set(0.0, 0.8, 0.0);
    node_onion_3.rotation.set(1.570796, 0.0, 0.0);
  }
  node_onion_3.userData.sculptComponent = {"id": "onion", "name": "Red onion rings", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "flat-lying torus ring; two sibling rings complete the stratum", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.14}, "parent": null, "attachment": null, "dimensions": {"width": 2.62, "height": 0.16, "depth": 1.0, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0.8, 0], "rotation": [1.570796, 0, 0]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "onion", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "onionMat", "materialLayers": ["onionMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "onion.ringSections", "kind": "geometry-feature", "description": "2-3 visible ring cross-sections, purple rims", "evidenceRef": "zone-r2c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 138, 171, 1.0)", "secondaryAlbedo": "rgba(122, 59, 110, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_onion_3.userData.actionProfile = {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "onion", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["root"] ?? root).add(node_onion_3);
  nodes["onion"] = node_onion_3;
  const mesh_onion_3Geometry = endpoint_onion_3
    ? new THREE.CylinderGeometry(endpoint_onion_3.endRadius, endpoint_onion_3.baseRadius, endpoint_onion_3.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.063, 12, 48);
  if (!endpoint_onion_3) {
    mesh_onion_3Geometry.scale(2.62, 0.16, 1.0);
  }
  const mesh_onion_3 = new THREE.Mesh(
    mesh_onion_3Geometry,
    materialMap["onionMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_onion_3.name = "Red onion rings";
  if (endpoint_onion_3) {
    mesh_onion_3.position.copy(endpoint_onion_3.midpoint);
    mesh_onion_3.quaternion.copy(endpoint_onion_3.quaternion);
  }
  mesh_onion_3.castShadow = options.castShadow ?? true;
  mesh_onion_3.receiveShadow = options.receiveShadow ?? true;
  mesh_onion_3.userData.sculptComponent = {"id": "onion", "name": "Red onion rings", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "flat-lying torus ring; two sibling rings complete the stratum", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.14}, "parent": null, "attachment": null, "dimensions": {"width": 2.62, "height": 0.16, "depth": 1.0, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0.8, 0], "rotation": [1.570796, 0, 0]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "onion", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "onionMat", "materialLayers": ["onionMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "onion.ringSections", "kind": "geometry-feature", "description": "2-3 visible ring cross-sections, purple rims", "evidenceRef": "zone-r2c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 138, 171, 1.0)", "secondaryAlbedo": "rgba(122, 59, 110, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_onion_3.add(mesh_onion_3);
  meshes["onion"] = mesh_onion_3;
  colliders["onion"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["onion"] ??= [];
  destructionGroups["onion"].push(node_onion_3);

  const attachment_onionRingB_4 = null;
  const endpoint_onionRingB_4 = makeAttachmentEndpoint(attachment_onionRingB_4);
  const node_onionRingB_4 = new THREE.Group();
  node_onionRingB_4.name = "Onion ring B__pivot";
  node_onionRingB_4.scale.set(1, 1, 1);
  if (endpoint_onionRingB_4) {
    node_onionRingB_4.position.copy(endpoint_onionRingB_4.start);
    node_onionRingB_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_onionRingB_4.position.set(0.14, -0.1, -0.025);
    node_onionRingB_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_onionRingB_4.userData.sculptComponent = {"id": "onionRingB", "name": "Onion ring B", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "smaller offset ring under the main one", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.0806}, "parent": "onion", "attachment": null, "dimensions": {"width": 1.7, "height": 1.7, "depth": 0.85, "units": "world", "confidence": 0.85}, "transform": {"position": [0.14, -0.1, -0.025], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "onion", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "onionMat", "materialLayers": ["onionMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 138, 171, 1.0)", "secondaryAlbedo": "rgba(122, 59, 110, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_onionRingB_4.userData.actionProfile = {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "onion", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["onion"] ?? root).add(node_onionRingB_4);
  nodes["onionRingB"] = node_onionRingB_4;
  const mesh_onionRingB_4Geometry = endpoint_onionRingB_4
    ? new THREE.CylinderGeometry(endpoint_onionRingB_4.endRadius, endpoint_onionRingB_4.baseRadius, endpoint_onionRingB_4.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.0363, 12, 48);
  if (!endpoint_onionRingB_4) {
    mesh_onionRingB_4Geometry.scale(1.7, 1.7, 0.85);
  }
  const mesh_onionRingB_4 = new THREE.Mesh(
    mesh_onionRingB_4Geometry,
    materialMap["onionMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_onionRingB_4.name = "Onion ring B";
  if (endpoint_onionRingB_4) {
    mesh_onionRingB_4.position.copy(endpoint_onionRingB_4.midpoint);
    mesh_onionRingB_4.quaternion.copy(endpoint_onionRingB_4.quaternion);
  }
  mesh_onionRingB_4.castShadow = options.castShadow ?? true;
  mesh_onionRingB_4.receiveShadow = options.receiveShadow ?? true;
  mesh_onionRingB_4.userData.sculptComponent = {"id": "onionRingB", "name": "Onion ring B", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "smaller offset ring under the main one", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.0806}, "parent": "onion", "attachment": null, "dimensions": {"width": 1.7, "height": 1.7, "depth": 0.85, "units": "world", "confidence": 0.85}, "transform": {"position": [0.14, -0.1, -0.025], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "onion", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "onionMat", "materialLayers": ["onionMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 138, 171, 1.0)", "secondaryAlbedo": "rgba(122, 59, 110, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_onionRingB_4.add(mesh_onionRingB_4);
  meshes["onionRingB"] = mesh_onionRingB_4;
  colliders["onionRingB"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["onion"] ??= [];
  destructionGroups["onion"].push(node_onionRingB_4);

  const attachment_onionRingC_5 = null;
  const endpoint_onionRingC_5 = makeAttachmentEndpoint(attachment_onionRingC_5);
  const node_onionRingC_5 = new THREE.Group();
  node_onionRingC_5.name = "Onion ring C__pivot";
  node_onionRingC_5.scale.set(1, 1, 1);
  if (endpoint_onionRingC_5) {
    node_onionRingC_5.position.copy(endpoint_onionRingC_5.start);
    node_onionRingC_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_onionRingC_5.position.set(-0.16, 0.12, -0.045);
    node_onionRingC_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_onionRingC_5.userData.sculptComponent = {"id": "onionRingC", "name": "Onion ring C", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "innermost offset ring", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.111}, "parent": "onion", "attachment": null, "dimensions": {"width": 1.3, "height": 1.3, "depth": 0.85, "units": "world", "confidence": 0.85}, "transform": {"position": [-0.16, 0.12, -0.045], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "onion", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "onionMat", "materialLayers": ["onionMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 138, 171, 1.0)", "secondaryAlbedo": "rgba(122, 59, 110, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_onionRingC_5.userData.actionProfile = {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "onion", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["onion"] ?? root).add(node_onionRingC_5);
  nodes["onionRingC"] = node_onionRingC_5;
  const mesh_onionRingC_5Geometry = endpoint_onionRingC_5
    ? new THREE.CylinderGeometry(endpoint_onionRingC_5.endRadius, endpoint_onionRingC_5.baseRadius, endpoint_onionRingC_5.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.05, 12, 48);
  if (!endpoint_onionRingC_5) {
    mesh_onionRingC_5Geometry.scale(1.3, 1.3, 0.85);
  }
  const mesh_onionRingC_5 = new THREE.Mesh(
    mesh_onionRingC_5Geometry,
    materialMap["onionMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_onionRingC_5.name = "Onion ring C";
  if (endpoint_onionRingC_5) {
    mesh_onionRingC_5.position.copy(endpoint_onionRingC_5.midpoint);
    mesh_onionRingC_5.quaternion.copy(endpoint_onionRingC_5.quaternion);
  }
  mesh_onionRingC_5.castShadow = options.castShadow ?? true;
  mesh_onionRingC_5.receiveShadow = options.receiveShadow ?? true;
  mesh_onionRingC_5.userData.sculptComponent = {"id": "onionRingC", "name": "Onion ring C", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "innermost offset ring", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.111}, "parent": "onion", "attachment": null, "dimensions": {"width": 1.3, "height": 1.3, "depth": 0.85, "units": "world", "confidence": 0.85}, "transform": {"position": [-0.16, 0.12, -0.045], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "onion", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "onionMat", "materialLayers": ["onionMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(196, 138, 171, 1.0)", "secondaryAlbedo": "rgba(122, 59, 110, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_onionRingC_5.add(mesh_onionRingC_5);
  meshes["onionRingC"] = mesh_onionRingC_5;
  colliders["onionRingC"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["onion"] ??= [];
  destructionGroups["onion"].push(node_onionRingC_5);

  const attachment_pickles_6 = null;
  const endpoint_pickles_6 = makeAttachmentEndpoint(attachment_pickles_6);
  const node_pickles_6 = new THREE.Group();
  node_pickles_6.name = "Crinkle-cut pickles__pivot";
  node_pickles_6.scale.set(1, 1, 1);
  if (endpoint_pickles_6) {
    node_pickles_6.position.copy(endpoint_pickles_6.start);
    node_pickles_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pickles_6.position.set(0.0, 0.93, 0.0);
    node_pickles_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_pickles_6.userData.sculptComponent = {"id": "pickles", "name": "Crinkle-cut pickles", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "center disc + radial InstancedMesh ring of 5 = one named part of anonymous discs", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 0.2, "depth": 1.0, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0.93, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pickles", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "pickleMat", "materialLayers": ["pickleMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pickles.crinkleEdge", "kind": "geometry-feature", "description": "crinkle-cut ridged edge; ring of 5 sibling discs via pickleRing repetition system", "evidenceRef": "zone-r1c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 139, 58, 1.0)", "secondaryAlbedo": "rgba(157, 176, 76, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_pickles_6.userData.actionProfile = {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pickles", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["root"] ?? root).add(node_pickles_6);
  nodes["pickles"] = node_pickles_6;
  const mesh_pickles_6Geometry = endpoint_pickles_6
    ? new THREE.CylinderGeometry(endpoint_pickles_6.endRadius, endpoint_pickles_6.baseRadius, endpoint_pickles_6.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_pickles_6) {
    mesh_pickles_6Geometry.scale(1.0, 0.2, 1.0);
  }
  const mesh_pickles_6 = new THREE.Mesh(
    mesh_pickles_6Geometry,
    materialMap["pickleMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pickles_6.name = "Crinkle-cut pickles";
  if (endpoint_pickles_6) {
    mesh_pickles_6.position.copy(endpoint_pickles_6.midpoint);
    mesh_pickles_6.quaternion.copy(endpoint_pickles_6.quaternion);
  }
  mesh_pickles_6.castShadow = options.castShadow ?? true;
  mesh_pickles_6.receiveShadow = options.receiveShadow ?? true;
  mesh_pickles_6.userData.sculptComponent = {"id": "pickles", "name": "Crinkle-cut pickles", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "center disc + radial InstancedMesh ring of 5 = one named part of anonymous discs", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 0.2, "depth": 1.0, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0.93, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "pickles", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "pickleMat", "materialLayers": ["pickleMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pickles.crinkleEdge", "kind": "geometry-feature", "description": "crinkle-cut ridged edge; ring of 5 sibling discs via pickleRing repetition system", "evidenceRef": "zone-r1c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 139, 58, 1.0)", "secondaryAlbedo": "rgba(157, 176, 76, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_pickles_6.add(mesh_pickles_6);
  meshes["pickles"] = mesh_pickles_6;
  colliders["pickles"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["pickles"] ??= [];
  destructionGroups["pickles"].push(node_pickles_6);

  const attachment_patty_7 = null;
  const endpoint_patty_7 = makeAttachmentEndpoint(attachment_patty_7);
  const node_patty_7 = new THREE.Group();
  node_patty_7.name = "Seared beef patty__pivot";
  node_patty_7.scale.set(1, 1, 1);
  if (endpoint_patty_7) {
    node_patty_7.position.copy(endpoint_patty_7.start);
    node_patty_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_patty_7.position.set(0.0, 1.26, 0.0);
    node_patty_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_patty_7.userData.sculptComponent = {"id": "patty", "name": "Seared beef patty", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "thick cylinder; crust relief from displacement (silhouette-affecting)", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 2.44, "height": 0.52, "depth": 2.44, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 1.26, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "patty", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "pattyMat", "materialLayers": ["pattyMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "patty.searedCrust", "kind": "relief", "description": "granular displaced crust, charred rim spots", "evidenceRef": "zone-r1c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "displacement 0.06 breaks the mechanical cylinder edge"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "denseMesh": true, "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 47, 30, 1.0)", "secondaryAlbedo": "rgba(42, 26, 16, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_patty_7.userData.actionProfile = {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "patty", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["root"] ?? root).add(node_patty_7);
  nodes["patty"] = node_patty_7;
  const mesh_patty_7Geometry = endpoint_patty_7
    ? new THREE.CylinderGeometry(endpoint_patty_7.endRadius, endpoint_patty_7.baseRadius, endpoint_patty_7.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_patty_7) {
    mesh_patty_7Geometry.scale(2.44, 0.52, 2.44);
  }
  const mesh_patty_7 = new THREE.Mesh(
    mesh_patty_7Geometry,
    createSculptMaterial("pattyMat", {"id": "pattyMat", "name": "Seared beef patty", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#4a2f1e", "color": "#4a2f1e", "albedo": {"dominant": "#7B4C30", "secondary": ["#512C15", "#1E0C05", "#E4AF44"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "public/model/pattymat_albedo.png", "url": "/model/pattymat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#7B4C30", "#512C15", "#1E0C05", "#E4AF44", "#A77346"], "pattern": "reference-derived pixel palette", "amplitude": 0.295, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.52, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.734, "variation": 0.122, "map": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pattyMat\\pattymat_roughness.png", "url": "pattymat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.23, "map": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pattyMat\\pattymat_normal.png", "url": "pattymat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pattyMat\\pattymat_height.png", "url": "pattymat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.028, "map": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pattyMat\\pattymat_height.png", "url": "pattymat_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "granular-crust", "amplitude": 0.06, "scale": 14.0, "silhouetteAffects": true}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\pattyMat\\pattymat_ao.png", "url": "pattymat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "patty-char-crust", "description": "char low-value spots ~20% coverage concentrated on rim", "evidenceRef": "detail-scan/zone-r1c1.png"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "grease sheen via low clearcoat; relief must survive grazing light", "clearcoat": {"base": 0.15}, "clearcoatRoughness": {"base": 0.5}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\pattyMat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "public/model/pattymat_albedo.png", "url": "/model/pattymat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "public/model/pattymat_roughness.png", "url": "/model/pattymat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "public/model/pattymat_height.png", "url": "/model/pattymat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "public/model/pattymat_normal.png", "url": "/model/pattymat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "public/model/pattymat_ao.png", "url": "/model/pattymat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 850, "sourceHeight": 170, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 850, "height": 170}, "mask": {"backgroundColor": "#8D732F", "backgroundNoise": 144.423, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9862}, "mapStats": {"valueRange": 0.7034, "heightP90Gradient": 0.06309, "roughnessBase": 0.734, "roughnessVariation": 0.122, "normalStrength": 0.23, "blurRadius": 21}, "palette": ["#7B4C30", "#512C15", "#1E0C05", "#E4AF44", "#A77346"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "web ship: all 5 channels at 512px under public/model/"}}, options, true)
  );
  mesh_patty_7.name = "Seared beef patty";
  if (endpoint_patty_7) {
    mesh_patty_7.position.copy(endpoint_patty_7.midpoint);
    mesh_patty_7.quaternion.copy(endpoint_patty_7.quaternion);
  }
  mesh_patty_7.castShadow = options.castShadow ?? true;
  mesh_patty_7.receiveShadow = options.receiveShadow ?? true;
  mesh_patty_7.userData.sculptComponent = {"id": "patty", "name": "Seared beef patty", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "thick cylinder; crust relief from displacement (silhouette-affecting)", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 2.44, "height": 0.52, "depth": 2.44, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 1.26, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "patty", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "pattyMat", "materialLayers": ["pattyMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "patty.searedCrust", "kind": "relief", "description": "granular displaced crust, charred rim spots", "evidenceRef": "zone-r1c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "displacement 0.06 breaks the mechanical cylinder edge"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "denseMesh": true, "colorMaterialRecipe": {"dominantAlbedo": "rgba(74, 47, 30, 1.0)", "secondaryAlbedo": "rgba(42, 26, 16, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_patty_7.add(mesh_patty_7);
  meshes["patty"] = mesh_patty_7;
  colliders["patty"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["patty"] ??= [];
  destructionGroups["patty"].push(node_patty_7);

  const attachment_cheese_8 = null;
  const endpoint_cheese_8 = makeAttachmentEndpoint(attachment_cheese_8);
  const node_cheese_8 = new THREE.Group();
  node_cheese_8.name = "Melted cheddar slab__pivot";
  node_cheese_8.scale.set(1, 1, 1);
  if (endpoint_cheese_8) {
    node_cheese_8.position.copy(endpoint_cheese_8.start);
    node_cheese_8.rotation.set(1.570796, 0.0, 0.0);
  } else {
    node_cheese_8.position.set(0.0, 1.54, 0.0);
    node_cheese_8.rotation.set(1.570796, 0.0, 0.0);
  }
  node_cheese_8.userData.sculptComponent = {"id": "cheese", "name": "Melted cheddar slab", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "melted rounded mass: superellipse blob profile (corners already molten), drape curl in code", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[1.3756, 0.0], [1.3636, 0.3112], [1.2491, 0.6015], [1.062, 0.847], [0.843, 1.0571], [0.5946, 1.2346], [0.3069, 1.3446], [0.0, 1.3604], [-0.2992, 1.3111], [-0.5946, 1.2346], [-0.8982, 1.1263], [-1.1589, 0.9242], [-1.2852, 0.6189], [-1.2749, 0.291], [-1.2244, 0.0], [-1.2262, -0.2799], [-1.2607, -0.6071], [-1.2057, -0.9615], [-0.9654, -1.2106], [-0.6141, -1.2752], [-0.2842, -1.2452], [-0.0, -1.2396], [0.2919, -1.2787], [0.6141, -1.2752], [0.9102, -1.1414], [1.1088, -0.8842], [1.2247, -0.5898], [1.3149, -0.3001]], "depth": 0.13}}, "parent": null, "attachment": null, "dimensions": {"width": 2.6, "height": 0.13, "depth": 2.6, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 1.54, 0], "rotation": [1.570796, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cheese.dripLobes", "kind": "geometry-feature", "description": "4 viscous lobes drape over patty edge (child components)", "evidenceRef": "zone-r1c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "satin melt; single transmissive material"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6", "colorGradient": {"type": "radial", "stops": [{"offset": 0.0, "color": "rgba(247, 185, 58, 1.0)"}, {"offset": 1.0, "color": "rgba(224, 148, 15, 1.0)"}]}}};
  node_cheese_8.userData.actionProfile = {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["root"] ?? root).add(node_cheese_8);
  nodes["cheese"] = node_cheese_8;
  const mesh_cheese_8Geometry = endpoint_cheese_8
    ? new THREE.CylinderGeometry(endpoint_cheese_8.endRadius, endpoint_cheese_8.baseRadius, endpoint_cheese_8.length, 16, 6)
    : buildExtrudeGeometry({"points": [[1.3756, 0.0], [1.3636, 0.3112], [1.2491, 0.6015], [1.062, 0.847], [0.843, 1.0571], [0.5946, 1.2346], [0.3069, 1.3446], [0.0, 1.3604], [-0.2992, 1.3111], [-0.5946, 1.2346], [-0.8982, 1.1263], [-1.1589, 0.9242], [-1.2852, 0.6189], [-1.2749, 0.291], [-1.2244, 0.0], [-1.2262, -0.2799], [-1.2607, -0.6071], [-1.2057, -0.9615], [-0.9654, -1.2106], [-0.6141, -1.2752], [-0.2842, -1.2452], [-0.0, -1.2396], [0.2919, -1.2787], [0.6141, -1.2752], [0.9102, -1.1414], [1.1088, -0.8842], [1.2247, -0.5898], [1.3149, -0.3001]], "depth": 0.13});
  if (!endpoint_cheese_8) {
    mesh_cheese_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cheese_8 = new THREE.Mesh(
    mesh_cheese_8Geometry,
    materialMap["cheeseMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cheese_8.name = "Melted cheddar slab";
  if (endpoint_cheese_8) {
    mesh_cheese_8.position.copy(endpoint_cheese_8.midpoint);
    mesh_cheese_8.quaternion.copy(endpoint_cheese_8.quaternion);
  }
  mesh_cheese_8.castShadow = options.castShadow ?? true;
  mesh_cheese_8.receiveShadow = options.receiveShadow ?? true;
  mesh_cheese_8.userData.sculptComponent = {"id": "cheese", "name": "Melted cheddar slab", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "melted rounded mass: superellipse blob profile (corners already molten), drape curl in code", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[1.3756, 0.0], [1.3636, 0.3112], [1.2491, 0.6015], [1.062, 0.847], [0.843, 1.0571], [0.5946, 1.2346], [0.3069, 1.3446], [0.0, 1.3604], [-0.2992, 1.3111], [-0.5946, 1.2346], [-0.8982, 1.1263], [-1.1589, 0.9242], [-1.2852, 0.6189], [-1.2749, 0.291], [-1.2244, 0.0], [-1.2262, -0.2799], [-1.2607, -0.6071], [-1.2057, -0.9615], [-0.9654, -1.2106], [-0.6141, -1.2752], [-0.2842, -1.2452], [-0.0, -1.2396], [0.2919, -1.2787], [0.6141, -1.2752], [0.9102, -1.1414], [1.1088, -0.8842], [1.2247, -0.5898], [1.3149, -0.3001]], "depth": 0.13}}, "parent": null, "attachment": null, "dimensions": {"width": 2.6, "height": 0.13, "depth": 2.6, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 1.54, 0], "rotation": [1.570796, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cheese.dripLobes", "kind": "geometry-feature", "description": "4 viscous lobes drape over patty edge (child components)", "evidenceRef": "zone-r1c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "satin melt; single transmissive material"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6", "colorGradient": {"type": "radial", "stops": [{"offset": 0.0, "color": "rgba(247, 185, 58, 1.0)"}, {"offset": 1.0, "color": "rgba(224, 148, 15, 1.0)"}]}}};
  node_cheese_8.add(mesh_cheese_8);
  meshes["cheese"] = mesh_cheese_8;
  colliders["cheese"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["cheese"] ??= [];
  destructionGroups["cheese"].push(node_cheese_8);

  const attachment_cheeseLobeF_9 = {"parentSocket": "cheese.frontEdge", "localStart": [0.0, 1.153, 0.03], "localEnd": [0.0, 1.292, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13};
  const endpoint_cheeseLobeF_9 = makeAttachmentEndpoint(attachment_cheeseLobeF_9);
  const node_cheeseLobeF_9 = new THREE.Group();
  node_cheeseLobeF_9.name = "Cheese drip lobe front__pivot";
  node_cheeseLobeF_9.scale.set(1, 1, 1);
  if (endpoint_cheeseLobeF_9) {
    node_cheeseLobeF_9.position.copy(endpoint_cheeseLobeF_9.start);
    node_cheeseLobeF_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cheeseLobeF_9.position.set(0.0, 0.0, 0.0);
    node_cheeseLobeF_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_cheeseLobeF_9.userData.sculptComponent = {"id": "cheeseLobeF", "name": "Cheese drip lobe front", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "tapered hanging drip; +Z in cheese-local = world down", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cheese", "attachment": {"parentSocket": "cheese.frontEdge", "localStart": [0.0, 1.153, 0.03], "localEnd": [0.0, 1.292, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13}, "dimensions": {"width": 0.3, "height": 0.34, "depth": 0.3, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_cheeseLobeF_9.userData.actionProfile = {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["cheese"] ?? root).add(node_cheeseLobeF_9);
  nodes["cheeseLobeF"] = node_cheeseLobeF_9;
  const mesh_cheeseLobeF_9Geometry = endpoint_cheeseLobeF_9
    ? new THREE.CylinderGeometry(endpoint_cheeseLobeF_9.endRadius, endpoint_cheeseLobeF_9.baseRadius, endpoint_cheeseLobeF_9.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_cheeseLobeF_9) {
    mesh_cheeseLobeF_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cheeseLobeF_9 = new THREE.Mesh(
    mesh_cheeseLobeF_9Geometry,
    materialMap["cheeseMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cheeseLobeF_9.name = "Cheese drip lobe front";
  if (endpoint_cheeseLobeF_9) {
    mesh_cheeseLobeF_9.position.copy(endpoint_cheeseLobeF_9.midpoint);
    mesh_cheeseLobeF_9.quaternion.copy(endpoint_cheeseLobeF_9.quaternion);
  }
  mesh_cheeseLobeF_9.castShadow = options.castShadow ?? true;
  mesh_cheeseLobeF_9.receiveShadow = options.receiveShadow ?? true;
  mesh_cheeseLobeF_9.userData.sculptComponent = {"id": "cheeseLobeF", "name": "Cheese drip lobe front", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "tapered hanging drip; +Z in cheese-local = world down", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cheese", "attachment": {"parentSocket": "cheese.frontEdge", "localStart": [0.0, 1.153, 0.03], "localEnd": [0.0, 1.292, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13}, "dimensions": {"width": 0.3, "height": 0.34, "depth": 0.3, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_cheeseLobeF_9.add(mesh_cheeseLobeF_9);
  meshes["cheeseLobeF"] = mesh_cheeseLobeF_9;
  colliders["cheeseLobeF"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["cheese"] ??= [];
  destructionGroups["cheese"].push(node_cheeseLobeF_9);

  const attachment_cheeseLobeFL_10 = {"parentSocket": "cheese.frontLeftEdge", "localStart": [-0.856, 0.883, 0.03], "localEnd": [-0.969, 0.997, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13};
  const endpoint_cheeseLobeFL_10 = makeAttachmentEndpoint(attachment_cheeseLobeFL_10);
  const node_cheeseLobeFL_10 = new THREE.Group();
  node_cheeseLobeFL_10.name = "Cheese drip lobe front-left__pivot";
  node_cheeseLobeFL_10.scale.set(1, 1, 1);
  if (endpoint_cheeseLobeFL_10) {
    node_cheeseLobeFL_10.position.copy(endpoint_cheeseLobeFL_10.start);
    node_cheeseLobeFL_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cheeseLobeFL_10.position.set(0.0, 0.0, 0.0);
    node_cheeseLobeFL_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_cheeseLobeFL_10.userData.sculptComponent = {"id": "cheeseLobeFL", "name": "Cheese drip lobe front-left", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "continuous organic stratum of the burger stack", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cheese", "attachment": {"parentSocket": "cheese.frontLeftEdge", "localStart": [-0.856, 0.883, 0.03], "localEnd": [-0.969, 0.997, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13}, "dimensions": {"width": 0.26, "height": 0.3, "depth": 0.26, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_cheeseLobeFL_10.userData.actionProfile = {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["cheese"] ?? root).add(node_cheeseLobeFL_10);
  nodes["cheeseLobeFL"] = node_cheeseLobeFL_10;
  const mesh_cheeseLobeFL_10Geometry = endpoint_cheeseLobeFL_10
    ? new THREE.CylinderGeometry(endpoint_cheeseLobeFL_10.endRadius, endpoint_cheeseLobeFL_10.baseRadius, endpoint_cheeseLobeFL_10.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_cheeseLobeFL_10) {
    mesh_cheeseLobeFL_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cheeseLobeFL_10 = new THREE.Mesh(
    mesh_cheeseLobeFL_10Geometry,
    materialMap["cheeseMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cheeseLobeFL_10.name = "Cheese drip lobe front-left";
  if (endpoint_cheeseLobeFL_10) {
    mesh_cheeseLobeFL_10.position.copy(endpoint_cheeseLobeFL_10.midpoint);
    mesh_cheeseLobeFL_10.quaternion.copy(endpoint_cheeseLobeFL_10.quaternion);
  }
  mesh_cheeseLobeFL_10.castShadow = options.castShadow ?? true;
  mesh_cheeseLobeFL_10.receiveShadow = options.receiveShadow ?? true;
  mesh_cheeseLobeFL_10.userData.sculptComponent = {"id": "cheeseLobeFL", "name": "Cheese drip lobe front-left", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "continuous organic stratum of the burger stack", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cheese", "attachment": {"parentSocket": "cheese.frontLeftEdge", "localStart": [-0.856, 0.883, 0.03], "localEnd": [-0.969, 0.997, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13}, "dimensions": {"width": 0.26, "height": 0.3, "depth": 0.26, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_cheeseLobeFL_10.add(mesh_cheeseLobeFL_10);
  meshes["cheeseLobeFL"] = mesh_cheeseLobeFL_10;
  colliders["cheeseLobeFL"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["cheese"] ??= [];
  destructionGroups["cheese"].push(node_cheeseLobeFL_10);

  const attachment_cheeseLobeFR_11 = {"parentSocket": "cheese.frontRightEdge", "localStart": [0.818, 0.93, 0.03], "localEnd": [0.931, 1.045, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13};
  const endpoint_cheeseLobeFR_11 = makeAttachmentEndpoint(attachment_cheeseLobeFR_11);
  const node_cheeseLobeFR_11 = new THREE.Group();
  node_cheeseLobeFR_11.name = "Cheese drip lobe front-right__pivot";
  node_cheeseLobeFR_11.scale.set(1, 1, 1);
  if (endpoint_cheeseLobeFR_11) {
    node_cheeseLobeFR_11.position.copy(endpoint_cheeseLobeFR_11.start);
    node_cheeseLobeFR_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cheeseLobeFR_11.position.set(0.0, 0.0, 0.0);
    node_cheeseLobeFR_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_cheeseLobeFR_11.userData.sculptComponent = {"id": "cheeseLobeFR", "name": "Cheese drip lobe front-right", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "continuous organic stratum of the burger stack", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cheese", "attachment": {"parentSocket": "cheese.frontRightEdge", "localStart": [0.818, 0.93, 0.03], "localEnd": [0.931, 1.045, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13}, "dimensions": {"width": 0.28, "height": 0.32, "depth": 0.28, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_cheeseLobeFR_11.userData.actionProfile = {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["cheese"] ?? root).add(node_cheeseLobeFR_11);
  nodes["cheeseLobeFR"] = node_cheeseLobeFR_11;
  const mesh_cheeseLobeFR_11Geometry = endpoint_cheeseLobeFR_11
    ? new THREE.CylinderGeometry(endpoint_cheeseLobeFR_11.endRadius, endpoint_cheeseLobeFR_11.baseRadius, endpoint_cheeseLobeFR_11.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_cheeseLobeFR_11) {
    mesh_cheeseLobeFR_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cheeseLobeFR_11 = new THREE.Mesh(
    mesh_cheeseLobeFR_11Geometry,
    materialMap["cheeseMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cheeseLobeFR_11.name = "Cheese drip lobe front-right";
  if (endpoint_cheeseLobeFR_11) {
    mesh_cheeseLobeFR_11.position.copy(endpoint_cheeseLobeFR_11.midpoint);
    mesh_cheeseLobeFR_11.quaternion.copy(endpoint_cheeseLobeFR_11.quaternion);
  }
  mesh_cheeseLobeFR_11.castShadow = options.castShadow ?? true;
  mesh_cheeseLobeFR_11.receiveShadow = options.receiveShadow ?? true;
  mesh_cheeseLobeFR_11.userData.sculptComponent = {"id": "cheeseLobeFR", "name": "Cheese drip lobe front-right", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "continuous organic stratum of the burger stack", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cheese", "attachment": {"parentSocket": "cheese.frontRightEdge", "localStart": [0.818, 0.93, 0.03], "localEnd": [0.931, 1.045, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13}, "dimensions": {"width": 0.28, "height": 0.32, "depth": 0.28, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_cheeseLobeFR_11.add(mesh_cheeseLobeFR_11);
  meshes["cheeseLobeFR"] = mesh_cheeseLobeFR_11;
  colliders["cheeseLobeFR"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["cheese"] ??= [];
  destructionGroups["cheese"].push(node_cheeseLobeFR_11);

  const attachment_cheeseLobeR_12 = {"parentSocket": "cheese.rightEdge", "localStart": [1.19, -0.186, 0.03], "localEnd": [1.311, -0.228, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13};
  const endpoint_cheeseLobeR_12 = makeAttachmentEndpoint(attachment_cheeseLobeR_12);
  const node_cheeseLobeR_12 = new THREE.Group();
  node_cheeseLobeR_12.name = "Cheese drip lobe right__pivot";
  node_cheeseLobeR_12.scale.set(1, 1, 1);
  if (endpoint_cheeseLobeR_12) {
    node_cheeseLobeR_12.position.copy(endpoint_cheeseLobeR_12.start);
    node_cheeseLobeR_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cheeseLobeR_12.position.set(0.0, 0.0, 0.0);
    node_cheeseLobeR_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_cheeseLobeR_12.userData.sculptComponent = {"id": "cheeseLobeR", "name": "Cheese drip lobe right", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "continuous organic stratum of the burger stack", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cheese", "attachment": {"parentSocket": "cheese.rightEdge", "localStart": [1.19, -0.186, 0.03], "localEnd": [1.311, -0.228, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13}, "dimensions": {"width": 0.24, "height": 0.26, "depth": 0.24, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_cheeseLobeR_12.userData.actionProfile = {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["cheese"] ?? root).add(node_cheeseLobeR_12);
  nodes["cheeseLobeR"] = node_cheeseLobeR_12;
  const mesh_cheeseLobeR_12Geometry = endpoint_cheeseLobeR_12
    ? new THREE.CylinderGeometry(endpoint_cheeseLobeR_12.endRadius, endpoint_cheeseLobeR_12.baseRadius, endpoint_cheeseLobeR_12.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_cheeseLobeR_12) {
    mesh_cheeseLobeR_12Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cheeseLobeR_12 = new THREE.Mesh(
    mesh_cheeseLobeR_12Geometry,
    materialMap["cheeseMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cheeseLobeR_12.name = "Cheese drip lobe right";
  if (endpoint_cheeseLobeR_12) {
    mesh_cheeseLobeR_12.position.copy(endpoint_cheeseLobeR_12.midpoint);
    mesh_cheeseLobeR_12.quaternion.copy(endpoint_cheeseLobeR_12.quaternion);
  }
  mesh_cheeseLobeR_12.castShadow = options.castShadow ?? true;
  mesh_cheeseLobeR_12.receiveShadow = options.receiveShadow ?? true;
  mesh_cheeseLobeR_12.userData.sculptComponent = {"id": "cheeseLobeR", "name": "Cheese drip lobe right", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "continuous organic stratum of the burger stack", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cheese", "attachment": {"parentSocket": "cheese.rightEdge", "localStart": [1.19, -0.186, 0.03], "localEnd": [1.311, -0.228, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13}, "dimensions": {"width": 0.24, "height": 0.26, "depth": 0.24, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_cheeseLobeR_12.add(mesh_cheeseLobeR_12);
  meshes["cheeseLobeR"] = mesh_cheeseLobeR_12;
  colliders["cheeseLobeR"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["cheese"] ??= [];
  destructionGroups["cheese"].push(node_cheeseLobeR_12);

  const attachment_topBun_13 = null;
  const endpoint_topBun_13 = makeAttachmentEndpoint(attachment_topBun_13);
  const node_topBun_13 = new THREE.Group();
  node_topBun_13.name = "Sesame dome bun__pivot";
  node_topBun_13.scale.set(1, 1, 1);
  if (endpoint_topBun_13) {
    node_topBun_13.position.copy(endpoint_topBun_13.start);
    node_topBun_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_topBun_13.position.set(0.0, 1.56, 0.0);
    node_topBun_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_topBun_13.userData.sculptComponent = {"id": "topBun", "name": "Sesame dome bun", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "oblate dome lathe with slight skirt overhang", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.001, 0.0], [0.95, 0.0], [1.18, 0.0298], [1.3, 0.1194], [1.32, 0.2687], [1.24, 0.4778], [1.02, 0.6569], [0.72, 0.7962], [0.38, 0.8759], [0.001, 0.8958]], "segments": 96}}, "parent": null, "attachment": null, "dimensions": {"width": 2.64, "height": 0.9, "depth": 2.64, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 1.56, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "bunCrust", "materialLayers": ["bunCrust"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "topBun.sesameField", "kind": "surface-repetition", "description": "~150 seeds over dome; spec-level radial ring approximation, full dome scatter (3 tones, dough depressions) in code refine", "evidenceRef": "zone-r0c1"}, {"id": "topBun.glazeGradient", "kind": "material-zone", "description": "amber apex -> deep skirt gradient", "evidenceRef": "zone-r0c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "glaze clearcoat + sheen; crumb pores"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "denseMesh": true, "colorMaterialRecipe": {"dominantAlbedo": "rgba(181, 101, 29, 1.0)", "secondaryAlbedo": "rgba(139, 74, 22, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6", "colorGradient": {"type": "linear", "stops": [{"offset": 0.0, "color": "rgba(216, 134, 60, 1.0)"}, {"offset": 1.0, "color": "rgba(139, 74, 22, 1.0)"}]}}};
  node_topBun_13.userData.actionProfile = {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["root"] ?? root).add(node_topBun_13);
  nodes["topBun"] = node_topBun_13;
  const mesh_topBun_13Geometry = endpoint_topBun_13
    ? new THREE.CylinderGeometry(endpoint_topBun_13.endRadius, endpoint_topBun_13.baseRadius, endpoint_topBun_13.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, 0.0], [0.95, 0.0], [1.18, 0.0298], [1.3, 0.1194], [1.32, 0.2687], [1.24, 0.4778], [1.02, 0.6569], [0.72, 0.7962], [0.38, 0.8759], [0.001, 0.8958]], "segments": 96});
  if (!endpoint_topBun_13) {
    mesh_topBun_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_topBun_13 = new THREE.Mesh(
    mesh_topBun_13Geometry,
    createSculptMaterial("bunCrust", {"id": "bunCrust", "name": "Top bun glazed crust", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#b5651d", "color": "#b5651d", "albedo": {"dominant": "#a85618", "secondary": ["#a85618", "#e09a4d"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#a85618", "#8f4713", "#c8752a", "#96470f", "#b5651d"], "pattern": "reference-derived pixel palette", "amplitude": 0.14, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.499, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.34, "variation": 0.16, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.25, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.052}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "dome-glaze-gradient", "description": "albedo amber apex -> deep brown skirt; roughness 0.32 apex -> 0.45 skirt", "evidenceRef": "detail-scan/zone-r0c1.png"}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "glazed brioche dome; broad softbox specular in reference is lighting, not albedo", "clearcoat": {"base": 0.22}, "clearcoatRoughness": {"base": 0.3}, "sheen": {"base": 0.2}, "sheenColor": "#e7a765", "sheenRoughness": {"base": 0.6}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\bunCrust.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunCrust\\buncrust_albedo.png", "url": "buncrust_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunCrust\\buncrust_roughness.png", "url": "buncrust_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunCrust\\buncrust_height.png", "url": "buncrust_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunCrust\\buncrust_normal.png", "url": "buncrust_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\bunCrust\\buncrust_ao.png", "url": "buncrust_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 701, "sourceHeight": 260, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 701, "height": 260}, "mask": {"backgroundColor": "#EFC59D", "backgroundNoise": 158.931, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9938}, "mapStats": {"valueRange": 0.6243, "heightP90Gradient": 0.11542, "roughnessBase": 0.756, "roughnessVariation": 0.18, "normalStrength": 0.292, "blurRadius": 21}, "palette": ["#BA560C", "#FACEA7", "#B86A38", "#89360B", "#E6A36D"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural-palette route: the single-view crop cross-contaminates channels (painted seeds / neighbouring-layer pixels), so the maps are evidence only; factory falls back to colorVariation procedural textures"}}, options, true)
  );
  mesh_topBun_13.name = "Sesame dome bun";
  if (endpoint_topBun_13) {
    mesh_topBun_13.position.copy(endpoint_topBun_13.midpoint);
    mesh_topBun_13.quaternion.copy(endpoint_topBun_13.quaternion);
  }
  mesh_topBun_13.castShadow = options.castShadow ?? true;
  mesh_topBun_13.receiveShadow = options.receiveShadow ?? true;
  mesh_topBun_13.userData.sculptComponent = {"id": "topBun", "name": "Sesame dome bun", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "oblate dome lathe with slight skirt overhang", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.001, 0.0], [0.95, 0.0], [1.18, 0.0298], [1.3, 0.1194], [1.32, 0.2687], [1.24, 0.4778], [1.02, 0.6569], [0.72, 0.7962], [0.38, 0.8759], [0.001, 0.8958]], "segments": 96}}, "parent": null, "attachment": null, "dimensions": {"width": 2.64, "height": 0.9, "depth": 2.64, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 1.56, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "bunCrust", "materialLayers": ["bunCrust"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "topBun.sesameField", "kind": "surface-repetition", "description": "~150 seeds over dome; spec-level radial ring approximation, full dome scatter (3 tones, dough depressions) in code refine", "evidenceRef": "zone-r0c1"}, {"id": "topBun.glazeGradient", "kind": "material-zone", "description": "amber apex -> deep skirt gradient", "evidenceRef": "zone-r0c1"}], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "glaze clearcoat + sheen; crumb pores"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "denseMesh": true, "colorMaterialRecipe": {"dominantAlbedo": "rgba(181, 101, 29, 1.0)", "secondaryAlbedo": "rgba(139, 74, 22, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6", "colorGradient": {"type": "linear", "stops": [{"offset": 0.0, "color": "rgba(216, 134, 60, 1.0)"}, {"offset": 1.0, "color": "rgba(139, 74, 22, 1.0)"}]}}};
  node_topBun_13.add(mesh_topBun_13);
  meshes["topBun"] = mesh_topBun_13;
  colliders["topBun"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["topBun"] ??= [];
  destructionGroups["topBun"].push(node_topBun_13);

  const attachment_skewer_14 = {"parentSocket": "topBun.apex", "localStart": [0, 0.3, 0], "localEnd": [0, 1.56, 0], "contactType": "embed", "embedDepth": 0.6, "gapTolerance": 0.005, "baseRadius": 0.022, "endRadius": 0.017};
  const endpoint_skewer_14 = makeAttachmentEndpoint(attachment_skewer_14);
  const node_skewer_14 = new THREE.Group();
  node_skewer_14.name = "Bamboo skewer__pivot";
  node_skewer_14.scale.set(1, 1, 1);
  if (endpoint_skewer_14) {
    node_skewer_14.position.copy(endpoint_skewer_14.start);
    node_skewer_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_skewer_14.position.set(0.0, 0.0, 0.0);
    node_skewer_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_skewer_14.userData.sculptComponent = {"id": "skewer", "name": "Bamboo skewer", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "embedded through dome apex; rides with topBun on explode (explodeWithParent)", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "topBun", "attachment": {"parentSocket": "topBun.apex", "localStart": [0, 0.3, 0], "localEnd": [0, 1.56, 0], "contactType": "embed", "embedDepth": 0.6, "gapTolerance": 0.005, "baseRadius": 0.022, "endRadius": 0.017}, "dimensions": {"width": 0.045, "height": 1.8, "depth": 0.045, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "skewerMat", "materialLayers": ["skewerMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 168, 106, 1.0)", "secondaryAlbedo": "rgba(168, 135, 76, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_skewer_14.userData.actionProfile = {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["topBun"] ?? root).add(node_skewer_14);
  nodes["skewer"] = node_skewer_14;
  const mesh_skewer_14Geometry = endpoint_skewer_14
    ? new THREE.CylinderGeometry(endpoint_skewer_14.endRadius, endpoint_skewer_14.baseRadius, endpoint_skewer_14.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_skewer_14) {
    mesh_skewer_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_skewer_14 = new THREE.Mesh(
    mesh_skewer_14Geometry,
    materialMap["skewerMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_skewer_14.name = "Bamboo skewer";
  if (endpoint_skewer_14) {
    mesh_skewer_14.position.copy(endpoint_skewer_14.midpoint);
    mesh_skewer_14.quaternion.copy(endpoint_skewer_14.quaternion);
  }
  mesh_skewer_14.castShadow = options.castShadow ?? true;
  mesh_skewer_14.receiveShadow = options.receiveShadow ?? true;
  mesh_skewer_14.userData.sculptComponent = {"id": "skewer", "name": "Bamboo skewer", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "embedded through dome apex; rides with topBun on explode (explodeWithParent)", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "topBun", "attachment": {"parentSocket": "topBun.apex", "localStart": [0, 0.3, 0], "localEnd": [0, 1.56, 0], "contactType": "embed", "embedDepth": 0.6, "gapTolerance": 0.005, "baseRadius": 0.022, "endRadius": 0.017}, "dimensions": {"width": 0.045, "height": 1.8, "depth": 0.045, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "skewerMat", "materialLayers": ["skewerMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 168, 106, 1.0)", "secondaryAlbedo": "rgba(168, 135, 76, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_skewer_14.add(mesh_skewer_14);
  meshes["skewer"] = mesh_skewer_14;
  colliders["skewer"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["topBun"] ??= [];
  destructionGroups["topBun"].push(node_skewer_14);

  const attachment_knotLoop_15 = null;
  const endpoint_knotLoop_15 = makeAttachmentEndpoint(attachment_knotLoop_15);
  const node_knotLoop_15 = new THREE.Group();
  node_knotLoop_15.name = "Bamboo knot loop__pivot";
  node_knotLoop_15.scale.set(1, 1, 1);
  if (endpoint_knotLoop_15) {
    node_knotLoop_15.position.copy(endpoint_knotLoop_15.start);
    node_knotLoop_15.rotation.set(0.35, 0.2, 0.1);
  } else {
    node_knotLoop_15.position.set(0.0, 1.04, 0.0);
    node_knotLoop_15.rotation.set(0.35, 0.2, 0.1);
  }
  node_knotLoop_15.userData.sculptComponent = {"id": "knotLoop", "name": "Bamboo knot loop", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "knotted strip approximated as small tilted torus at the pick head", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.22}, "parent": "skewer", "attachment": null, "dimensions": {"width": 0.26, "height": 0.26, "depth": 0.8, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 1.04, 0], "rotation": [0.35, 0.2, 0.1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "skewerMat", "materialLayers": ["skewerMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 168, 106, 1.0)", "secondaryAlbedo": "rgba(168, 135, 76, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_knotLoop_15.userData.actionProfile = {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["skewer"] ?? root).add(node_knotLoop_15);
  nodes["knotLoop"] = node_knotLoop_15;
  const mesh_knotLoop_15Geometry = endpoint_knotLoop_15
    ? new THREE.CylinderGeometry(endpoint_knotLoop_15.endRadius, endpoint_knotLoop_15.baseRadius, endpoint_knotLoop_15.length, 16, 6)
    : new THREE.TorusGeometry(0.45, 0.099, 12, 48);
  if (!endpoint_knotLoop_15) {
    mesh_knotLoop_15Geometry.scale(0.26, 0.26, 0.8);
  }
  const mesh_knotLoop_15 = new THREE.Mesh(
    mesh_knotLoop_15Geometry,
    materialMap["skewerMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_knotLoop_15.name = "Bamboo knot loop";
  if (endpoint_knotLoop_15) {
    mesh_knotLoop_15.position.copy(endpoint_knotLoop_15.midpoint);
    mesh_knotLoop_15.quaternion.copy(endpoint_knotLoop_15.quaternion);
  }
  mesh_knotLoop_15.castShadow = options.castShadow ?? true;
  mesh_knotLoop_15.receiveShadow = options.receiveShadow ?? true;
  mesh_knotLoop_15.userData.sculptComponent = {"id": "knotLoop", "name": "Bamboo knot loop", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "torus", "topologyClass": "continuous-sculpt", "topologyRationale": "knotted strip approximated as small tilted torus at the pick head", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "torusTubeRatio": 0.22}, "parent": "skewer", "attachment": null, "dimensions": {"width": 0.26, "height": 0.26, "depth": 0.8, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 1.04, 0], "rotation": [0.35, 0.2, 0.1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "topBun", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "skewerMat", "materialLayers": ["skewerMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(201, 168, 106, 1.0)", "secondaryAlbedo": "rgba(168, 135, 76, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_knotLoop_15.add(mesh_knotLoop_15);
  meshes["knotLoop"] = mesh_knotLoop_15;
  colliders["knotLoop"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["topBun"] ??= [];
  destructionGroups["topBun"].push(node_knotLoop_15);

  const attachment_lettuceInner_16 = null;
  const endpoint_lettuceInner_16 = makeAttachmentEndpoint(attachment_lettuceInner_16);
  const node_lettuceInner_16 = new THREE.Group();
  node_lettuceInner_16.name = "Lettuce inner fold__pivot";
  node_lettuceInner_16.scale.set(1, 1, 1);
  if (endpoint_lettuceInner_16) {
    node_lettuceInner_16.position.copy(endpoint_lettuceInner_16.start);
    node_lettuceInner_16.rotation.set(0.0, 0.9, 0.0);
  } else {
    node_lettuceInner_16.position.set(0.08, 0.07, 0.05);
    node_lettuceInner_16.rotation.set(0.0, 0.9, 0.0);
  }
  node_lettuceInner_16.userData.sculptComponent = {"id": "lettuceInner", "name": "Lettuce inner fold", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.9, "primitive": "lathe", "topologyClass": "open-shell", "topologyRationale": "thin drooping sheet: lathe profile with folded-back rim; radial ruffle from displacement", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.001, 0.14], [0.45, 0.15], [0.85, 0.16], [1.05, 0.1], [1.18, 0.02], [1.13, -0.02], [0.85, 0.06], [0.4, 0.08], [0.001, 0.075]], "segments": 72}}, "parent": "lettuce", "attachment": null, "dimensions": {"width": 2.36, "height": 0.18, "depth": 2.36, "units": "world", "confidence": 0.7}, "transform": {"position": [0.08, 0.07, 0.05], "rotation": [0, 0.9, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lettuce", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "lettuceMat", "materialLayers": ["lettuceMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "vein bump + waxy sheen; margin translucency faked with sheen"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "denseMesh": true, "colorMaterialRecipe": {"dominantAlbedo": "rgba(90, 168, 50, 1.0)", "secondaryAlbedo": "rgba(140, 200, 94, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_lettuceInner_16.userData.actionProfile = {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lettuce", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["lettuce"] ?? root).add(node_lettuceInner_16);
  nodes["lettuceInner"] = node_lettuceInner_16;
  const mesh_lettuceInner_16Geometry = endpoint_lettuceInner_16
    ? new THREE.CylinderGeometry(endpoint_lettuceInner_16.endRadius, endpoint_lettuceInner_16.baseRadius, endpoint_lettuceInner_16.length, 16, 6)
    : buildLatheGeometry({"points": [[0.001, 0.14], [0.45, 0.15], [0.85, 0.16], [1.05, 0.1], [1.18, 0.02], [1.13, -0.02], [0.85, 0.06], [0.4, 0.08], [0.001, 0.075]], "segments": 72});
  if (!endpoint_lettuceInner_16) {
    mesh_lettuceInner_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lettuceInner_16 = new THREE.Mesh(
    mesh_lettuceInner_16Geometry,
    createSculptMaterial("lettuceMat", {"id": "lettuceMat", "name": "Lettuce leaf", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#5aa832", "color": "#5aa832", "albedo": {"dominant": "#4d9429", "secondary": ["#8cc85e", "#3f8722"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights."}, "colorVariation": {"palette": ["#4d9429", "#6cae3f", "#3a7d1f", "#5aa832"], "pattern": "reference-derived pixel palette", "amplitude": 0.14, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "stable object-scale detail"}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.465, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.36, "variation": 0.16, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "map": "independent-procedural-field"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.25, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.035}, "displacement": {"pattern": "radial-ruffle", "amplitude": 0.05, "scale": 9.0, "silhouetteAffects": true}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["independent albedo/roughness/height channels; never alias albedo", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "semi-translucent margins approximated with sheen, NOT transmission (budget: 1 transmissive total)", "sheen": {"base": 0.25}, "sheenColor": "#bfe6a0", "sheenRoughness": {"base": 0.5}, "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-crops\\lettuceMat.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.95, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_albedo.png", "url": "lettucemat_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_roughness.png", "url": "lettucemat_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_height.png", "url": "lettucemat_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_normal.png", "url": "lettucemat_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\mauri\\Documents\\chamba\\carnivoro-pe\\.img2threejs\\material-evidence\\lettuceMat\\lettucemat_ao.png", "url": "lettucemat_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 800, "sourceHeight": 115, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 800, "height": 115}, "mask": {"backgroundColor": "#AE7B31", "backgroundNoise": 77.311, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.5286, "heightP90Gradient": 0.07746, "roughnessBase": 0.74, "roughnessVariation": 0.136, "normalStrength": 0.247, "blurRadius": 21}, "palette": ["#D38C3C", "#E8AC5A", "#BA6A27", "#8F4316", "#F9D39D"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "routeNote": "procedural-palette route: the single-view crop cross-contaminates channels (painted seeds / neighbouring-layer pixels), so the maps are evidence only; factory falls back to colorVariation procedural textures"}, "doubleSided": true}, options, true)
  );
  mesh_lettuceInner_16.name = "Lettuce inner fold";
  if (endpoint_lettuceInner_16) {
    mesh_lettuceInner_16.position.copy(endpoint_lettuceInner_16.midpoint);
    mesh_lettuceInner_16.quaternion.copy(endpoint_lettuceInner_16.quaternion);
  }
  mesh_lettuceInner_16.castShadow = options.castShadow ?? true;
  mesh_lettuceInner_16.receiveShadow = options.receiveShadow ?? true;
  mesh_lettuceInner_16.userData.sculptComponent = {"id": "lettuceInner", "name": "Lettuce inner fold", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.9, "primitive": "lathe", "topologyClass": "open-shell", "topologyRationale": "thin drooping sheet: lathe profile with folded-back rim; radial ruffle from displacement", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.001, 0.14], [0.45, 0.15], [0.85, 0.16], [1.05, 0.1], [1.18, 0.02], [1.13, -0.02], [0.85, 0.06], [0.4, 0.08], [0.001, 0.075]], "segments": 72}}, "parent": "lettuce", "attachment": null, "dimensions": {"width": 2.36, "height": 0.18, "depth": 2.36, "units": "world", "confidence": 0.7}, "transform": {"position": [0.08, 0.07, 0.05], "rotation": [0, 0.9, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "layer", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lettuce", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "lettuceMat", "materialLayers": ["lettuceMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": "vein bump + waxy sheen; margin translucency faked with sheen"}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "denseMesh": true, "colorMaterialRecipe": {"dominantAlbedo": "rgba(90, 168, 50, 1.0)", "secondaryAlbedo": "rgba(140, 200, 94, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_lettuceInner_16.add(mesh_lettuceInner_16);
  meshes["lettuceInner"] = mesh_lettuceInner_16;
  colliders["lettuceInner"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["lettuce"] ??= [];
  destructionGroups["lettuce"].push(node_lettuceInner_16);

  const attachment_cheeseLobeRL_17 = {"parentSocket": "cheese.rearLeftEdge", "localStart": [-0.93, -0.977, 0.03], "localEnd": [-1.045, -1.092, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13};
  const endpoint_cheeseLobeRL_17 = makeAttachmentEndpoint(attachment_cheeseLobeRL_17);
  const node_cheeseLobeRL_17 = new THREE.Group();
  node_cheeseLobeRL_17.name = "Cheese drip lobe rear-left__pivot";
  node_cheeseLobeRL_17.scale.set(1, 1, 1);
  if (endpoint_cheeseLobeRL_17) {
    node_cheeseLobeRL_17.position.copy(endpoint_cheeseLobeRL_17.start);
    node_cheeseLobeRL_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cheeseLobeRL_17.position.set(0.0, 0.0, 0.0);
    node_cheeseLobeRL_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_cheeseLobeRL_17.userData.sculptComponent = {"id": "cheeseLobeRL", "name": "Cheese drip lobe rear-left", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "tapered hanging drip; +Z in cheese-local = world down", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cheese", "attachment": {"parentSocket": "cheese.rearLeftEdge", "localStart": [-0.93, -0.977, 0.03], "localEnd": [-1.045, -1.092, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13}, "dimensions": {"width": 0.3, "height": 0.34, "depth": 0.3, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_cheeseLobeRL_17.userData.actionProfile = {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}};
  (nodes["cheese"] ?? root).add(node_cheeseLobeRL_17);
  nodes["cheeseLobeRL"] = node_cheeseLobeRL_17;
  const mesh_cheeseLobeRL_17Geometry = endpoint_cheeseLobeRL_17
    ? new THREE.CylinderGeometry(endpoint_cheeseLobeRL_17.endRadius, endpoint_cheeseLobeRL_17.baseRadius, endpoint_cheeseLobeRL_17.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_cheeseLobeRL_17) {
    mesh_cheeseLobeRL_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cheeseLobeRL_17 = new THREE.Mesh(
    mesh_cheeseLobeRL_17Geometry,
    materialMap["cheeseMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cheeseLobeRL_17.name = "Cheese drip lobe rear-left";
  if (endpoint_cheeseLobeRL_17) {
    mesh_cheeseLobeRL_17.position.copy(endpoint_cheeseLobeRL_17.midpoint);
    mesh_cheeseLobeRL_17.quaternion.copy(endpoint_cheeseLobeRL_17.quaternion);
  }
  mesh_cheeseLobeRL_17.castShadow = options.castShadow ?? true;
  mesh_cheeseLobeRL_17.receiveShadow = options.receiveShadow ?? true;
  mesh_cheeseLobeRL_17.userData.sculptComponent = {"id": "cheeseLobeRL", "name": "Cheese drip lobe rear-left", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "tapered hanging drip; +Z in cheese-local = world down", "geometryDescriptor": {"topologyIntent": "smooth organic surface, bevel-ready seams", "edgeTreatment": {"type": "round", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cheese", "attachment": {"parentSocket": "cheese.rearLeftEdge", "localStart": [-0.93, -0.977, 0.03], "localEnd": [-1.045, -1.092, 0.24], "contactType": "overlap", "overlap": 0.06, "gapTolerance": 0.01, "baseRadius": 0.2, "endRadius": 0.13}, "dimensions": {"width": 0.3, "height": 0.34, "depth": 0.3, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "detail", "pivot": {"mode": "base-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cheese", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "bunCrust"}}, "material": "cheeseMat", "materialLayers": ["cheeseMat"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.5, "microRoughness": 0.3, "bumpAmplitude": 0.02, "normalPattern": "value-noise", "displacementPattern": "", "occlusionPattern": "seam-cavity", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "hero", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 166, 20, 1.0)", "secondaryAlbedo": "rgba(224, 148, 15, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.85, "evidenceRef": "analysis.md Layer 5/6"}};
  node_cheeseLobeRL_17.add(mesh_cheeseLobeRL_17);
  meshes["cheeseLobeRL"] = mesh_cheeseLobeRL_17;
  colliders["cheeseLobeRL"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "layer disc proxy"};
  destructionGroups["cheese"] ??= [];
  destructionGroups["cheese"].push(node_cheeseLobeRL_17);

  // repetition system: pickleRing (InstancedMesh, radial, count=5, level=macro)
  {
    const parent = nodes["pickles"] ?? root;
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
    const mat = materialMap["pickleMat"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [1.0, 0.2, 1.0];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 1.9;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 5);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 5; i++) {
      const ang = ((12.0) + (i * 360) / 5) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "pickleRing";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createCheeseburgerLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Cheeseburger look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"type": "key", "direction": "upper-front-left softbox", "color": "#fff2e2", "intensity": "soft broad key; exposure matched to ACES filmic tone mapping (project uses ACESFilmicToneMapping, exposure 1.05)"}, {"type": "fill", "direction": "white seamless environment bounce", "color": "#ffffff", "intensity": "high ambient fill; environment reflection from Lightformer env"}, {"type": "rim", "direction": "subtle top-rear rim from seamless sweep", "color": "#fff6ea", "intensity": "low"}, {"type": "contact-shadow", "direction": "ground under heel", "color": "#00000022", "intensity": "tight soft contact shadow + ambient occlusion in layer seams"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createCheeseburgerEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameCheeseburgerCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createCheeseburgerPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureCheeseburgerRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createCheeseburgerInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
