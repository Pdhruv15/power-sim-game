import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { SimResult, VillaData } from '../sim';
import { skyColor, STATUS, statusColor } from './colors';

// Plan dimensions in metres. Rooms sit in two rows either side of a corridor, one room per circuit.
const ROOM = 4.4, WALL_H = 2.8, WALL_T = 0.14, CORRIDOR = 1.4, DOOR = 1.0, BASE = 0.2;
const PANEL_KW = 0.55;           // one PV panel
const PANEL_TILT = 20;           // degrees
const FADED_OPACITY = 0.12;
const MARKER_Y = BASE + WALL_H + 1.7;

interface RoomParts {
  floorMat: THREE.MeshStandardMaterial;
  wallMat: THREE.MeshStandardMaterial;
  bandMat: THREE.MeshBasicMaterial;
  cableMat: THREE.MeshBasicMaterial;
  marker: THREE.Mesh;
  label: HTMLDivElement;
}

/**
 * Low-poly isometric villa. Reads SimResult values only; it never changes the simulation.
 * The host page owns the clock and calls update() with each new result.
 */
export class VillaScene {
  /** Called when the player clicks a room (not a drag). */
  onRoomClick: (circuitId: string) => void = () => {};

  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private labels = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  private controls: OrbitControls;
  private hemi = new THREE.HemisphereLight(0xdfe9f5, 0x8a7350, 1);
  private sunLight = new THREE.DirectionalLight(0xfff1dc, 2.5);
  private sunDisc = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  private villa = new THREE.Group();
  private roof = new THREE.Group();
  private rooms = new Map<string, RoomParts>();
  private pickRooms: THREE.Object3D[] = [];
  private pickRoof: THREE.Object3D[] = [];
  private faded = new Set<string>();
  private clock = new THREE.Clock();
  private resizeObserver: ResizeObserver;
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private down: { x: number; y: number } | null = null;

  constructor(private host: HTMLElement, data: VillaData) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.labels.domElement.className = 'scene-labels';
    host.append(this.renderer.domElement, this.labels.domElement);

    // Isometric-style orthographic camera; OrbitControls gives rotate, zoom and pan.
    this.camera.position.set(24, 22, 26);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47; // stay above ground
    this.controls.minZoom = 0.6;
    this.controls.maxZoom = 4;

    this.buildEnvironment();
    this.buildVilla(data);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    this.renderer.setAnimationLoop(this.frame);
  }

  /** Apply a simulation result: sun, sky, lights and each room's status colours. */
  update(r: SimResult): void {
    const { elevation: e, azimuth: az, height } = r.sun;
    // North = −z, east = +x
    const dir = new THREE.Vector3(Math.cos(e) * Math.sin(az), Math.sin(e), -Math.cos(e) * Math.cos(az));
    this.sunDisc.position.copy(dir).multiplyScalar(17);
    this.sunDisc.visible = e > -0.05;
    (this.sunDisc.material as THREE.MeshBasicMaterial).color.set(height < 0.3 ? 0xffa45c : 0xffe08a);
    this.sunLight.position.copy(dir).multiplyScalar(30);
    const day = THREE.MathUtils.clamp(height / 0.35, 0, 1);
    this.sunLight.intensity = 2.6 * day;
    this.hemi.intensity = 0.15 + 0.85 * day;
    this.scene.background = skyColor(height, (this.scene.background as THREE.Color) ?? new THREE.Color());

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
      rm.label.className = `scene-label st-${c.dead ? 'off' : c.band}${c.tripped || c.overloaded ? ' alarm' : ''}`;
      rm.label.lastChild!.textContent = state;
    }
  }

  setRoofVisible(visible: boolean): void {
    this.roof.visible = visible;
  }

  /** Rooms whose walls are faded so the player can see inside. */
  setFaded(ids: ReadonlySet<string>): void {
    this.faded = new Set(ids);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
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
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sunLight.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
    this.scene.add(this.hemi, fill, this.sunLight, this.sunLight.target, this.sunDisc);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0xcfbb94, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private buildVilla(data: VillaData): void {
    const cols = Math.ceil(data.circuits.length / 2);
    const W = cols * ROOM, D = 2 * ROOM + CORRIDOR;

    this.addLabel(this.scene, 'N ↑', new THREE.Vector3(0, 0, -D / 2 - 4), 'scene-label tag'); // north is world −z
    this.villa.rotation.y = -THREE.MathUtils.degToRad(data.orientation); // clockwise from north
    this.scene.add(this.villa);

    box(W + 0.6, BASE, D + 0.6, mat(0xb9ab92), 0, BASE / 2, 0, this.villa);       // plinth
    box(W, 0.06, CORRIDOR, mat(0x9a948a), 0, BASE + 0.03, 0, this.villa);         // corridor floor

    // Distribution board at the west end of the corridor
    const dbX = -W / 2 + 0.35;
    box(0.5, 1.2, 0.3, mat(0x7c8792, { metalness: 0.4 }), dbX - 0.15, BASE + 0.9, 0, this.villa);
    this.addLabel(this.villa, `DB · ${data.supply.mainBreakerA} A`, new THREE.Vector3(dbX, BASE + 2, 0), 'scene-label tag');

    data.circuits.forEach((c, i) => {
      const row = i < cols ? 0 : 1, col = i % cols;
      const side = row === 0 ? -1 : 1;                                      // −1 north row, +1 south row
      const cx = (col - (cols - 1) / 2) * ROOM, cz = side * (CORRIDOR / 2 + ROOM / 2);
      const outerZ = cz + side * ROOM / 2, innerZ = cz - side * ROOM / 2;   // inner = corridor side
      const y = BASE + WALL_H / 2;
      const g = new THREE.Group();
      this.villa.add(g);

      // Floor glows with the circuit's status colour
      const floorMat = mat(0x262d34, { emissive: STATUS.ok, emissiveIntensity: 0.4 });
      const floor = box(ROOM - WALL_T, 0.06, ROOM - WALL_T, floorMat, cx, BASE + 0.03, cz, g);

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
      for (const x of [cx - ROOM / 2, cx + ROOM / 2]) box(WALL_T + 0.06, 0.1, ROOM, bandMat, x, by, cz, g, false);

      // Cable: DB → along the corridor in its own lane → through the door to the room centre
      const cableMat = new THREE.MeshBasicMaterial({ color: STATUS.ok });
      const lane = side * (0.16 + col * 0.11), cy = BASE + 0.1;
      box(Math.abs(cx - dbX), 0.07, 0.07, cableMat, (cx + dbX) / 2, cy, lane, g, false);
      box(0.07, 0.07, Math.abs(cz - lane), cableMat, cx, cy, (cz + lane) / 2, g, false);

      // Tripped marker floats above the room
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.38), new THREE.MeshBasicMaterial({ color: STATUS.high }));
      marker.position.set(cx, MARKER_Y, cz);
      marker.visible = false;
      g.add(marker);

      const label = this.addLabel(g, c.room, new THREE.Vector3(cx, BASE + WALL_H + 0.7, cz), 'scene-label');
      label.append(document.createElement('span'));

      for (const m of [floor, ...walls]) { m.userData.circuitId = c.id; this.pickRooms.push(m); }
      this.rooms.set(c.id, { floorMat, wallMat, bandMat, cableMat, marker, label });
    });

    this.buildRoof(W, D, data.solarKw);
  }

  /** Flat roof with parapet and, when solarKw > 0, tilted PV panels. Hidden by default. */
  private buildRoof(W: number, D: number, solarKw: number): void {
    const roofY = BASE + WALL_H, top = roofY + 0.25, parMat = mat(0xcfc5b2);
    this.villa.add(this.roof);
    this.pickRoof.push(
      box(W + 0.5, 0.25, D + 0.5, mat(0xd9d0bf), 0, roofY + 0.125, 0, this.roof),
      box(W + 0.5, 0.5, 0.15, parMat, 0, top + 0.25, -(D + 0.5) / 2, this.roof),
      box(W + 0.5, 0.5, 0.15, parMat, 0, top + 0.25, (D + 0.5) / 2, this.roof),
      box(0.15, 0.5, D + 0.5, parMat, -(W + 0.5) / 2, top + 0.25, 0, this.roof),
      box(0.15, 0.5, D + 0.5, parMat, (W + 0.5) / 2, top + 0.25, 0, this.roof),
    );
    if (solarKw > 0) {
      const panelMat = new THREE.MeshStandardMaterial({ color: 0x1f3a5f, metalness: 0.5, roughness: 0.3 });
      const count = Math.max(1, Math.round(solarKw / PANEL_KW));
      const perRow = Math.max(1, Math.floor((W - 1) / 1.3));
      for (let k = 0; k < count; k++) {
        const r = Math.floor(k / perRow), inRow = Math.min(perRow, count - r * perRow), j = k % perRow;
        const z = -D / 2 + 1.9 + r * 3.0;
        if (z > D / 2 - 1.2) break; // roof is full
        const p = box(1.13, 0.05, 2.28, panelMat, (j - (inRow - 1) / 2) * 1.3, top + 0.55, z, this.roof);
        p.rotation.x = THREE.MathUtils.degToRad(PANEL_TILT);
        this.pickRoof.push(p);
      }
    }
    this.roof.visible = false;
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
    return el;
  }

  // ---------- runtime ----------

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    const a = w / h, size = Math.max(22, 30 / a); // keep the villa in view on narrow screens
    Object.assign(this.camera, { left: (-size * a) / 2, right: (size * a) / 2, top: size / 2, bottom: -size / 2 });
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  private frame = (): void => {
    const t = this.clock.getElapsedTime();
    this.controls.update();
    for (const [id, rm] of this.rooms) {
      const target = this.faded.has(id) ? FADED_OPACITY : 1;
      rm.wallMat.opacity += (target - rm.wallMat.opacity) * 0.15;
      rm.wallMat.depthWrite = rm.wallMat.opacity > 0.95;
      if (rm.marker.visible && !this.reduceMotion) {
        rm.marker.rotation.y = t * 2;
        rm.marker.position.y = MARKER_Y + Math.sin(t * 3) * 0.15;
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
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const targets = this.roof.visible ? [...this.pickRoof, ...this.pickRooms] : this.pickRooms;
    const id = ray.intersectObjects(targets, false)[0]?.object.userData.circuitId;
    if (typeof id === 'string') this.onRoomClick(id);
  };
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
