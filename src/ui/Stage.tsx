import { useEffect, useRef, useState } from 'react';
import { SiteScene } from '../render/SiteScene';
import type { LabelMode } from '../render/labelRules';
import type { Level, SimResult } from '../sim';

interface Props {
  level: Level;
  result: SimResult;
  roofOn: boolean;
  faded: ReadonlySet<string>;
  labelMode: LabelMode;
  floorLimit: number | null;
  onRoomClick: (id: string) => void;
  /** Start close in on the house, as when it was built. */
  closeUp?: boolean;
}

/** Hosts the Three.js scene and passes it each new result. */
export function Stage({ level, result, roofOn, faded, labelMode, floorLimit, onRoomClick, closeUp = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SiteScene | null>(null);
  const latest = useRef({ result, roofOn, faded, labelMode, floorLimit, onRoomClick, closeUp });
  const [failed, setFailed] = useState(false);

  useEffect(() => { latest.current = { result, roofOn, faded, labelMode, floorLimit, onRoomClick, closeUp }; });

  // Create the scene once per level and bring it up to date with the current props
  useEffect(() => {
    let s: SiteScene;
    try {
      s = new SiteScene(host.current!, level);
    } catch (e) {
      console.error('3D view could not start', e);
      setFailed(true);
      return;
    }
    const p = latest.current;
    s.onRoomClick = id => latest.current.onRoomClick(id);
    s.update(p.result);
    s.setRoofVisible(p.roofOn);
    s.setFaded(p.faded);
    s.setLabelMode(p.labelMode);
    s.setFloorLimit(p.floorLimit);
    if (p.closeUp) s.closeIn();
    scene.current = s;
    return () => { s.dispose(); scene.current = null; };
  }, [level]);

  useEffect(() => { scene.current?.update(result); }, [result]);
  useEffect(() => { scene.current?.setRoofVisible(roofOn); }, [roofOn]);
  useEffect(() => { scene.current?.setFaded(faded); }, [faded]);
  useEffect(() => { scene.current?.setLabelMode(labelMode); }, [labelMode]);
  useEffect(() => { scene.current?.setFloorLimit(floorLimit); }, [floorLimit]);

  return (
    <div className="stage" ref={host}>
      {failed && <p className="fallback">The 3D view could not start on this device (WebGL is off or not supported). The circuit list still runs.</p>}
    </div>
  );
}
