import { useEffect, useRef, useState } from 'react';
import { VillaScene } from '../render/VillaScene';
import type { SimResult, VillaData } from '../sim';

interface Props {
  data: VillaData;
  result: SimResult;
  roofOn: boolean;
  faded: ReadonlySet<string>;
  onRoomClick: (id: string) => void;
}

/** Hosts the Three.js scene and passes it each new result. */
export function Stage({ data, result, roofOn, faded, onRoomClick }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<VillaScene | null>(null);
  const latest = useRef({ result, roofOn, faded, onRoomClick });
  const [failed, setFailed] = useState(false);

  useEffect(() => { latest.current = { result, roofOn, faded, onRoomClick }; });

  // Create the scene once per level and bring it up to date with the current props
  useEffect(() => {
    let s: VillaScene;
    try {
      s = new VillaScene(host.current!, data);
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
    scene.current = s;
    return () => { s.dispose(); scene.current = null; };
  }, [data]);

  useEffect(() => { scene.current?.update(result); }, [result]);
  useEffect(() => { scene.current?.setRoofVisible(roofOn); }, [roofOn]);
  useEffect(() => { scene.current?.setFaded(faded); }, [faded]);

  return (
    <div className="stage" ref={host}>
      {failed && <p className="fallback">The 3D view could not start on this device (WebGL is off or not supported). The circuit list still runs.</p>}
    </div>
  );
}
