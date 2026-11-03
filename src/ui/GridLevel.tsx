import { useState } from 'react';
import {
  coinsEarned, GRID_MISSIONS, gridCost, gridStarGoals, needsTransformers, STARTING_COINS, testGrid, VOLTAGE_BAND, type GridDesign, type GridHour, type GridReport,
} from '../game';
import { CONDUCTOR_IDS, CONDUCTORS, GRID_TRANSFORMER_MVA, LINE_KV, lineAmps } from '../sim';
import { fmt } from './format';
import type { LevelEntry } from './levels';
import { loadWallet, saveWallet, type Best } from './progress';

interface Props {
  entry: LevelEntry;
  picker: React.ReactNode;
  map: React.ReactNode;
  best: Best | undefined;
  onResult: (stars: number) => void;
  onNext: (() => void) | null;
}

const clock = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Transmission level: pick the line voltage, the line and the transformers, then run the city's day over them. */
export function GridLevel({ entry, picker, map, best, onResult, onNext }: Props) {
  const mission = GRID_MISSIONS[entry.id];
  const [design, setDesign] = useState<GridDesign>({ kv: mission.station.kv, conductor: 'light', lines: 1, upMva: GRID_TRANSFORMER_MVA[0], downMva: GRID_TRANSFORMER_MVA[0] });
  const [report, setReport] = useState<GridReport | null>(null);
  const [coins, setCoins] = useState(0);
  const [wallet, setWallet] = useState(() => loadWallet(STARTING_COINS));
  const set = (patch: Partial<GridDesign>) => setDesign(d => ({ ...d, ...patch }));
  const steps = needsTransformers(mission, design);
  const peak = Math.max(...mission.city.demand);
  const cost = gridCost(mission, design);
  const earnedStars = Math.max(best?.stars ?? 0, report?.stars ?? 0);
  const goals = gridStarGoals(mission);
  const locked = report !== null;

  const powerOn = () => {
    const r = testGrid(mission, design);
    const won = r.held ? coinsEarned(best?.stars ?? 0, r.stars) : 0;
    if (won > 0) {
      const next = { ...wallet, coins: wallet.coins + won };
      saveWallet(next);
      setWallet(next);
    }
    if (r.held) onResult(r.stars);
    setCoins(won);
    setReport(r);
  };
  // Show the first hour the city lost power, or else its dimmest hour if it dimmed, or else the busiest
  const shown = report && (
    report.hours.find(h => h.served < h.demand - 1e-6)
    ?? (report.lowestVoltage < 1 - VOLTAGE_BAND ? report.hours.find(h => h.voltage === report.lowestVoltage) : undefined)
    ?? report.hours.reduce((a, h) => (h.demand > a.demand ? h : a))
  );

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Level {entry.number} · {entry.title} · Transmission</p>
          <h1>Power Sim</h1>
        </div>
        <p className="proj coins-line"><b aria-label={`${wallet.coins} coins`}>{wallet.coins} coins</b></p>
      </header>
      {picker}
      {map}

      <section className="sim">
        <div className="stage-col">
          <section className="panel grid-map" aria-label="The line">
            <LineDrawing design={design} steps={steps} hour={shown ?? null} station={mission.station} lengthKm={mission.lengthKm} />
          </section>

          {report && shown && (
            <section className="panel" aria-label="The day on the line">
              <header><h2>The day on the line</h2><small className="muted">Shown above: {clock(shown.hour)}</small></header>
              <DayBars hours={report.hours} />
              <ul className="mix-legend">
                <li><i className="served" />Reached the city</li>
                <li><i className="lost" />Lost on the way</li>
                {report.hours.some(h => h.served < h.demand - 1e-6) && <li><i className="short" />No power</li>}
              </ul>
              <dl className="mix-readings">
                <div className={shown.loading.every(l => l <= 1) ? 'ok' : 'bad'}><dt>Each line, {clock(shown.hour)}</dt><dd id="reading-amps">{shown.amps.map(a => fmt(a, 0)).join(' · ')} A</dd></div>
                <div className={report.lossShare <= mission.lossTarget ? 'ok' : 'bad'}><dt>Lost on the way</dt><dd id="reading-loss">{fmt(report.lossShare * 100, 1)} %</dd></div>
                <div className={report.lowestVoltage >= 1 - VOLTAGE_BAND ? 'ok' : 'bad'}><dt>City voltage, lowest</dt><dd id="reading-voltage">{fmt(report.lowestVoltage * 100, 0)} %</dd></div>
                <div className={report.withinBudget ? 'ok' : 'bad'}><dt>Cost a day</dt><dd id="reading-cost">{fmt(report.cost, 0)} / {mission.budget}</dd></div>
              </dl>
            </section>
          )}

          <section className="panel grid-picks" aria-label="Your line">
            <div className="grid-row">
              <h3>Line voltage</h3>
              <div className="seg" role="group" aria-label="Line voltage">
                {LINE_KV.map(kv => <button key={kv} type="button" id={`kv-${kv}`} aria-pressed={design.kv === kv} disabled={locked} onClick={() => set({ kv })}>{kv} kV</button>)}
              </div>
              <small id="peak-amps">The evening's {peak} MW needs {fmt(lineAmps(peak, design.kv), 0)} A at {design.kv} kV, shared by the lines.</small>
            </div>
            <div className="grid-row">
              <h3>Line</h3>
              <div className="source-grid">
                {CONDUCTOR_IDS.map(id => {
                  const c = CONDUCTORS[id];
                  return (
                    <button
                      key={id} type="button" id={`line-${id}`} className={`load-card grid-line ${c.kind}`} aria-pressed={design.conductor === id} disabled={locked}
                      onClick={() => set({ conductor: id })} title={c.note}
                    >
                      <span><b>{c.name}</b><small>{c.amps} A · {c.ohmsPerKm} Ω/km · {c.costPerKm} cr/km</small></span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid-row">
              <h3>Lines side by side</h3>
              <div className="seg" role="group" aria-label="Lines side by side">
                {([1, 2] as const).map(n => <button key={n} type="button" id={`lines-${n}`} aria-pressed={design.lines === n} disabled={locked} onClick={() => set({ lines: n })}>{n}</button>)}
              </div>
            </div>
            <div className="grid-row">
              <h3>Transformers</h3>
              {steps ? (
                <div className="pick-fields">
                  <label>Step-up at the dam
                    <select id="up-mva" value={design.upMva} disabled={locked} onChange={e => set({ upMva: Number(e.target.value) })}>
                      {GRID_TRANSFORMER_MVA.map(v => <option key={v} value={v}>{v} MVA</option>)}
                    </select>
                  </label>
                  <label>Step-down at the city
                    <select id="down-mva" value={design.downMva} disabled={locked} onChange={e => set({ downMva: Number(e.target.value) })}>
                      {GRID_TRANSFORMER_MVA.map(v => <option key={v} value={v}>{v} MVA</option>)}
                    </select>
                  </label>
                </div>
              ) : <small>None needed: the dam already makes {mission.station.kv} kV.</small>}
            </div>
          </section>

          <div className="controls workshop-controls">
            <button type="button" id="power-on" className="btn primary power-on" disabled={locked} onClick={powerOn}>Power On</button>
            <span className="hint-now">{locked ? 'Change the line to try again.' : 'Pick a voltage, a line and the transformers, then press Power On.'}</span>
          </div>
        </div>

        <div className="side">
          {report ? (
            <aside className="panel score" aria-live="polite">
              <header>
                <h2>{report.held ? 'The city kept its power!' : 'The city went dark'}</h2>
                <span className="stars" aria-label={`${report.stars} of 3 stars`}>
                  {[1, 2, 3].map(n => <i key={n} className={n <= report.stars ? 'on' : undefined}>★</i>)}
                </span>
              </header>
              <ul className="star-goals">
                {goals.map((text, i) => {
                  const ok = [report.held, report.steady, report.withinBudget][i];
                  return <li key={text} className={ok ? 'ok' : 'bad'}><span aria-hidden="true">{ok ? '✓' : '✕'}</span> {text}</li>;
                })}
              </ul>
              {coins > 0 && <p className="coins-won">+{coins} coins</p>}
              {report.lessons.slice(0, 3).map(l => <p key={l} className="tip">{l}</p>)}
              {report.stars === 3 && <p className="tip">A good line: high voltage, little lost, and the city's lamps bright.</p>}
              <div className="actions">
                {report.held && onNext && <button type="button" className="btn primary" id="next-level" onClick={onNext}>Next level</button>}
                <button type="button" className={`btn${report.held ? '' : ' primary'}`} id="change-design" onClick={() => setReport(null)}>Change the line</button>
              </div>
            </aside>
          ) : (
            <aside className="panel mission">
              <header><h2>Mission</h2></header>
              <p className="intro">{mission.goal}</p>
              <ul className="star-goals">
                {goals.map((text, i) => <li key={text}><span className={i < earnedStars ? 'on' : undefined} aria-hidden="true">★</span> {text}</li>)}
              </ul>
              <div className={`cost${cost > mission.budget ? ' over' : ''}`}>
                <span>Cost</span>
                <b>{fmt(cost, 0)} / {mission.budget} credits a day</b>
                <span className="meter"><i style={{ width: `${Math.min(100, (cost / mission.budget) * 100)}%` }} /></span>
              </div>
            </aside>
          )}
        </div>
      </section>
    </main>
  );
}

/** The run from the dam to the city: transformers when needed, the lines with their loading, and the city lit or dark. */
function LineDrawing({ design, steps, hour, station, lengthKm }: {
  design: GridDesign; steps: boolean; hour: GridHour | null; station: { name: string; mw: number; kv: number }; lengthKm: number;
}) {
  const lit = !hour || hour.served >= hour.demand - 1e-6;
  const ys = design.lines === 1 ? [110] : [92, 128];
  const x0 = steps ? 170 : 120, x1 = steps ? 470 : 520;
  const lineState = (i: number) => (!hour ? 'idle' : hour.out[i] ? 'out' : hour.loading[i] > 0.9 ? 'hot' : 'ok');
  return (
    <svg className="line-drawing" viewBox="0 0 640 210" role="img"
      aria-label={hour ? `At ${clock(hour.hour)}: ${hour.out.map((o, i) => `line ${i + 1} ${o ? 'tripped' : `${fmt(hour.loading[i] * 100, 0)} % loaded`}`).join(', ')}. The city ${lit ? 'has power' : 'is dark'}.` : `${station.name} to the city over ${design.lines} line${design.lines > 1 ? 's' : ''} at ${design.kv} kV.`}
    >
      <circle cx="60" cy="110" r="22" className="sym" /><text x="60" y="116" className="sym-letter">G</text>
      <text x="60" y="152" className="cap">{station.name}</text><text x="60" y="168" className="sub">{station.mw} MW · {station.kv} kV</text>
      {steps && <><circle cx="122" cy="110" r="14" className="sym tx" /><circle cx="138" cy="110" r="14" className="sym tx" /><text x="130" y="148" className="sub">step-up</text></>}
      {ys.map((y, i) => (
        <g key={i} className={`hv-line ${lineState(i)}`}>
          <path d={`M${steps ? 152 : 82} 110 L${x0} ${y} L${x1} ${y} L${steps ? 488 : 548} 110`} />
          {[0.25, 0.5, 0.75].map(t => <path key={t} className="tower" d={`M${x0 + (x1 - x0) * t} ${y} l-6 18 M${x0 + (x1 - x0) * t} ${y} l6 18 M${x0 + (x1 - x0) * t - 4} ${y + 8} h8`} />)}
          <text x={(x0 + x1) / 2} y={y - 8} className="line-tag">
            {['Line A', 'Line B'][i]} · {hour ? (hour.out[i] ? 'tripped' : `${fmt(hour.loading[i] * 100, 0)} %`) : `${lengthKm} km`}
          </text>
        </g>
      ))}
      {steps && <><circle cx="502" cy="110" r="14" className="sym tx" /><circle cx="518" cy="110" r="14" className="sym tx" /><text x="510" y="148" className="sub">step-down</text></>}
      <g className={`city${lit ? ' lit' : ''}`}>
        <rect x="560" y="80" width="16" height="50" /><rect x="580" y="66" width="18" height="64" /><rect x="602" y="90" width="18" height="40" />
      </g>
      <text x="590" y="152" className="cap">City</text>
      <text x="590" y="168" className="sub">{hour ? `${fmt(hour.demand, 0)} MW · ${hour.voltage > 0 ? `${fmt(hour.voltage * 100, 0)} %` : 'dark'}` : `${design.kv} kV line`}</text>
    </svg>
  );
}

const BAR_W = 600, BAR_H = 120;

/** Each hour: what reached the city, what it went without, and what the lines lost on the way. */
function DayBars({ hours }: { hours: readonly GridHour[] }) {
  const top = Math.max(...hours.map(h => h.demand + h.lossMw)) * 1.1;
  const w = BAR_W / hours.length;
  const y = (v: number) => BAR_H - (v / top) * BAR_H;
  return (
    <svg className="mix-chart grid-bars" viewBox={`0 0 ${BAR_W} ${BAR_H + 16}`} role="img" aria-label="What reached the city each hour, and what was lost on the way">
      {hours.map((h, i) => (
        <g key={h.hour}>
          <rect className="served" x={i * w + 1} width={w - 2} y={y(h.served)} height={BAR_H - y(h.served)} />
          {h.demand > h.served && <rect className="short" x={i * w + 1} width={w - 2} y={y(h.demand)} height={y(h.served) - y(h.demand)} />}
          {h.lossMw > 0 && <rect className="lost" x={i * w + 1} width={w - 2} y={y(h.demand + h.lossMw)} height={y(h.demand) - y(h.demand + h.lossMw)} />}
        </g>
      ))}
      <line className="axis" x1="0" x2={BAR_W} y1={BAR_H} y2={BAR_H} />
      {[0, 6, 12, 18, 24].map(hr => <text key={hr} x={Math.min(BAR_W - 16, Math.max(16, hr * w))} y={BAR_H + 13} textAnchor="middle">{clock(hr)}</text>)}
    </svg>
  );
}
