import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAY_STEP_HOURS, runDay, scoreDay, type DayRun, type ScoreCard } from '../game';
import { LevelError, parseVilla, Simulator, type VillaData } from '../sim';
import { CircuitList } from './CircuitList';
import { DesignPanel } from './DesignPanel';
import { EventLog } from './EventLog';
import { Kpis } from './Kpis';
import { ScorePanel } from './ScorePanel';
import { Stage } from './Stage';
import { TimeControls } from './TimeControls';
import { useAnimationClock } from './useAnimationClock';

const LEVEL_URL = `${import.meta.env.BASE_URL}data/villa.json`;
const START_HOUR = 12;
/** Simulated hours per real second: free exploring, and the scored day replay (24 h in 12 s). */
const EXPLORE_SPEED = 1;
const RUN_SPEED = 2;

/** Loads the level file, then starts the game. */
export function App() {
  const [level, setLevel] = useState<VillaData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(LEVEL_URL)
      .then(res => {
        if (!res.ok) throw new Error(`Could not load ${LEVEL_URL} (HTTP ${res.status}).`);
        return res.json();
      })
      .then(json => live && setLevel(parseVilla(json)))
      .catch((e: unknown) => live && setError(e instanceof LevelError ? e.message : `Could not open the level: ${(e as Error).message}`));
    return () => { live = false; };
  }, []);

  if (error) return <main className="app"><pre className="error">{error}</pre></main>;
  if (!level) return <main className="app"><p className="muted">Loading level…</p></main>;
  return <VillaLevel level={level} />;
}

/**
 * One level in three phases:
 *   design  the player edits breakers, cables, main breaker and solar, and can explore any time of day
 *   run     the scored day replays from 00:00 to 24:00
 *   score   the score card explains what went right and wrong
 */
type Phase =
  | { kind: 'design' }
  | { kind: 'run'; day: DayRun; card: ScoreCard }
  | { kind: 'score'; day: DayRun; card: ScoreCard };

function VillaLevel({ level }: { level: VillaData }) {
  const [design, setDesign] = useState(level);
  const [phase, setPhase] = useState<Phase>({ kind: 'design' });
  const [playing, setPlaying] = useState(false);
  const [roofOn, setRoofOn] = useState(false);
  const [faded, setFaded] = useState<ReadonlySet<string>>(new Set());

  // Explore: a free simulator over the current design. Rebuilt when the design changes, keeping the time.
  const exploreHour = useRef(START_HOUR);
  const explore = useMemo(() => new Simulator(design, exploreHour.current), [design]);
  const [exploreResult, setExploreResult] = useState(() => explore.result());
  useEffect(() => setExploreResult(explore.result()), [explore]);

  // Run: position in the recorded day, in frames
  const [frame, setFrame] = useState(0);

  useAnimationClock(playing, dt => {
    if (phase.kind === 'run') {
      const last = phase.day.frames.length - 1;
      const next = Math.min(last, frame + (dt * RUN_SPEED) / DAY_STEP_HOURS);
      setFrame(next);
      if (next >= last) finishRun();
    } else {
      explore.advance(dt * EXPLORE_SPEED);
      exploreHour.current = explore.hour;
      setExploreResult(explore.result());
    }
  });

  const startRun = () => {
    const day = runDay(design);
    setPhase({ kind: 'run', day, card: scoreDay(design, day) });
    setFrame(0);
    setPlaying(true);
  };
  const finishRun = () => {
    if (phase.kind !== 'run') return;
    setPlaying(false);
    setFrame(phase.day.frames.length - 1);
    setPhase({ kind: 'score', day: phase.day, card: phase.card });
  };
  const replay = () => {
    if (phase.kind !== 'score') return;
    setPhase({ kind: 'run', day: phase.day, card: phase.card });
    setFrame(0);
    setPlaying(true);
  };
  const backToDesign = () => {
    setPhase({ kind: 'design' });
    setPlaying(false);
  };

  const setExploreHour = (h: number) => {
    explore.setHour(h);
    exploreHour.current = explore.hour;
    setExploreResult(explore.result());
  };
  const resetBreakers = () => { explore.resetBreakers(); setExploreResult(explore.result()); };
  const toggleRoom = useCallback((id: string) => setFaded(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  }), []);

  const result = phase.kind === 'design' ? exploreResult : phase.day.frames[Math.floor(frame)];
  const layout = useLayout(design);

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Level 1 · One villa · Learn mode</p>
          <h1>Villa Power Sim</h1>
        </div>
        <p className="proj">
          <b>{design.project}</b> · {design.supply.voltage} V · main {design.supply.mainBreakerA} A · PV {design.solarKw} kWp
          <span className="phase">{phase.kind === 'design' ? 'Design' : phase.kind === 'run' ? 'Running the day' : 'Result'}</span>
        </p>
      </header>

      <section className="sim">
        <div className="stage-col">
          <div className="stage-wrap">
            <Stage data={layout} result={result} roofOn={roofOn} faded={faded} onRoomClick={toggleRoom} />
            <Kpis result={result} solarKwp={design.solarKw} />
            <p className="hint">Drag to rotate · scroll to zoom · right-drag to pan · click a room to see inside</p>
          </div>
          <TimeControls
            mode={phase.kind === 'design' ? 'explore' : phase.kind === 'run' ? 'run' : 'result'}
            hour={result.hour} playing={playing} roofOn={roofOn}
            onHour={setExploreHour} onPlay={() => (phase.kind === 'score' ? replay() : setPlaying(p => !p))}
            onRoof={() => setRoofOn(r => !r)}
            onSecondary={phase.kind === 'design' ? resetBreakers : finishRun}
          />
          <CircuitList result={result} selected={faded} onSelect={toggleRoom} />
        </div>

        <div className="side">
          {phase.kind === 'design' && (
            <DesignPanel design={design} onChange={setDesign} onRestore={() => setDesign(level)} onRun={startRun} />
          )}
          {phase.kind === 'run' && <EventLog events={phase.day.events} hour={result.hour} />}
          {phase.kind === 'score' && <ScorePanel card={phase.card} onFix={backToDesign} onReplay={replay} />}
        </div>
      </section>
    </main>
  );
}

/**
 * The 3D scene is rebuilt only when something it draws changes (rooms, solar panels, main breaker label),
 * not when a breaker or cable choice changes.
 */
function useLayout(d: VillaData): VillaData {
  const key = JSON.stringify([d.circuits.map(c => [c.id, c.room]), d.solarKw, d.supply.mainBreakerA, d.orientation]);
  const [kept, setKept] = useState({ key, d });
  if (kept.key !== key) {
    setKept({ key, d });
    return d;
  }
  return kept.d;
}
