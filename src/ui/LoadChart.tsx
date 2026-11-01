import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dayChart, type DayRun } from '../game';
import type { Level } from '../sim';
import { fmt, hhmm } from './format';

const HEIGHT = 230;
const MIN_WIDTH = 240;
const PAD = { top: 12, right: 12, bottom: 24, left: 42 };
const HOUR_TICKS = [0, 6, 12, 18, 24];
/** How far from a trip the readout still names it, in hours. */
const MARK_REACH = 0.3;

interface Props {
  level: Level;
  day: DayRun;
  /** Time reached in the replay. The chart draws itself up to here. */
  hour: number;
}

/** Current on the busiest phase over the day, against what the supply can carry. */
export function LoadChart({ level, day, hour }: Props) {
  const chart = useMemo(() => dayChart(level, day), [level, day]);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [inspect, setInspect] = useState<number | null>(null);
  const clipId = `chart${useId().replace(/:/g, '')}`;

  // Measure before the first paint, so the chart never starts wider than its panel
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const fit = (w: number) => { if (w > 0) setWidth(Math.max(MIN_WIDTH, w)); };
    fit(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => fit(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (h: number) => PAD.left + (h / 24) * plotW;
  const y = (a: number) => PAD.top + plotH - (a / chart.maxA) * plotH;

  const { askedPath, flowPath, flowArea } = useMemo(() => {
    const line = (pick: (p: (typeof chart.points)[number]) => number) =>
      chart.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.hour).toFixed(1)} ${y(pick(p)).toFixed(1)}`).join('');
    const flow = line(p => p.flowA);
    return { askedPath: line(p => p.askedA), flowPath: flow, flowArea: `${flow}L${x(24)} ${y(0)}L${x(0)} ${y(0)}Z` };
    // x and y only change with width and the chart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, width]);

  const reached = Math.min(hour, 24);
  const marks = chart.marks.filter(m => m.hour <= reached);
  const at = inspect === null ? null : chart.points[Math.round(Math.min(inspect, reached) / chart.stepHours)];
  const near = at ? marks.filter(m => Math.abs(m.hour - at.hour) <= MARK_REACH) : [];
  const hourly = chart.points.filter(p => Number.isInteger(Math.round(p.hour * 1000) / 1000));

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setInspect(Math.min(24, Math.max(0, ((e.clientX - box.left - PAD.left) / plotW) * 24)));
  };
  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const from = inspect ?? 12;
    setInspect(Math.min(24, Math.max(0, from + (e.key === 'ArrowRight' ? 0.5 : -0.5))));
  };

  return (
    <section className="panel chart">
      <header>
        <h2>Load through the day</h2>
        <span className="legend chart-legend">
          <span><i className="key flow" />Through the main board</span>
          <span><i className="key asked" />Asked for</span>
          <span><i className="key limit" />Limit</span>
          <span><b className="trip-key">✕</b>Trip or short</span>
        </span>
      </header>
      <p className="chart-note">Amps on the busiest phase. Above a limit, that equipment heats up. A gap under “asked for” means solar is helping or rooms have lost power.</p>

      <div className="chart-plot" ref={host}>
        <svg
          width={width} height={HEIGHT} role="img" tabIndex={0}
          aria-label={`Busiest phase through the day, peaking at ${fmt(Math.max(...chart.points.map(p => p.askedA)), 0)} A asked for. The hourly table below has the same numbers.`}
          onPointerMove={onPointerMove} onPointerLeave={() => setInspect(null)} onKeyDown={onKeyDown} onBlur={() => setInspect(null)}
        >
          <defs>
            <clipPath id={clipId}><rect x={PAD.left} y={0} width={Math.max(0, x(reached) - PAD.left)} height={HEIGHT} /></clipPath>
          </defs>

          {chart.ticks.map(a => (
            <g key={a}>
              <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(a)} y2={y(a)} />
              <text className="tick" x={PAD.left - 6} y={y(a) + 3.5} textAnchor="end">{a}</text>
            </g>
          ))}
          {HOUR_TICKS.map(h => (
            <text key={h} className="tick" x={x(h)} y={HEIGHT - 7} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>{hhmm(h)}</text>
          ))}
          <text className="tick" x={4} y={y(chart.maxA) + 3.5}>A</text>

          {chart.limits.map(l => <line key={l.label} className="limit" x1={PAD.left} x2={width - PAD.right} y1={y(l.amps)} y2={y(l.amps)} />)}

          <g clipPath={`url(#${clipId})`}>
            <path className="asked-line" d={askedPath} />
            <path className="flow-area" d={flowArea} />
            <path className="flow-line" d={flowPath} />
          </g>

          {/* Over the lines so they stay readable. Limits can sit close together, so their labels start from opposite ends. */}
          {chart.limits.map((l, i) => (
            <text key={l.label} className="limit-label" x={i % 2 ? PAD.left + 4 : width - PAD.right - 4} y={y(l.amps) - 4} textAnchor={i % 2 ? 'start' : 'end'}>
              {l.label} {fmt(l.amps, 0)} A
            </text>
          ))}

          {marks.map((m, i) => (
            <g key={i}>
              <title>{hhmm(m.hour)} {m.text}</title>
              <line className="mark-line" x1={x(m.hour)} x2={x(m.hour)} y1={PAD.top + 8} y2={y(0)} />
              <text className="mark" x={x(m.hour)} y={PAD.top + 6} textAnchor="middle">✕</text>
            </g>
          ))}

          {at && <line className="crosshair" x1={x(at.hour)} x2={x(at.hour)} y1={PAD.top} y2={y(0)} />}
        </svg>

        {at && (
          <div className={`chart-tip${at.hour > 12 ? ' left' : ''}`} style={{ left: x(at.hour) }}>
            <time>{hhmm(at.hour)}</time>
            <p><i className="key flow" /><b>{fmt(at.flowA, 0)} A</b> through the main board</p>
            <p><i className="key asked" /><b>{fmt(at.askedA, 0)} A</b> asked for</p>
            {near.map((m, i) => <p key={i} className="tip-mark">✕ {m.text}</p>)}
          </div>
        )}
      </div>

      <details className="chart-table">
        <summary>Show the numbers by hour</summary>
        <table>
          <thead><tr><th scope="col">Time</th><th scope="col">Through the main board</th><th scope="col">Asked for</th></tr></thead>
          <tbody>
            {hourly.map(p => <tr key={p.hour}><td>{hhmm(p.hour)}</td><td>{fmt(p.flowA, 0)} A</td><td>{fmt(p.askedA, 0)} A</td></tr>)}
          </tbody>
        </table>
      </details>
    </section>
  );
}
