import { useEffect, useRef } from 'react';
import { SiteScene, type BuildView } from '../render/SiteScene';
import { Simulator, type Level } from '../sim';

/** Midday, so the site is in full light while the player builds. */
const BUILD_HOUR = 12;

/** Whether this device can draw 3D at all, checked before choosing the 3D view. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface Props {
  level: Level;
  view: BuildView;
  /** House to look at up close, by its board, or null for the whole site. */
  focus?: string | null;
  onPick: (kind: 'room' | 'board', id: string) => void;
  /** A click landed on neither a room nor a board. */
  onMiss: () => void;
  /** The 3D view could not start, so the caller shows the diagram instead. */
  onFail: () => void;
}

/** Hosts the Three.js scene in build mode: the site as built so far, with the roof off and the view held still. */
export function BuildStage({ level, view, focus = null, onPick, onMiss, onFail }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SiteScene | null>(null);
  const latest = useRef({ view, onPick, onMiss, onFail });

  useEffect(() => { latest.current = { view, onPick, onMiss, onFail }; });

  useEffect(() => {
    let s: SiteScene;
    try {
      s = new SiteScene(host.current!, level);
    } catch (e) {
      console.error('3D view could not start', e);
      latest.current.onFail();
      return;
    }
    s.onPick = (kind, id) => latest.current.onPick(kind, id);
    s.onMiss = () => latest.current.onMiss();
    s.update(new Simulator(level, BUILD_HOUR).result());
    s.setRoofVisible(false);
    s.setBuildView(latest.current.view);
    scene.current = s;
    return () => { s.dispose(); scene.current = null; };
  }, [level]);

  useEffect(() => { scene.current?.setBuildView(view); }, [view]);
  useEffect(() => { scene.current?.focusOn(focus); }, [focus]);

  return <div className="stage build-stage" ref={host} />;
}
