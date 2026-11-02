import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCost, coinsEarned, HINT_PRICE, isBar, MISSIONS, PART_INFO, partEnds, powerOn, SHOP_ITEMS, STARTING_COINS, wireConductor,
  type Build, type PartKind, type PlacedPart, type PowerOnReport, type Terminal, type Wire,
} from '../game';
import { cableAmps } from '../sim';
import { fmt } from './format';
import type { LevelEntry } from './levels';
import { PartIcon, TERM_TITLES, type IconName } from './PartIcon';
import { loadWallet, saveWallet, type Best, type Wallet } from './progress';
import { trackDrag } from './trackDrag';
import { TERMINAL_ATTR, useWireDrag } from './useWireDrag';
import { draftPath, drawWires, labelSpot, routeWires, type Point, type WireEnd } from './wireRoute';

const BOARD_W = 860, BOARD_H = 440;
/** Parts sit on the board's dots, so their connections line up. */
const GRID = 20;
const PART_W = 120, PART_H = 80;
/** The distribution board's outline. Loads go to the right of it. */
const DB_BOX = { left: 180, top: 20, width: 380, height: 400 };
const LOADS_MIN_X = DB_BOX.left + DB_BOX.width + 2 * GRID;
const STEP_MS = 1500;
const PART_ICONS: Readonly<Record<PartKind, IconName>> = {
  battery: 'battery', supply: 'supply', switch: 'switch', breaker: 'breaker', lamp: 'lamp', light: 'lamp', socket: 'socket', lbar: 'busbar', nbar: 'busbar', ebar: 'busbar', mainswitch: 'isolator',
};
/** Where each part goes when added with a click: laid out in the order the power flows. */
const LAYOUTS: Readonly<Record<string, Partial<Record<PartKind, readonly (readonly [number, number])[]>>>> = {
  'level-circuit': { battery: [[20, 160]], switch: [[300, 140]], lamp: [[580, 140]] },
  'level-room': { light: [[640, 60]], socket: [[640, 240]] },
};
/** Where a part goes when it is added with a click instead of dragged. */
const SLOTS = [[20, 40], [360, 40], [700, 40], [20, 320], [360, 320], [700, 320], [360, 180], [20, 180], [700, 180]] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sizeOf = (k: PartKind) => {
  if (k === 'lbar') return { w: 220, h: 14 };
  if (isBar(k)) return { w: 300, h: 14 };
  if (k === 'breaker' || k === 'mainswitch') return { w: 80, h: PART_H };
  return { w: PART_W, h: PART_H };
};
/** Nearest free spot on the grid that keeps the part on the board, with room for a wire to leave it. */
const gridSpot = (k: PartKind, x: number, y: number, minX: number) => ({
  x: clamp(Math.round(x / GRID) * GRID, minX, BOARD_W - sizeOf(k).w - GRID),
  y: clamp(Math.round(y / GRID) * GRID, 0, BOARD_H - sizeOf(k).h),
});

interface Props {
  entry: LevelEntry;
  picker: React.ReactNode;
  map: React.ReactNode;
  best: Best | undefined;
  onResult: (stars: number) => void;
  onNext: (() => void) | null;
}

interface Run {
  report: PowerOnReport;
  /** Steps shown so far. */
  shown: number;
  done: boolean;
  coins: number;
}

/** Workshop level: place parts, wire them, press Power On, earn stars and coins. Nothing runs while building. */
export function WorkshopLevel({ entry, picker, map, best, onResult, onNext }: Props) {
  const mission = MISSIONS[entry.id];
  const [build, setBuild] = useState<Build>(mission.start);
  const hasBoard = mission.start.parts.length > 0;
  const minX = hasBoard ? LOADS_MIN_X : GRID;
  const [cable, setCable] = useState(mission.cables[mission.cables.length - 1]);
  const [pending, setPending] = useState<Terminal | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [wallet, setWallet] = useState<Wallet>(() => loadWallet(STARTING_COINS));
  const [ghost, setGhost] = useState<{ kind: PartKind; x: number; y: number } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const dragged = useRef(false);
  const testing = run !== null && !run.done;
  const locked = run !== null;
  const lastStep = run && run.shown > 0 ? run.report.steps[run.shown - 1] : null;

  const changeWallet = (next: Wallet) => { setWallet(next); saveWallet(next); };

  const addPart = useCallback((kind: PartKind, x?: number, y?: number) => {
    const id = `${kind}${nextId.current++}`;
    setBuild(b => {
      const taken = (sx: number, sy: number) => b.parts.some(p => Math.abs(p.x - sx) < sizeOf(p.kind).w && Math.abs(p.y - sy) < sizeOf(p.kind).h);
      const free = LAYOUTS[mission.id]?.[kind]?.find(([sx, sy]) => !taken(sx, sy)) ?? SLOTS.find(([sx, sy]) => !taken(sx, sy)) ?? SLOTS[0];
      const part: PlacedPart = {
        id, kind, ...gridSpot(kind, x ?? free[0], y ?? free[1], minX),
        ...(kind === 'breaker' && { breakerA: mission.breakers[0] }),
      };
      return { ...b, parts: [...b.parts, part] };
    });
  }, [mission.breakers, mission.id, minX]);

  const removeSelected = () => {
    if (!selected) return;
    setBuild(b => ({
      parts: b.parts.filter(p => p.id !== selected),
      wires: b.wires.filter(w => w.id !== selected && !w.from.startsWith(`${selected}.`) && !w.to.startsWith(`${selected}.`)),
    }));
    setSelected(null);
  };

  const connect = (from: Terminal, to: Terminal) => {
    const id = `wire${nextId.current++}`;
    setPending(null);
    setBuild(b => (b.wires.some(w => (w.from === from && w.to === to) || (w.from === to && w.to === from))
      ? b
      : { ...b, wires: [...b.wires, { id, from, to, mm2: cable }] }));
  };
  const { preview, startWireDrag, endedDrag } = useWireDrag(board, connect);

  const clickTerminal = (t: Terminal) => {
    if (locked || endedDrag()) return;
    if (pending === null) { setPending(t); return; }
    if (pending === t) setPending(null);
    else connect(pending, t);
  };

  const pickCable = (mm2: number) => {
    setCable(mm2);
    setBuild(b => (b.wires.some(w => w.id === selected) ? { ...b, wires: b.wires.map(w => (w.id === selected ? { ...w, mm2 } : w)) } : b));
  };

  const finish = useCallback(() => {
    setRun(r => (r ? { ...r, shown: r.report.steps.length, done: true } : r));
  }, []);

  const pressPowerOn = () => {
    const report = powerOn(mission, build);
    const coins = report.held ? coinsEarned(best?.stars ?? 0, report.stars) : 0;
    if (report.held) onResult(report.stars);
    if (coins > 0) changeWallet({ ...wallet, coins: wallet.coins + coins });
    setPending(null);
    setSelected(null);
    const instant = report.steps.length === 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setRun({ report, coins, shown: instant ? report.steps.length : 1, done: !!instant });
  };

  // Play the test one step at a time
  useEffect(() => {
    if (!run || run.done) return;
    const id = setTimeout(() => {
      setRun(r => {
        if (!r) return r;
        return r.shown >= r.report.steps.length ? { ...r, done: true } : { ...r, shown: r.shown + 1 };
      });
    }, STEP_MS);
    return () => clearTimeout(id);
  }, [run]);

  const startDragFromTray = (e: React.PointerEvent, kind: PartKind) => {
    dragged.current = false;
    trackDrag(e, (x, y) => { dragged.current = true; setGhost({ kind, x, y }); }, (x, y, moved) => {
      setGhost(null);
      const box = board.current?.getBoundingClientRect();
      if (!moved || !box) return;
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        addPart(kind, x - box.left - sizeOf(kind).w / 2, y - box.top - sizeOf(kind).h / 2);
      }
    });
  };

  const movePart = (id: string, x: number, y: number) =>
    setBuild(b => ({ ...b, parts: b.parts.map(p => (p.id === id ? { ...p, ...gridSpot(p.kind, x, y, minX) } : p)) }));

  const startMovePart = (e: React.PointerEvent, p: PlacedPart) => {
    if (locked || p.fixed) return;
    setSelected(p.id);
    const x0 = e.clientX - p.x, y0 = e.clientY - p.y;
    const move = (ev: PointerEvent) => movePart(p.id, ev.clientX - x0, ev.clientY - y0);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onPartKey = (e: React.KeyboardEvent, p: PlacedPart) => {
    if (locked || p.fixed) return;
    const step: Record<string, [number, number]> = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] };
    if (step[e.key]) {
      e.preventDefault();
      movePart(p.id, p.x + step[e.key][0], p.y + step[e.key][1]);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setSelected(p.id);
      setBuild(b => ({
        parts: b.parts.filter(q => q.id !== p.id),
        wires: b.wires.filter(w => !w.from.startsWith(`${p.id}.`) && !w.to.startsWith(`${p.id}.`)),
      }));
      setSelected(null);
    }
  };

  const hintId = `hint:${mission.id}`;
  const hasHint = wallet.owned.includes(hintId);
  const buy = (id: string, price: number) => changeWallet({ coins: wallet.coins - price, owned: [...wallet.owned, id] });
  // The first level teaches wiring with the numbers on show
  const showGuide = mission.kind === 'circuit';
  const noWiresYet = !build.wires.some(w => !w.fixed);
  const { routes, drawing, conductors } = useMemo(() => {
    const boxes = build.parts.map(p => ({
      left: p.x, right: p.x + sizeOf(p.kind).w, top: p.y, bottom: p.y + sizeOf(p.kind).h,
      pads: partEnds(p.kind).map(end => terminalAt(build.parts, `${p.id}.${end}`)!),
    }));
    const jobs = build.wires.flatMap(w => {
      const a = terminalAt(build.parts, w.from), b = terminalAt(build.parts, w.to);
      return a && b ? [{ id: w.id, from: w.from, to: w.to, a, b }] : [];
    });
    const routed = routeWires(jobs, BOARD_W, BOARD_H, boxes);
    return {
      routes: routed,
      drawing: drawWires(jobs, routed),
      conductors: new Map(build.wires.map(w => [w.id, wireConductor(build, w)])),
    };
  }, [build]);

  const cost = buildCost(mission, build);
  const overBudget = mission.budget !== null && cost > mission.budget;
  const earnedStars = Math.max(best?.stars ?? 0, run?.done ? run.report.stars : 0);

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="eyebrow">Level {entry.number} · {entry.title} · Workshop</p>
          <h1>Power Sim</h1>
        </div>
        <p className="proj coins-line"><b aria-label={`${wallet.coins} coins`}>{wallet.coins} coins</b></p>
      </header>
      {picker}
      {map}

      <section className="sim">
        <div className="stage-col">
          <section className="panel tray" aria-label="Parts">
            <h2>Parts</h2>
            <div className="tray-items">
              {(Object.entries(mission.tray) as [PartKind, number][]).map(([kind, max]) => {
                const left = max - build.parts.filter(p => p.kind === kind).length;
                return (
                  <button
                    key={kind} id={`tray-${kind}`} type="button" className="tray-item" disabled={left <= 0 || locked}
                    onPointerDown={e => startDragFromTray(e, kind)}
                    onClick={() => { if (!dragged.current) addPart(kind); dragged.current = false; }}
                  >
                    <PartIcon name={PART_ICONS[kind]} size={20} /> <b>{PART_INFO[kind].name}</b> <small>{left} left</small>
                  </button>
                );
              })}
            </div>
            {mission.cables.length > 1 && (
              <div className="seg cable-pick" role="group" aria-label="Cable">
                <span>Cable</span>
                {mission.cables.map(mm => (
                  <button key={mm} id={`cable-${mm}`} type="button" aria-pressed={cable === mm} disabled={locked} onClick={() => pickCable(mm)}>
                    {mm} mm² · {cableAmps(mm)} A
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="board-scroll">
            <div
              ref={board} className={`board${wallet.owned.includes('warm-lamps') ? ' warm' : ''}${wallet.owned.includes('gold-wires') ? ' gold' : ''}`}
              style={{ width: BOARD_W, height: BOARD_H }}
              onPointerDown={e => { if (e.target === e.currentTarget) { setSelected(null); setPending(null); } }}
            >
              <svg className="wires over" width={BOARD_W} height={BOARD_H} aria-hidden={build.wires.length === 0}>
                {build.wires.map(w => {
                  const points = routes.get(w.id);
                  return points && <WirePath key={w.id} wire={w} points={points} d={drawing.paths.get(w.id)!} conductor={conductors.get(w.id) ?? null} amps={lastStep?.wireAmps[w.id]} selected={selected === w.id} onSelect={() => { if (!locked && !w.fixed) setSelected(w.id); }} />;
                })}
                {drawing.dots.map(p => <circle key={`${p.x},${p.y}`} className="wire-dot" cx={p.x} cy={p.y} r={3.5} />)}
                {preview && <path className="wire-preview" d={draftPath(preview)} />}
              </svg>

              {hasBoard && <div className="db-box" style={DB_BOX}><span>Distribution board (DB)</span></div>}
              {build.parts.length === 0 && <p className="board-empty">Drag a part here, or click it to place it.</p>}
              {run?.done && lastStep?.ok && lastStep.open.length > 0 && (
                <p className="board-tip">That was the fault test: the breaker opened, as it should. In normal use it stays closed.</p>
              )}
              {build.parts.length > 0 && noWiresYet && !locked && (
                <p className="board-tip">{showGuide ? 'Drag from one circle to another with the same number.' : 'Drag from one circle to another to add a wire.'}</p>
              )}

              {build.parts.map(p => {
                const lit = lastStep?.lit.includes(p.id) ?? false;
                const open = lastStep?.open.includes(p.id) ?? false;
                const safeTrip = open && lastStep?.ok;
                const size = sizeOf(p.kind);
                const focus = run?.done && run.report.focus === p.id;
                return (
                  <div
                    key={p.id} id={`part-${p.id}`} role="group" tabIndex={0} aria-label={PART_INFO[p.kind].name}
                    className={`part kind-${p.kind}${isBar(p.kind) ? ' bus-bar' : ''}${lit ? ' lit' : ''}${safeTrip ? ' safe-trip' : open ? ' open' : ''}${focus ? ' focus' : ''}${selected === p.id ? ' sel' : ''}`}
                    style={{ left: p.x, top: p.y, width: size.w, height: size.h }}
                    onPointerDown={e => startMovePart(e, p)} onKeyDown={e => onPartKey(e, p)}
                  >
                    {!isBar(p.kind) && p.kind !== 'breaker' && <PartIcon name={PART_ICONS[p.kind]} size={p.kind === 'mainswitch' ? 22 : 28} />}
                    {p.kind === 'breaker'
                      ? <span className="part-title"><PartIcon name="breaker" size={16} /><span className="part-name">{p.label ?? PART_INFO[p.kind].name}</span></span>
                      : <span className="part-name">{p.label ?? PART_INFO[p.kind].name}</span>}
                    {p.kind === 'breaker' && !open && (
                      <select
                        id={`size-${p.id}`} aria-label="Breaker size" value={p.breakerA} disabled={locked}
                        onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                        onChange={e => setBuild(b => ({ ...b, parts: b.parts.map(q => (q.id === p.id ? { ...q, breakerA: Number(e.target.value) } : q)) }))}
                      >
                        {mission.breakers.map(a => <option key={a} value={a}>{a} A</option>)}
                      </select>
                    )}
                    {open && <span className="part-state">{p.breakerA} A · {safeTrip ? 'safe trip' : 'OPEN'}</span>}
                    {PART_INFO[p.kind].watts !== undefined && <span className="part-state">{lit ? 'ON' : 'off'}</span>}
                    {partEnds(p.kind).map((end, i) => {
                      const t = `${p.id}.${end}`;
                      const pad = padSpot(p.kind, end);
                      const label = isBar(p.kind) ? '' : PART_INFO[p.kind][end as 'a' | 'b' | 'c'] ?? '';
                      const number = showGuide ? mission.guide[p.kind]?.[i] : undefined;
                      return (
                        <button
                          key={end} id={`term-${p.id}-${end}`} type="button" disabled={locked} {...{ [TERMINAL_ATTR]: t }}
                          style={{ left: pad.dx, right: 'auto', top: pad.dy, transform: 'translate(-50%, -50%)' }}
                          className={`term ${pad.vert ? (pad.dir < 0 ? 'top' : 'bottom') : pad.dir < 0 ? 'a' : 'b'}${pending === t ? ' pending' : ''}${build.wires.some(w => w.from === t || w.to === t) ? ' wired' : ''}`}
                          aria-label={`${PART_INFO[p.kind].name}, ${label || `point ${i + 1}`}`} title={TERM_TITLES[label]}
                          onPointerDown={e => startWireDrag(e, t)} onClick={() => clickTerminal(t)}
                        >
                          {(label || number) && <span className="term-label">{number && <b>{number}</b>} {label}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="controls workshop-controls">
            <button type="button" id="power-on" className="btn primary power-on" disabled={locked} onClick={pressPowerOn}>Power On</button>
            {pending
              ? <span className="hint-now">Now click another connection point.</span>
              : <span className="hint-now">Drag between two circles to add a wire, or click one, then the other.</span>}
            {selected && !locked && <button type="button" className="btn" onClick={removeSelected}>Remove selected</button>}
            <button type="button" className="btn" disabled={locked} onClick={() => { setBuild(mission.start); setSelected(null); setPending(null); }}>Clear board</button>
          </div>
        </div>

        <div className="side">
          {run ? (
            <RunPanel
              run={run} onSkip={finish} testing={testing} onNext={onNext}
              onFix={() => setRun(null)}
            />
          ) : (
            <aside className="panel mission">
              <header><h2>Mission</h2></header>
              <p className="intro">{mission.goal}</p>
              <ul className="star-goals">
                {mission.stars.map((text, i) => (
                  <li key={text}><span className={i < earnedStars ? 'on' : undefined} aria-hidden="true">★</span> {text}</li>
                ))}
              </ul>
              {mission.budget !== null && (
                <div className={`cost${overBudget ? ' over' : ''}`}>
                  <span>Cost</span>
                  <b>{cost} / {mission.budget} credits</b>
                  <span className="meter"><i style={{ width: `${Math.min(100, (cost / mission.budget) * 100)}%` }} /></span>
                </div>
              )}
              <section className="hint-box">
                {hasHint
                  ? <ol className="hint-steps">{mission.hint.map(h => <li key={h}>{h}</li>)}</ol>
                  : <button type="button" className="btn" id="buy-hint" disabled={wallet.coins < HINT_PRICE} onClick={() => buy(hintId, HINT_PRICE)}>Show me how · {HINT_PRICE} coins</button>}
              </section>
            </aside>
          )}

          <aside className="panel shop" aria-label="Shop">
            <header><h2>Shop</h2></header>
            <ul className="shop-items">
              {SHOP_ITEMS.map(item => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  {wallet.owned.includes(item.id)
                    ? <small>Owned</small>
                    : <button type="button" className="btn" id={`buy-${item.id}`} disabled={wallet.coins < item.price} onClick={() => buy(item.id, item.price)}>{item.price} coins</button>}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      {ghost && <div className="tray-ghost" style={{ left: ghost.x, top: ghost.y }}>{PART_INFO[ghost.kind].name}</div>}
    </main>
  );
}

/** Where a connection point sits on its part, and which way a wire leaves it. Sources face the way the power flows. */
function padSpot(kind: PartKind, end: string): { dx: number; dy: number; dir: -1 | 1; vert?: boolean } {
  const { w, h } = sizeOf(kind);
  const i = ['a', 'b', 'c'].indexOf(end);
  if (kind === 'lbar' && end !== 'a') return { dx: end === 'b' ? 60 : 160, dy: h, dir: 1, vert: true };
  if (isBar(kind)) return { dx: end === 'a' ? 0 : w, dy: h / 2, dir: end === 'a' ? -1 : 1 };
  if (kind === 'breaker') return { dx: w / 2, dy: end === 'a' ? 0 : h, dir: end === 'a' ? -1 : 1, vert: true };
  if (kind === 'supply') return { dx: w, dy: GRID * (i + 1), dir: 1 };
  if (kind === 'battery') return { dx: w, dy: GRID * (2 * i + 1), dir: 1 };
  if (kind === 'light' || kind === 'socket') return { dx: 0, dy: GRID * (i + 1), dir: -1 };
  return { dx: end === 'a' ? 0 : w, dy: h / 2, dir: end === 'a' ? -1 : 1 };
}

/** Where a connection point sits on the board. */
function terminalAt(parts: readonly PlacedPart[], t: Terminal): WireEnd | null {
  const [id, end] = t.split('.');
  const p = parts.find(q => q.id === id);
  if (!p) return null;
  const { dx, dy, dir, vert } = padSpot(p.kind, end);
  return { x: p.x + dx, y: p.y + dy, dir, vert };
}

function WirePath({ wire, points, d, conductor, amps, selected, onSelect }: { wire: Wire; points: readonly Point[]; d: string; conductor: string | null; amps: number | undefined; selected: boolean; onSelect: () => void }) {
  const live = (amps ?? 0) >= 0.01;
  const hot = live && (amps ?? 0) > cableAmps(wire.mm2);
  const spot = labelSpot(points);
  return (
    <g id={wire.id} className={`wire${wire.fixed ? ' fixed' : ''}${conductor ? ` cond-${conductor}` : ''}${live ? ' live' : ''}${hot ? ' hot' : ''}${selected ? ' sel' : ''}`}>
      <path className="wire-hit" d={d} role="button" tabIndex={0} aria-label={`Wire, ${wire.mm2} mm²`}
        onPointerDown={e => { e.stopPropagation(); onSelect(); }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      />
      <path className="wire-line" d={d} style={{ strokeWidth: Math.min(4, 1.5 + wire.mm2 * 0.8) }} />
      {live && <text x={spot.x} y={spot.y - 6} textAnchor="middle">{fmt(amps ?? 0, (amps ?? 0) >= 100 ? 0 : 1)} A</text>}
    </g>
  );
}

function RunPanel({ run, testing, onSkip, onFix, onNext }: { run: Run; testing: boolean; onSkip: () => void; onFix: () => void; onNext: (() => void) | null }) {
  const { report } = run;
  return (
    <aside className="panel score" aria-live="polite">
      <header>
        <h2>{testing ? 'Power On' : report.held ? 'It held!' : 'It did not hold'}</h2>
        {!testing && (
          <span className="stars" aria-label={`${report.stars} of 3 stars`}>
            {[1, 2, 3].map(n => <i key={n} className={n <= report.stars ? 'on' : undefined}>★</i>)}
          </span>
        )}
      </header>
      {report.steps.length > 0 && (
        <ol className="test-steps">
          {report.steps.slice(0, run.shown).map(s => (
            <li key={s.label} className={s.ok ? 'ok' : 'bad'}><b>{s.ok ? '✓' : '✕'} {s.label}</b><span>{s.text}</span></li>
          ))}
        </ol>
      )}
      {testing && <button type="button" className="btn" onClick={onSkip}>Skip to result</button>}
      {!testing && (
        <>
          {run.coins > 0 && <p className="coins-won">+{run.coins} coins</p>}
          {report.tip && <p className="tip">{report.tip}</p>}
          {report.stars === 3 && <p className="tip">A perfect build. The rules you used here carry on to bigger jobs.</p>}
          <div className="actions">
            {report.held && onNext && <button type="button" className="btn primary" id="next-level" onClick={onNext}>Next level</button>}
            <button type="button" className={`btn${report.held ? '' : ' primary'}`} id="fix-build" onClick={onFix}>{report.stars === 3 ? 'Back to the board' : 'Fix it and try again'}</button>
          </div>
        </>
      )}
    </aside>
  );
}
