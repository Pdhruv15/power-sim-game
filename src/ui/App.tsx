import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LabelMode } from '../render/labelRules';
import {
  BOARD_BREAKER_SIZES, BREAKER_SIZES, coinsEarned, DAY_STEP_HOURS, GRID_MISSIONS, MIX_MISSIONS, newSiteBuild, runDay, scoreDay, STARTING_COINS, type DayRun, type ScoreCard, type SiteBuild,
} from '../game';
import { LevelError, parseLevel, Simulator, topBoard, totalSolarKw, type Level } from '../sim';
import { CircuitList } from './CircuitList';
import { DesignPanel } from './DesignPanel';
import { EventLog } from './EventLog';
import { Kpis } from './Kpis';
import { LEVELS, type LevelEntry } from './levels';
import { GridLevel } from './GridLevel';
import { LoadChart } from './LoadChart';
import { MixLevel } from './MixLevel';
import { isUnlocked, loadProgress, loadWallet, saveResult, saveWallet, type Best } from './progress';
import { ScorePanel } from './ScorePanel';
import { Stage } from './Stage';
import { TimeControls } from './TimeControls';
import { SiteBuilder } from './SiteBuilder';
import { useAnimationClock } from './useAnimationClock';
import { ViewBar } from './ViewBar';
import { WorkshopLevel } from './WorkshopLevel';
import { WorldMap } from './WorldMap';

const START_HOUR = 12;
/** Simulated hours per real second: free exploring, and the scored day replay (24 h in 12 s). */
const EXPLORE_SPEED = 1;
const RUN_SPEED = 2;

/** Level picker plus the current level. */
export function App() {
  const [progress, setProgress] = useState<Record<string, Best>>(loadProgress);
  // Start on the first level still to win
  const [entry, setEntry] = useState<LevelEntry>(() => LEVELS.find(l => !progress[l.id]?.stars) ?? LEVELS[LEVELS.length - 1]);
  // The loaded level, tagged with the entry it belongs to so a level switch never shows the old one
  const [loaded, setLoaded] = useState<{ id: string; level: Level } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    if (!entry.file) return; // workshop level: nothing to load
    const url = `${import.meta.env.BASE_URL}${entry.file}`;
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

  const map = <WorldMap progress={progress} current={entry.id} onOpen={setEntry} />;

  if (!entry.file) {
    const next = LEVELS[LEVELS.indexOf(entry) + 1];
    const props = {
      entry, picker, map, best: progress[entry.id],
      onResult: (stars: number) => setProgress(saveResult(entry.id, { score: stars, stars })),
      onNext: next ? () => setEntry(next) : null,
    };
    if (GRID_MISSIONS[entry.id]) return <GridLevel key={entry.id} {...props} />;
    return MIX_MISSIONS[entry.id] ? <MixLevel key={entry.id} {...props} /> : <WorkshopLevel key={entry.id} {...props} />;
  }
  if (error) return <main className="app">{picker}<pre className="error">{error}</pre></main>;
  if (!loaded || loaded.id !== entry.id) return <main className="app">{picker}<p className="muted">Loading level…</p></main>;
  return (
    <PlayLevel
      key={entry.id} entry={entry} level={loaded.level} picker={picker} map={map}
      onResult={card => {
        const coins = coinsEarned(progress[entry.id]?.stars ?? 0, card.stars);
        if (coins > 0) {
          const wallet = loadWallet(STARTING_COINS);
          saveWallet({ ...wallet, coins: wallet.coins + coins });
        }
        setProgress(saveResult(entry.id, { score: card.total, stars: card.stars }));
        return coins;
      }}
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
  map: React.ReactNode;
  /** Saves the result and returns the coins it earned. */
  onResult: (card: ScoreCard) => number;
}

function PlayLevel({ entry, level, picker, map, onResult }: PlayProps) {
  const [design, setDesign] = useState(level);
  // Levels with a builder start from an empty plan. The installer's wiring stays available to fix instead.
  const [building, setBuilding] = useState(!!entry.buildGoal);
  const [site, setSite] = useState<SiteBuild>(() => newSiteBuild(level, BOARD_BREAKER_SIZES[0], BREAKER_SIZES[0]));
  const [coins, setCoins] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'design' });
  const [playing, setPlaying] = useState(false);
  const [roofOn, setRoofOn] = useState(false);
  const [faded, setFaded] = useState<ReadonlySet<string>>(new Set());
  const [labelMode, setLabelMode] = useState<LabelMode>('smart');
  const [floorLimit, setFloorLimit] = useState<number | null>(null);
  const floors = 1 + Math.max(0, ...level.boards.filter(b => level.circuits.some(c => c.board === b.id)).map(b => b.floor ?? 0));

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

  const startRun = (d: Level) => {
    const day = runDay(d);
    setDesign(d);
    setPhase({ kind: 'run', day, card: scoreDay(d, day) });
    setCoins(0);
    setFrame(0);
    setPlaying(true);
  };
  const finishRun = () => {
    if (phase.kind !== 'run') return;
    setPlaying(false);
    setFrame(phase.day.frames.length - 1);
    setPhase({ kind: 'score', day: phase.day, card: phase.card });
    setCoins(onResult(phase.card));
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
  /** Replay: go straight to a moment marked on the time bar, paused there. */
  const jumpTo = (h: number) => {
    if (phase.kind === 'design') return;
    setPlaying(false);
    setFrame(Math.min(phase.day.frames.length - 1, Math.round(h / DAY_STEP_HOURS)));
  };
  const toggleRoom = useCallback((id: string) => setFaded(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  }), []);

  const result = phase.kind === 'design' ? exploreResult : phase.day.frames[Math.floor(frame)];
  const layout = useLayout(design);
  const threePhase = design.boards.some(b => b.phases === 3);
  const pv = totalSolarKw(design);
  // Villas play out close in, the view they were built in. Buildings and villages keep the whole tile in view.
  const closeUp = !level.boards.some(b => (b.floor ?? 0) > 0 || b.row !== undefined);

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Level {entry.number} · {entry.title} · Learn mode</p>
          <h1>Power Sim</h1>
        </div>
        <p className="proj">
          <b>{design.project}</b> · {threePhase ? `${design.voltage}/${Math.round(design.voltage * Math.sqrt(3))} V three-phase` : `${design.voltage} V`}
          {design.transformer && ` · ${design.transformer.kva} kVA transformer`}
          {' '}· main {topBoard(design).breakerA} A{pv > 0 && ` · PV ${pv} kWp`}
          <span className="phase">{phase.kind === 'design' ? 'Design' : phase.kind === 'run' ? 'Running the day' : 'Result'}</span>
        </p>
      </header>
      {picker}
      {map}
      {entry.buildGoal && phase.kind === 'design' && (
        <div className="seg build-mode" role="group" aria-label="How to work on this level">
          <button type="button" aria-pressed={building} onClick={() => setBuilding(true)}>Build it yourself</button>
          <button type="button" aria-pressed={!building} onClick={() => { setDesign(level); setBuilding(false); }}>Fix the installer’s wiring</button>
        </div>
      )}

      {building && entry.buildGoal && phase.kind === 'design' ? (
        <SiteBuilder level={level} goal={entry.buildGoal} build={site} onChange={setSite} onPowerOn={startRun} />
      ) : (
      <section className="sim">
        <div className="stage-col">
          <div className="stage-wrap">
            <Stage
              level={layout} result={result} roofOn={roofOn} faded={faded} labelMode={labelMode} floorLimit={floorLimit}
              onRoomClick={toggleRoom} closeUp={closeUp}
            />
            <Kpis result={result} solarKwp={pv} />
            <ViewBar labelMode={labelMode} onLabelMode={setLabelMode} floors={floors} floorLimit={floorLimit} onFloorLimit={setFloorLimit} />
          </div>
          <TimeControls
            mode={phase.kind === 'design' ? 'explore' : phase.kind === 'run' ? 'run' : 'result'}
            hour={result.hour} playing={playing} roofOn={roofOn}
            onHour={setExploreHour} onPlay={() => (phase.kind === 'score' ? replay() : setPlaying(p => !p))}
            onRoof={() => setRoofOn(r => !r)}
            onSecondary={phase.kind === 'design' ? resetBreakers : finishRun}
            events={phase.kind === 'design' ? undefined : phase.day.events} onJump={jumpTo}
          />
          <p className="hint-line">Drag to rotate · scroll to zoom · right-drag to pan · point at a room for details</p>
          {phase.kind !== 'design' && <LoadChart level={design} day={phase.day} hour={result.hour} />}
          <CircuitList result={result} selected={faded} onSelect={toggleRoom} />
        </div>

        <div className="side">
          {phase.kind === 'design' && (
            <DesignPanel design={design} onChange={setDesign} onRestore={() => setDesign(level)} onRun={() => startRun(design)} />
          )}
          {phase.kind === 'run' && <EventLog events={phase.day.events} hour={result.hour} />}
          {phase.kind === 'score' && <ScorePanel card={phase.card} coins={coins} onFix={backToDesign} onReplay={replay} />}
        </div>
      </section>
      )}
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
