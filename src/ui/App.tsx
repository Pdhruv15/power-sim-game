import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAY_STEP_HOURS, runDay, scoreDay, type DayRun, type ScoreCard } from '../game';
import { LevelError, parseLevel, Simulator, topBoard, totalSolarKw, type Level } from '../sim';
import { CircuitList } from './CircuitList';
import { DesignPanel } from './DesignPanel';
import { EventLog } from './EventLog';
import { Kpis } from './Kpis';
import { LEVELS, type LevelEntry } from './levels';
import { isUnlocked, loadProgress, saveResult, type Best } from './progress';
import { ScorePanel } from './ScorePanel';
import { Stage } from './Stage';
import { TimeControls } from './TimeControls';
import { useAnimationClock } from './useAnimationClock';

const START_HOUR = 12;
/** Simulated hours per real second: free exploring, and the scored day replay (24 h in 12 s). */
const EXPLORE_SPEED = 1;
const RUN_SPEED = 2;

/** Level picker plus the current level. */
export function App() {
  const [progress, setProgress] = useState<Record<string, Best>>(loadProgress);
  const [entry, setEntry] = useState<LevelEntry>(LEVELS[0]);
  // The loaded level, tagged with the entry it belongs to so a level switch never shows the old one
  const [loaded, setLoaded] = useState<{ id: string; level: Level } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const url = `${import.meta.env.BASE_URL}${entry.file}`;
    setError(null);
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
        return res.json();
      })
      .then(json => live && setLoaded({ id: entry.id, level: parseLevel(json) }))
      .catch((e: unknown) => live && setError(e instanceof LevelError ? e.message : `Could not open the level: ${(e as Error).message}`));
    return () => { live = false; };
  }, [entry]);

  const ids = LEVELS.map(l => l.id);
  const picker = (
    <nav className="levels" aria-label="Levels">
      {LEVELS.map((l, i) => {
        const open = isUnlocked(i, ids, progress);
        const stars = progress[l.id]?.stars ?? 0;
        return (
          <button
            key={l.id} type="button" className={`level-tab${l.id === entry.id ? ' on' : ''}`} disabled={!open}
            aria-current={l.id === entry.id ? 'page' : undefined} onClick={() => setEntry(l)}
            title={open ? undefined : `Get at least one star in Level ${l.number - 1} to open this level`}
          >
            <span>Level {l.number}</span> <b>{l.title}</b>{' '}
            <em aria-label={`${stars} of 3 stars`}>{open ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : 'locked'}</em>
          </button>
        );
      })}
    </nav>
  );

  if (error) return <main className="app">{picker}<pre className="error">{error}</pre></main>;
  if (!loaded || loaded.id !== entry.id) return <main className="app">{picker}<p className="muted">Loading level…</p></main>;
  return (
    <PlayLevel
      key={entry.id} entry={entry} level={loaded.level} picker={picker}
      onResult={card => setProgress(saveResult(entry.id, { score: card.total, stars: card.stars }))}
    />
  );
}

/**
 * One level in three phases:
 *   design  the player edits breakers, cables, phases and solar, and can explore any time of day
 *   run     the scored day replays from 00:00 to 24:00
 *   score   the score card explains what went right and wrong
 */
type Phase =
  | { kind: 'design' }
  | { kind: 'run'; day: DayRun; card: ScoreCard }
  | { kind: 'score'; day: DayRun; card: ScoreCard };

interface PlayProps {
  entry: LevelEntry;
  level: Level;
  picker: React.ReactNode;
  onResult: (card: ScoreCard) => void;
}

function PlayLevel({ entry, level, picker, onResult }: PlayProps) {
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
    onResult(phase.card);
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
  const threePhase = design.boards.some(b => b.phases === 3);
  const pv = totalSolarKw(design);

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Level {entry.number} · {entry.title} · Learn mode</p>
          <h1>Power Sim</h1>
        </div>
        <p className="proj">
          <b>{design.project}</b> · {threePhase ? `${design.voltage}/${Math.round(design.voltage * Math.sqrt(3))} V three-phase` : `${design.voltage} V`}
          {' '}· main {topBoard(design).breakerA} A{pv > 0 && ` · PV ${pv} kWp`}
          <span className="phase">{phase.kind === 'design' ? 'Design' : phase.kind === 'run' ? 'Running the day' : 'Result'}</span>
        </p>
      </header>
      {picker}

      <section className="sim">
        <div className="stage-col">
          <div className="stage-wrap">
            <Stage level={layout} result={result} roofOn={roofOn} faded={faded} onRoomClick={toggleRoom} />
            <Kpis result={result} solarKwp={pv} />
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
 * The 3D scene is rebuilt only when something it draws changes (rooms, boards, solar panels, labels),
 * not when a breaker, cable or phase choice changes.
 */
function useLayout(d: Level): Level {
  const key = JSON.stringify([
    d.circuits.map(c => [c.id, c.board, c.room]),
    d.boards.map(b => [b.id, b.parent, b.solarKw, b.parent === null ? b.breakerA : 0]),
    d.orientation,
  ]);
  const [kept, setKept] = useState({ key, d });
  if (kept.key !== key) {
    setKept({ key, d });
    return d;
  }
  return kept.d;
}
