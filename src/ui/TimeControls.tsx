import type { DayEvent } from '../game';
import { hhmm } from './format';

interface Props {
  /** explore: free slider and play. run: replay of the scored day. result: the day has ended. */
  mode: 'explore' | 'run' | 'result';
  hour: number;
  playing: boolean;
  roofOn: boolean;
  onHour: (h: number) => void;
  onPlay: () => void;
  onRoof: () => void;
  /** Explore: reset breakers. Run: skip to the result. Not shown for result. */
  onSecondary: () => void;
  /** Run and result: what happened, marked on the time bar. */
  events?: readonly DayEvent[];
  /** Run and result: jump the replay to a marked moment. */
  onJump?: (hour: number) => void;
}

/** Play/pause, 24-hour slider with the day's events marked on it, roof toggle and one mode-specific action. */
export function TimeControls({ mode, hour, playing, roofOn, onHour, onPlay, onRoof, onSecondary, events = [], onJump }: Props) {
  const run = mode !== 'explore';
  const playLabel = playing ? 'Pause' : mode === 'run' ? 'Resume' : mode === 'result' ? 'Replay' : 'Play';
  return (
    <div className="controls">
      <button id="play" type="button" className="btn play" onClick={onPlay}>{playLabel}</button>
      <div className="slider">
        <input
          id="hour" type="range" min={0} max={24} step={0.05} value={hour} disabled={run}
          aria-label="Time of day" aria-valuetext={hhmm(hour)}
          onChange={e => onHour(Number(e.target.value))}
        />
        {run && events.length > 0 && (
          <div className="event-marks" role="group" aria-label="What happened">
            {events.map((e, i) => (
              <button
                key={i} type="button" className={`event-mark ${e.kind === 'high' ? 'warn' : 'bad'}${e.hour <= hour ? ' past' : ''}`}
                style={{ left: `${(e.hour / 24) * 100}%` }} aria-label={`${hhmm(e.hour)}: ${e.text}`} title={`${hhmm(e.hour)} · ${e.text}`}
                onClick={() => onJump?.(e.hour)}
              />
            ))}
          </div>
        )}
        <div className="ticks"><span>00</span><span>06 sunrise</span><span>12</span><span>18 sunset</span><span>24</span></div>
      </div>
      <button id="roof" type="button" className="btn" onClick={onRoof}>{roofOn ? 'Hide roof' : 'Show roof'}</button>
      {mode !== 'result' && (
        <button id="secondary" type="button" className="btn" onClick={onSecondary}>{run ? 'Skip to result' : 'Reset breakers'}</button>
      )}
    </div>
  );
}
