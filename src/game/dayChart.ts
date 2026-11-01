import { phaseIndex, topBoard, transformerRatedAmps, type Level } from '../sim';
import { DAY_STEP_HOURS, type DayRun } from './runDay';

export interface ChartPoint {
  hour: number;
  /** Busiest phase if every room with a working cable had what it wants, before any solar. */
  askedA: number;
  /** What really flowed through the main board on its busiest phase. */
  flowA: number;
}

export interface ChartLimit {
  label: string;
  amps: number;
}

export interface ChartMark {
  hour: number;
  text: string;
}

export interface DayChart {
  /** One point per frame of the day. */
  points: ChartPoint[];
  stepHours: number;
  /** What the main board's supply can carry on each phase. */
  limits: ChartLimit[];
  /** Trips and short circuits, in time order. */
  marks: ChartMark[];
  /** Top of the scale, a clean number above everything drawn. */
  maxA: number;
  /** Where to draw the amp scale, from 0 to maxA. */
  ticks: number[];
}

/** The next clean step (1, 2 or 5 × a power of ten) that splits maxA into about four parts. */
function niceStep(maxA: number): number {
  const rough = maxA / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/**
 * The day as one line chart: current on the busiest phase at the main board, against what the
 * main breaker and transformer can carry. Current is what trips things, so the chart shows it
 * directly, and a lopsided design shows up as a line far above its share.
 */
export function dayChart(level: Level, day: DayRun): DayChart {
  const phaseOf = new Map(level.circuits.map(c => [c.id, phaseIndex(level, c)]));
  const shortedAt = new Map(day.faults.map(f => [f.circuit, f.hour]));

  const points = day.frames.map((frame): ChartPoint => {
    const asked = [0, 0, 0];
    for (const c of frame.circuits) {
      const shorted = shortedAt.get(c.id);
      if (shorted === undefined || frame.hour < shorted) asked[phaseOf.get(c.id)!] += c.demandA;
    }
    return { hour: frame.hour, askedA: Math.max(...asked), flowA: frame.main.amps };
  });

  const limits: ChartLimit[] = [{ label: 'Main breaker', amps: topBoard(level).breakerA }];
  if (level.transformer) limits.push({ label: 'Transformer', amps: transformerRatedAmps(level.transformer.kva, level.voltage) });

  const marks = day.events.filter(e => e.kind !== 'high').map(e => ({ hour: e.hour, text: e.text }));

  const highest = Math.max(...points.map(p => Math.max(p.askedA, p.flowA)), ...limits.map(l => l.amps));
  const step = niceStep(highest * 1.12);
  const maxA = Math.ceil((highest * 1.12) / step) * step;
  const ticks = Array.from({ length: Math.round(maxA / step) + 1 }, (_, i) => i * step);

  return { points, stepHours: DAY_STEP_HOURS, limits, marks, maxA, ticks };
}
