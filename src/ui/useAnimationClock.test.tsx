// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnimationClock } from './useAnimationClock';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Start the clock at 1000 ms, and hand back a way to fire the next animation frame. */
function startClock(onTick: (dt: number) => void) {
  let next: FrameRequestCallback = () => {};
  vi.spyOn(performance, 'now').mockReturnValue(1000);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { next = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  renderHook(() => useAnimationClock(true, onTick));
  return (now: number) => next(now);
}

describe('useAnimationClock', () => {
  it('reports the seconds since the last frame', () => {
    const onTick = vi.fn();
    startClock(onTick)(1100);
    expect(onTick).toHaveBeenLastCalledWith(0.1);
  });

  it('never steps backwards when a frame is stamped before the clock started', () => {
    const onTick = vi.fn();
    startClock(onTick)(990);
    expect(onTick).toHaveBeenLastCalledWith(0);
  });

  it('caps the step after a hidden tab comes back', () => {
    const onTick = vi.fn();
    startClock(onTick)(60_000);
    expect(onTick).toHaveBeenLastCalledWith(0.25);
  });
});
