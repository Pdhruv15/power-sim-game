/**
 * Which room labels to show, so a busy building stays readable.
 *   smart  rooms that need attention, plus the one under the pointer and any the player clicked
 *   all    every room
 *   off    none (board labels and trip markers stay)
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

export function roomLabelVisible(mode: LabelMode, room: RoomState, selected: boolean, hovered: boolean): boolean {
  if (mode === 'all') return true;
  if (mode === 'off') return false;
  return selected || hovered || needsAttention(room);
}
