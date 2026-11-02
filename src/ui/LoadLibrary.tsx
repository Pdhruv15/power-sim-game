import { useState } from 'react';
import { BREAKER_SIZES } from '../game';
import {
  INSTANT_TRIP, LOAD_LIBRARY, LOAD_TYPES, POWER_FACTOR, PROFILES, runningAmps, startAmps, tripsAtStart,
  type LoadBehaviour, type LoadGroup, type LoadType,
} from '../sim';
import { fmt } from './format';
import { loadIcon, PartIcon } from './PartIcon';

const GROUPS: readonly { id: LoadGroup | 'all'; name: string }[] = [
  { id: 'all', name: 'All' }, { id: 'home', name: 'Home' }, { id: 'building', name: 'Building' }, { id: 'public', name: 'Public' },
];
const BEHAVIOURS: Readonly<Record<LoadBehaviour, string>> = { heating: 'Heating', motor: 'Motor', electronics: 'Electronics', timed: 'Timed', mixed: 'Mixed' };

const CHART_W = 240, CHART_H = 90;

/** Current over the first seconds of a load's run, against the level its breaker opens at once. */
function StartChart({ running, start, limit }: { running: number; start: number; limit: number }) {
  const top = Math.max(start, limit) * 1.15;
  const y = (amps: number) => CHART_H - (amps / top) * CHART_H;
  const line = start > running
    ? `M0 ${CHART_H} H30 V${y(start)} H70 L90 ${y(running)} H${CHART_W}`
    : `M0 ${CHART_H} H30 V${y(running)} H${CHART_W}`;
  return (
    <svg className="start-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label={`Starts at ${fmt(start, 0)} A. The breaker opens at once from ${fmt(limit, 0)} A.`}>
      <line className="limit" x1="0" x2={CHART_W} y1={y(limit)} y2={y(limit)} />
      <path d={line} />
    </svg>
  );
}

/** Look through the loads the game knows: how each one behaves, and what it asks of its breaker. */
export function LoadLibrary({ voltage, onThisJob }: { voltage: number; onThisJob: readonly LoadType[] }) {
  const [group, setGroup] = useState<LoadGroup | 'all'>('all');
  const [picked, setPicked] = useState<LoadType>(onThisJob.find(t => LOAD_LIBRARY[t].startMultiple > 1) ?? onThisJob[0] ?? 'lighting');
  const [breakerA, setBreakerA] = useState(16);
  const info = LOAD_LIBRARY[picked];
  const running = runningAmps(info.typicalKw, picked, voltage);
  const start = startAmps(info.typicalKw, picked, voltage);
  const trips = tripsAtStart(start, breakerA);
  const tooSmall = running > breakerA;

  return (
    <section className="panel load-lib" aria-label="Load library">
      <div className="load-cards">
        <div className="seg" role="group" aria-label="Load group">
          {GROUPS.map(g => <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>{g.name}</button>)}
        </div>
        <div className="load-grid">
          {LOAD_TYPES.filter(t => group === 'all' || LOAD_LIBRARY[t].group === group).map(t => (
            <button
              key={t} id={`load-${t}`} type="button" className={`load-card ${LOAD_LIBRARY[t].behaviour}`} aria-pressed={picked === t}
              onClick={() => setPicked(t)}
            >
              <PartIcon name={loadIcon(t)} size={26} />
              <span>
                <b>{LOAD_LIBRARY[t].name}</b>
                <small>{LOAD_LIBRARY[t].typicalKw} kW · {BEHAVIOURS[LOAD_LIBRARY[t].behaviour]}</small>
                {onThisJob.includes(t) && <small className="on-job">On this job</small>}
              </span>
            </button>
          ))}
        </div>
      </div>

      <aside className="load-detail">
        <h3>{info.name}</h3>
        <p>{info.note}</p>
        <dl>
          <dt>Runs at</dt><dd>{fmt(running)} A</dd>
          <dt>Starts at</dt><dd>{info.startMultiple > 1 ? `${fmt(start, 0)} A` : 'No surge'}</dd>
          <dt>Power factor</dt><dd>{POWER_FACTOR[picked]}</dd>
        </dl>
        <label className="load-breaker">
          <span>Try a breaker</span>
          <select id="library-breaker" value={breakerA} onChange={e => setBreakerA(Number(e.target.value))}>
            {BREAKER_SIZES.map(a => <option key={a} value={a}>{a} A</option>)}
          </select>
        </label>
        <StartChart running={running} start={start} limit={breakerA * INSTANT_TRIP} />
        <p id="library-verdict" className={`verdict${trips || tooSmall ? ' bad' : ' ok'}`} role="status">
          {trips
            ? `Trips on starting: it opens at once from ${breakerA * INSTANT_TRIP} A.`
            : tooSmall ? `Overheats: it runs above ${breakerA} A.` : 'Holds, both starting and running.'}
        </p>
        <div className="load-day" role="img" aria-label="How busy this load is through the day">
          {PROFILES[picked].map((v, h) => <i key={h} style={{ height: `${Math.max(2, v * 100)}%` }} />)}
        </div>
        <small>Busy through the day, midnight to midnight</small>
      </aside>
    </section>
  );
}
