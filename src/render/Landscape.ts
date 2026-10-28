import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LandscapeLayout, Tree } from './landscapeLayout';

// Scenery colours
const ASPHALT = 0x3b3f44, MARKING = 0xe9e4d6, PAVEMENT = 0xc9c3b6, KERB = 0xa9a397;
const LAWN = 0x7fae5a, PATH = 0xd8cbb0;
const TRUNK = 0x7a5532, PALM_TRUNK = 0x9b7a52, LEAF = 0x4f8a3c, PINE = 0x3d6e3a, FROND = 0x5f9a3e;
const BUSH = [0x5b8f46, 0x4a7d3b, 0xc2508a];
const WATER = 0x3f86b0, POND_EDGE = 0x8d7a5a, STONE = 0x9a958c, REED = 0x6b8f3a, LILY = 0x4f8f3c;
const LAMP_OFF = new THREE.Color(0x5a6066), LAMP_ON = new THREE.Color(0xffd58a);

const RIPPLES = 3;
const RIPPLE_SECONDS = 4;

/**
 * Street, trees, lawns, a pond and street lamps around the site. Decoration only: it never affects the
 * simulation or room picking. Lamps light up at dusk; the pond ripples unless motion is reduced.
 */
export class Landscape {
  readonly group = new THREE.Group();
  private lampHead = new THREE.MeshBasicMaterial({ color: LAMP_OFF });
  private lampGlow = new THREE.MeshBasicMaterial({ color: LAMP_ON, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  private ripples: THREE.Mesh[] = [];
  private pondSize: number;

  constructor(private layout: LandscapeLayout) {
    this.buildStreet();
    this.buildLawnsAndPaths();
    this.buildPond();
    this.buildTrees(layout.trees);
    this.buildBushes();
    this.buildLamps();
    this.pondSize = Math.min(layout.pond.rx, layout.pond.rz);
  }

  /** 0 = night, 1 = full day. Lamps fade in as the light goes. */
  setDaylight(day: number): void {
    const night = THREE.MathUtils.clamp(1 - day * 1.6, 0, 1);
    this.lampHead.color.copy(LAMP_OFF).lerp(LAMP_ON, night);
    this.lampGlow.opacity = 0.28 * night;
  }

  /** Animate the pond ripples. t = seconds. */
  tick(t: number): void {
    this.ripples.forEach((r, i) => {
      const phase = ((t / RIPPLE_SECONDS) + i / RIPPLES) % 1;
      const s = this.pondSize * (0.15 + 0.6 * phase);
      r.scale.set(s, s, 1);
      (r.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - phase);
    });
  }

  // ---------- build ----------

  private buildStreet(): void {
    const { road, pavementWidth } = this.layout;
    const len = road.maxX - road.minX, cx = (road.minX + road.maxX) / 2;
    flat(len, 0.04, road.width, ASPHALT, cx, 0.02, road.z, this.group);
    // Dashed centre line
    const dash = new THREE.BoxGeometry(1.6, 0.02, 0.14), dashMat = new THREE.MeshStandardMaterial({ color: MARKING, roughness: 0.8 });
    for (let x = road.minX + 1; x < road.maxX; x += 3.6) {
      const m = new THREE.Mesh(dash, dashMat);
      m.position.set(x, 0.05, road.z);
      this.group.add(m);
    }
    // Pavements with a kerb on the road side
    for (const side of [-1, 1]) {
      const z = road.z + side * (road.width / 2 + pavementWidth / 2);
      flat(len, 0.12, pavementWidth, PAVEMENT, cx, 0.06, z, this.group);
      flat(len, 0.16, 0.14, KERB, cx, 0.08, road.z + side * (road.width / 2 + 0.07), this.group);
    }
  }

  private buildLawnsAndPaths(): void {
    for (const l of this.layout.lawns) flat(l.maxX - l.minX, 0.02, l.maxZ - l.minZ, LAWN, (l.minX + l.maxX) / 2, 0.01, (l.minZ + l.maxZ) / 2, this.group);
    for (const p of this.layout.paths) flat(p.maxX - p.minX, 0.04, p.maxZ - p.minZ, PATH, (p.minX + p.maxX) / 2, 0.03, (p.minZ + p.maxZ) / 2, this.group);
  }

  private buildPond(): void {
    const { x, z, rx, rz } = this.layout.pond;
    const pond = new THREE.Group();
    pond.position.set(x, 0, z);
    this.group.add(pond);

    const disc = new THREE.CircleGeometry(1, 48);
    const edge = new THREE.Mesh(disc, new THREE.MeshStandardMaterial({ color: POND_EDGE, roughness: 1 }));
    edge.rotation.x = -Math.PI / 2;
    edge.scale.set(rx + 0.6, rz + 0.6, 1);
    edge.position.y = 0.015;
    edge.receiveShadow = true;
    const water = new THREE.Mesh(disc, new THREE.MeshStandardMaterial({ color: WATER, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2;
    water.scale.set(rx, rz, 1);
    water.position.y = 0.03;
    water.receiveShadow = true;
    pond.add(edge, water);

    // Stones round the edge
    const stone = new THREE.DodecahedronGeometry(0.28, 0), stoneMat = new THREE.MeshStandardMaterial({ color: STONE, roughness: 1, flatShading: true });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const m = new THREE.Mesh(stone, stoneMat);
      m.position.set(Math.cos(a) * (rx + 0.35), 0.1, Math.sin(a) * (rz + 0.35));
      m.scale.setScalar(0.7 + ((i * 37) % 10) / 20);
      m.rotation.set(i, i * 2, 0);
      m.castShadow = true;
      pond.add(m);
    }

    // Reeds in two clumps, lily pads on the water
    const reed = new THREE.CylinderGeometry(0.025, 0.035, 1.2, 4), reedMat = new THREE.MeshStandardMaterial({ color: REED });
    for (const [ax, az] of [[-0.7, -0.6], [0.6, 0.7]]) {
      for (let k = 0; k < 9; k++) {
        const m = new THREE.Mesh(reed, reedMat);
        m.position.set(ax * rx + Math.cos(k * 2.4) * 0.35, 0.6, az * rz + Math.sin(k * 2.4) * 0.35);
        m.rotation.set(Math.sin(k) * 0.15, 0, Math.cos(k) * 0.15);
        pond.add(m);
      }
    }
    const pad = new THREE.CircleGeometry(0.32, 10), padMat = new THREE.MeshStandardMaterial({ color: LILY, roughness: 0.6 });
    for (const [px, pz] of [[0.2, 0.1], [0.35, -0.25], [-0.25, 0.3], [-0.1, -0.15]]) {
      const m = new THREE.Mesh(pad, padMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(px * rx, 0.04, pz * rz);
      pond.add(m);
    }

    // Ripple rings
    const ring = new THREE.RingGeometry(0.94, 1, 48);
    for (let i = 0; i < RIPPLES; i++) {
      const m = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(-0.15 * rx, 0.045, 0.1 * rz);
      pond.add(m);
      this.ripples.push(m);
    }
  }

  private buildTrees(trees: Tree[]): void {
    const parts = treeParts();
    for (const t of trees) {
      const g = new THREE.Group();
      g.position.set(t.x, 0, t.z);
      g.rotation.y = t.turn;
      g.scale.setScalar(t.scale);
      for (const [geo, mat, y] of parts[t.kind]) {
        const m = new THREE.Mesh(geo, mat);
        m.position.y = y;
        m.castShadow = true;
        g.add(m);
      }
      this.group.add(g);
    }
  }

  private buildBushes(): void {
    const geo = new THREE.IcosahedronGeometry(0.55, 0);
    const mats = BUSH.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
    this.layout.bushes.forEach((b, i) => {
      const m = new THREE.Mesh(geo, mats[i % 7 === 3 ? 2 : i % 2]); // the odd bougainvillea
      m.position.set(b.x, 0.4 * b.scale, b.z);
      m.scale.set(b.scale * 1.2, b.scale * 0.8, b.scale);
      m.castShadow = true;
      this.group.add(m);
    });
  }

  private buildLamps(): void {
    const pole = new THREE.CylinderGeometry(0.06, 0.08, 4, 6), arm = new THREE.BoxGeometry(0.08, 0.08, 1);
    const head = new THREE.BoxGeometry(0.45, 0.14, 0.3), glow = new THREE.CircleGeometry(2.4, 24);
    const metal = new THREE.MeshStandardMaterial({ color: 0x4b5157, metalness: 0.5, roughness: 0.5 });
    for (const l of this.layout.lamps) {
      const g = new THREE.Group();
      g.position.set(l.x, 0.12, l.z);
      const p = new THREE.Mesh(pole, metal);
      p.position.y = 2;
      p.castShadow = true;
      const a = new THREE.Mesh(arm, metal);
      a.position.set(0, 3.95, 0.45);
      const h = new THREE.Mesh(head, this.lampHead);
      h.position.set(0, 3.85, 0.9);
      const pool = new THREE.Mesh(glow, this.lampGlow);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(0, 0.02, 1.2);
      g.add(p, a, h, pool);
      this.group.add(g);
    }
  }
}

type Part = [THREE.BufferGeometry, THREE.Material, number];

/** Shared low-poly pieces for each tree kind: geometry, material, height of its centre. */
function treeParts(): Record<Tree['kind'], Part[]> {
  const std = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
  // Palm crown: seven drooping fronds merged into one mesh, plus a few coconuts
  const fronds = Array.from({ length: 7 }, (_, i) => {
    const f = new THREE.BoxGeometry(0.28, 0.04, 1.9);
    f.translate(0, 0, 0.95);
    f.rotateX(0.45);
    f.rotateY((i / 7) * Math.PI * 2);
    return f;
  });
  return {
    round: [
      [new THREE.CylinderGeometry(0.12, 0.18, 1.7, 6), std(TRUNK), 0.85],
      [new THREE.IcosahedronGeometry(1.15, 0), std(LEAF), 2.3],
    ],
    cone: [
      [new THREE.CylinderGeometry(0.1, 0.14, 1, 6), std(TRUNK), 0.5],
      [new THREE.ConeGeometry(0.95, 2.6, 7), std(PINE), 2.2],
    ],
    palm: [
      [new THREE.CylinderGeometry(0.1, 0.17, 3.8, 6), std(PALM_TRUNK), 1.9],
      [mergeGeometries(fronds)!, std(FROND), 3.85],
      [new THREE.IcosahedronGeometry(0.22, 0), std(0x6d5a3a), 3.7],
    ],
  };
}

function flat(w: number, h: number, d: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  m.position.set(x, y, z);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
