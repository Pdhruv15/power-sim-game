/**
 * Which room labels to show, so a busy building stays readable.
 *   smart  rooms and boards that need attention, the main board, the room under the pointer and its board,
 *          and any room the player clicked
 *   all    every room
 *   off    none, except boards that are overloaded or tripped (trip markers always stay)
 */
export type LabelMode = 'smart' | 'all' | 'off';

export const LABEL_MODES: readonly LabelMode[] = ['smart', 'all', 'off'];

export interface RoomState {
  band: 'ok' | 'warn' | 'high';
  overloaded: boolean;
  tripped: boolean;
  dead: boolean;
}

/** True when a room is worth flagging on its own: running above 90 %, overloaded, tripped or without power. */
export const needsAttention = (r: RoomState): boolean => r.band === 'high' || r.overloaded || r.tripped || r.dead;

/** With the transformer off everything is dead. Its own label says why, so one label per room adds only clutter. */
export const inBlackout = (r: RoomState): RoomState => ({ ...r, dead: false });

export function roomLabelVisible(mode: LabelMode, room: RoomState, selected: boolean, hovered: boolean): boolean {
  if (mode === 'all') return true;
  if (mode === 'off') return false;
  return selected || hovered || needsAttention(room);
}

/** isTop: the board fed from the grid. related: the board feeds the room under the pointer or a clicked room. */
export function boardLabelVisible(mode: LabelMode, board: RoomState, isTop: boolean, related: boolean): boolean {
  if (mode === 'all') return true;
  if (mode === 'off') return board.overloaded || board.tripped;
  return isTop || related || needsAttention(board);
}
