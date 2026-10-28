import type { CircuitResult, SimResult } from '../sim';
import { fmt } from './format';

const TYPE_NAME = { ac: 'AC', lighting: 'Lighting', sockets: 'Sockets' } as const;

interface Props {
  result: SimResult;
  selected: ReadonlySet<string>;
  onSelect: (id: string) => void;
}

/** Live circuit schedule. Clicking a row fades that room's walls, same as clicking the room. */
export function CircuitList({ result, selected, onSelect }: Props) {
  return (
    <aside className="circuits">
      <header>
        <h2>Circuits</h2>
        <span className="legend">
          <span className="st-ok"><i />&lt;60%</span>
          <span className="st-warn"><i />60–90%</span>
          <span className="st-high"><i />&gt;90%</span>
          <span className="st-off"><i />off</span>
        </span>
      </header>
      <ol>
        {result.circuits.map(c => (
          <li key={c.id}>
            <button
              type="button" aria-pressed={selected.has(c.id)}
              className={`row st-${c.dead ? 'off' : c.band}${c.tripped || c.overloaded ? ' alarm' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <span className="dot" />
              <span className="nm"><b>{c.id} {c.room}</b><small>{TYPE_NAME[c.type]} · {c.breakerA} A breaker</small></span>
              <span className="val"><b>{valueText(c)}</b><small>{detailText(c)}</small></span>
              <span className="bar">
                <s style={{ left: '60%' }} /><s style={{ left: '90%' }} />
                <i style={{ width: `${c.dead ? 0 : Math.min(100, c.loading * 100)}%` }} />
                {c.heat > 0 && !c.tripped && <em style={{ width: `${c.heat * 100}%` }} title="Breaker heating towards a trip" />}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="main-line">
        <span>Main breaker</span>
        <b>{result.main.tripped ? 'TRIPPED' : `${fmt(result.main.amps)} A of ${result.main.ratingA} A`}</b>
      </p>
    </aside>
  );
}

function valueText(c: CircuitResult): string {
  if (c.tripped) return 'TRIPPED';
  if (c.dead) return 'no supply';
  return `${fmt(c.amps)} A`;
}

function detailText(c: CircuitResult): string {
  if (c.tripped || c.dead) return `room wants ${fmt(c.demandA)} A`;
  if (c.overloaded) return `${fmt(c.loading * 100, 0)}% · overload, will trip`;
  return `${fmt(c.loading * 100, 0)}% · ${fmt(c.kw, 2)} kW`;
}
