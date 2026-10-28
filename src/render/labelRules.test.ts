import { describe, expect, it } from 'vitest';
import { roomLabelVisible, type RoomState } from './labelRules';

const calm: RoomState = { band: 'ok', overloaded: false, tripped: false, dead: false };

describe('roomLabelVisible', () => {
  it('shows every room in "all" and none in "off"', () => {
    expect(roomLabelVisible('all', calm, false, false)).toBe(true);
    expect(roomLabelVisible('off', { ...calm, tripped: true }, true, true)).toBe(false);
  });

  it('hides calm rooms in "smart" mode', () => {
    expect(roomLabelVisible('smart', calm, false, false)).toBe(false);
    expect(roomLabelVisible('smart', { ...calm, band: 'warn' }, false, false)).toBe(false);
  });

  it('shows rooms that need attention, and the hovered or clicked room', () => {
    for (const s of [{ band: 'high' as const }, { overloaded: true }, { tripped: true }, { dead: true }]) {
      expect(roomLabelVisible('smart', { ...calm, ...s }, false, false)).toBe(true);
    }
    expect(roomLabelVisible('smart', calm, true, false)).toBe(true);
    expect(roomLabelVisible('smart', calm, false, true)).toBe(true);
  });
});
