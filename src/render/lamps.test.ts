import { describe, expect, it } from 'vitest';
import { LIGHTS_ON_BELOW, roomGlow } from './lamps';

describe('room lights', () => {
  it('stay off in daylight', () => {
    expect(roomGlow(false, 1, 1)).toBe(0);
    expect(roomGlow(false, 1, LIGHTS_ON_BELOW)).toBe(0);
  });

  it('come on as it gets dark, fully at night', () => {
    const dusk = roomGlow(false, 1, LIGHTS_ON_BELOW * 0.8);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
    expect(roomGlow(false, 1, 0)).toBe(1);
  });

  it('stay dark in a room with no power, or nothing running', () => {
    expect(roomGlow(true, 1, 0)).toBe(0);
    expect(roomGlow(false, 0, 0)).toBe(0);
  });
});
