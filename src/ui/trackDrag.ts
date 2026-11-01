/** How far the pointer must move before a press counts as a drag rather than a click. */
const DRAG_START_PX = 6;

/** Follow a pointer from this press until it is released. onMove runs only once it counts as a drag. */
export function trackDrag(
  e: { clientX: number; clientY: number },
  onMove: (x: number, y: number) => void,
  onEnd: (x: number, y: number, moved: boolean) => void,
): void {
  const x0 = e.clientX, y0 = e.clientY;
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > DRAG_START_PX) moved = true;
    if (moved) onMove(ev.clientX, ev.clientY);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    onEnd(ev.clientX, ev.clientY, moved);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
