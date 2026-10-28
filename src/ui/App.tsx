import { useCallback, useEffect, useMemo, useState } from 'react';
import { LevelError, parseVilla, Simulator, type VillaData } from '../sim';
import { CircuitList } from './CircuitList';
import { Kpis } from './Kpis';
import { Stage } from './Stage';
import { TimeControls } from './TimeControls';
import { useAnimationClock } from './useAnimationClock';

const LEVEL_URL = `${import.meta.env.BASE_URL}data/villa.json`;
const START_HOUR = 12;
/** Simulated hours per real second while playing. */
const HOURS_PER_SECOND = 1;

/** Loads the level file, then shows the simulator. */
export function App() {
  const [data, setData] = useState<VillaData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(LEVEL_URL)
      .then(res => {
        if (!res.ok) throw new Error(`Could not load ${LEVEL_URL} (HTTP ${res.status}).`);
        return res.json();
      })
      .then(json => live && setData(parseVilla(json)))
      .catch((e: unknown) => live && setError(e instanceof LevelError ? e.message : `Could not open the level: ${(e as Error).message}`));
    return () => { live = false; };
  }, []);

  if (error) return <main className="app"><pre className="error">{error}</pre></main>;
  if (!data) return <main className="app"><p className="muted">Loading level…</p></main>;
  return <VillaSim data={data} />;
}

function VillaSim({ data }: { data: VillaData }) {
  const sim = useMemo(() => new Simulator(data, START_HOUR), [data]);
  const [result, setResult] = useState(() => sim.result());
  const [playing, setPlaying] = useState(false);
  const [roofOn, setRoofOn] = useState(false);
  const [faded, setFaded] = useState<ReadonlySet<string>>(new Set());

  useAnimationClock(playing, dtSeconds => {
    sim.advance(dtSeconds * HOURS_PER_SECOND);
    setResult(sim.result());
  });

  const setHour = (h: number) => { sim.setHour(h); setResult(sim.result()); };
  const resetBreakers = () => { sim.resetBreakers(); setResult(sim.result()); };
  const toggleRoom = useCallback((id: string) => setFaded(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  }), []);

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Level 1 · One villa · Learn mode</p>
          <h1>Villa Power Sim</h1>
        </div>
        <p className="proj">
          <b>{data.project}</b> · {data.supply.voltage} V · main {data.supply.mainBreakerA} A · PV {data.solarKw} kWp
        </p>
      </header>

      <section className="sim">
        <div className="stage-col">
          <div className="stage-wrap">
            <Stage data={data} result={result} roofOn={roofOn} faded={faded} onRoomClick={toggleRoom} />
            <Kpis result={result} solarKwp={data.solarKw} />
            <p className="hint">Drag to rotate · scroll to zoom · right-drag to pan · click a room to see inside</p>
          </div>
          <TimeControls
            hour={result.hour} playing={playing} roofOn={roofOn}
            onHour={setHour} onPlay={() => setPlaying(p => !p)} onRoof={() => setRoofOn(r => !r)} onReset={resetBreakers}
          />
        </div>
        <CircuitList result={result} selected={faded} onSelect={toggleRoom} />
      </section>
    </main>
  );
}
