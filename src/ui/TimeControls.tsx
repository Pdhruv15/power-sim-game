import { hhmm } from './format';

interface Props {
  hour: number;
  playing: boolean;
  roofOn: boolean;
  onHour: (h: number) => void;
  onPlay: () => void;
  onRoof: () => void;
  onReset: () => void;
}

/** Play/pause, 24-hour slider, roof toggle and breaker reset. */
export function TimeControls({ hour, playing, roofOn, onHour, onPlay, onRoof, onReset }: Props) {
  return (
    <div className="controls">
      <button id="play" type="button" className="btn play" onClick={onPlay}>{playing ? 'Pause' : 'Play'}</button>
      <div className="slider">
        <input
          id="hour" type="range" min={0} max={24} step={0.25} value={hour}
          aria-label="Time of day" aria-valuetext={hhmm(hour)}
          onChange={e => onHour(Number(e.target.value))}
        />
        <div className="ticks"><span>00</span><span>06 sunrise</span><span>12</span><span>18 sunset</span><span>24</span></div>
      </div>
      <button id="roof" type="button" className="btn" onClick={onRoof}>{roofOn ? 'Hide roof' : 'Show roof'}</button>
      <button id="reset" type="button" className="btn" onClick={onReset}>Reset breakers</button>
    </div>
  );
}
