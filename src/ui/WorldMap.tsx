import { LEVELS, WORLD_MAP, type LevelEntry } from './levels';
import { isUnlocked, type Best } from './progress';

/** A box on the map's ground: x, y across the tile, w, d its footprint, h its height. */
type Box = readonly [number, number, number, number, number];

/** What stands on each step's tile, growing from one cell to a city. */
const SCENES: Readonly<Record<string, readonly Box[]>> = {
  Circuit: [[4, 4, 2, 1, 1]],
  Room: [[3, 3, 3, 3, 2]],
  Villa: [[2, 3, 5, 3, 2]],
  Street: [[1, 1, 3, 2, 2], [5, 5, 3, 2, 2]],
  Block: [[3, 3, 3, 3, 5]],
  Village: [[1, 1, 2, 2, 1.5], [5, 1, 2, 2, 1.5], [1, 5, 2, 2, 1.5], [5, 5, 2, 2, 1.5]],
  Villages: [[0, 0, 2, 2, 1.2], [3, 0, 2, 2, 1.2], [6, 3, 2, 2, 1.2], [0, 6, 2, 2, 1.2], [6, 6, 2, 2, 1.2], [3, 6, 2, 2, 1.2]],
  'Small city': [[1, 1, 2, 2, 4], [5, 1, 2, 2, 6], [3, 5, 2, 2, 5]],
  'Big city': [[0, 0, 2, 2, 6], [3, 0, 2, 2, 8], [6, 1, 2, 2, 5], [1, 4, 2, 2, 7], [5, 5, 2, 2, 9]],
  // A row of towers carrying a line across the country
  Grid: [[0.5, 0.5, 0.6, 0.6, 6], [3.5, 3.5, 0.6, 0.6, 6], [6.5, 6.5, 0.6, 0.6, 6], [7.5, 0.5, 1.2, 1.2, 1.5]],
};

const S = 4.2, OX = 34, OY = 30;
const at = (x: number, y: number, z = 0): string => `${(OX + (x - y) * 0.87 * S).toFixed(1)},${(OY + (x + y) * 0.5 * S - z * S).toFixed(1)}`;

/** A small isometric tile with the step's buildings on it. */
function Tile({ name, lit }: { name: string; lit: boolean }) {
  const boxes = [...(SCENES[name] ?? [])].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  return (
    <svg className="map-tile" viewBox="0 0 68 70" aria-hidden="true">
      <polygon className="ground" points={[at(0, 0), at(9, 0), at(9, 9), at(0, 9)].join(' ')} />
      {boxes.map(([x, y, w, d, h], i) => (
        <g key={i}>
          <polygon className="wall-l" points={[at(x, y + d), at(x + w, y + d), at(x + w, y + d, h), at(x, y + d, h)].join(' ')} />
          <polygon className="wall-r" points={[at(x + w, y), at(x + w, y + d), at(x + w, y + d, h), at(x + w, y, h)].join(' ')} />
          <polygon className="roof" points={[at(x, y, h), at(x + w, y, h), at(x + w, y + d, h), at(x, y + d, h)].join(' ')} />
        </g>
      ))}
      {lit && <circle className="glow" cx="58" cy="10" r="4" />}
    </svg>
  );
}

interface Props {
  progress: Record<string, Best>;
  current: string;
  onOpen: (entry: LevelEntry) => void;
}

/** The world the player lights up, step by step. Each step opens its level; steps still to come stay dark. */
export function WorldMap({ progress, current, onOpen }: Props) {
  const ids = LEVELS.map(l => l.id);
  return (
    <ol className="world-map" aria-label="Your world">
      {WORLD_MAP.map(step => {
        const entry = LEVELS.find(l => l.id === step.level);
        const stars = entry ? progress[entry.id]?.stars ?? 0 : 0;
        const open = !!entry && isUnlocked(LEVELS.indexOf(entry), ids, progress);
        return (
          <li key={step.name} className={stars > 0 ? 'lit' : undefined}>
            <button
              type="button" id={`map-${step.name.toLowerCase().replace(/\s+/g, '-')}`} disabled={!open} aria-current={entry?.id === current ? 'step' : undefined}
              aria-label={entry ? `${step.name}, level ${entry.number}, ${open ? `${stars} of 3 stars` : 'locked'}` : `${step.name}, still to come`}
              onClick={() => entry && onOpen(entry)}
            >
              <Tile name={step.name} lit={stars > 0} />
              <span className="map-name">{step.name}</span>
              <small aria-hidden="true">{!entry ? 'soon' : open ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : 'locked'}</small>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
