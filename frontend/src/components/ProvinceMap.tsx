import { useEffect, useState } from 'react';
import { compact, pct } from '../format';

type Row = { area: string; volume: number; share_pct: number | null; growth_pct: number | null };
type Geo = { w: number; h: number; src: string; districts: { name: string; d: string }[] };

// Province of each district (Rwanda, 30 districts).
const PROVINCE_OF: Record<string, string> = {};
const GROUPS: Record<string, string[]> = {
  'Kigali City': ['Nyarugenge', 'Gasabo', 'Kicukiro'],
  'Northern Province': ['Burera', 'Gakenke', 'Gicumbi', 'Musanze', 'Rulindo'],
  'Southern Province': ['Gisagara', 'Huye', 'Kamonyi', 'Muhanga', 'Nyamagabe', 'Nyanza', 'Nyaruguru', 'Ruhango'],
  'Eastern Province': ['Bugesera', 'Gatsibo', 'Kayonza', 'Kirehe', 'Ngoma', 'Nyagatare', 'Rwamagana'],
  'Western Province': ['Karongi', 'Ngororero', 'Nyabihu', 'Nyamasheke', 'Rubavu', 'Rusizi', 'Rutsiro'],
};
for (const [p, ds] of Object.entries(GROUPS)) ds.forEach((d) => (PROVINCE_OF[d] = p));

let geoPromise: Promise<Geo> | undefined;
const loadGeo = () => (geoPromise ??= fetch('/rwanda-districts.json').then((r) => { if (!r.ok) throw new Error('map'); return r.json(); }));

/** Province-level map of Rwanda. Districts are drawn individually and shaded by their province's value. */
export function ProvinceMap({ rows }: { rows: Row[] }) {
  const [geo, setGeo] = useState<Geo | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<{ province: string; x: number; y: number } | null>(null);
  useEffect(() => { loadGeo().then(setGeo).catch(() => setFailed(true)); }, []);

  const byProv = new Map(rows.filter((r) => Object.keys(GROUPS).includes(r.area)).map((r) => [r.area, r]));
  if (failed || byProv.size < 2) return null; // only meaningful when the data uses Rwandan province names
  if (!geo) return <div className="h-64 animate-pulse rounded-lg bg-slate-100" />;

  const vals = [...byProv.values()].map((r) => r.volume);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const shade = (v: number | undefined) => {
    if (v == null) return 'var(--map-none, #e2e8f0)';
    const t = hi === lo ? 0.6 : (v - lo) / (hi - lo);
    return `hsl(192 ${35 + 30 * t}% ${88 - 52 * t}%)`; // light → dark teal
  };
  const h = hover ? byProv.get(hover.province) : undefined;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${geo.w} ${geo.h}`} className="mx-auto block h-auto w-full max-w-md" role="img" aria-label="Map of Rwanda shaded by province transaction volume">
        {geo.districts.map((d) => {
          const p = PROVINCE_OF[d.name];
          const on = hover?.province === p;
          return (
            <path key={d.name} d={d.d} fill={shade(byProv.get(p)?.volume)} stroke={on ? '#0f172a' : '#ffffff'} strokeWidth={on ? 1.5 : 0.8}
              tabIndex={0} aria-label={`${d.name}, ${p}: ${byProv.get(p) ? compact(byProv.get(p)!.volume) : 'no data'}`}
              className="cursor-pointer outline-none focus-visible:stroke-slate-900"
              onMouseMove={(e) => { const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect(); setHover({ province: p, x: e.clientX - r.left, y: e.clientY - r.top }); }}
              onFocus={() => setHover({ province: p, x: 20, y: 20 })} onBlur={() => setHover(null)} onMouseLeave={() => setHover(null)} />
          );
        })}
      </svg>
      {hover && h && (
        <div className="pointer-events-none absolute z-10 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg" style={{ left: hover.x + 14, top: hover.y + 10 }}>
          <div className="font-semibold">{h.area}</div>
          <div>Volume {compact(h.volume)} · share {pct(h.share_pct, 1, false)}</div>
          <div>Growth {pct(h.growth_pct)}</div>
        </div>
      )}
      <div className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-500">
        <span>{compact(lo)}</span>
        <span className="h-2.5 w-32 rounded-sm" style={{ background: `linear-gradient(to right, ${shade(lo)}, ${shade(hi)})` }} />
        <span>{compact(hi)}</span>
      </div>
      <p className="mt-1 text-center text-[11px] text-slate-400">Shading is by province; district boundaries from geoBoundaries RWA ADM2 (CC BY 4.0).</p>
    </div>
  );
}
