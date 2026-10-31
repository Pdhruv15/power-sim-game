import type { SimResult } from '../sim';
import { fmt, hhmm } from './format';

/** Headline numbers over the 3D view. */
export function Kpis({ result: r, solarKwp }: { result: SimResult; solarKwp: number }) {
  const sunDeg = (r.sun.elevation * 180) / Math.PI;
  const exporting = r.gridKw < 0;
  const t = r.transformer;
  return (
    <div className={`kpis${t ? ' six' : ''}`}>
      <div className="kpi k-time"><span>Time</span><b>{hhmm(r.hour)}</b><small>{sunDeg > 0 ? `sun ${fmt(sunDeg, 0)}°` : 'night'}</small></div>
      <div className="kpi"><span>Load</span><b>{fmt(r.loadKw)} kW</b><small>{fmt(r.loadA)} A</small></div>
      <div className="kpi"><span>Solar</span><b>{fmt(r.solarKw)} kW</b><small>of {solarKwp} kWp</small></div>
      <div className="kpi"><span>Grid</span><b className={exporting ? 'exp' : undefined}>{fmt(Math.abs(r.gridKw))} kW</b><small>{exporting ? 'export' : 'import'}</small></div>
      {t && (
        <div className={`kpi st-${t.tripped ? 'off' : t.band}`}>
          <span>Transformer</span>
          <b>{t.tripped ? 'OFF' : `${fmt(t.loading * 100, 0)}%`}</b>
          <small>{fmt(t.loadKva, 0)} / {t.kva} kVA</small>
        </div>
      )}
      <div className={`kpi st-${r.main.tripped ? 'off' : r.main.band}`}>
        <span>Main breaker</span>
        <b>{r.main.tripped ? 'TRIPPED' : `${fmt(r.main.loading * 100, 0)}%`}</b>
        <small>{fmt(r.main.amps)} / {r.main.ratingA} A</small>
      </div>
    </div>
  );
}
