import { useMemo, useRef, useState } from 'react';
import { BOARD_BREAKER_SIZES, BREAKER_SIZES, designCost, peakNeeds, SOLAR_OPTIONS, villaDesign, type VillaBuild } from '../game';
import { CABLE_SIZES, cableAmps, type Level } from '../sim';
import { fmt, hhmm } from './format';
import { trackDrag } from './trackDrag';

const BOARD_W = 860, BOARD_H = 468;
const STREET = { x: 16, y: 190, w: 110, h: 76 };
const VBOARD_W = 136, VBOARD_H = 76;
const ROOM_W = 176, ROOM_H = 100;
const ROOM_COLS = [456, 668];
const ROOM_GAP_Y = 12;
/** Room cables on offer. Thicker sizes are for board feeders. */
const ROOM_CABLES = CABLE_SIZES.filter(mm => mm <= 10);
const DEFAULT_CABLE = 2.5;

const STREET_OUT = 'street', BOARD_IN = 'board.a', BOARD_OUT = 'board.b';
const roomIn = (id: string) => `room.${id}`;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Props {
  level: Level;
  build: VillaBuild;
  onChange: (next: VillaBuild) => void;
  /** The build is complete: run the day on this design. */
  onPowerOn: (design: Level) => void;
}

/** Build the villa from the street: place the board, wire it to the street and to every room, and pick the sizes. */
export function VillaBuilder({ level, build, onChange, onPowerOn }: Props) {
  const [boardAt, setBoardAt] = useState({ x: 200, y: 190 });
  const [pending, setPending] = useState<string | null>(null);
  const [cable, setCable] = useState(DEFAULT_CABLE);
  const [selected, setSelected] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const needs = useMemo(() => peakNeeds(level), [level]);
  const roomAt = (i: number) => ({ x: ROOM_COLS[i % 2], y: ROOM_GAP_Y + Math.floor(i / 2) * (ROOM_H + ROOM_GAP_Y) });

  const update = (patch: Partial<VillaBuild>) => { setTip(null); onChange({ ...build, ...patch }); };
  const setRoom = (id: string, patch: Partial<VillaBuild['rooms'][string]>) =>
    update({ rooms: { ...build.rooms, [id]: { ...build.rooms[id], ...patch } } });

  const placeBoard = (x?: number, y?: number) => {
    if (x !== undefined && y !== undefined) moveBoard(x, y);
    update({ boardPlaced: true });
  };
  const moveBoard = (x: number, y: number) =>
    setBoardAt({ x: clamp(x, 140, ROOM_COLS[0] - VBOARD_W - 40), y: clamp(y, 0, BOARD_H - VBOARD_H) });

  const removeBoard = () => {
    update({ boardPlaced: false, supplyWired: false, rooms: Object.fromEntries(Object.entries(build.rooms).map(([id, r]) => [id, { ...r, mm2: null }])) });
    setSelected(null);
  };

  /** Only two kinds of wire exist here: street to board, and board to room. */
  const clickTerminal = (t: string) => {
    if (pending === null) { setPending(t); return; }
    const pair = [pending, t];
    setPending(null);
    if (pending === t) return;
    if (pair.includes(STREET_OUT) && pair.includes(BOARD_IN)) { update({ supplyWired: true }); return; }
    const room = pair.find(p => p.startsWith('room.'));
    if (room && pair.includes(BOARD_OUT)) { setRoom(room.slice(5), { mm2: cable }); return; }
    setTip('That connection does nothing here. Wire the street to the board’s left side, and the board’s right side to each room.');
  };

  const pickCable = (mm: number) => {
    setCable(mm);
    if (selected?.startsWith('room.')) setRoom(selected.slice(5), { mm2: mm });
  };
  const removeWire = () => {
    if (selected === STREET_OUT) update({ supplyWired: false });
    else if (selected?.startsWith('room.')) setRoom(selected.slice(5), { mm2: null });
    setSelected(null);
  };

  const pressPowerOn = () => {
    const r = villaDesign(level, build);
    if (r.design) onPowerOn(r.design);
    else setTip(r.tip);
  };

  const startTrayDrag = (e: React.PointerEvent) => {
    dragged.current = false;
    trackDrag(e, (x, y) => { dragged.current = true; setGhost({ x, y }); }, (x, y, moved) => {
      setGhost(null);
      const box = area.current?.getBoundingClientRect();
      if (moved && box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        placeBoard(x - box.left - VBOARD_W / 2, y - box.top - VBOARD_H / 2);
      }
    });
  };
  const startMoveBoard = (e: React.PointerEvent) => {
    const dx = e.clientX - boardAt.x, dy = e.clientY - boardAt.y;
    trackDrag(e, (x, y) => moveBoard(x - dx, y - dy), () => {});
  };

  const streetOut = { x: STREET.x + STREET.w, y: STREET.y + STREET.h / 2 };
  const boardIn = { x: boardAt.x, y: boardAt.y + VBOARD_H / 2 };
  const boardOut = { x: boardAt.x + VBOARD_W, y: boardAt.y + VBOARD_H / 2 };
  const preview = useMemo(() => {
    const r = villaDesign(level, build);
    return r.design ? designCost(r.design) : null;
  }, [level, build]);
  const wired = level.circuits.filter(c => build.rooms[c.id]?.mm2 != null).length;
  const budget = level.budget ?? null;

  return (
    <section className="sim villa-build">
      <div className="stage-col">
        <section className="panel tray" aria-label="Parts">
          <h2>Parts</h2>
          <div className="tray-items">
            <button
              id="tray-villa-board" type="button" className="tray-item" disabled={build.boardPlaced}
              onPointerDown={startTrayDrag} onClick={() => { if (!dragged.current) placeBoard(); dragged.current = false; }}
            >
              <b>Villa board</b> <small>{build.boardPlaced ? 'placed' : '1 left'}</small>
            </button>
          </div>
          <div className="seg cable-pick" role="group" aria-label="Cable">
            <span>Cable</span>
            {ROOM_CABLES.map(mm => (
              <button key={mm} id={`cable-${mm}`} type="button" aria-pressed={cable === mm} onClick={() => pickCable(mm)} title={`Good for ${cableAmps(mm)} A`}>{mm}</button>
            ))}
            <span>mm² · {cableAmps(cable)} A</span>
          </div>
        </section>

        <div className="board-scroll">
          <div
            ref={area} className="board" style={{ width: BOARD_W, height: BOARD_H }}
            onPointerDown={e => { if (e.target === e.currentTarget) { setSelected(null); setPending(null); } }}
          >
            <svg className="wires" width={BOARD_W} height={BOARD_H} aria-hidden={wired === 0 && !build.supplyWired}>
              {build.supplyWired && <VillaWire id={STREET_OUT} label="Street to board" from={streetOut} to={boardIn} mm2={16} selected={selected === STREET_OUT} onSelect={setSelected} />}
              {build.boardPlaced && level.circuits.map((c, i) => {
                const mm2 = build.rooms[c.id]?.mm2;
                if (mm2 == null) return null;
                const at = roomAt(i);
                return <VillaWire key={c.id} id={roomIn(c.id)} label={`${c.room} cable, ${mm2} mm²`} from={boardOut} to={{ x: at.x, y: at.y + ROOM_H / 2 }} mm2={mm2} selected={selected === roomIn(c.id)} onSelect={setSelected} />;
              })}
            </svg>

            <div className="part kind-supply" style={{ left: STREET.x, top: STREET.y, width: STREET.w, height: STREET.h }}>
              <span className="part-name">Street supply</span>
              <button id="term-street" type="button" className={`term b${pending === STREET_OUT ? ' pending' : ''}`} aria-label="Street supply" onClick={() => clickTerminal(STREET_OUT)} />
            </div>

            {build.boardPlaced && (
              <div
                id="part-villa-board" role="group" tabIndex={0} aria-label="Villa board" className={`part${selected === 'board' ? ' sel' : ''}`}
                style={{ left: boardAt.x, top: boardAt.y, width: VBOARD_W, height: VBOARD_H }}
                onPointerDown={e => { setSelected('board'); startMoveBoard(e); }}
                onKeyDown={e => {
                  const step: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
                  if (step[e.key]) { e.preventDefault(); moveBoard(boardAt.x + step[e.key][0], boardAt.y + step[e.key][1]); }
                }}
              >
                <span className="part-name">Villa board</span>
                <select
                  id="main-breaker" aria-label="Main breaker" value={build.mainBreakerA}
                  onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                  onChange={e => update({ mainBreakerA: Number(e.target.value) })}
                >
                  {BOARD_BREAKER_SIZES.map(a => <option key={a} value={a}>Main {a} A</option>)}
                </select>
                <button id="term-board-in" type="button" className={`term a${pending === BOARD_IN ? ' pending' : ''}`} aria-label="Villa board, from the street" onPointerDown={e => e.stopPropagation()} onClick={() => clickTerminal(BOARD_IN)} />
                <button id="term-board-out" type="button" className={`term b${pending === BOARD_OUT ? ' pending' : ''}`} aria-label="Villa board, to the rooms" onPointerDown={e => e.stopPropagation()} onClick={() => clickTerminal(BOARD_OUT)} />
              </div>
            )}

            {level.circuits.map((c, i) => {
              const at = roomAt(i);
              const need = needs.circuits.get(c.id);
              const t = roomIn(c.id);
              return (
                <div key={c.id} id={`room-${c.id}`} role="group" aria-label={c.room} className="part room-part" style={{ left: at.x, top: at.y, width: ROOM_W, height: ROOM_H }}>
                  <span className="part-name">{c.room}</span>
                  <small className="part-state">up to {fmt(need?.amps ?? 0)} A at {hhmm(need?.hour ?? 0)}</small>
                  <select
                    id={`brk-${c.id}`} aria-label={`${c.room} breaker`} value={build.rooms[c.id].breakerA}
                    onChange={e => setRoom(c.id, { breakerA: Number(e.target.value) })}
                  >
                    {BREAKER_SIZES.map(a => <option key={a} value={a}>{a} A</option>)}
                  </select>
                  <button id={`term-${c.id}`} type="button" className={`term a${pending === t ? ' pending' : ''}`} aria-label={`${c.room}, cable in`} onClick={() => clickTerminal(t)} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="controls workshop-controls">
          <button type="button" id="power-on" className="btn primary power-on" onClick={pressPowerOn}>Power On</button>
          <span className="hint-now">{pending ? 'Now click where this wire goes.' : 'Click two connection points to join them. A room’s wire uses the cable picked above.'}</span>
          {selected === 'board'
            ? <button type="button" className="btn" onClick={removeBoard}>Remove the board</button>
            : selected && <button type="button" className="btn" onClick={removeWire}>Remove the wire</button>}
        </div>
      </div>

      <div className="side">
        <aside className="panel mission">
          <header><h2>Mission</h2></header>
          <p className="intro">Build this villa from the street: a board, then a cable and a breaker to each room. Keep every room on for a whole day, and keep each cable safe.</p>
          <p className="rule-line">Room current ≤ breaker ≤ cable</p>
          <label className="solar-pick">
            <span>Solar on the roof</span>
            <select id="solar" value={build.solarKw} onChange={e => update({ solarKw: Number(e.target.value) })}>
              {SOLAR_OPTIONS.map(k => <option key={k} value={k}>{k === 0 ? 'None' : `${k} kWp`}</option>)}
            </select>
          </label>
          <p className="wired-count">{wired} of {level.circuits.length} rooms wired</p>
          {budget !== null && preview !== null && (
            <div className={`cost${preview > budget ? ' over' : ''}`}>
              <span>Cost</span>
              <b>{preview} / {budget} credits</b>
              <span className="meter"><i style={{ width: `${Math.min(100, (preview / budget) * 100)}%` }} /></span>
            </div>
          )}
          {tip && <p className="tip" role="status">{tip}</p>}
        </aside>
      </div>

      {ghost && <div className="tray-ghost" style={{ left: ghost.x, top: ghost.y }}>Villa board</div>}
    </section>
  );
}

function VillaWire({ id, label, from, to, mm2, selected, onSelect }: {
  id: string; label: string; from: { x: number; y: number }; to: { x: number; y: number }; mm2: number; selected: boolean; onSelect: (id: string) => void;
}) {
  const mid = (from.x + to.x) / 2;
  const d = `M${from.x} ${from.y} C${mid} ${from.y} ${mid} ${to.y} ${to.x} ${to.y}`;
  return (
    <g className={`wire${selected ? ' sel' : ''}`}>
      <path
        className="wire-hit" d={d} role="button" tabIndex={0} aria-label={label}
        onPointerDown={e => { e.stopPropagation(); onSelect(id); }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); } }}
      />
      <path className="wire-line" d={d} style={{ strokeWidth: Math.min(6, 1.5 + mm2 * 0.5) }} />
    </g>
  );
}
