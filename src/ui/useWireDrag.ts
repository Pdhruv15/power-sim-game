import { useRef, useState, type RefObject } from 'react';
import { trackDrag } from './trackDrag';

/** Connection points carry this attribute, naming the terminal a dropped wire lands on. */
export const TERMINAL_ATTR = 'data-terminal';

/** Drag from one connection point to another to make a wire. Clicking one, then the other, keeps working. */
export function useWireDrag(area: RefObject<HTMLElement>, connect: (from: string, to: string) => void) {
  const [preview, setPreview] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const dragged = useRef(false);

  const startWireDrag = (e: React.PointerEvent<HTMLElement>, from: string) => {
    e.stopPropagation();
    dragged.current = false;
    const box = area.current?.getBoundingClientRect();
    if (!box) return;
    const at = e.currentTarget.getBoundingClientRect();
    const x1 = at.left + at.width / 2 - box.left, y1 = at.top + at.height / 2 - box.top;
    trackDrag(e, (x, y) => {
      dragged.current = true;
      setPreview({ x1, y1, x2: x - box.left, y2: y - box.top });
    }, (x, y, moved) => {
      setPreview(null);
      if (!moved) return;
      const to = document.elementFromPoint(x, y)?.closest(`[${TERMINAL_ATTR}]`)?.getAttribute(TERMINAL_ATTR);
      if (to && to !== from) connect(from, to);
    });
  };

  /** True when the click that ends a press belongs to a drag, so it should not start a wire too. */
  const endedDrag = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };

  return { preview, startWireDrag, endedDrag };
}
