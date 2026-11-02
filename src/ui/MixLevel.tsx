import { useState } from 'react';
import { coinsEarned, MIN_RESERVE, MIX_MISSIONS, mixStarGoals, STARTING_COINS, testMix, type MixReport } from '../game';
import { buildCost, HZ_BAND, NOMINAL_HZ, SOURCE_LIBRARY, SOURCE_TYPES, type Mix, type MixDay, type SourceGroup, type SourceType } from '../sim';
import { fmt } from './format';
import type { LevelEntry } from './levels';
import { PartIcon, type IconName } from './PartIcon';
import { loadWallet, saveWallet, type Best } from './progress';

export const SOURCE_ICONS: Readonly<Record<SourceType, IconName>> = {
  solar: 'solar', wind: 'wind', hydro: 'hydro', battery: 'battery', diesel: 'generator',
  gas: 'generator', biomass: 'steam', coal: 'steam', geothermal: 'steam', nuclear: 'steam',
};
const GROUPS: readonly { id: SourceGroup; name: string }[] = [
  { id: 'weather', name: 'Weather' }, { id: 'demand', name: 'On demand' }, { id: 'store', name: 'Store' },
];
/** Stacking order in the chart: steady plants at the bottom, the battery on top. */
const STACK: readonly SourceType[] = ['nuclear', 'geothermal', 'coal', 'biomass', 'hydro', 'gas', 'wind', 'solar', 'diesel', 'battery'];

const mw = (v: number) => `${fmt(v, v < 10 && v % 1 !== 0 ? 1 : 0)} MW`;

interface Props {
  entry: LevelEntry;
  picker: React.ReactNode;
  map: React.ReactNode;
  best: Best | undefined;
  onResult: (stars: number) => void;
  onNext: (() => void) | null;
}

/** Power-mix level: pick sources and sizes, press Power On, and see every hour of each test day. */
export function MixLevel({ entry, picker, map, best, onResult, onNext }: Props) {
  const mission = MIX_MISSIONS[entry.id];
  const [steps, setSteps] = useState<Partial<Record<SourceType, number>>>({});
  const [report, setReport] = useState<MixReport | null>(null);
  const [shownDay, setShownDay] = useState(0);
  const [coins, setCoins] = useState(0);
  const [wallet, setWallet] = useState(() => loadWallet(STARTING_COINS));
  const offers = new Map(mission.offers.map(o => [o.type, o]));
  const mix: Mix = Object.fromEntries(mission.offers.map(o => [o.type, (steps[o.type] ?? 0) * o.step]));
  const built = buildCost(mix);
  const earnedStars = Math.max(best?.stars ?? 0, report?.stars ?? 0);
  const goals = mixStarGoals(mission);

  const change = (t: SourceType, by: number) => {
    const o = offers.get(t)!;
    setSteps(s => ({ ...s, [t]: Math.min(o.max, Math.max(0, (s[t] ?? 0) + by)) }));
  };
  const powerOn = () => {
    const r = testMix(mission, mix);
    const won = r.held ? coinsEarned(best?.stars ?? 0, r.stars) : 0;
    if (won > 0) {
      const next = { ...wallet, coins: wallet.coins + won };
      saveWallet(next);
      setWallet(next);
    }
    if (r.held) onResult(r.stars);
    setCoins(won);
    setReport(r);
    setShownDay(r.days.findIndex(d => d.shortMwh > 0) >= 0 ? r.days.findIndex(d => d.shortMwh > 0) : 0);
  };

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Level {entry.number} · {entry.title} · Power mix</p>
          <h1>Power Sim</h1>
        </div>
        <p className="proj coins-line"><b aria-label={`${wallet.coins} coins`}>{wallet.coins} coins</b></p>
      </header>
      {picker}
      {map}

      <section className="sim">
        <div className="stage-col">
          <section className="panel sources" aria-label="Sources">
            {GROUPS.map(g => (
              <div key={g.id} className="source-group">
                <h3>{g.name}</h3>
                <div className="source-grid">
                  {SOURCE_TYPES.filter(t => SOURCE_LIBRARY[t].group === g.id).map(t => {
                    const info = SOURCE_LIBRARY[t];
                    const o = offers.get(t);
                    const n = steps[t] ?? 0;
                    return (
                      <div key={t} id={`source-${t}`} className={`source-card src-${t}${o ? '' : ' locked'}${n > 0 ? ' built' : ''}`}>
                        <span className="source-head">
                          <PartIcon name={SOURCE_ICONS[t]} size={30} />
                          <span className="source-text">
                            <b>{info.name}</b>
                            <small>{info.short}</small>
                          </span>
                        </span>
                        {o ? (
                          <span className="stepper">
                            <button type="button" id={`less-${t}`} aria-label={`Less ${info.name}`} disabled={n === 0 || report !== null} onClick={() => change(t, -1)}>−</button>
                            <output aria-label={`${info.name} size`}>{n > 0 ? mw(n * o.step) : '–'}</output>
                            <button type="button" id={`more-${t}`} aria-label={`More ${info.name}`} disabled={n >= o.max || report !== null} onClick={() => change(t, 1)}>+</button>
                          </span>
                        ) : <small className="later">Later level</small>}
                        {o && (
                          <small className="source-facts" title={info.note}>
                            {info.buildPerMw} cr/MW{info.fuelPerMwh > 0 && ` · fuel ${info.fuelPerMwh}/MWh`}{info.co2 > 0 && ` · ${info.co2} g`}
                          </small>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>

          <section className="panel mix-day" aria-label="Day on your grid">
            <header>
              <h2>{report ? 'The day on your grid' : 'Demand through the day'}</h2>
              {report && report.days.length > 1 && (
                <div className="seg" role="group" aria-label="Test day">
                  {mission.site.days.map((w, i) => (
                    <button key={w.name} type="button" id={`day-${i}`} aria-pressed={shownDay === i} onClick={() => setShownDay(i)}>
                      {w.name}{report.days[i].shortMwh > 0 ? ' ✕' : ''}
                    </button>
                  ))}
                </div>
              )}
            </header>
            <MixChart demand={mission.site.demand} day={report?.days[shownDay] ?? null} />
            {report && <Readings report={report} day={report.days[shownDay]} budget={mission.budget} />}
            {report && (
              <ul className="mix-legend">
                {STACK.filter(t => (mix[t] ?? 0) > 0).map(t => <li key={t}><i className={`src-${t}`} />{SOURCE_LIBRARY[t].name}</li>)}
                {report.days[shownDay].hours.some(h => h.charge > 1e-6) && <li><i className="charging" />Charging the battery</li>}
                <li><i className="demand" />Demand</li>
                {report.days[shownDay].shortMwh > 0 && <li><i className="short" />No power</li>}
              </ul>
            )}
          </section>

          <div className="controls workshop-controls">
            <button type="button" id="power-on" className="btn primary power-on" disabled={report !== null} onClick={powerOn}>Power On</button>
            <span className="hint-now">{report ? 'Change the mix to try again.' : 'Pick sources with + and −, then press Power On.'}</span>
            <button type="button" className="btn" disabled={report !== null} onClick={() => setSteps({})}>Clear</button>
          </div>
        </div>

        <div className="side">
          {report ? (
            <aside className="panel score" aria-live="polite">
              <header>
                <h2>{report.held ? 'The lights stayed on!' : 'The lights went out'}</h2>
                <span className="stars" aria-label={`${report.stars} of 3 stars`}>
                  {[1, 2, 3].map(n => <i key={n} className={n <= report.stars ? 'on' : undefined}>★</i>)}
                </span>
              </header>
              <ul className="star-goals">
                {goals.map((text, i) => {
                  const ok = [report.held, report.spareOk && report.withinBudget, report.clean][i];
                  return <li key={text} className={ok ? 'ok' : 'bad'}><span aria-hidden="true">{ok ? '✓' : '✕'}</span> {text}</li>;
                })}
              </ul>
              {coins > 0 && <p className="coins-won">+{coins} coins</p>}
              {report.lessons.slice(0, 3).map(l => <p key={l} className="tip">{l}</p>)}
              {report.stars === 3 && <p className="tip">A perfect mix: steady, safe, affordable and clean.</p>}
              <div className="actions">
                {report.held && onNext && <button type="button" className="btn primary" id="next-level" onClick={onNext}>Next level</button>}
                <button type="button" className={`btn${report.held ? '' : ' primary'}`} id="change-mix" onClick={() => setReport(null)}>Change the mix</button>
              </div>
            </aside>
          ) : (
            <aside className="panel mission">
              <header><h2>Mission</h2></header>
              <p className="intro">{mission.goal}</p>
              <ul className="star-goals">
                {goals.map((text, i) => (
                  <li key={text}><span className={i < earnedStars ? 'on' : undefined} aria-hidden="true">★</span> {text}</li>
                ))}
              </ul>
              <div className={`cost${built > mission.budget ? ' over' : ''}`}>
                <span>Building</span>
                <b>{fmt(built, 0)} / {mission.budget} credits a day</b>
                <span className="meter"><i style={{ width: `${Math.min(100, (built / mission.budget) * 100)}%` }} /></span>
              </div>
              <p className="muted small">Fuel is added once the day runs.</p>
            </aside>
          )}
        </div>
      </section>
    </main>
  );
}

function Readings({ report, day, budget }: { report: MixReport; day: MixDay; budget: number }) {
  const hzBad = day.lowestHz < NOMINAL_HZ - HZ_BAND || day.highestHz > NOMINAL_HZ + HZ_BAND;
  return (
    <dl className="mix-readings">
      <div className={hzBad ? 'bad' : 'ok'}><dt>Frequency</dt><dd id="reading-hz">{day.lowestHz === day.highestHz ? fmt(day.lowestHz, 1) : `${fmt(day.lowestHz, 1)}–${fmt(day.highestHz, 1)}`} Hz</dd></div>
      <div className={day.lowestReserve >= MIN_RESERVE ? 'ok' : 'bad'}><dt>Spare, lowest</dt><dd id="reading-spare">{fmt(day.lowestReserve * 100, 0)} %</dd></div>
      <div className={report.clean ? 'ok' : 'bad'}><dt>CO₂</dt><dd id="reading-co2">{fmt(report.co2, 0)} g/kWh</dd></div>
      <div className={report.withinBudget ? 'ok' : 'bad'}><dt>Cost a day</dt><dd id="reading-cost">{fmt(report.cost, 0)} / {budget}</dd></div>
    </dl>
  );
}

const CHART_W = 600, CHART_H = 200, PAD_B = 18;

/** Each hour's supply stacked by source, against the demand line. Before Power On, only the demand. */
function MixChart({ demand, day }: { demand: readonly number[]; day: MixDay | null }) {
  const top = Math.max(...demand, ...(day?.hours.map(h => STACK.reduce((s, t) => s + h.out[t], 0) + h.short) ?? [])) * 1.1;
  const colW = CHART_W / demand.length;
  const plotH = CHART_H - PAD_B;
  const y = (v: number) => plotH - (v / top) * plotH;
  const line = demand.map((d, i) => `${i === 0 ? 'M' : 'L'}${i * colW} ${y(d)} H${(i + 1) * colW}`).join(' ');
  const label = day
    ? `Supply and demand each hour. ${day.shortMwh > 0 ? `${fmt(day.shortMwh)} MWh of demand went without power.` : 'Demand was met every hour.'}`
    : `Demand each hour, from ${fmt(Math.min(...demand))} to ${fmt(Math.max(...demand))} MW.`;
  return (
    <svg className="mix-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label={label}>
      {day?.hours.map((h, i) => {
        let base = 0;
        const bars = STACK.filter(t => h.out[t] > 1e-6).map(t => {
          const r = <rect key={t} className={`src-${t}`} x={i * colW + 1} width={colW - 2} y={y(base + h.out[t])} height={y(base) - y(base + h.out[t])} />;
          base += h.out[t];
          return r;
        });
        if (h.charge > 1e-6) bars.push(<rect key="charge" className="charging" x={i * colW + 1} width={colW - 2} y={y(base)} height={y(base - h.charge) - y(base)} />);
        if (h.short > 1e-6) bars.push(<rect key="short" className="short" x={i * colW + 1} width={colW - 2} y={y(base + h.short)} height={y(base) - y(base + h.short)} />);
        return <g key={h.hour}>{bars}</g>;
      })}
      <path className="demand" d={line} />
      <line className="axis" x1="0" x2={CHART_W} y1={plotH} y2={plotH} />
      {[0, 6, 12, 18, 24].map(hr => (
        <text key={hr} x={Math.min(CHART_W - 16, Math.max(16, hr * colW))} y={CHART_H - 4} textAnchor="middle">{`${String(hr).padStart(2, '0')}:00`}</text>
      ))}
      <text className="peak" x="4" y={y(Math.max(...demand)) - 4}>{mw(Math.max(...demand))}</text>
    </svg>
  );
}
