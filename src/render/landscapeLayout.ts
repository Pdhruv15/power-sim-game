/**
 * Where the scenery goes: street, lamps, trees, bushes, pond and lawns around the site.
 * Pure numbers with no Three.js, so placement can be tested. Positions are in site coordinates
 * (x east, z south, metres) with the units centred on x = 0, z = 0.
 */

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface LayoutInput {
  /** Footprint of each villa or flat row, including its plinth. */
  units: Rect[];
  /** Small things to keep clear, such as a feeder pillar or riser. */
  keepClear: Rect[];
  /** Centre line of the street, in z. */
  roadZ: number;
  /** How far the scenery reaches beyond the site. */
  reach: number;
}

export type TreeKind = 'palm' | 'round' | 'cone';

export interface Tree {
  x: number;
  z: number;
  kind: TreeKind;
  /** Size factor around 1. */
  scale: number;
  /** Turn about the trunk, radians. */
  turn: number;
}

export interface Pond {
  x: number;
  z: number;
  /** Half sizes of the ellipse. */
  rx: number;
  rz: number;
}

export interface LandscapeLayout {
  /** The block of land the game sits on. Everything else stays inside it. */
  tile: Rect;
  road: { z: number; width: number; minX: number; maxX: number };
  /** Pavement strips on each side of the road. */
  pavementWidth: number;
  lamps: { x: number; z: number }[];
  /** Footpaths from the pavement to each unit's front. */
  paths: Rect[];
  lawns: Rect[];
  pond: Pond;
  trees: Tree[];
  bushes: { x: number; z: number; scale: number }[];
}

export const ROAD_WIDTH = 7;
export const PAVEMENT_WIDTH = 1.6;
const LAMP_SPACING = 14;
const LAWN_MARGIN = 2.5;
const CLEARANCE = 1.2;
/** Keep tree canopies off the tile's edge. */
const TILE_EDGE_MARGIN = 1.6;
/** Ground in front of the street, so the tile does not end at the kerb. */
const TILE_FRONT_MIN = 6;

/** Small seeded random generator (mulberry32), so the scenery is the same on every load. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const grow = (r: Rect, by: number): Rect => ({ minX: r.minX - by, maxX: r.maxX + by, minZ: r.minZ - by, maxZ: r.maxZ + by });
const inside = (r: Rect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const inPond = (p: Pond, x: number, z: number, pad = 0): boolean =>
  ((x - p.x) / (p.rx + pad)) ** 2 + ((z - p.z) / (p.rz + pad)) ** 2 <= 1;

export function layoutLandscape(input: LayoutInput, seed = 7): LandscapeLayout {
  const rand = seededRandom(seed);
  const site = input.units.reduce(
    (a, u) => ({ minX: Math.min(a.minX, u.minX), maxX: Math.max(a.maxX, u.maxX), minZ: Math.min(a.minZ, u.minZ), maxZ: Math.max(a.maxZ, u.maxZ) }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
  const minX = site.minX - input.reach, maxX = site.maxX + input.reach;
  const tile: Rect = {
    minX, maxX, minZ: site.minZ - input.reach,
    maxZ: input.roadZ + ROAD_WIDTH / 2 + PAVEMENT_WIDTH + Math.max(TILE_FRONT_MIN, input.reach * 0.6),
  };
  // The street runs right across the tile and is cut off at its edges
  const road = { z: input.roadZ, width: ROAD_WIDTH, minX, maxX };
  const roadBand: Rect = { minX: road.minX, maxX: road.maxX, minZ: road.z - ROAD_WIDTH / 2 - PAVEMENT_WIDTH, maxZ: road.z + ROAD_WIDTH / 2 + PAVEMENT_WIDTH };

  // Lamps along the near pavement, evenly spaced and centred on the site
  const lamps: LandscapeLayout['lamps'] = [];
  const lampZ = road.z - ROAD_WIDTH / 2 - PAVEMENT_WIDTH / 2;
  const half = Math.floor((maxX - minX) / 2 / LAMP_SPACING);
  for (let i = -half; i <= half; i++) {
    const x = (site.minX + site.maxX) / 2 + i * LAMP_SPACING;
    if (x > minX + 1 && x < maxX - 1) lamps.push({ x, z: lampZ });
  }

  // A footpath from the pavement to the front of each unit (ground-floor rows only reach the street)
  const frontZ = Math.max(...input.units.map(u => u.maxZ));
  const paths = input.units
    .filter(u => u.maxZ === frontZ)
    .map(u => { const cx = (u.minX + u.maxX) / 2; return { minX: cx - 0.8, maxX: cx + 0.8, minZ: u.maxZ, maxZ: roadBand.minZ }; });

  const lawns = input.units.map(u => grow(u, LAWN_MARGIN));

  // Pond to the east of the site, behind the street
  const pond: Pond = { x: site.maxX + 9, z: (site.minZ + Math.min(site.maxZ, road.z - 6)) / 2, rx: 4.5, rz: 3 };

  // Keep scenery off the buildings, cables, street, paths and pond
  const blocked = [
    ...input.units.map(u => grow(u, CLEARANCE)),
    ...input.keepClear.map(r => grow(r, CLEARANCE)),
    grow(roadBand, 0.3),
    ...paths.map(p => grow(p, 0.6)),
  ];
  const onTile = (x: number, z: number) => inside(grow(tile, -TILE_EDGE_MARGIN), x, z);
  const free = (x: number, z: number, pad: number) =>
    onTile(x, z) && !blocked.some(r => inside(grow(r, pad), x, z)) && !inPond(pond, x, z, pad + 1);

  // Palms along the far pavement, between the lamps
  const trees: Tree[] = [];
  const palmZ = road.z + ROAD_WIDTH / 2 + PAVEMENT_WIDTH + 1.2;
  for (let i = -half; i < half; i++) {
    const x = (site.minX + site.maxX) / 2 + (i + 0.5) * LAMP_SPACING;
    if (x < minX + TILE_EDGE_MARGIN || x > maxX - TILE_EDGE_MARGIN) continue;
    trees.push({ x, z: palmZ, kind: 'palm', scale: 0.9 + rand() * 0.3, turn: rand() * Math.PI * 2 });
  }

  // Shade trees scattered around the site, spaced apart
  const area = grow(tile, -TILE_EDGE_MARGIN); // trees keep off the tile's edge
  const wanted = Math.round(((area.maxX - area.minX) * (area.maxZ - area.minZ)) / 45);
  for (let tries = 0; tries < wanted * 12 && trees.length < wanted; tries++) {
    const x = area.minX + rand() * (area.maxX - area.minX);
    const z = area.minZ + rand() * (area.maxZ - area.minZ);
    if (!free(x, z, 0.8) || trees.some(t => Math.hypot(t.x - x, t.z - z) < 3.2)) continue;
    const kind: TreeKind = rand() < 0.55 ? 'round' : rand() < 0.5 ? 'cone' : 'palm';
    trees.push({ x, z, kind, scale: 0.75 + rand() * 0.5, turn: rand() * Math.PI * 2 });
  }

  // Bushes around the lawns and the pond edge
  const bushes: LandscapeLayout['bushes'] = [];
  for (const lawn of lawns) {
    for (let k = 0; k < 6; k++) {
      const side = k % 4;
      const t = rand();
      const x = side < 2 ? lawn.minX + t * (lawn.maxX - lawn.minX) : side === 2 ? lawn.minX : lawn.maxX;
      const z = side < 2 ? (side === 0 ? lawn.minZ : lawn.maxZ) : lawn.minZ + t * (lawn.maxZ - lawn.minZ);
      if (free(x, z, 0.2)) bushes.push({ x, z, scale: 0.6 + rand() * 0.5 });
    }
  }
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rand() * 0.4;
    const x = pond.x + Math.cos(a) * (pond.rx + 1.3), z = pond.z + Math.sin(a) * (pond.rz + 1.3);
    if (onTile(x, z) && !blocked.some(r => inside(r, x, z))) bushes.push({ x, z, scale: 0.5 + rand() * 0.4 });
  }

  return { tile, road, pavementWidth: PAVEMENT_WIDTH, lamps, paths, lawns, pond, trees, bushes };
}
