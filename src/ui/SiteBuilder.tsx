import { useMemo, useRef, useState } from 'react';
import {
  BOARD_BREAKER_SIZES, BREAKER_SIZES, DEFAULT_POINTS, designCost, peakNeeds, siteDesign, SOLAR_OPTIONS, SIZING_RULE, type SiteBuild,
} from '../game';
import { CABLE_SIZES, cableAmps, PHASES, type Board, type Level, type Phase } from '../sim';
import { fmt, hhmm } from './format';
import { PartIcon, roomIcon, TERM_TITLES } from './PartIcon';
import { trackDrag } from './trackDrag';
import { TERMINAL_ATTR, useWireDrag } from './useWireDrag';
import { draftPath, pathOf, routeWires, type Point, type WireEnd } from './wireRoute';

const BOARD_W = 860;
const STREET = { x: 16, w: 100, h: 92 };
const PANEL_W = 136, PANEL_H = 116;
const ROOM_W = 168, ROOM_H = 100;
const ROOM_COLS = [472, 672];
const ROOM_GAP_Y = 12;
/** Boards stay left of the rooms, leaving a channel for the wires. */
const PANEL_MIN_X = 130, PANEL_MAX_X = ROOM_COLS[0] - PANEL_W - 52;
const DEFAULT_CABLE = 2.5;

const STREET_OUT = 'street';
const boardIn = (id: string) => `in.${id}`;
const boardOut = (id: string) => `out.${id}`;
const roomIn = (id: string) => `room.${id}`;
/** A wire is named by the street, or by the board or room it feeds. */
const feederWire = (id: string) => `feeder.${id}`;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Props {
  level: Level;
  /** What this build asks of the player. */
  goal: string;
  build: SiteBuild;
  onChange: (next: SiteBuild) => void;
  /** The build is complete: run the day on this design. */
  onPowerOn: (design: Level) => void;
}

/** Build a site from the street: place each board, wire the tree down to every room, and pick the sizes. */
export function SiteBuilder({ level, goal, build, onChange, onPowerOn }: Props) {
  const rows = Math.ceil(level.circuits.length / ROOM_COLS.length);
  const boardH = Math.max(rows * (ROOM_H + ROOM_GAP_Y) + ROOM_GAP_Y, 300);
  const top = level.boards.find(b => b.parent === null)!;
  const below = level.boards.filter(b => b.parent !== null);
  const [spots, setSpots] = useState<Record<string, { x: number; y: number }>>(() => Object.fromEntries(level.boards.map(b => {
    if (b.parent === null) return [b.id, { x: below.length ? 136 : 200, y: boardH / 2 - PANEL_H / 2 }];
    const i = below.indexOf(b);
    return [b.id, { x: PANEL_MAX_X, y: ((i + 0.5) / below.length) * boardH - PANEL_H / 2 }];
  })));
  const [pending, setPending] = useState<string | null>(null);
  const [cable, setCable] = useState(DEFAULT_CABLE);
  const [selected, setSelected] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ name: string; x: number; y: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const street = { x: STREET.x, y: boardH / 2 - STREET.h / 2 };
  const roomAt = (i: number) => ({ x: ROOM_COLS[i % ROOM_COLS.length], y: ROOM_GAP_Y + Math.floor(i / ROOM_COLS.length) * (ROOM_H + ROOM_GAP_Y) });
  const threePhase = level.boards.some(b => b.phases === 3);
  const solarScored = ((level.points ?? DEFAULT_POINTS).solar ?? 0) > 0;
  const nameOf = (b: Board) => (level.boards.length === 1 ? 'Board' : b.name);

  // Learn mode: what each room and board asks for, with the phases as they stand now
  const phaseKey = level.circuits.map(c => build.rooms[c.id].phase).join();
  const needs = useMemo(
    () => peakNeeds({ ...level, circuits: level.circuits.map(c => ({ ...c, phase: build.rooms[c.id].phase })) }),
    // Only the phases change what is drawn here
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [level, phaseKey],
  );

  const update = (patch: Partial<SiteBuild>) => { setTip(null); onChange({ ...build, ...patch }); };
  const setBoard = (id: string, patch: Partial<SiteBuild['boards'][string]>) =>
    update({ boards: { ...build.boards, [id]: { ...build.boards[id], ...patch } } });
  const setRoom = (id: string, patch: Partial<SiteBuild['rooms'][string]>) =>
    update({ rooms: { ...build.rooms, [id]: { ...build.rooms[id], ...patch } } });

  const moveBoard = (id: string, x: number, y: number) =>
    setSpots(s => ({ ...s, [id]: { x: clamp(x, PANEL_MIN_X, PANEL_MAX_X), y: clamp(y, 0, boardH - PANEL_H) } }));

  /** Lifting a board takes every wire touching it with it. */
  const removeBoard = (id: string) => {
    update({
      supplyWired: id === top.id ? false : build.supplyWired,
      boards: Object.fromEntries(Object.entries(build.boards).map(([k, v]) => {
        const isChild = level.boards.find(b => b.id === k)?.parent === id;
        return [k, k === id ? { ...v, placed: false, mm2: null } : isChild ? { ...v, mm2: null } : v];
      })),
      rooms: Object.fromEntries(Object.entries(build.rooms).map(([k, v]) => [k, level.circuits.find(c => c.id === k)?.board === id ? { ...v, mm2: null } : v])),
    });
    setSelected(null);
  };

  /** A wire is only useful down the tree: street to top board, board to the boards and rooms it feeds. */
  const connect = (from: string, to: string) => {
    const pair = [from, to];
    setPending(null);
    if (pair.includes(STREET_OUT) && pair.includes(boardIn(top.id))) { update({ supplyWired: true }); return; }
    const child = below.find(b => pair.includes(boardIn(b.id)) && pair.includes(boardOut(b.parent!)));
    if (child) { setBoard(child.id, { mm2: cable }); return; }
    const room = level.circuits.find(c => pair.includes(roomIn(c.id)) && pair.includes(boardOut(c.board)));
    if (room) { setRoom(room.id, { mm2: cable }); return; }
    setTip(`That connection does nothing here. Wire the street to IN on the ${nameOf(top).toLowerCase()}, then each board's OUT to what it feeds.`);
  };
  const { preview: wireDraft, startWireDrag, endedDrag } = useWireDrag(area, connect);

  const clickTerminal = (t: string) => {
    if (endedDrag()) return;
    if (pending === null) { setPending(t); return; }
    if (pending === t) setPending(null);
    else connect(pending, t);
  };
  /** Everything a connection point needs: dragging from it, clicking it, and being dropped on. */
  const termProps = (t: string, wired: boolean, end: 'a' | 'b') => ({
    [TERMINAL_ATTR]: t,
    className: `term ${end}${pending === t ? ' pending' : ''}${wired ? ' wired' : ''}`,
    title: TERM_TITLES[end === 'a' ? 'IN' : 'OUT'],
    children: <span className="term-label">{end === 'a' ? 'IN' : 'OUT'}</span>,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => startWireDrag(e, t),
    onClick: () => clickTerminal(t),
  });

  const pickCable = (mm: number) => {
    setCable(mm);
    if (selected?.startsWith('room.')) setRoom(selected.slice(5), { mm2: mm });
    if (selected?.startsWith('feeder.')) setBoard(selected.slice(7), { mm2: mm });
  };
  const removeWire = () => {
    if (selected === STREET_OUT) update({ supplyWired: false });
    else if (selected?.startsWith('room.')) setRoom(selected.slice(5), { mm2: null });
    else if (selected?.startsWith('feeder.')) setBoard(selected.slice(7), { mm2: null });
    setSelected(null);
  };

  const pressPowerOn = () => {
    const r = siteDesign(level, build);
    if (r.design) onPowerOn(r.design);
    else setTip(r.tip);
  };

  const placeBoard = (b: Board, x?: number, y?: number) => {
    if (x !== undefined && y !== undefined) moveBoard(b.id, x, y);
    setBoard(b.id, { placed: true });
  };
  const startTrayDrag = (e: React.PointerEvent, b: Board) => {
    dragged.current = false;
    trackDrag(e, (x, y) => { dragged.current = true; setGhost({ name: b.name, x, y }); }, (x, y, moved) => {
      setGhost(null);
      const box = area.current?.getBoundingClientRect();
      if (moved && box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        placeBoard(b, x - box.left - PANEL_W / 2, y - box.top - PANEL_H / 2);
      }
    });
  };
  const startMoveBoard = (e: React.PointerEvent, id: string) => {
    const dx = e.clientX - spots[id].x, dy = e.clientY - spots[id].y;
    trackDrag(e, (x, y) => moveBoard(id, x - dx, y - dy), () => {});
  };

  const inAt = (id: string): WireEnd => ({ x: spots[id].x, y: spots[id].y + PANEL_H / 2, dir: -1 });
  const outAt = (id: string): WireEnd => ({ x: spots[id].x + PANEL_W, y: spots[id].y + PANEL_H / 2, dir: 1 });
  const routes = useMemo(() => {
    const placed = level.boards.filter(b => build.boards[b.id].placed);
    const boxes = [
      { left: street.x, right: street.x + STREET.w, top: street.y, bottom: street.y + STREET.h },
      ...placed.map(b => ({ left: spots[b.id].x, right: spots[b.id].x + PANEL_W, top: spots[b.id].y, bottom: spots[b.id].y + PANEL_H })),
      ...level.circuits.map((_, i) => { const at = roomAt(i); return { left: at.x, right: at.x + ROOM_W, top: at.y, bottom: at.y + ROOM_H }; }),
    ];
    const jobs = [
      ...(build.supplyWired ? [{ id: STREET_OUT, from: STREET_OUT, to: boardIn(top.id), a: { x: street.x + STREET.w, y: street.y + STREET.h / 2, dir: 1 as const }, b: inAt(top.id) }] : []),
      ...below.filter(b => build.boards[b.id].mm2 != null)
        .map(b => ({ id: feederWire(b.id), from: boardOut(b.parent!), to: boardIn(b.id), a: outAt(b.parent!), b: inAt(b.id) })),
      ...level.circuits.flatMap((c, i) => {
        if (build.rooms[c.id].mm2 == null) return [];
        const at = roomAt(i);
        return [{ id: roomIn(c.id), from: boardOut(c.board), to: roomIn(c.id), a: outAt(c.board), b: { x: at.x, y: at.y + ROOM_H / 2, dir: -1 as const } }];
      }),
    ];
    return routeWires(jobs, BOARD_W, boardH, boxes);
    // Everything else here follows from the level, which fixes the board's size and the rooms
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, build, spots]);
  const preview = useMemo(() => {
    const r = siteDesign(level, build);
    return r.design ? designCost(r.design) : null;
  }, [level, build]);
  const wired = level.circuits.filter(c => build.rooms[c.id].mm2 != null).length;
  const budget = level.budget ?? null;
  const selectedBoard = level.boards.find(b => selected === `board.${b.id}`);

  return (
    <section className="sim site-build">
      <div className="stage-col">
        <section className="panel tray" aria-label="Parts">
          <h2>Parts</h2>
          <div className="tray-items">
            {level.boards.map(b => (
              <button
                key={b.id} id={`tray-${b.id}`} type="button" className="tray-item" disabled={build.boards[b.id].placed}
                onPointerDown={e => startTrayDrag(e, b)} onClick={() => { if (!dragged.current) placeBoard(b); dragged.current = false; }}
              >
                <PartIcon name="board" size={18} /> <b>{b.name}</b> <small>{build.boards[b.id].placed ? 'placed' : '1 left'}</small>
              </button>
            ))}
          </div>
          <div className="seg cable-pick" role="group" aria-label="Cable">
            <span>Cable</span>
            {CABLE_SIZES.map(mm => (
              <button key={mm} id={`cable-${mm}`} type="button" aria-pressed={cable === mm} onClick={() => pickCable(mm)} title={`Good for ${cableAmps(mm)} A`}>{mm}</button>
            ))}
            <span>mm² · {cableAmps(cable)} A</span>
          </div>
        </section>

        <div className="board-scroll">
          <div
            ref={area} className="board" style={{ width: BOARD_W, height: boardH }}
            onPointerDown={e => { if (e.target === e.currentTarget) { setSelected(null); setPending(null); } }}
          >
            <svg className="wires" width={BOARD_W} height={boardH} aria-hidden={wired === 0 && !build.supplyWired}>
              {build.supplyWired && (
                <SiteWire id={STREET_OUT} label={`Street to ${top.name}`} points={routes.get(STREET_OUT)!} mm2={16} selected={selected === STREET_OUT} onSelect={setSelected} />
              )}
              {below.map(b => {
                const mm2 = build.boards[b.id].mm2;
                if (mm2 == null) return null;
                return <SiteWire key={b.id} id={feederWire(b.id)} label={`${b.name} feeder, ${mm2} mm²`} points={routes.get(feederWire(b.id))!} mm2={mm2} selected={selected === feederWire(b.id)} onSelect={setSelected} />;
              })}
              {level.circuits.map(c => {
                const mm2 = build.rooms[c.id].mm2;
                if (mm2 == null) return null;
                return <SiteWire key={c.id} id={roomIn(c.id)} label={`${c.room} cable, ${mm2} mm²`} points={routes.get(roomIn(c.id))!} mm2={mm2} selected={selected === roomIn(c.id)} onSelect={setSelected} />;
              })}
              {wireDraft && <path className="wire-preview" d={draftPath(wireDraft)} />}
            </svg>

            {wired === 0 && !build.supplyWired && <p className="board-tip">Drag from one circle to another to add a wire.</p>}

            <div className="part kind-supply" style={{ left: street.x, top: street.y, width: STREET.w, height: STREET.h }}>
              <PartIcon name="supply" />
              <span className="part-name">Street supply</span>
              <button id="term-street" type="button" aria-label="Street supply" {...termProps(STREET_OUT, build.supplyWired, 'b')} />
            </div>

            {level.boards.filter(b => build.boards[b.id].placed).map(b => {
              const need = needs.boards.get(b.id);
              const split = b.phases === 3 ? PHASES.map((p, i) => `${p} ${fmt(need?.phaseAmps?.[i] ?? 0, 0)}`).join(' · ') : `${fmt(need?.amps ?? 0, 0)} A`;
              const parent = level.boards.find(x => x.id === b.parent);
              return (
                <div
                  key={b.id} id={`part-${b.id}`} role="group" tabIndex={0} aria-label={b.name} className={`part panel-part${selected === `board.${b.id}` ? ' sel' : ''}`}
                  style={{ left: spots[b.id].x, top: spots[b.id].y, width: PANEL_W, height: PANEL_H }}
                  onPointerDown={e => { setSelected(`board.${b.id}`); startMoveBoard(e, b.id); }}
                  onKeyDown={e => {
                    const step: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
                    if (step[e.key]) { e.preventDefault(); moveBoard(b.id, spots[b.id].x + step[e.key][0], spots[b.id].y + step[e.key][1]); }
                  }}
                >
                  <PartIcon name="board" size={24} />
                  <span className="part-name">{nameOf(b)}</span>
                  <small className="part-state">{split}</small>
                  <select
                    id={`brk-${b.id}`} aria-label={`${b.name} breaker`} value={build.boards[b.id].breakerA}
                    onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                    onChange={e => setBoard(b.id, { breakerA: Number(e.target.value) })}
                  >
                    {BOARD_BREAKER_SIZES.map(a => <option key={a} value={a}>{a} A</option>)}
                  </select>
                  <button
                    id={`term-${b.id}-in`} type="button" aria-label={`${b.name}, ${parent ? `feed from ${parent.name}` : 'from the street'}`}
                    {...termProps(boardIn(b.id), b.parent === null ? build.supplyWired : build.boards[b.id].mm2 != null, 'a')}
                  />
                  <button
                    id={`term-${b.id}-out`} type="button" aria-label={`${b.name}, feeds out`}
                    {...termProps(boardOut(b.id), below.some(x => x.parent === b.id && build.boards[x.id].mm2 != null) || level.circuits.some(c => c.board === b.id && build.rooms[c.id].mm2 != null), 'b')}
                  />
                </div>
              );
            })}

            {level.circuits.map((c, i) => {
              const at = roomAt(i);
              const need = needs.circuits.get(c.id);
              const t = roomIn(c.id);
              const board = level.boards.find(b => b.id === c.board)!;
              const room = build.rooms[c.id];
              const owner = level.boards.length > 1 ? `${board.name} · ` : '';
              return (
                <div key={c.id} id={`room-${c.id}`} role="group" aria-label={`${owner}${c.room}`} className="part room-part" style={{ left: at.x, top: at.y, width: ROOM_W, height: ROOM_H }}>
                  <span className="part-title"><PartIcon name={roomIcon(c.room)} size={20} /><span className="part-name">{owner}{c.room}</span></span>
                  <small className="part-state">up to {fmt(need?.amps ?? 0)} A at {hhmm(need?.hour ?? 0)}</small>
                  <span className="room-picks">
                    <select
                      id={`brk-${c.id}`} aria-label={`${c.room} breaker`} value={room.breakerA}
                      onChange={e => setRoom(c.id, { breakerA: Number(e.target.value) })}
                    >
                      {BREAKER_SIZES.map(a => <option key={a} value={a}>{a} A</option>)}
                    </select>
                    {board.phases === 3 && (
                      <select id={`ph-${c.id}`} aria-label={`${c.room} phase`} value={room.phase} onChange={e => setRoom(c.id, { phase: e.target.value as Phase })}>
                        {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    )}
                  </span>
                  <button id={`term-${c.id}`} type="button" aria-label={`${c.room}, cable in`} {...termProps(t, room.mm2 != null, 'a')} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="controls workshop-controls">
          <button type="button" id="power-on" className="btn primary power-on" onClick={pressPowerOn}>Power On</button>
          <span className="hint-now">{pending ? 'Now click where this wire goes.' : 'Drag between two circles to add a wire, or click one, then the other. New wires use the cable picked above.'}</span>
          {selectedBoard
            ? <button type="button" className="btn" onClick={() => removeBoard(selectedBoard.id)}>Remove the board</button>
            : selected && <button type="button" className="btn" onClick={removeWire}>Remove the wire</button>}
        </div>
      </div>

      <div className="side">
        <aside className="panel mission">
          <header><h2>Mission</h2></header>
          <p className="intro">{goal}</p>
          <p className="rule-line">{SIZING_RULE}</p>
          {threePhase && <p className="rule-line">Keep L1, L2 and L3 about equal on every board.</p>}
          {solarScored && (
            <label className="solar-pick">
              <span>Solar on the roof</span>
              <select id="solar" value={build.solarKw} onChange={e => update({ solarKw: Number(e.target.value) })}>
                {SOLAR_OPTIONS.map(k => <option key={k} value={k}>{k === 0 ? 'None' : `${k} kWp`}</option>)}
              </select>
            </label>
          )}
          <p className="wired-count">{wired} of {level.circuits.length} rooms wired</p>
          {below.length > 0 && (
            <ul className="feeder-list">
              {below.map(b => <li key={b.id}>{b.name} feeder · {b.cable?.lengthM} m</li>)}
            </ul>
          )}
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

      {ghost && <div className="tray-ghost" style={{ left: ghost.x, top: ghost.y }}>{ghost.name}</div>}
    </section>
  );
}

function SiteWire({ id, label, points, mm2, selected, onSelect }: {
  id: string; label: string; points: readonly Point[]; mm2: number; selected: boolean; onSelect: (id: string) => void;
}) {
  const d = pathOf(points);
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
