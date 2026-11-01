import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildCost, coinsEarned, HINT_PRICE, MISSIONS, PART_INFO, powerOn, SHOP_ITEMS, STARTING_COINS,
  type Build, type PartKind, type PlacedPart, type PowerOnReport, type Terminal, type Wire,
} from '../game';
import { cableAmps } from '../sim';
import { fmt } from './format';
import type { LevelEntry } from './levels';
import { loadWallet, saveWallet, type Best, type Wallet } from './progress';
import { trackDrag } from './trackDrag';
import { TERMINAL_ATTR, useWireDrag } from './useWireDrag';
import { wirePath, type WireEnd } from './wireRoute';

const BOARD_W = 860, BOARD_H = 440;
const PART_W = 136, PART_H = 76;
const NUDGE = 10;
const STEP_MS = 1500;
/** Where a part goes when it is added with a click instead of dragged. */
const SLOTS = [[30, 40], [362, 40], [694, 40], [30, 320], [362, 320], [694, 320], [362, 180], [30, 180], [694, 180]] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
  const [build, setBuild] = useState<Build>({ parts: [], wires: [] });
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
      const free = SLOTS.find(([sx, sy]) => !b.parts.some(p => Math.abs(p.x - sx) < PART_W && Math.abs(p.y - sy) < PART_H)) ?? SLOTS[0];
      const part: PlacedPart = {
        id, kind,
        x: clamp(x ?? free[0], 0, BOARD_W - PART_W), y: clamp(y ?? free[1], 0, BOARD_H - PART_H),
        ...(kind === 'breaker' && { breakerA: mission.breakers[0] }),
      };
      return { ...b, parts: [...b.parts, part] };
    });
  }, [mission.breakers]);

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
        addPart(kind, x - box.left - PART_W / 2, y - box.top - PART_H / 2);
      }
    });
  };

  const movePart = (id: string, x: number, y: number) =>
    setBuild(b => ({ ...b, parts: b.parts.map(p => (p.id === id ? { ...p, x: clamp(x, 0, BOARD_W - PART_W), y: clamp(y, 0, BOARD_H - PART_H) } : p)) }));

  const startMovePart = (e: React.PointerEvent, p: PlacedPart) => {
    if (locked) return;
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
    if (locked) return;
    const step: Record<string, [number, number]> = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] };
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
                    <b>{PART_INFO[kind].name}</b> <small>{left} left</small>
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
                {build.wires.map(w => (
                  <WirePath key={w.id} wire={w} parts={build.parts} amps={lastStep?.wireAmps[w.id]} selected={selected === w.id} onSelect={() => { if (!locked) setSelected(w.id); }} />
                ))}
                {preview && <line className="wire-preview" x1={preview.x1} y1={preview.y1} x2={preview.x2} y2={preview.y2} />}
              </svg>

              {build.parts.length === 0 && <p className="board-empty">Drag a part here, or click it to place it.</p>}
              {build.parts.length > 0 && build.wires.length === 0 && !locked && <p className="board-tip">Drag from one circle to another to add a wire.</p>}

              {build.parts.map(p => {
                const lit = lastStep?.lit.includes(p.id) ?? false;
                const open = lastStep?.open.includes(p.id) ?? false;
                const focus = run?.done && run.report.focus === p.id;
                return (
                  <div
                    key={p.id} id={`part-${p.id}`} role="group" tabIndex={0} aria-label={PART_INFO[p.kind].name}
                    className={`part kind-${p.kind}${lit ? ' lit' : ''}${open ? ' open' : ''}${focus ? ' focus' : ''}${selected === p.id ? ' sel' : ''}`}
                    style={{ left: p.x, top: p.y, width: PART_W, height: PART_H }}
                    onPointerDown={e => startMovePart(e, p)} onKeyDown={e => onPartKey(e, p)}
                  >
                    <span className="part-name">{PART_INFO[p.kind].name}</span>
                    {p.kind === 'breaker' && (
                      <select
                        id={`size-${p.id}`} aria-label="Breaker size" value={p.breakerA} disabled={locked}
                        onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                        onChange={e => setBuild(b => ({ ...b, parts: b.parts.map(q => (q.id === p.id ? { ...q, breakerA: Number(e.target.value) } : q)) }))}
                      >
                        {mission.breakers.map(a => <option key={a} value={a}>{a} A</option>)}
                      </select>
                    )}
                    {open && <span className="part-state">OPEN</span>}
                    {PART_INFO[p.kind].watts !== undefined && <span className="part-state">{lit ? 'ON' : 'off'}</span>}
                    {(['a', 'b'] as const).map(end => {
                      const t = `${p.id}.${end}`;
                      return (
                        <button
                          key={end} id={`term-${p.id}-${end}`} type="button" disabled={locked} {...{ [TERMINAL_ATTR]: t }}
                          className={`term ${end}${pending === t ? ' pending' : ''}${build.wires.some(w => w.from === t || w.to === t) ? ' wired' : ''}`}
                          aria-label={`${PART_INFO[p.kind].name}, ${PART_INFO[p.kind][end] || (end === 'a' ? 'left side' : 'right side')}`}
                          onPointerDown={e => startWireDrag(e, t)} onClick={() => clickTerminal(t)}
                        >
                          {PART_INFO[p.kind][end]}
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
            <button type="button" className="btn" disabled={locked} onClick={() => { setBuild({ parts: [], wires: [] }); setSelected(null); setPending(null); }}>Clear board</button>
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

/** Where a connection point sits on the board. */
function terminalAt(parts: readonly PlacedPart[], t: Terminal): WireEnd | null {
  const [id, end] = t.split('.');
  const p = parts.find(q => q.id === id);
  return p ? { x: end === 'a' ? p.x : p.x + PART_W, y: p.y + PART_H / 2, dir: end === 'a' ? -1 : 1 } : null;
}

function WirePath({ wire, parts, amps, selected, onSelect }: { wire: Wire; parts: readonly PlacedPart[]; amps: number | undefined; selected: boolean; onSelect: () => void }) {
  const a = terminalAt(parts, wire.from), b = terminalAt(parts, wire.to);
  if (!a || !b) return null;
  const boxes = parts.map(p => ({ left: p.x, right: p.x + PART_W, top: p.y, bottom: p.y + PART_H }));
  const d = wirePath(a, b, BOARD_W, BOARD_H, boxes);
  const live = (amps ?? 0) >= 0.01;
  const hot = live && (amps ?? 0) > cableAmps(wire.mm2);
  return (
    <g id={wire.id} className={`wire${live ? ' live' : ''}${hot ? ' hot' : ''}${selected ? ' sel' : ''}`}>
      <path className="wire-hit" d={d} role="button" tabIndex={0} aria-label={`Wire, ${wire.mm2} mm²`}
        onPointerDown={e => { e.stopPropagation(); onSelect(); }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      />
      <path className="wire-line" d={d} style={{ strokeWidth: 1.5 + wire.mm2 * 0.8 }} />
      {live && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} textAnchor="middle">{fmt(amps ?? 0, (amps ?? 0) >= 100 ? 0 : 1)} A</text>}
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
