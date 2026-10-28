import { describe, expect, it } from 'vitest';
import { layoutLandscape, PAVEMENT_WIDTH, ROAD_WIDTH, seededRandom, type LayoutInput, type Rect } from './landscapeLayout';

// Two villas side by side with a feeder pillar in front, as in Level 2
const villa = (cx: number): Rect => ({ minX: cx - 7, maxX: cx + 7, minZ: -5.4, maxZ: 5.4 });
const input: LayoutInput = {
  units: [villa(-10), villa(10)],
  keepClear: [{ minX: -0.5, maxX: 0.5, minZ: 10.8, maxZ: 11.3 }],
  roadZ: 16,
  reach: 14,
};
const inside = (r: Rect, x: number, z: number) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

describe('layoutLandscape', () => {
  const l = layoutLandscape(input);

  it('is the same on every load', () => {
    expect(layoutLandscape(input)).toEqual(l);
    expect(seededRandom(1)()).toBe(seededRandom(1)());
  });

  it('keeps trees and bushes off the villas, pillar and street', () => {
    const halfStreet = ROAD_WIDTH / 2 + PAVEMENT_WIDTH;
    for (const p of [...l.trees, ...l.bushes]) {
      for (const u of [...input.units, ...input.keepClear]) expect(inside(u, p.x, p.z)).toBe(false);
      expect(Math.abs(p.z - input.roadZ)).toBeGreaterThan(halfStreet);
    }
  });

  it('keeps trees out of the pond and apart from each other', () => {
    const { pond } = l;
    for (const t of l.trees) {
      expect(((t.x - pond.x) / pond.rx) ** 2 + ((t.z - pond.z) / pond.rz) ** 2).toBeGreaterThan(1);
    }
    const shade = l.trees.filter(t => t.kind !== 'palm' || t.z !== l.trees[0].z);
    for (let i = 0; i < shade.length; i++) {
      for (let j = i + 1; j < shade.length; j++) {
        expect(Math.hypot(shade[i].x - shade[j].x, shade[i].z - shade[j].z)).toBeGreaterThanOrEqual(3.2);
      }
    }
  });

  it('puts the pond beside the site and plenty of trees around it', () => {
    expect(l.pond.x - l.pond.rx).toBeGreaterThan(17);
    expect(l.trees.length).toBeGreaterThan(20);
    expect(l.lamps.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps everything on the tile, with the street cut at its edges', () => {
    const { tile, road } = l;
    expect(road.minX).toBe(tile.minX);
    expect(road.maxX).toBe(tile.maxX);
    expect(tile.maxZ).toBeGreaterThan(road.z + ROAD_WIDTH / 2 + PAVEMENT_WIDTH);
    for (const p of [...l.trees, ...l.bushes, ...l.lamps]) {
      expect(inside(tile, p.x, p.z)).toBe(true);
    }
    const { pond } = l;
    expect(pond.x + pond.rx).toBeLessThan(tile.maxX);
    for (const u of input.units) {
      expect(u.minX).toBeGreaterThan(tile.minX);
      expect(u.maxX).toBeLessThan(tile.maxX);
    }
  });

  it('runs a footpath from each villa to the pavement', () => {
    expect(l.paths).toHaveLength(2);
    for (const p of l.paths) {
      expect(p.minZ).toBe(5.4);
      expect(p.maxZ).toBeCloseTo(input.roadZ - ROAD_WIDTH / 2 - PAVEMENT_WIDTH);
    }
  });
});
