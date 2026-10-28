import { useMemo } from 'react';
import {
  BREAKER_SIZES, designCost, MAIN_BREAKER_SIZES, peakNeeds, SIZING_RULE, SOLAR_OPTIONS,
} from '../game';
import { CABLE_SIZES, cableAmps, type Circuit, type VillaData } from '../sim';
import { fmt, hhmm } from './format';

const TYPE_NAME = { ac: 'AC', lighting: 'Lighting', sockets: 'Sockets' } as const;

interface Props {
  design: VillaData;
  onChange: (next: VillaData) => void;
  onRestore: () => void;
  onRun: () => void;
}

/**
 * Design step: the player picks a breaker and cable for each room, the main breaker and the solar size.
 * Learn mode shows each room's highest current as a guide. Verdicts come after the day is run.
 */
export function DesignPanel({ design, onChange, onRestore, onRun }: Props) {
  const needs = useMemo(() => peakNeeds(design), [design]);
  const cost = designCost(design);
  const budget = design.budget ?? null;
  const over = budget !== null && cost > budget;

  const setCircuit = (id: string, patch: Partial<Circuit>) =>
    onChange({ ...design, circuits: design.circuits.map(c => (c.id === id ? { ...c, ...patch } : c)) });

  return (
    <aside className="panel design">
      <header>
        <h2>Design</h2>
        <span className="rule" title="Sizing rule">{SIZING_RULE}</span>
      </header>
      {design.intro && <p className="intro">{design.intro}</p>}

      <ol className="design-rows">
        {design.circuits.map(c => {
          const need = needs.circuits.get(c.id);
          return (
            <li key={c.id} className="design-row">
              <div className="nm">
                <b>{c.id} {c.room}</b>
                <small>{TYPE_NAME[c.type]} · {c.kw} kW · needs up to {fmt(need?.amps ?? 0)} A at {hhmm(need?.hour ?? 0)}</small>
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
                  {CABLE_SIZES.map(mm => <option key={mm} value={mm}>{mm} mm² · {cableAmps(mm)} A</option>)}
                </select>
              </label>
            </li>
          );
        })}
      </ol>

      <div className="design-supply">
        <label>
          <span>Main breaker <small>villa needs up to {fmt(needs.total.amps)} A</small></span>
          <select id="main-breaker" value={design.supply.mainBreakerA}
            onChange={e => onChange({ ...design, supply: { ...design.supply, mainBreakerA: Number(e.target.value) } })}>
            {withCurrent(MAIN_BREAKER_SIZES, design.supply.mainBreakerA).map(a => <option key={a} value={a}>{a} A</option>)}
          </select>
        </label>
        <label>
          <span>Solar on the roof</span>
          <select id="solar" value={design.solarKw} onChange={e => onChange({ ...design, solarKw: Number(e.target.value) })}>
            {withCurrent(SOLAR_OPTIONS, design.solarKw).map(k => <option key={k} value={k}>{k === 0 ? 'None' : `${k} kWp`}</option>)}
          </select>
        </label>
      </div>

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

/** Option list that also contains the current value, in case a level file uses another size. */
function withCurrent(options: readonly number[], current: number): number[] {
  return options.includes(current) ? [...options] : [...options, current].sort((a, b) => a - b);
}
