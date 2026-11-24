import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PALETTE, compact, monthLabel, num } from '../format';

const axisProps = { stroke: '#94a3b8', fontSize: 11, tickLine: false } as const;

/** Wide, labelled multi-series line chart over time. `rows` = [{period, <key>: value}]. */
export function MultiLine({ rows, keys, height = 280, fmt = compact, yLabel }: {
  rows: any[]; keys: string[]; height?: number; fmt?: (v: any) => string; yLabel?: string;
}) {
  if (!rows?.length) return <p className="py-10 text-center text-sm text-slate-500">No data for the current selection.</p>;
  return (
    <div role="img" aria-label={`Line chart of ${keys.join(', ')} over time`}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis dataKey="period" tickFormatter={monthLabel} minTickGap={36} {...axisProps} />
          <YAxis tickFormatter={(v) => fmt(v)} width={56} label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' } : undefined} {...axisProps} />
          <Tooltip labelFormatter={(l) => monthLabel(String(l))} formatter={(v: any, n: any) => [fmt(v), n]} />
          {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {keys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SimpleBars({ rows, x, keys, height = 260, fmt = compact, layout = 'vertical' }: {
  rows: any[]; x: string; keys: string[]; height?: number; fmt?: (v: any) => string; layout?: 'vertical' | 'horizontal';
}) {
  if (!rows?.length) return <p className="py-10 text-center text-sm text-slate-500">No data for the current selection.</p>;
  const horizontal = layout === 'horizontal';
  return (
    <div role="img" aria-label={`Bar chart of ${keys.join(', ')} by ${x}`}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, left: horizontal ? 24 : 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={!horizontal} vertical={horizontal} />
          {horizontal ? (<><XAxis type="number" tickFormatter={(v) => fmt(v)} {...axisProps} /><YAxis type="category" dataKey={x} width={110} {...axisProps} /></>)
            : (<><XAxis dataKey={x} {...axisProps} /><YAxis tickFormatter={(v) => fmt(v)} width={56} {...axisProps} /></>)}
          <Tooltip formatter={(v: any, n: any) => [fmt(v), n]} />
          {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {keys.map((k, i) => <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Historical series + forecast with 80% / 95% prediction bands. */
export function ForecastChart({ history, forecast, height = 320, unit }: { history: any[]; forecast: any[]; height?: number; unit?: string }) {
  const lastHist = history[history.length - 1];
  const rows = [
    ...history.map((h) => ({ period: h.period, actual: h.value })),
    ...forecast.map((f) => ({ period: f.period, forecast: f.value, band95: [f.lower_95, f.upper_95], band80: [f.lower_80, f.upper_80] })),
  ];
  // connect the forecast line to the last observed point
  if (lastHist && forecast.length) {
    const i = history.length - 1;
    (rows[i] as any).forecast = lastHist.value;
  }
  return (
    <div role="img" aria-label={`Historical values and forecast${unit ? ` in ${unit}` : ''} with prediction intervals`}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis dataKey="period" tickFormatter={monthLabel} minTickGap={36} {...axisProps} />
          <YAxis tickFormatter={(v) => compact(v)} width={56} {...axisProps} />
          <Tooltip labelFormatter={(l) => monthLabel(String(l))}
            formatter={(v: any, n: any) => [Array.isArray(v) ? `${compact(v[0])} – ${compact(v[1])}` : compact(v), n]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area dataKey="band95" name="95% interval" stroke="none" fill="#e69f00" fillOpacity={0.15} isAnimationActive={false} />
          <Area dataKey="band80" name="80% interval" stroke="none" fill="#e69f00" fillOpacity={0.3} isAnimationActive={false} />
          <Line dataKey="actual" name="Historical" stroke="#1f7a8c" strokeWidth={2} dot={false} />
          <Line dataKey="forecast" name="Forecast" stroke="#d55e00" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Series with one highlighted anomalous point (alert detail). */
export function AnomalyChart({ series, point, expected }: { series: any[]; point: { period: string; value: number }; expected?: number | null }) {
  return (
    <div role="img" aria-label="Time series with the flagged observation highlighted">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis dataKey="period" tickFormatter={monthLabel} minTickGap={36} {...axisProps} />
          <YAxis tickFormatter={(v) => compact(v)} width={56} {...axisProps} />
          <Tooltip labelFormatter={(l) => monthLabel(String(l))} formatter={(v: any) => [num(v, 2), 'Reported value']} />
          <Line dataKey="value" stroke="#1f7a8c" strokeWidth={2} dot={false} />
          <ReferenceDot x={point.period} y={point.value} r={7} fill="#b91c1c" stroke="#fff" strokeWidth={2} ifOverflow="extendDomain" />
          {expected != null && <ReferenceDot x={point.period} y={expected} r={5} fill="#fff" stroke="#e69f00" strokeWidth={2} ifOverflow="extendDomain" />}
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-slate-500"><span className="font-semibold text-red-700">● Red</span>: observed value. <span className="font-semibold text-amber-600">○ Amber</span>: expected baseline.</p>
    </div>
  );
}

export function Sparkline({ values, color = '#1f7a8c' }: { values: number[]; color?: string }) {
  if (!values?.length) return null;
  const rows = values.map((v, i) => ({ i, v }));
  return (
    <div aria-hidden className="h-8 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows}><Line dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} /></LineChart>
      </ResponsiveContainer>
    </div>
  );
}
