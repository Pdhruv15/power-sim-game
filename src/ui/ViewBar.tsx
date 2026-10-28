import { LABEL_MODES, type LabelMode } from '../render/labelRules';

const MODE_NAME: Record<LabelMode, string> = { smart: 'Smart', all: 'All', off: 'Off' };

interface Props {
  labelMode: LabelMode;
  onLabelMode: (m: LabelMode) => void;
  /** Number of floors with rooms. The floor choice only shows for buildings. */
  floors: number;
  /** Highest floor shown (0 = ground), or null for all. */
  floorLimit: number | null;
  onFloorLimit: (f: number | null) => void;
}

/** View options over the 3D scene: how many labels to show, and which floors. */
export function ViewBar({ labelMode, onLabelMode, floors, floorLimit, onFloorLimit }: Props) {
  return (
    <div className="viewbar">
      <div className="seg" role="group" aria-label="Labels">
        <span>Labels</span>
        {LABEL_MODES.map(m => (
          <button key={m} type="button" aria-pressed={labelMode === m} onClick={() => onLabelMode(m)}
            title={m === 'smart' ? 'Show rooms that need attention, and the room under the pointer' : undefined}>
            {MODE_NAME[m]}
          </button>
        ))}
      </div>
      {floors > 1 && (
        <div className="seg" role="group" aria-label="Floors">
          <span>Floors</span>
          <button type="button" aria-pressed={floorLimit === null} onClick={() => onFloorLimit(null)}>All</button>
          {Array.from({ length: floors - 1 }, (_, f) => (
            <button key={f} type="button" aria-pressed={floorLimit === f} onClick={() => onFloorLimit(f)}>
              {f === 0 ? '1' : `1–${f + 1}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
