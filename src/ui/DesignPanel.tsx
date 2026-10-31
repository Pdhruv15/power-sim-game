import { useMemo } from 'react';
import {
  BOARD_BREAKER_SIZES, BREAKER_SIZES, connectedKva, DEFAULT_POINTS, designCost, peakNeeds, SIZING_RULE, SOLAR_OPTIONS, TRANSFORMER_SIZES, type PeakNeed,
} from '../game';
import {
  BOARD_INSTANT_TRIP, CABLE_SIZES, cableAmps, INSTANT_TRIP, PHASES, Simulator, topBoard, transformerRatedAmps, type Board, type Circuit, type Level, type Phase,
} from '../sim';
import { fmt, hhmm } from './format';

const TYPE_NAME = { ac: 'AC', lighting: 'Lighting', sockets: 'Sockets', shop: 'Shop', school: 'School' } as const;

interface Props {
  design: Level;
  onChange: (next: Level) => void;
  onRestore: () => void;
  onRun: () => void;
}

/**
 * Design step, one section per board: the board's breaker (and feeder cable), then its rooms' breakers,
 * cables and phases. Learn mode shows the highest currents as a guide. Verdicts come after the day is run.
 */
export function DesignPanel({ design, onChange, onRestore, onRun }: Props) {
  const needs = useMemo(() => peakNeeds(design), [design]);
  // Learn mode for levels with a short circuit: the current that will flow at each faulty room
  const faultAmps = useMemo(() => {
    const sim = new Simulator(design);
    return new Map(design.faults.map(f => [f.circuit, sim.faultAmps(f.circuit)]));
  }, [design]);
  const hasFaults = design.faults.length > 0;
  const parentOf = (b: Board) => design.boards.find(x => x.id === b.parent);
  const cost = designCost(design);
  const budget = design.budget ?? null;
  const over = budget !== null && cost > budget;
  const solarScored = ((design.points ?? DEFAULT_POINTS).solar ?? 0) > 0;
  const hasPhases = design.boards.some(b => b.phases === 3);
  const tx = design.transformer;

  const setCircuit = (id: string, patch: Partial<Circuit>) =>
    onChange({ ...design, circuits: design.circuits.map(c => (c.id === id ? { ...c, ...patch } : c)) });
  const setBoard = (id: string, patch: Partial<Board>) =>
    onChange({ ...design, boards: design.boards.map(b => (b.id === id ? { ...b, ...patch } : b)) });

  return (
    <aside className="panel design">
      <header>
        <h2>Design</h2>
        <span className="rule" title="Sizing rule">{SIZING_RULE}</span>
      </header>
      {design.intro && <p className="intro">{design.intro}</p>}

      {tx && (
        <section className="board-block">
          <div className="board-head">
            <div className="nm">
              <b>{tx.name}</b>
              <small>Every room at once: {fmt(connectedKva(design), 0)} kVA · busiest moment: {fmt(needs.total.kva, 0)} kVA at {hhmm(needs.total.hour)}</small>
              <small>Busiest phase: {fmt((needs.boards.get(topBoard(design).id)!.amps / transformerRatedAmps(tx.kva, design.voltage)) * 100, 0)} % of this size</small>
            </div>
            <label>
              <span>Size</span>
              <select id="tx-kva" value={tx.kva} onChange={e => onChange({ ...design, transformer: { ...tx, kva: Number(e.target.value) } })}>
                {withCurrent(TRANSFORMER_SIZES, tx.kva).map(k => <option key={k} value={k}>{k} kVA</option>)}
              </select>
            </label>
          </div>
        </section>
      )}

      {boardsTopDown(design).map(b => {
        const rooms = design.circuits.filter(c => c.board === b.id);
        const isTop = b.parent === null;
        const need = needs.boards.get(b.id);
        return (
          <section key={b.id} className="board-block">
            <div className="board-head">
              <div className="nm">
                <b>{isTop && design.boards.length === 1 ? 'Main breaker' : b.name}</b>
                <small>
                  {boardNeedText(b, need)}
                  {hasFaults && ` · trips at once from ${b.breakerA * BOARD_INSTANT_TRIP} A`}
                </small>
              </div>
              <label>
                <span>{isTop ? 'Main breaker' : 'Feeder breaker'}</span>
                <select id={`brk-${b.id}`} value={b.breakerA} onChange={e => setBoard(b.id, { breakerA: Number(e.target.value) })}>
                  {withCurrent(BOARD_BREAKER_SIZES, b.breakerA).map(a => <option key={a} value={a}>{a} A</option>)}
                </select>
              </label>
              {b.cable && (
                <label>
                  <span>Feeder cable · {b.cable.lengthM} m</span>
                  <select id={`cab-${b.id}`} value={b.cable.mm2} onChange={e => setBoard(b.id, { cable: { ...b.cable!, mm2: Number(e.target.value) } })}>
                    {CABLE_SIZES.map(mm => <option key={mm} value={mm}>{mm} mm² · {cableAmps(mm)} A</option>)}
                  </select>
                </label>
              )}
              {b.phases === 1 && parentOf(b)?.phases === 3 && (
                <label>
                  <span>Phase</span>
                  <select id={`ph-${b.id}`} value={b.phase} onChange={e => setBoard(b.id, { phase: e.target.value as Phase })}>
                    {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
              )}
              {solarScored && rooms.length > 0 && (
                <label>
                  <span>Solar on the roof</span>
                  <select id={`solar-${b.id}`} value={b.solarKw} onChange={e => setBoard(b.id, { solarKw: Number(e.target.value) })}>
                    {withCurrent(SOLAR_OPTIONS, b.solarKw).map(k => <option key={k} value={k}>{k === 0 ? 'None' : `${k} kWp`}</option>)}
                  </select>
                </label>
              )}
            </div>

            {rooms.length > 0 && (
              <ol className="design-rows">
                {rooms.map(c => {
                  const n = needs.circuits.get(c.id);
                  return (
                    <li key={c.id} className={`design-row${b.phases === 3 ? ' three' : ''}`}>
                      <div className="nm">
                        <b>{c.id} {c.room}</b>
                        <small>
                          {TYPE_NAME[c.type]} · {c.kw} kW{c.lengthM > 0 && ` · ${c.lengthM} m`} · needs up to {fmt(n?.amps ?? 0)} A at {hhmm(n?.hour ?? 0)}
                        </small>
                        {faultAmps.has(c.id) && (
                          <small className="fault-hint">
                            Short circuit here at {hhmm(design.faults.find(f => f.circuit === c.id)!.hour)}: about {fmt(faultAmps.get(c.id)!, 0)} A.
                            {' '}This breaker trips at once from {c.breakerA * INSTANT_TRIP} A.
                          </small>
                        )}
                      </div>
                      <label>
                        <span>Breaker</span>
                        <select id={`brk-${c.id}`} value={c.breakerA} onChange={e => setCircuit(c.id, { breakerA: Number(e.target.value) })}>
                          {withCurrent(BREAKER_SIZES, c.breakerA).map(a => <option key={a} value={a}>{a} A</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Cable</span>
                        <select id={`cab-${c.id}`} value={c.cableMm2} onChange={e => setCircuit(c.id, { cableMm2: Number(e.target.value) })}>
                          {CABLE_SIZES.filter(mm => mm <= 10).map(mm => <option key={mm} value={mm}>{mm} mm² · {cableAmps(mm)} A</option>)}
                        </select>
                      </label>
                      {b.phases === 3 && (
                        <label>
                          <span>Phase</span>
                          <select id={`ph-${c.id}`} value={c.phase} onChange={e => setCircuit(c.id, { phase: e.target.value as Phase })}>
                            {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </label>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}

      {hasPhases && <p className="tip">Tip: spread the load so L1, L2 and L3 carry about the same current at the busiest time.</p>}
      {hasFaults && (
        <p className="tip">
          In a short circuit, a room breaker trips at once from {INSTANT_TRIP} × its rating and a board breaker from {BOARD_INSTANT_TRIP} ×.
          The room breaker should trip, and the boards above it should not.
        </p>
      )}

      <div className={`cost${over ? ' over' : ''}`}>
        <span>Cost</span>
        <b>{cost}{budget !== null && <> / {budget}</>} credits</b>
        {budget !== null && <span className="meter"><i style={{ width: `${Math.min(100, (cost / budget) * 100)}%` }} /></span>}
      </div>

      <div className="actions">
        <button type="button" className="btn primary" onClick={onRun}>Run the day</button>
        <button type="button" className="btn" onClick={onRestore}>Start over</button>
      </div>
    </aside>
  );
}

function boardNeedText(b: Board, need: PeakNeed | undefined): string {
  if (!need) return '';
  if (b.phases === 1) return `needs up to ${fmt(need.amps)} A at ${hhmm(need.hour)}`;
  const split = PHASES.map((p, i) => `${p} ${fmt(need.phaseAmps?.[i] ?? 0, 0)}`).join(' · ');
  return `busiest at ${hhmm(need.hour)}: ${split} A`;
}

/** Parents before children, so the design reads from the supply down. */
function boardsTopDown(level: Level): Board[] {
  const out: Board[] = [];
  const visit = (parent: string | null) => {
    for (const b of level.boards) if (b.parent === parent) { out.push(b); visit(b.id); }
  };
  visit(null);
  return out;
}

/** Option list that also contains the current value, in case a level file uses another size. */
function withCurrent(options: readonly number[], current: number): number[] {
  return options.includes(current) ? [...options] : [...options, current].sort((a, b) => a - b);
}
