import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { PHASES, type Board, type Circuit, type Level, type SimResult } from '../sim';
import { STATUS, statusColor } from './colors';
import { boardLabelVisible, roomLabelVisible, type LabelMode, type RoomState } from './labelRules';
import { CABLE_DEPTH, Landscape } from './Landscape';
import { Sky } from './Sky';
import { layoutLandscape, PAVEMENT_WIDTH, ROAD_WIDTH, type Rect } from './landscapeLayout';

// Plan dimensions in metres. Each villa has two rows of rooms either side of a corridor, one room per circuit.
const ROOM = 4.4, WALL_H = 2.8, WALL_T = 0.14, CORRIDOR = 1.4, DOOR = 1.0, BASE = 0.2;
const VILLA_GAP = 7;             // between villas
const FLAT_GAP = 0.3;            // between flats in a building
const FLOOR_H = BASE + WALL_H + 0.25; // storey height
const RISER_SETBACK = 1.8;       // riser and boards beside the building's west end
const SKY_RADIUS = 260;          // inside the camera's far plane
const PILLAR_SETBACK = 6;        // feeder pillar distance in front of the villas
const PANEL_KW = 0.55;           // one PV panel
const PANEL_TILT = 20;           // degrees
const FADED_OPACITY = 0.12;
const MARKER_LIFT = 1.7;

interface RoomParts {
  floorMat: THREE.MeshStandardMaterial;
  wallMat: THREE.MeshStandardMaterial;
  bandMat: THREE.MeshBasicMaterial;
  cableMat: THREE.MeshBasicMaterial;
  marker: THREE.Mesh;
  markerY: number;
  label: HTMLDivElement;
  labelObj: CSS2DObject;
  floor: number;
  state: RoomState;
}

interface BoardParts {
  cableMat: THREE.MeshBasicMaterial | null;
  marker: THREE.Mesh;
  markerY: number;
  label: HTMLDivElement;
  labelObj: CSS2DObject;
  floor: number;
  isTop: boolean;
  state: RoomState;
}

/**
 * Low-poly isometric site: one villa per board that has rooms, plus a feeder pillar when the
 * top board feeds other boards. Reads SimResult values only; it never changes the simulation.
 * The host page owns the clock and calls update() with each new result.
 */
export class SiteScene {
  /** Called when the player clicks a room (not a drag). */
  onRoomClick: (circuitId: string) => void = () => {};

  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private labels = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private controls: OrbitControls;
  private hemi = new THREE.HemisphereLight(0xdfe9f5, 0x8a7350, 1);
  private sunLight = new THREE.DirectionalLight(0xfff1dc, 2.5);
  private sunDisc = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  private site = new THREE.Group();
  private roofs: THREE.Group[] = [];
  private rooms = new Map<string, RoomParts>();
  private boards = new Map<string, BoardParts>();
  private pickRooms: THREE.Object3D[] = [];
  private pickRoof: THREE.Object3D[] = [];
  private faded = new Set<string>();
  private labelMode: LabelMode = 'smart';
  private hovered: string | null = null;
  /** Highest floor shown; upper floors are hidden so the player can look inside. Infinity = all. */
  private floorLimit = Infinity;
  /** Objects drawn on each floor above the ground, for hiding floors. */
  private floorObjects: { floor: number; obj: THREE.Object3D }[] = [];
  private labelObjs = new Map<HTMLElement, CSS2DObject>();
  /** Board each room is on. */
  private roomBoard = new Map<string, string>();
  private hoverQueued: PointerEvent | null = null;
  private landscape: Landscape | null = null;
  private sky: Sky | null = null;
  /** Buried supply cable from the street network to the top board, seen in the tile's cut face. */
  private supply: { mat: THREE.MeshBasicMaterial; labelObj: CSS2DObject } | null = null;
  /** Furthest the view may pan from the site centre. */
  private panLimit = 30;
  private span = 20;
  private clock = new THREE.Clock();
  private resizeObserver: ResizeObserver;
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private down: { x: number; y: number } | null = null;

  constructor(private host: HTMLElement, level: Level) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.labels.domElement.className = 'scene-labels';
    host.append(this.renderer.domElement, this.labels.domElement);

    // Isometric-style orthographic camera; OrbitControls gives rotate, zoom and pan.
    this.camera.position.set(22, 30, 24); // about 43° above the ground
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47; // stay above ground
    this.controls.minZoom = 0.45; // far enough out to see the whole tile
    this.controls.maxZoom = 4;

    this.buildSite(level);
    this.buildEnvironment();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.renderer.setAnimationLoop(this.frame);
  }

  /** Apply a simulation result: sun, sky, lights, and the status colours of rooms, cables and boards. */
  update(r: SimResult): void {
    const { elevation: e, azimuth: az, height } = r.sun;
    // North = −z, east = +x
    const dir = new THREE.Vector3(Math.cos(e) * Math.sin(az), Math.sin(e), -Math.cos(e) * Math.cos(az));
    this.sunDisc.position.copy(dir).multiplyScalar(this.span * 0.9);
    this.sunDisc.visible = e > -0.05;
    (this.sunDisc.material as THREE.MeshBasicMaterial).color.set(height < 0.3 ? 0xffa45c : 0xffe08a);
    this.sunLight.position.copy(dir).multiplyScalar(this.span * 1.6);
    const day = THREE.MathUtils.clamp(height / 0.35, 0, 1);
    this.sunLight.intensity = 2.6 * day;
    this.hemi.intensity = 0.15 + 0.85 * day;
    this.sky?.setSunHeight(height);
    this.scene.background = this.sky?.haze ?? null;
    this.supply?.mat.color.copy(statusColor(r.main.band, r.main.dead));
    this.landscape?.setDaylight(day);

    for (const c of r.circuits) {
      const rm = this.rooms.get(c.id);
      if (!rm) continue;
      const col = statusColor(c.band, c.dead);
      rm.floorMat.emissive.copy(col);
      rm.floorMat.emissiveIntensity = c.dead ? 0.05 : 0.25 + 0.75 * Math.min(c.loading, 1);
      rm.bandMat.color.copy(col);
      rm.cableMat.color.copy(col);
      rm.marker.visible = c.tripped;
      const state = c.tripped ? 'TRIPPED' : c.dead ? 'no supply' : c.overloaded ? `${c.amps.toFixed(1)} A · OVERLOAD` : `${c.amps.toFixed(1)} / ${c.breakerA} A`;
      rm.state = { band: c.band, overloaded: c.overloaded, tripped: c.tripped, dead: c.dead };
      rm.label.className = `scene-label st-${c.dead ? 'off' : c.band}${c.tripped || c.overloaded ? ' alarm' : ''}`;
      rm.label.lastChild!.textContent = state;
    }

    for (const b of r.boards) {
      const bp = this.boards.get(b.id);
      if (!bp) continue;
      bp.cableMat?.color.copy(statusColor(b.band, b.dead));
      bp.marker.visible = b.tripped;
      const amps = b.phases === 3
        ? PHASES.map((p, i) => `${p} ${Math.abs(b.phaseAmps[i]).toFixed(0)}`).join(' · ') + ' A'
        : `${b.amps.toFixed(1)} / ${b.ratingA} A`;
      bp.state = { band: b.band, overloaded: b.overloaded, tripped: b.tripped, dead: b.dead };
      bp.label.className = `scene-label tag st-${b.dead ? 'off' : b.band}${b.tripped || b.overloaded ? ' alarm' : ''}`;
      bp.label.lastChild!.textContent = b.tripped ? 'TRIPPED' : b.dead ? 'no supply' : amps;
    }
    this.refreshLabels();
  }

  /** Which room labels to show: smart (default), all, or off. */
  setLabelMode(mode: LabelMode): void {
    this.labelMode = mode;
    this.refreshLabels();
  }

  /** Show floors 0…limit only (null = all), so the player can look into the lower floors. */
  setFloorLimit(limit: number | null): void {
    this.floorLimit = limit ?? Infinity;
    for (const { floor, obj } of this.floorObjects) obj.visible = floor <= this.floorLimit;
    this.hovered = null;
    this.refreshLabels();
  }

  setRoofVisible(visible: boolean): void {
    for (const r of this.roofs) r.visible = visible;
  }

  /** Rooms whose walls are faded so the player can see inside. */
  setFaded(ids: ReadonlySet<string>): void {
    this.faded = new Set(ids);
    this.refreshLabels();
  }

  /** Apply the label mode, hover, clicked rooms and hidden floors to every label. */
  private refreshLabels(): void {
    for (const [id, rm] of this.rooms) {
      rm.labelObj.visible = rm.floor <= this.floorLimit && roomLabelVisible(this.labelMode, rm.state, this.faded.has(id), this.hovered === id);
    }
    // Boards that feed the room under the pointer or a clicked room
    const related = new Set([this.hovered, ...this.faded].filter((id): id is string => !!id).map(id => this.roomBoard.get(id)));
    for (const [id, bp] of this.boards) {
      bp.labelObj.visible = bp.floor <= this.floorLimit && boardLabelVisible(this.labelMode, bp.state, bp.isTop, related.has(id));
    }
    if (this.supply) this.supply.labelObj.visible = this.labelMode !== 'off';
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    this.scene.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      }
    });
    this.renderer.dispose();
    canvas.remove();
    this.labels.domElement.remove();
  }

  // ---------- build ----------

  private buildEnvironment(): void {
    const fill = new THREE.AmbientLight(0x4a5d80, 0.35); // night-time fill
    const tile = this.landscape?.tile;
    const s = tile ? Math.max(tile.maxX - tile.minX, tile.maxZ - tile.minZ) * 0.6 : this.span * 0.8;
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sunLight.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: this.span * 4 });
    this.scene.add(this.hemi, fill, this.sunLight, this.sunLight.target, this.sunDisc);

    // Sky all round the floating tile. The tile itself is the ground (see Landscape).
    this.sky = new Sky(SKY_RADIUS);
    this.scene.add(this.sky.group);
  }

  /**
   * Units (villas or flats) in a row per floor. Villas stand apart with a feeder pillar in front;
   * flats in a building sit side by side, floors stacked, with the main and floor boards on a riser at the west end.
   */
  private buildSite(level: Level): void {
    const building = level.boards.some(b => b.floor !== undefined && b.floor > 0);
    const gap = building ? FLAT_GAP : VILLA_GAP;
    const units = level.boards.filter(b => level.circuits.some(c => c.board === b.id));
    const floorOf = (b: Board) => b.floor ?? 0;
    const topFloor = Math.max(...units.map(floorOf));
    const sizeOf = new Map(units.map(b => [b.id, villaSize(level.circuits.filter(c => c.board === b.id).length)]));
    const floors = [...new Set(units.map(floorOf))].sort((a, b) => a - b);
    const rowWidth = (f: number) => {
      const row = units.filter(b => floorOf(b) === f);
      return row.reduce((s, b) => s + sizeOf.get(b.id)!.W, 0) + gap * (row.length - 1);
    };
    const rowW = Math.max(...floors.map(rowWidth));
    const maxD = Math.max(...units.map(b => sizeOf.get(b.id)!.D));
    this.site.rotation.y = -THREE.MathUtils.degToRad(level.orientation); // clockwise from north
    this.scene.add(this.site);

    // Where each board sits, in site coordinates, and what the scenery must keep clear of
    const dbAt = new Map<string, THREE.Vector3>();
    const footprints: Rect[] = [];
    const keepClear: Rect[] = [];
    for (const f of floors) {
      let x = -rowWidth(f) / 2;
      for (const b of units.filter(u => floorOf(u) === f)) {
        const { W } = sizeOf.get(b.id)!;
        const g = new THREE.Group();
        g.position.set(x + W / 2, f * FLOOR_H, 0);
        this.site.add(g);
        if (f > 0) this.floorObjects.push({ floor: f, obj: g });
        const db = this.buildVilla(g, b, level.circuits.filter(c => c.board === b.id), units.length > 1, floorOf(b) === topFloor);
        dbAt.set(b.id, db.add(g.position));
        if (f === floors[0]) footprints.push(around(g.position.x, 0, W / 2 + 0.3, sizeOf.get(b.id)!.D / 2 + 0.3));
        x += W + gap;
      }
    }

    // Boards without rooms: a feeder pillar in front of villas, or main and floor boards on the building's riser
    const others = level.boards.filter(b => !dbAt.has(b.id));
    others.forEach((b, i) => {
      const at = building
        ? new THREE.Vector3(-rowW / 2 - RISER_SETBACK, floorOf(b) * FLOOR_H, b.parent === null ? 2.5 : 0)
        : new THREE.Vector3((i - (others.length - 1) / 2) * 4, 0, maxD / 2 + PILLAR_SETBACK);
      const cabinet = box(0.9, 1.4, 0.5, mat(0x6f7a85, { metalness: 0.3 }), at.x, at.y + 0.7, at.z, this.site);
      if (floorOf(b) > 0) this.floorObjects.push({ floor: floorOf(b), obj: cabinet });
      dbAt.set(b.id, at);
      if (at.y === 0) keepClear.push(around(at.x, at.z, 0.45, 0.25));
      // On a riser the main board stands in front, so its label sits low, clear of the floor boards' labels
      const labelY = at.y + (building && b.parent === null ? 1.6 : 2.2);
      this.boards.set(b.id, this.boardParts(b, new THREE.Vector3(at.x, labelY, at.z), null));
    });

    // Feeder cables: up the riser to the child's floor, along the parent's line, then across to the child's board
    for (const b of level.boards) {
      if (!b.parent) continue;
      const from = dbAt.get(b.parent)!, to = dbAt.get(b.id)!;
      const cableMat = new THREE.MeshBasicMaterial({ color: STATUS.ok });
      const lift = building ? BASE + 0.1 : 0.06;
      const y0 = from.y + lift, y1 = to.y + lift, t = 0.18;
      if (Math.abs(y1 - y0) > 0.01) box(t, Math.abs(y1 - y0), t, cableMat, from.x, (y0 + y1) / 2, from.z, this.site, false);
      box(Math.abs(to.x - from.x) + t, t / 3, t, cableMat, (from.x + to.x) / 2, y1, from.z, this.site, false);
      box(t, t / 3, Math.abs(from.z - to.z) + t, cableMat, to.x, y1, (from.z + to.z) / 2, this.site, false);
      if (y1 < 0.5) {
        keepClear.push({ minX: Math.min(from.x, to.x), maxX: Math.max(from.x, to.x), minZ: from.z - t, maxZ: from.z + t });
        keepClear.push({ minX: to.x - t, maxX: to.x + t, minZ: Math.min(from.z, to.z), maxZ: Math.max(from.z, to.z) });
      }
      const parts = this.boards.get(b.id);
      if (parts) parts.cableMat = cableMat;
    }

    // Street in front (past the feeder pillar when there is one), trees, lawns and a pond around the site
    const pillar = others.length > 0 && !building;
    const roadZ = maxD / 2 + (pillar ? PILLAR_SETBACK + 0.6 : 3) + PAVEMENT_WIDTH + ROAD_WIDTH / 2;
    this.landscape = new Landscape(layoutLandscape({ units: footprints, keepClear, roadZ, reach: Math.max(14, rowW * 0.5) }));
    this.site.add(this.landscape.group);
    this.buildSupplyCable(dbAt.get(level.boards.find(b => b.parent === null)!.id)!, this.landscape.tile);

    const height = (topFloor + 1) * FLOOR_H;
    const siteSpan = Math.max(rowW + (building ? RISER_SETBACK * 2 : 0), maxD + (others.length && !building ? PILLAR_SETBACK * 2 : 0), height * 1.4);
    const { tile } = this.landscape;
    const tileSpan = Math.max(tile.maxX - tile.minX, tile.maxZ - tile.minZ);
    // Start a little wider than the site so the tile's edge and the sky around it are in view
    this.span = Math.max(siteSpan, tileSpan * 0.65);
    this.panLimit = tileSpan * 0.45;
    this.controls.target.set(0, height / 2, 0);
    this.addLabel(this.scene, 'N ↑', new THREE.Vector3(0, 0, -maxD / 2 - 4), 'scene-label tag'); // north is world −z
  }

  /** One villa, centred on its group. Returns where its board sits, in the group's coordinates. */
  private buildVilla(g: THREE.Group, board: Board, circuits: Circuit[], showName: boolean, withRoof: boolean): THREE.Vector3 {
    const cols = Math.ceil(circuits.length / 2);
    const { W, D } = villaSize(circuits.length);

    box(W + 0.6, BASE, D + 0.6, mat(0xb9ab92), 0, BASE / 2, 0, g);          // plinth
    box(W, 0.06, CORRIDOR, mat(0x9a948a), 0, BASE + 0.03, 0, g);            // corridor floor

    // Board at the west end of the corridor
    const dbX = -W / 2 + 0.35;
    box(0.5, 1.2, 0.3, mat(0x7c8792, { metalness: 0.4 }), dbX - 0.15, BASE + 0.9, 0, g);
    const parts = this.boardParts(board, new THREE.Vector3(dbX, BASE + 2, 0), g, showName ? board.name : `DB · ${board.breakerA} A`);
    this.boards.set(board.id, parts);

    circuits.forEach((c, i) => {
      const row = i < cols ? 0 : 1, col = i % cols;
      const side = row === 0 ? -1 : 1;                                      // −1 north row, +1 south row
      const cx = (col - (cols - 1) / 2) * ROOM, cz = side * (CORRIDOR / 2 + ROOM / 2);
      const outerZ = cz + side * ROOM / 2, innerZ = cz - side * ROOM / 2;   // inner = corridor side
      const y = BASE + WALL_H / 2;

      // Floor glows with the circuit's status colour
      const floorMat = mat(0x262d34, { emissive: STATUS.ok, emissiveIntensity: 0.4 });
      const floorMesh = box(ROOM - WALL_T, 0.06, ROOM - WALL_T, floorMat, cx, BASE + 0.03, cz, g);

      // Walls share one material so a click fades the whole room. The corridor wall has a door gap.
      const wallMat = mat(0xece4d4, { transparent: true, opacity: 1 });
      const seg = (ROOM - DOOR) / 2;
      const walls = [
        box(ROOM, WALL_H, WALL_T, wallMat, cx, y, outerZ, g),
        box(WALL_T, WALL_H, ROOM, wallMat, cx - ROOM / 2, y, cz, g),
        box(WALL_T, WALL_H, ROOM, wallMat, cx + ROOM / 2, y, cz, g),
        box(seg, WALL_H, WALL_T, wallMat, cx - (DOOR + seg) / 2, y, innerZ, g),
        box(seg, WALL_H, WALL_T, wallMat, cx + (DOOR + seg) / 2, y, innerZ, g),
      ];

      // Status band along the wall tops, visible from outside even with the roof on
      const bandMat = new THREE.MeshBasicMaterial({ color: STATUS.ok });
      const by = BASE + WALL_H - 0.1;
      for (const z of [outerZ, innerZ]) box(ROOM + 0.04, 0.1, WALL_T + 0.06, bandMat, cx, by, z, g, false);
      for (const bx of [cx - ROOM / 2, cx + ROOM / 2]) box(WALL_T + 0.06, 0.1, ROOM, bandMat, bx, by, cz, g, false);

      // Cable: board → along the corridor in its own lane → through the door to the room centre
      const cableMat = new THREE.MeshBasicMaterial({ color: STATUS.ok });
      const lane = side * (0.16 + col * 0.11), cy = BASE + 0.1;
      box(Math.abs(cx - dbX), 0.07, 0.07, cableMat, (cx + dbX) / 2, cy, lane, g, false);
      box(0.07, 0.07, Math.abs(cz - lane), cableMat, cx, cy, (cz + lane) / 2, g, false);

      const markerY = BASE + WALL_H + MARKER_LIFT;
      const marker = tripMarker(cx, markerY, cz, g);
      const label = this.addLabel(g, c.room, new THREE.Vector3(cx, BASE + WALL_H + 0.7, cz), 'scene-label');
      const floor = board.floor ?? 0;
      this.roomBoard.set(c.id, board.id);
      label.append(document.createElement('span'));

      for (const m of [floorMesh, ...walls]) { m.userData.circuitId = c.id; m.userData.floor = floor; this.pickRooms.push(m); }
      this.rooms.set(c.id, {
        floorMat, wallMat, bandMat, cableMat, marker, markerY, label, labelObj: this.labelObjs.get(label)!, floor,
        state: { band: 'ok', overloaded: false, tripped: false, dead: false },
      });
    });

    if (withRoof) this.buildRoof(g, W, D, board.solarKw);
    return new THREE.Vector3(dbX, 0, 0);
  }

  /** Flat roof with parapet and, when solarKw > 0, tilted PV panels. Hidden by default. */
  private buildRoof(g: THREE.Group, W: number, D: number, solarKw: number): void {
    const roof = new THREE.Group();
    const roofY = BASE + WALL_H, top = roofY + 0.25, parMat = mat(0xcfc5b2);
    g.add(roof);
    this.roofs.push(roof);
    this.pickRoof.push(
      box(W + 0.5, 0.25, D + 0.5, mat(0xd9d0bf), 0, roofY + 0.125, 0, roof),
      box(W + 0.5, 0.5, 0.15, parMat, 0, top + 0.25, -(D + 0.5) / 2, roof),
      box(W + 0.5, 0.5, 0.15, parMat, 0, top + 0.25, (D + 0.5) / 2, roof),
      box(0.15, 0.5, D + 0.5, parMat, -(W + 0.5) / 2, top + 0.25, 0, roof),
      box(0.15, 0.5, D + 0.5, parMat, (W + 0.5) / 2, top + 0.25, 0, roof),
    );
    if (solarKw > 0) {
      const panelMat = new THREE.MeshStandardMaterial({ color: 0x1f3a5f, metalness: 0.5, roughness: 0.3 });
      const count = Math.max(1, Math.round(solarKw / PANEL_KW));
      const perRow = Math.max(1, Math.floor((W - 1) / 1.3));
      for (let k = 0; k < count; k++) {
        const r = Math.floor(k / perRow), inRow = Math.min(perRow, count - r * perRow), j = k % perRow;
        const z = -D / 2 + 1.9 + r * 3.0;
        if (z > D / 2 - 1.2) break; // roof is full
        const p = box(1.13, 0.05, 2.28, panelMat, (j - (inRow - 1) / 2) * 1.3, top + 0.55, z, roof);
        p.rotation.x = THREE.MathUtils.degToRad(PANEL_TILT);
        this.pickRoof.push(p);
      }
    }
    roof.visible = false;
  }

  private boardParts(board: Board, labelAt: THREE.Vector3, parent: THREE.Object3D | null, name = board.name): BoardParts {
    const host = parent ?? this.site;
    const label = this.addLabel(host, name, labelAt, 'scene-label tag');
    label.append(document.createElement('span'));
    const markerY = labelAt.y + 1.2;
    return {
      cableMat: null, marker: tripMarker(labelAt.x, markerY, labelAt.z, host), markerY, label,
      labelObj: this.labelObjs.get(label)!, floor: board.floor ?? 0, isTop: board.parent === null,
      state: { band: 'ok', overloaded: false, tripped: false, dead: false },
    };
  }

  private addLabel(parent: THREE.Object3D, text: string, at: THREE.Vector3, className: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = className;
    const name = document.createElement('b');
    name.textContent = text; // textContent: names come from the level file
    el.append(name);
    const obj = new CSS2DObject(el);
    obj.position.copy(at);
    parent.add(obj);
    this.labelObjs.set(el, obj);
    return el;
  }

  // ---------- runtime ----------

  /**
   * Supply cable from the street network, buried in the topsoil under the street. It runs from the top board
   * to the tile's front edge, where its end shows in the cut face with a label.
   */
  private buildSupplyCable(top: THREE.Vector3, tile: Rect): void {
    const mat = new THREE.MeshBasicMaterial({ color: STATUS.ok });
    const y = -CABLE_DEPTH, len = tile.maxZ - top.z + 0.05;
    const run = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, len, 10), mat);
    run.rotation.x = Math.PI / 2;
    run.position.set(top.x, y, top.z + len / 2);
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, CABLE_DEPTH + 0.3, 8), mat);
    riser.position.set(top.x, y / 2 + 0.15, top.z);
    // Duct around the cable end, so it reads as a pipe in the cut face
    const duct = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.24, 16), new THREE.MeshBasicMaterial({ color: 0x2b2b2b, side: THREE.DoubleSide }));
    duct.position.set(top.x, y, tile.maxZ + 0.06);
    this.site.add(run, riser, duct);
    const label = this.addLabel(this.site, 'Supply from the street', new THREE.Vector3(top.x, y - 0.9, tile.maxZ + 0.2), 'scene-label tag');
    this.supply = { mat, labelObj: this.labelObjs.get(label)! };
  }

  /** Stop the view from panning off the tile into empty sky. */
  private keepViewOnTile(): void {
    const t = this.controls.target;
    const r = Math.hypot(t.x, t.z);
    if (r <= this.panLimit) return;
    const k = (r - this.panLimit) / r;
    const shift = new THREE.Vector3(-t.x * k, 0, -t.z * k);
    t.add(shift);
    this.camera.position.add(shift);
  }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    const a = w / h, size = Math.max(this.span * 1.25, (this.span * 1.7) / a); // keep the whole site in view
    Object.assign(this.camera, { left: (-size * a) / 2, right: (size * a) / 2, top: size / 2, bottom: -size / 2 });
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  private frame = (): void => {
    const t = this.clock.getElapsedTime();
    this.keepViewOnTile();
    this.controls.update();
    for (const [id, rm] of this.rooms) {
      const target = this.faded.has(id) ? FADED_OPACITY : 1;
      rm.wallMat.opacity += (target - rm.wallMat.opacity) * 0.15;
      rm.wallMat.depthWrite = rm.wallMat.opacity > 0.95;
    }
    if (!this.reduceMotion) {
      this.landscape?.tick(t);
      for (const p of [...this.rooms.values(), ...this.boards.values()]) {
        if (!p.marker.visible) continue;
        p.marker.rotation.y = t * 2;
        p.marker.position.y = p.markerY + Math.sin(t * 3) * 0.15;
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  /** A click (not a drag) picks a room. A visible roof blocks the click. */
  private onPointerUp = (e: PointerEvent): void => {
    if (!this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
    const id = this.roomAt(e);
    if (id) this.onRoomClick(id);
  };

  /** Room under the pointer, ignoring hidden floors. A visible roof blocks the view. */
  private roomAt(e: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const shown = (o: THREE.Object3D) => (o.userData.floor ?? 0) <= this.floorLimit;
    const roofs = this.pickRoof.filter(o => o.parent?.visible && o.parent.parent?.visible !== false);
    const targets = [...roofs, ...this.pickRooms.filter(shown)];
    const id = ray.intersectObjects(targets, false)[0]?.object.userData.circuitId;
    return typeof id === 'string' ? id : null;
  }

  /** Hover shows a room's label in smart mode. Checked once per frame at most. */
  private onPointerMove = (e: PointerEvent): void => {
    if (e.buttons) return; // dragging the view
    if (!this.hoverQueued) requestAnimationFrame(() => {
      const ev = this.hoverQueued;
      this.hoverQueued = null;
      if (!ev) return;
      const id = this.roomAt(ev);
      this.renderer.domElement.style.cursor = id ? 'pointer' : '';
      if (id !== this.hovered) { this.hovered = id; this.refreshLabels(); }
    });
    this.hoverQueued = e;
  };

  private onPointerLeave = (): void => {
    this.hoverQueued = null;
    if (this.hovered) { this.hovered = null; this.refreshLabels(); }
  };
}

/** Rectangle centred on (x, z) with the given half sizes. */
function around(x: number, z: number, hx: number, hz: number): Rect {
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}

function villaSize(rooms: number): { W: number; D: number } {
  return { W: Math.ceil(rooms / 2) * ROOM, D: 2 * ROOM + CORRIDOR };
}

function tripMarker(x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.38), new THREE.MeshBasicMaterial({ color: STATUS.high }));
  m.position.set(x, y, z);
  m.visible = false;
  parent.add(m);
  return m;
}

function mat(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
}

function box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, shadows = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadows;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
