import { useEffect, useRef } from 'react';

/** Calls onTick(seconds since last frame) on every animation frame while running. */
export function useAnimationClock(running: boolean, onTick: (dtSeconds: number) => void): void {
  const tick = useRef(onTick);
  useEffect(() => { tick.current = onTick; });

  useEffect(() => {
    if (!running) return;
    let last = performance.now(), id = 0;
    const loop = (now: number) => {
      // Cap the step so a hidden tab does not jump hours ahead when it comes back.
      // A frame can be stamped just before the clock started, so never step backwards either.
      tick.current(Math.max(0, Math.min((now - last) / 1000, 0.25)));
      last = now;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [running]);
}
