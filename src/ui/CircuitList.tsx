import { PHASES, type BoardResult, type CircuitResult, type SimResult, type TransformerResult } from '../sim';
import { fmt } from './format';

const TYPE_NAME = { ac: 'AC', lighting: 'Lighting', sockets: 'Sockets', shop: 'Shop', school: 'School' } as const;

interface Props {
  result: SimResult;
  selected: ReadonlySet<string>;
  onSelect: (id: string) => void;
}

/**
 * Live schedule, grouped by board when there is more than one. Clicking a room row fades that room's walls,
 * same as clicking the room.
 */
export function CircuitList({ result, selected, onSelect }: Props) {
  const multi = result.boards.length > 1;
  return (
    <section className="panel circuits">
      <header>
        <h2>{multi ? 'Boards and circuits' : 'Circuits'}</h2>
        <span className="legend">
          <span className="st-ok"><i />&lt;60%</span>
          <span className="st-warn"><i />60–90%</span>
          <span className="st-high"><i />&gt;90%</span>
          <span className="st-off"><i />off</span>
        </span>
      </header>
      {result.transformer && <div className="board-group"><TransformerRow t={result.transformer} /></div>}
      {result.boards.map(b => {
        const rooms = result.circuits.filter(c => c.board === b.id);
        return (
          <div key={b.id} className="board-group">
            {multi && <BoardRow b={b} />}
            {rooms.length > 0 && (
              <ol>
                {rooms.map(c => (
                  <li key={c.id}>
                    <button
                      type="button" aria-pressed={selected.has(c.id)}
                      className={`row st-${c.dead ? 'off' : c.band}${c.tripped || c.overloaded ? ' alarm' : ''}`}
                      onClick={() => onSelect(c.id)}
                    >
                      <span className="dot" />
                      <span className="nm">
                        <b>{c.id} {c.room}</b>
                        <small>{TYPE_NAME[c.type]} · {c.breakerA} A{b.phases === 3 && ` · ${c.phase}`}{c.vdPct > 0 && ` · drop ${fmt(c.vdPct)} %`}</small>
                      </span>
                      <span className="val"><b>{valueText(c)}</b><small>{detailText(c)}</small></span>
                      <LoadBar loading={c.dead ? 0 : c.loading} heat={c.tripped ? 0 : c.heat} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
      {!multi && (
        <p className="main-line">
          <span>Main breaker</span>
          <b>{result.main.tripped ? 'TRIPPED' : `${fmt(result.main.amps)} A of ${result.main.ratingA} A`}</b>
        </p>
      )}
    </section>
  );
}

function TransformerRow({ t }: { t: TransformerResult }) {
  return (
    <div className={`row board st-${t.tripped ? 'off' : t.band}${t.tripped || t.overloaded ? ' alarm' : ''}`}>
      <span className="dot" />
      <span className="nm">
        <b>{t.name}</b>
        <small>{t.kva} kVA · {fmt(t.ratedA, 0)} A per phase</small>
      </span>
      <span className="val">
        <b>{t.tripped ? 'OVERHEATED' : `${fmt(t.loading * 100, 0)}%`}</b>
        <small>{t.tripped ? '' : `${fmt(t.loadKva)} kVA`}</small>
      </span>
      <LoadBar loading={t.tripped ? 0 : t.loading} heat={t.tripped ? 0 : t.heat} />
    </div>
  );
}

function BoardRow({ b }: { b: BoardResult }) {
  const split = b.phases === 3 ? PHASES.map((p, i) => `${p} ${fmt(Math.abs(b.phaseAmps[i]), 0)}`).join(' · ') + ' A' : `${fmt(b.amps)} A`;
  return (
    <div className={`row board st-${b.dead ? 'off' : b.band}${b.tripped || b.overloaded ? ' alarm' : ''}`}>
      <span className="dot" />
      <span className="nm">
        <b>{b.name}</b>
        <small>{b.ratingA} A breaker{b.phases === 1 && b.parent !== null && ` · on ${b.phase}`}{b.vdPct > 0 && ` · drop ${fmt(b.vdPct)} %`}</small>
      </span>
      <span className="val">
        <b>{b.tripped ? 'TRIPPED' : b.dead ? 'no supply' : `${fmt(b.loading * 100, 0)}%`}</b>
        <small>{b.tripped || b.dead ? '' : split}</small>
      </span>
      <LoadBar loading={b.dead ? 0 : b.loading} heat={b.tripped ? 0 : b.heat} />
    </div>
  );
}

function LoadBar({ loading, heat }: { loading: number; heat: number }) {
  return (
    <span className="bar">
      <s style={{ left: '60%' }} /><s style={{ left: '90%' }} />
      <i style={{ width: `${Math.min(100, loading * 100)}%` }} />
      {heat > 0 && <em style={{ width: `${heat * 100}%` }} title="Breaker heating towards a trip" />}
    </span>
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
