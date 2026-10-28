import * as THREE from 'three';
import { seededRandom } from './landscapeLayout';

// Sky colours: overhead, at the horizon, and below the horizon (the haze the tile floats in)
const DAY = { zenith: 0x4f8fd0, horizon: 0xcfe6f5, below: 0x9ec6e4 };
const DUSK = { zenith: 0x3a4f7a, horizon: 0xf0a070, below: 0xc98f7e };
const NIGHT = { zenith: 0x050a16, horizon: 0x16223a, below: 0x0c1424 };

const STARS = 600;
const CLOUDS = 10;
/** Clouds float above the ground (y = 0), outside the tile's edge. */
const CLOUD_MIN_Y = 4;
const CLOUD_RANGE_Y = 7;

type Stop = typeof DAY;
const mix = (a: Stop, b: Stop, t: number, key: keyof Stop, out: THREE.Color) =>
  out.set(a[key]).lerp(new THREE.Color(b[key]), t);

/**
 * Gradient sky dome all around the tile, with stars at night and a few low-poly clouds drifting past.
 * The dome follows the camera's target so the tile always sits in the middle of the sky.
 */
export class Sky {
  readonly group = new THREE.Group();
  private uniforms = {
    zenith: { value: new THREE.Color(DAY.zenith) },
    horizon: { value: new THREE.Color(DAY.horizon) },
    below: { value: new THREE.Color(DAY.below) },
  };
  private stars: THREE.Points;
  private clouds: { mesh: THREE.Group; speed: number }[] = [];

  constructor(radius: number, tileSize: number) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 zenith, horizon, below;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 c = h >= 0.0 ? mix(horizon, zenith, smoothstep(0.0, 0.55, h)) : mix(horizon, below, smoothstep(0.0, -0.35, h));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    dome.renderOrder = -1;
    this.group.add(dome);

    // Stars all round, so the floating tile sits in a starry night
    const rand = seededRandom(11);
    const pos = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
      const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = radius * 0.95;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
    this.group.add(this.stars);

    // Clouds: a few soft puffs in the sky around the tile, above ground level
    const puff = new THREE.IcosahedronGeometry(1, 1);
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.92 });
    for (let i = 0; i < CLOUDS; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(puff, cloudMat);
        m.position.set((k - n / 2) * 1.6, rand() * 0.6, (rand() - 0.5) * 1.4);
        m.scale.setScalar(1.2 + rand() * 0.9);
        g.add(m);
      }
      const a = (i / CLOUDS) * Math.PI * 2 + rand() * 0.4;
      const d = tileSize * (0.62 + rand() * 0.35);
      g.position.set(Math.cos(a) * d, CLOUD_MIN_Y + rand() * CLOUD_RANGE_Y, Math.sin(a) * d);
      g.scale.set(1.4, 0.7, 1);
      this.group.add(g);
      this.clouds.push({ mesh: g, speed: 0.15 + rand() * 0.2 });
    }
  }

  /** Sun height: 1 at noon, 0 at sunrise or sunset, below 0 at night. */
  setSunHeight(h: number): void {
    const { zenith, horizon, below } = this.uniforms;
    let a: Stop, b: Stop, t: number;
    if (h <= -0.2) { a = NIGHT; b = NIGHT; t = 0; }
    else if (h < 0.1) { a = NIGHT; b = DUSK; t = (h + 0.2) / 0.3; }
    else if (h < 0.45) { a = DUSK; b = DAY; t = (h - 0.1) / 0.35; }
    else { a = DAY; b = DAY; t = 0; }
    mix(a, b, t, 'zenith', zenith.value);
    mix(a, b, t, 'horizon', horizon.value);
    mix(a, b, t, 'below', below.value);
    (this.stars.material as THREE.PointsMaterial).opacity = THREE.MathUtils.clamp(-h * 3, 0, 0.9);
  }

  /** Drift the clouds slowly round the tile. t = seconds since start. */
  tick(dt: number): void {
    for (const c of this.clouds) {
      const p = c.mesh.position;
      const r = Math.hypot(p.x, p.z), a = Math.atan2(p.z, p.x) + (c.speed * dt) / Math.max(r, 1);
      p.set(Math.cos(a) * r, p.y, Math.sin(a) * r);
    }
  }

  /** Colour to clear the screen with if the dome is not drawn (matches the haze). */
  get haze(): THREE.Color {
    return this.uniforms.below.value;
  }
}
