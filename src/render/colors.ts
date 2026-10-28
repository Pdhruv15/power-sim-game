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
