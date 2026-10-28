import * as THREE from 'three';
import type { Band } from '../sim';

/** Status colours. Keep in step with --ok / --warn / --high / --off in src/ui/styles.css. */
export const STATUS = {
  ok: new THREE.Color('#2fbf8f'),
  warn: new THREE.Color('#f0a531'),
  high: new THREE.Color('#ec5a52'),
  off: new THREE.Color('#5d6873'),
} as const;

export const statusColor = (band: Band, off: boolean): THREE.Color => (off ? STATUS.off : STATUS[band]);

/** Sky colour from sun height (1 = noon, 0 = horizon, below 0 = night): night → dusk → day. */
const NIGHT = new THREE.Color(0x0b1422), DUSK = new THREE.Color(0xd9825b), DAY = new THREE.Color(0x8ab9dc);
export function skyColor(height: number, out = new THREE.Color()): THREE.Color {
  if (height <= -0.2) return out.copy(NIGHT);
  if (height < 0.1) return out.copy(NIGHT).lerp(DUSK, (height + 0.2) / 0.3);
  if (height < 0.45) return out.copy(DUSK).lerp(DAY, (height - 0.1) / 0.35);
  return out.copy(DAY);
}
