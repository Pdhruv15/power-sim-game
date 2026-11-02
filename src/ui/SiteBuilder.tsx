import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applySiteTool, BOARD_BREAKER_SIZES, BREAKER_SIZES, DEFAULT_POINTS, designCost, peakNeeds, siteDesign, SOLAR_OPTIONS, SIZING_RULE, TRANSFORMER_SIZES,
  type SiteBuild, type SiteTool,
} from '../game';
import type { BuildView } from '../render/SiteScene';
import { CABLE_SIZES, cableAmps, LOAD_LIBRARY, PHASES, startAmps, TRANSFORMER_ID, transformerRatedAmps, type Board, type Level, type Phase } from '../sim';
import { BuildStage, webglAvailable } from './BuildStage';
import { fmt, hhmm } from './format';
import { LoadLibrary } from './LoadLibrary';
import { loadIcon, PartIcon, TERM_TITLES } from './PartIcon';
import { trackDrag } from './trackDrag';
import { TERMINAL_ATTR, useWireDrag } from './useWireDrag';
import { draftPath, drawWires, routeWires, type WireEnd } from './wireRoute';

const BOARD_W = 860;
const STREET = { x: 16, w: 100, h: 92 };
const PANEL_W = 136, PANEL_H = 116;
const ROOM_W = 168, ROOM_H = 100;
const ROOM_COLS = [472, 672];
const ROOM_GAP_Y = 12;
/** Boards stay left of the rooms, leaving a channel for the wires. */
const PANEL_MIN_X = 130, PANEL_MAX_X = ROOM_COLS[0] - PANEL_W - 52;
const DEFAULT_CABLE = 2.5;
/** Cables a room can use. Bigger sizes are for feeders between boards. */
const ROOM_CABLES = CABLE_SIZES.filter(mm => mm <= 10);
const MIN_SHEET_H = 300;
const SHEET_BOARD_X = 200;
/** With no rooms on it, the plan has the whole width for its boards. */
const PLAN_TOP_X = 180, PLAN_BELOW_X = 460, PLAN_MAX_X = BOARD_W - PANEL_W - 40;

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
  const top = level.boards.find(b => b.parent === null)!;
  const below = level.boards.filter(b => b.parent !== null);
  // With boards below the top one, the plan shows the boards, and each board's rooms open on a sheet of their own
  const hasSheets = below.length > 0;
  const [sheet, setSheet] = useState<string | null>(null);
  const sheetBoard = level.boards.find(b => b.id === sheet);
  const rooms = sheet ? level.circuits.filter(c => c.board === sheet) : hasSheets ? [] : level.circuits;
  const rows = Math.ceil(rooms.length / ROOM_COLS.length);
  const boardH = Math.max(rows * (ROOM_H + ROOM_GAP_Y) + ROOM_GAP_Y, MIN_SHEET_H);
  const shownBoards = sheetBoard ? [sheetBoard] : level.boards;
  const [spots, setSpots] = useState<Record<string, { x: number; y: number }>>(() => Object.fromEntries(level.boards.map(b => {
    if (b.parent === null) return [b.id, { x: below.length ? PLAN_TOP_X : SHEET_BOARD_X, y: boardH / 2 - PANEL_H / 2 }];
    const i = below.indexOf(b);
    return [b.id, { x: PLAN_BELOW_X, y: ((i + 0.5) / below.length) * boardH - PANEL_H / 2 }];
  })));
  const [pending, setPending] = useState<string | null>(null);
  const [cable, setCable] = useState(DEFAULT_CABLE);
  const [selected, setSelected] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ name: string; x: number; y: number } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const street = { x: STREET.x, y: boardH / 2 - STREET.h / 2 };
  const roomAt = (i: number) => ({ x: ROOM_COLS[i % ROOM_COLS.length], y: ROOM_GAP_Y + Math.floor(i / ROOM_COLS.length) * (ROOM_H + ROOM_GAP_Y) });
  const threePhase = level.boards.some(b => b.phases === 3);
  const solarScored = ((level.points ?? DEFAULT_POINTS).solar ?? 0) > 0;
  const nameOf = (b: Board) => (level.boards.length === 1 ? 'Board' : b.name);
  // Villas and villages are built in the 3D world. Buildings, and devices without 3D, use the diagram.
  const can3d = !level.boards.some(b => (b.floor ?? 0) > 0);
  const [view, setView] = useState<'3d' | 'diagram'>('3d');
  const [no3d, setNo3d] = useState(() => !webglAvailable());
  const in3d = can3d && !no3d && view === '3d';
  const [tool, setTool] = useState<SiteTool | null>(null);
  /** 3D: the house looked at up close, by its board, or null for the whole site. */
  const [focus, setFocus] = useState<string | null>(null);
  const houses = level.boards.filter(b => level.circuits.some(c => c.board === b.id));
  const roomCables = below.length ? CABLE_SIZES : ROOM_CABLES;
  /** A single-phase board fed from a three-phase one sits on one phase as a whole. */
  const onOnePhase = (b: Board) => b.phases === 1 && level.boards.find(x => x.id === b.parent)?.phases === 3;
  const phased = level.boards.some(b => onOnePhase(b) || (b.phases === 3 && level.circuits.some(c => c.board === b.id)));
  const boardPhase = (b: Board): Phase => build.boards[b.id].phase ?? b.phase;

  useEffect(() => {
    if (!tool) return;
    const drop = (e: KeyboardEvent) => { if (e.key === 'Escape') setTool(null); };
    addEventListener('keydown', drop);
    return () => removeEventListener('keydown', drop);
  }, [tool]);

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

  const openSheet = (id: string | null) => { setSheet(id); setSelected(null); setPending(null); setTip(null); };
  const spotOf = (id: string) => (id === sheet ? { x: SHEET_BOARD_X, y: boardH / 2 - PANEL_H / 2 } : spots[id]);

  const moveBoard = (id: string, x: number, y: number) =>
    setSpots(s => ({ ...s, [id]: { x: clamp(x, PANEL_MIN_X, hasSheets ? PLAN_MAX_X : PANEL_MAX_X), y: clamp(y, 0, boardH - PANEL_H) } }));

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

  /** 3D: pick up a part from the bar, or put it back by picking it again. */
  const takeTool = (t: SiteTool) => {
    setSelected(null);
    setTip(null);
    setTool(cur => (JSON.stringify(cur) === JSON.stringify(t) ? null : t));
    if (t.kind === 'cable') setCable(t.mm2);
  };
  /** 3D: a click on a room or a board uses the part in hand, or picks it to change its sizes. */
  const pick = (kind: 'room' | 'board', id: string) => {
    if (id === TRANSFORMER_ID) {
      if (tool) { setTip('The transformer comes with the site. Click it with nothing in hand to pick its size.'); return; }
      setTip(null);
      setSelected('transformer');
      return;
    }
    if (!tool) {
      setTip(null);
      setSelected(kind === 'room' ? roomIn(id) : `board.${id}`);
      return;
    }
    const r = applySiteTool(level, build, tool, { kind, id });
    if (!r.build) { setTip(r.tip); return; }
    update(r.build);
    if (tool.kind === 'board' || tool.kind === 'supply') setTool(null);
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

  const inAt = (id: string): WireEnd => ({ x: spotOf(id).x, y: spotOf(id).y + PANEL_H / 2, dir: -1 });
  const outAt = (id: string): WireEnd => ({ x: spotOf(id).x + PANEL_W, y: spotOf(id).y + PANEL_H / 2, dir: 1 });
  const routes = useMemo(() => {
    const placed = shownBoards.filter(b => build.boards[b.id].placed);
    const boxes = [
      ...(sheet ? [] : [{ left: street.x, right: street.x + STREET.w, top: street.y, bottom: street.y + STREET.h }]),
      ...placed.map(b => ({ left: spotOf(b.id).x, right: spotOf(b.id).x + PANEL_W, top: spotOf(b.id).y, bottom: spotOf(b.id).y + PANEL_H })),
      ...rooms.map((_, i) => { const at = roomAt(i); return { left: at.x, right: at.x + ROOM_W, top: at.y, bottom: at.y + ROOM_H }; }),
    ];
    const jobs = [
      ...(build.supplyWired && !sheet ? [{ id: STREET_OUT, from: STREET_OUT, to: boardIn(top.id), a: { x: street.x + STREET.w, y: street.y + STREET.h / 2, dir: 1 as const }, b: inAt(top.id) }] : []),
      ...below.filter(b => !sheet && build.boards[b.id].mm2 != null)
        .map(b => ({ id: feederWire(b.id), from: boardOut(b.parent!), to: boardIn(b.id), a: outAt(b.parent!), b: inAt(b.id) })),
      ...rooms.flatMap((c, i) => {
        if (build.rooms[c.id].mm2 == null) return [];
        const at = roomAt(i);
        return [{ id: roomIn(c.id), from: boardOut(c.board), to: roomIn(c.id), a: outAt(c.board), b: { x: at.x, y: at.y + ROOM_H / 2, dir: -1 as const } }];
      }),
    ];
    return drawWires(jobs, routeWires(jobs, BOARD_W, boardH, boxes));
    // Everything else here follows from the level, which fixes the board's size and the rooms
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, build, spots, sheet]);
  const preview = useMemo(() => {
    const r = siteDesign(level, build);
    return r.design ? designCost(r.design) : null;
  }, [level, build]);
  const wired = level.circuits.filter(c => build.rooms[c.id].mm2 != null).length;
  const budget = level.budget ?? null;
  const selectedBoard = level.boards.find(b => selected === `board.${b.id}`);
  const selectedRoom = level.circuits.find(c => selected === roomIn(c.id));

  /** Rooms on a phase, across the three-phase boards. */
  const onPhase = (p: Phase) => level.circuits.filter(c => build.rooms[c.id].phase === p && level.boards.find(b => b.id === c.board)?.phases === 3).length
    + level.boards.filter(b => onOnePhase(b) && boardPhase(b) === p).length;
  /** The board in hand, if any. */
  const held = tool?.kind === 'board' ? level.boards.find(b => b.id === tool.board) ?? top : null;

  const buildView = useMemo<BuildView>(() => ({
    boards: Object.fromEntries(level.boards.map(b => {
      const s = build.boards[b.id];
      const split = b.phases === 3 && s.placed ? PHASES.map((p, i) => `${p} ${fmt(needs.boards.get(b.id)?.phaseAmps?.[i] ?? 0, 0)}`).join(' · ') + ' A' : null;
      return [b.id, { placed: s.placed, fed: s.mm2 != null, name: nameOf(b), text: split ?? (s.placed ? `${s.breakerA} A` : 'not placed'), phase: onOnePhase(b) ? boardPhase(b) : null }];
    })),
    supplyWired: build.supplyWired,
    rooms: Object.fromEntries(level.circuits.map(c => {
      const r = build.rooms[c.id];
      const phase = level.boards.find(b => b.id === c.board)?.phases === 3 ? r.phase : null;
      return [c.id, { wired: r.mm2 != null, phase, text: r.mm2 != null ? `${r.breakerA} A · ${r.mm2} mm²` : `up to ${fmt(needs.circuits.get(c.id)?.amps ?? 0)} A` }];
    })),
    selected: selectedRoom?.id ?? selectedBoard?.id ?? null,
    targets: tool?.kind === 'supply' || (held && !houses.includes(held)) ? 'boards' : tool ? 'rooms' : null,
    ghostBoards: tool?.kind === 'board',
    ghostBoard: tool?.kind === 'board' ? tool.board ?? null : null,
    // With several houses in view their labels would pile up, so only the house looked at shows its rooms
    roomLabels: houses.length <= 1 ? 'all' : focus ?? 'none',
    // nameOf only reads the level
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [level, build, needs, selectedRoom, selectedBoard, tool, held, focus]);
  const toolHint = !tool
    ? 'Pick a part below, then click in the house. Click a room to change its sizes.'
    : tool.kind === 'board' ? (held && houses.includes(held)
      ? `Click a room in ${level.boards.length === 1 ? 'the house' : held.name} to fix its board at the end of the corridor.`
      : `Click the faint ${(held ?? top).name.toLowerCase()} to place it.`)
      : tool.kind === 'supply' ? `Click the ${nameOf(top).toLowerCase()} to bring the street cable to it.`
        : tool.kind === 'phase' ? `Click each room${level.boards.some(onOnePhase) ? ', or a single-phase board,' : ''} to move it onto ${tool.phase}. Keep L1, L2 and L3 about equal on every board.`
          : `Click each room to run a ${tool.mm2} mm² cable to it (good for ${cableAmps(tool.mm2)} A)${below.length ? ', or a board to run its feeder' : ''}. Pick the cable again, or press Esc, to put it down.`;

  return (
    <section className="sim site-build">
      <div className="stage-col">
        {can3d && !no3d && (
          <div className="seg view-pick" role="group" aria-label="View">
            <button type="button" id="view-3d" aria-pressed={view === '3d'} onClick={() => { setView('3d'); setSelected(null); setPending(null); }}>3D</button>
            <button type="button" id="view-diagram" aria-pressed={view === 'diagram'} onClick={() => { setView('diagram'); setSelected(null); setTool(null); }}>Diagram</button>
          </div>
        )}

        {in3d ? (
          <>
            <div className="stage-wrap build-wrap">
              <BuildStage
                level={level} view={buildView} focus={focus} onPick={pick} onFail={() => { setNo3d(true); setTool(null); }}
                onMiss={() => {
                  if (!tool) setSelected(null);
                  else setTip(below.length ? 'Click a room or a board.' : `Click inside the house: a room, or the ${nameOf(top).toLowerCase()} at the end of the corridor.`);
                }}
              />
              <p className="build-count"><b>{wired} of {level.circuits.length}</b> rooms wired</p>
              {houses.length > 3 && (
                <label className="focus-pick focus-select">Look at
                  <select id="focus-pick" value={focus ?? ''} onChange={e => setFocus(e.target.value || null)}>
                    <option value="">The whole site</option>
                    {houses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              )}
              {houses.length > 1 && houses.length <= 3 && (
                <div className="seg focus-pick" role="group" aria-label="Look at">
                  <button type="button" id="focus-site" aria-pressed={focus === null} onClick={() => setFocus(null)}>Whole site</button>
                  {houses.map(b => <button key={b.id} type="button" id={`focus-${b.id}`} aria-pressed={focus === b.id} onClick={() => setFocus(b.id)}>{b.name}</button>)}
                </div>
              )}
            </div>

            <div className="hotbar" role="toolbar" aria-label="Parts">
              {/* A board's slot goes once it is placed, so the bar keeps to what is left to do */}
              {level.boards.filter(b => !build.boards[b.id].placed).map(b => (
                <button
                  key={b.id} type="button" id={`tool-board-${b.id}`} className="hot-slot" aria-pressed={held?.id === b.id}
                  onClick={() => takeTool({ kind: 'board', board: b.id })}
                >
                  <PartIcon name="board" size={22} /><b>{nameOf(b)}</b><small>to place</small>
                </button>
              ))}
              <button
                type="button" id="tool-supply" className="hot-slot" aria-pressed={tool?.kind === 'supply'}
                disabled={build.supplyWired} onClick={() => takeTool({ kind: 'supply' })}
              >
                <PartIcon name="supply" size={22} /><b>Street cable</b><small>{build.supplyWired ? 'laid' : 'to the board'}</small>
              </button>
              {roomCables.map(mm => (
                <button
                  key={mm} type="button" id={`tool-cable-${mm}`} className="hot-slot cable" aria-pressed={tool?.kind === 'cable' && tool.mm2 === mm}
                  onClick={() => takeTool({ kind: 'cable', mm2: mm })}
                >
                  <i style={{ height: Math.min(8, 2 + mm * 0.6) }} aria-hidden="true" /><b>{mm} mm²</b><small>{cableAmps(mm)} A</small>
                </button>
              ))}
              {phased && PHASES.map(p => (
                <button
                  key={p} type="button" id={`tool-phase-${p}`} className={`hot-slot phase ph-${p}`} aria-pressed={tool?.kind === 'phase' && tool.phase === p}
                  onClick={() => takeTool({ kind: 'phase', phase: p })}
                >
                  <i aria-hidden="true">{p}</i><b>Phase {p}</b><small>{onPhase(p)} room{onPhase(p) === 1 ? '' : 's'}</small>
                </button>
              ))}
            </div>

            <div className="pick-strip" role="group" aria-label="Rooms">
              {level.transformer && (
                <span className="pick-group">
                  <button type="button" id="pick-transformer" className={`pick-chip board on${selected === 'transformer' ? ' sel' : ''}`} onClick={() => pick('board', TRANSFORMER_ID)}>
                    <PartIcon name="transformer" size={16} />{level.transformer.name} <small>{build.transformerKva} kVA</small>
                  </button>
                </span>
              )}
              {level.boards.map(b => (
                <span key={b.id} className="pick-group">
                  <button
                    type="button" id={`pick-board-${b.id}`}
                    className={`pick-chip board${build.boards[b.id].placed ? ' on' : ''}${selectedBoard?.id === b.id ? ' sel' : ''}`}
                    onClick={() => pick('board', b.id)}
                  >
                    <PartIcon name="board" size={16} />{nameOf(b)}
                    {onOnePhase(b) && <i className={`ph-tag ph-${boardPhase(b)}`}>{boardPhase(b)}</i>}
                  </button>
                  {level.circuits.filter(c => c.board === b.id).map(c => (
                    <button
                      key={c.id} type="button" id={`pick-${c.id}`} aria-label={level.boards.length > 1 ? `${b.name}, ${c.room}` : undefined}
                      className={`pick-chip${build.rooms[c.id].mm2 != null ? ' on' : ''}${selectedRoom?.id === c.id ? ' sel' : ''}`}
                      onClick={() => pick('room', c.id)}
                    >
                      <PartIcon name={loadIcon(c.type)} size={16} />{c.room}
                      {b.phases === 3 && <i className={`ph-tag ph-${build.rooms[c.id].phase}`}>{build.rooms[c.id].phase}</i>}
                    </button>
                  ))}
                </span>
              ))}
            </div>

            {selectedRoom && (() => {
              const c = selectedRoom, room = build.rooms[c.id], need = needs.circuits.get(c.id);
              const board = level.boards.find(b => b.id === c.board)!;
              return (
                <section className="panel pick-card" aria-label={c.room}>
                  <header><h2><PartIcon name={loadIcon(c.type)} size={20} /> {c.room}</h2><small>up to {fmt(need?.amps ?? 0)} A at {hhmm(need?.hour ?? 0)}</small></header>
                  {LOAD_LIBRARY[c.type].startMultiple > 1 && <p className="part-state starts">Starts at {fmt(startAmps(c.kw, c.type, level.voltage), 0)} A</p>}
                  <div className="pick-fields">
                    <label>Breaker
                      <select id={`brk-${c.id}`} value={room.breakerA} onChange={e => setRoom(c.id, { breakerA: Number(e.target.value) })}>
                        {BREAKER_SIZES.map(a => <option key={a} value={a}>{a} A</option>)}
                      </select>
                    </label>
                    <label>Cable
                      <select id={`cable-${c.id}`} value={room.mm2 ?? ''} onChange={e => setRoom(c.id, { mm2: e.target.value === '' ? null : Number(e.target.value) })}>
                        <option value="">None yet</option>
                        {roomCables.map(mm => <option key={mm} value={mm}>{mm} mm² · {cableAmps(mm)} A</option>)}
                      </select>
                    </label>
                    {board.phases === 3 && (
                      <label>Phase
                        <select id={`ph-${c.id}`} value={room.phase} onChange={e => setRoom(c.id, { phase: e.target.value as Phase })}>
                          {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                </section>
              );
            })()}
            {selected === 'transformer' && level.transformer && build.transformerKva !== null && (
              <section className="panel pick-card" aria-label={level.transformer.name}>
                <header>
                  <h2><PartIcon name="transformer" size={20} /> {level.transformer.name}</h2>
                  <small>busiest phase: {fmt(((needs.boards.get(top.id)?.amps ?? 0) / transformerRatedAmps(build.transformerKva, level.voltage)) * 100, 0)} % of this size</small>
                </header>
                <div className="pick-fields">
                  <label>Size
                    <select id="tx-kva" value={build.transformerKva} onChange={e => update({ transformerKva: Number(e.target.value) })}>
                      {TRANSFORMER_SIZES.map(k => <option key={k} value={k}>{k} kVA</option>)}
                    </select>
                  </label>
                  <small>Size it for the busiest moment, not every room at once.</small>
                </div>
              </section>
            )}
            {selectedBoard && (
              <section className="panel pick-card" aria-label={selectedBoard.name}>
                <header>
                  <h2><PartIcon name="board" size={20} /> {nameOf(selectedBoard)}</h2>
                  <small>{build.boards[selectedBoard.id].placed ? `everything at once: up to ${fmt(needs.boards.get(selectedBoard.id)?.amps ?? 0, 0)} A` : 'not placed yet'}</small>
                </header>
                {build.boards[selectedBoard.id].placed && (
                  <div className="pick-fields">
                    <label>{selectedBoard.parent ? 'Feeder breaker' : 'Main breaker'}
                      <select id={`brk-${selectedBoard.id}`} value={build.boards[selectedBoard.id].breakerA} onChange={e => setBoard(selectedBoard.id, { breakerA: Number(e.target.value) })}>
                        {BOARD_BREAKER_SIZES.map(a => <option key={a} value={a}>{a} A</option>)}
                      </select>
                    </label>
                    {onOnePhase(selectedBoard) && (
                      <label>Phase
                        <select id={`ph-${selectedBoard.id}`} value={boardPhase(selectedBoard)} onChange={e => setBoard(selectedBoard.id, { phase: e.target.value as Phase })}>
                          {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </label>
                    )}
                    {selectedBoard.parent ? (
                      <label>Feeder cable, {selectedBoard.cable?.lengthM} m
                        <select
                          id={`feeder-${selectedBoard.id}`} value={build.boards[selectedBoard.id].mm2 ?? ''}
                          onChange={e => setBoard(selectedBoard.id, { mm2: e.target.value === '' ? null : Number(e.target.value) })}
                        >
                          <option value="">None yet</option>
                          {CABLE_SIZES.map(mm => <option key={mm} value={mm}>{mm} mm² · {cableAmps(mm)} A</option>)}
                        </select>
                      </label>
                    ) : <small>{build.supplyWired ? 'Street cable laid' : 'No street cable yet'}</small>}
                  </div>
                )}
              </section>
            )}
          </>
        ) : (
          <>
            <section className="panel tray" aria-label="Parts">
              <h2>Parts</h2>
              <div className="tray-items">
                {level.boards.map(b => (
                  <button
                    key={b.id} id={`tray-${b.id}`} type="button" className="tray-item" disabled={build.boards[b.id].placed}
                    onPointerDown={e => startTrayDrag(e, b)} onClick={() => { if (!dragged.current) placeBoard(b); dragged.current = false; }}
                  >
                    <PartIcon name="board" size={20} /> <b>{b.name}</b> <small>{build.boards[b.id].placed ? 'placed' : '1 left'}</small>
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

            {hasSheets && (
              <nav className="sheet-path" aria-label="Sheets">
                {sheetBoard
                  ? <><button type="button" id="sheet-up" className="btn" onClick={() => openSheet(null)}>{level.title}</button><span aria-hidden="true">›</span><b>{sheetBoard.name}</b></>
                  : <b>{level.title}</b>}
              </nav>
            )}

            <div className="board-scroll">
              <div
                ref={area} className="board" style={{ width: BOARD_W, height: boardH }}
                onPointerDown={e => { if (e.target === e.currentTarget) { setSelected(null); setPending(null); } }}
              >
                <svg className="wires" width={BOARD_W} height={boardH} aria-hidden={wired === 0 && !build.supplyWired}>
                  {build.supplyWired && !sheet && (
                    <SiteWire id={STREET_OUT} label={`Street to ${top.name}`} d={routes.paths.get(STREET_OUT)!} mm2={16} selected={selected === STREET_OUT} onSelect={setSelected} />
                  )}
                  {below.map(b => {
                    const mm2 = build.boards[b.id].mm2;
                    if (mm2 == null || sheet) return null;
                    return <SiteWire key={b.id} id={feederWire(b.id)} label={`${b.name} feeder, ${mm2} mm²`} d={routes.paths.get(feederWire(b.id))!} mm2={mm2} selected={selected === feederWire(b.id)} onSelect={setSelected} />;
                  })}
                  {rooms.map(c => {
                    const mm2 = build.rooms[c.id].mm2;
                    if (mm2 == null) return null;
                    return <SiteWire key={c.id} id={roomIn(c.id)} label={`${c.room} cable, ${mm2} mm²`} d={routes.paths.get(roomIn(c.id))!} mm2={mm2} selected={selected === roomIn(c.id)} onSelect={setSelected} />;
                  })}
                  {routes.dots.map(p => <circle key={`${p.x},${p.y}`} className="wire-dot" cx={p.x} cy={p.y} r={3.5} />)}
                  {wireDraft && <path className="wire-preview" d={draftPath(wireDraft)} />}
                </svg>

                {wired === 0 && !build.supplyWired && !sheet && <p className="board-tip">Drag from one circle to another to add a wire.</p>}
                {wired === 0 && build.supplyWired && hasSheets && !sheet && <p className="board-tip left">Press Open on a board to wire its rooms.</p>}

                {!sheet && (
                  <div className="part kind-supply" style={{ left: street.x, top: street.y, width: STREET.w, height: STREET.h }}>
                    <PartIcon name="supply" />
                    <span className="part-name">Street supply</span>
                    <button id="term-street" type="button" aria-label="Street supply" {...termProps(STREET_OUT, build.supplyWired, 'b')} />
                  </div>
                )}

                {shownBoards.filter(b => build.boards[b.id].placed).map(b => {
                  const need = needs.boards.get(b.id);
                  const split = b.phases === 3 ? PHASES.map((p, i) => `${p} ${fmt(need?.phaseAmps?.[i] ?? 0, 0)}`).join(' · ') : `${fmt(need?.amps ?? 0, 0)} A`;
                  const parent = level.boards.find(x => x.id === b.parent);
                  const own = level.circuits.filter(c => c.board === b.id);
                  const ownWired = own.filter(c => build.rooms[c.id].mm2 != null).length;
                  const closed = hasSheets && !sheet && own.length > 0;
                  const onSheet = b.id === sheet;
                  const at = spotOf(b.id);
                  return (
                    <div
                      key={b.id} id={`part-${b.id}`} role="group" tabIndex={0} aria-label={b.name} className={`part panel-part${selected === `board.${b.id}` ? ' sel' : ''}${closed && ownWired === own.length ? ' sheet-done' : ''}`}
                      style={{ left: at.x, top: at.y, width: PANEL_W, height: PANEL_H }}
                      onPointerDown={e => { if (onSheet) return; setSelected(`board.${b.id}`); startMoveBoard(e, b.id); }}
                      onDoubleClick={() => { if (closed) openSheet(b.id); }}
                      onKeyDown={e => {
                        if (onSheet) return;
                        const step: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
                        if (step[e.key]) { e.preventDefault(); moveBoard(b.id, spots[b.id].x + step[e.key][0], spots[b.id].y + step[e.key][1]); }
                      }}
                    >
                      <span className="part-title"><PartIcon name="board" size={20} /><span className="part-name">{nameOf(b)}</span></span>
                      <small className="part-state">{split}</small>
                      <select
                        id={`brk-${b.id}`} aria-label={`${b.name} breaker`} value={build.boards[b.id].breakerA}
                        onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                        onChange={e => setBoard(b.id, { breakerA: Number(e.target.value) })}
                      >
                        {BOARD_BREAKER_SIZES.map(a => <option key={a} value={a}>{a} A</option>)}
                      </select>
                      {closed && (
                        <span className="sheet-open">
                          <small>{ownWired} of {own.length} wired</small>
                          <button
                            type="button" id={`open-${b.id}`} className="btn" aria-label={`Open ${b.name}`}
                            onPointerDown={e => e.stopPropagation()} onClick={() => openSheet(b.id)}
                          >Open</button>
                        </span>
                      )}
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

                {rooms.map((c, i) => {
                  const at = roomAt(i);
                  const need = needs.circuits.get(c.id);
                  const t = roomIn(c.id);
                  const board = level.boards.find(b => b.id === c.board)!;
                  const room = build.rooms[c.id];
                  return (
                    <div key={c.id} id={`room-${c.id}`} role="group" aria-label={c.room} className="part room-part" style={{ left: at.x, top: at.y, width: ROOM_W, height: ROOM_H }}>
                      <span className="part-title"><PartIcon name={loadIcon(c.type)} size={22} /><span className="part-name">{c.room}</span></span>
                      <small className="part-state">up to {fmt(need?.amps ?? 0)} A at {hhmm(need?.hour ?? 0)}</small>
                      {LOAD_LIBRARY[c.type].startMultiple > 1 && <small className="part-state starts">starts at {fmt(startAmps(c.kw, c.type, level.voltage), 0)} A</small>}
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
          </>
        )}

        <div className="controls workshop-controls">
          <button type="button" id="power-on" className="btn primary power-on" onClick={pressPowerOn}>Power On</button>
          <button type="button" id="open-library" className="btn" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(o => !o)}>Load library</button>
          <span className="hint-now">
            {in3d ? toolHint : pending ? 'Now click where this wire goes.' : 'Drag between two circles to add a wire, or click one, then the other. New wires use the cable picked above.'}
          </span>
          {selectedBoard
            ? <button type="button" className="btn" onClick={() => removeBoard(selectedBoard.id)}>Remove the board</button>
            : selected && <button type="button" className="btn" onClick={removeWire}>Remove the wire</button>}
        </div>

        {libraryOpen && <LoadLibrary voltage={level.voltage} onThisJob={[...new Set(level.circuits.map(c => c.type))]} />}
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

function SiteWire({ id, label, d, mm2, selected, onSelect }: {
  id: string; label: string; d: string; mm2: number; selected: boolean; onSelect: (id: string) => void;
}) {
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
