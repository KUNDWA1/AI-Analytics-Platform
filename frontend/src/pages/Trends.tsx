import { useState } from 'react';
import { errMsg, post } from '../api';
import { AreaSelect, IndicatorSelect, useSelectorData } from '../components/Selectors';
import { Badge, Card, Empty, ErrorBox, Field, Notice, PageHeader, Spinner, Stat, SyntheticBanner, Table } from '../components/ui';
import { MultiLine, SimpleBars } from '../components/charts';
import { cap, compact, monthLabel, num, pct } from '../format';

type Tab = 'trend' | 'compare' | 'regions';

export default function Trends() {
  const [tab, setTab] = useState<Tab>('trend');
  const { indicators, filters, usable } = useSelectorData();
  return (
    <div>
      <PageHeader title="AI trend analysis" subtitle="Historical trends, growth rates, moving averages, indicator comparisons and regional comparisons computed from stored observations." />
      <div role="tablist" className="mb-5 flex gap-1 border-b border-slate-200">
        {([['trend', 'Trend analysis'], ['compare', 'Indicator comparison'], ['regions', 'Regional comparison']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-brand-600 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>
        ))}
      </div>
      {indicators.loading && !indicators.data && <Spinner />}
      {indicators.error && <ErrorBox message={indicators.error} onRetry={indicators.reload} />}
      {indicators.data && !usable.length && <Card><Empty title="No indicators with data yet" hint="Upload and process a dataset first." /></Card>}
      {usable.length > 0 && (tab === 'trend' ? <TrendTab usable={usable} areas={filters.data?.areas || []} />
        : tab === 'compare' ? <CompareTab usable={usable} areas={filters.data?.areas || []} /> : <RegionsTab usable={usable} />)}
    </div>
  );
}

function useRunner<T>() {
  const [res, setRes] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<T>) => { setBusy(true); setErr(null); try { setRes(await fn()); } catch (e) { setRes(null); setErr(errMsg(e)); } finally { setBusy(false); } };
  return { res, err, busy, run };
}

function TrendTab({ usable, areas }: { usable: any[]; areas: string[] }) {
  const [f, setF] = useState({ indicator_id: '', area: '', from: '', to: '' });
  const { res, err, busy, run } = useRunner<any>();
  const [show, setShow] = useState({ ma3: true, ma12: true, trend: true });
  const submit = () => run(() => post('/analytics/trends', { indicator_id: Number(f.indicator_id), area: f.area || undefined, from: f.from || undefined, to: f.to || undefined }));
  const s = res?.statistics;
  const keys = ['Reported value', ...(show.ma3 ? ['3-period moving average'] : []), ...(show.ma12 ? ['12-period moving average'] : []), ...(show.trend ? ['Linear trend'] : [])];
  const rows = res?.points.map((p: any) => ({ period: p.period, 'Reported value': p.value, '3-period moving average': p.moving_avg_3, '12-period moving average': p.moving_avg_12, 'Linear trend': p.trend_line }));
  return (
    <div className="space-y-5">
      <Card>
        <div className="grid gap-3 md:grid-cols-5">
          <div className="md:col-span-2"><IndicatorSelect value={f.indicator_id} onChange={(v) => setF({ ...f, indicator_id: v })} items={usable} /></div>
          <AreaSelect value={f.area} onChange={(v) => setF({ ...f, area: v })} areas={areas} />
          <Field label="From"><input className="input" type="month" value={f.from.slice(0, 7)} onChange={(e) => setF({ ...f, from: e.target.value ? `${e.target.value}-01` : '' })} /></Field>
          <Field label="To"><input className="input" type="month" value={f.to.slice(0, 7)} onChange={(e) => setF({ ...f, to: e.target.value ? `${e.target.value}-01` : '' })} /></Field>
        </div>
        <div className="mt-4"><button className="btn-primary" disabled={!f.indicator_id || busy} onClick={submit}>{busy ? 'Analysing…' : 'Run trend analysis'}</button></div>
      </Card>
      {err && <ErrorBox message={err} />}
      {res && (
        <>
          <SyntheticBanner show={res.is_synthetic} />
          <Notice tone="blue"><strong>{res.indicator.name}</strong> — {res.area}. {res.summary}</Notice>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Trend direction" value={<Badge tone={s.trend_direction === 'increasing' ? 'green' : s.trend_direction === 'decreasing' ? 'red' : 'gray'}>{cap(s.trend_direction)}</Badge>} sub={`R² ${s.trend_r2?.toFixed(2)} (linear fit)`} />
            <Stat label="Total change" value={pct(s.total_change_pct)} sub={`${compact(s.first_value)} → ${compact(s.latest_value)}`} />
            <Stat label="Annualised growth" value={pct(s.annualised_growth_pct)} sub={`Avg per period ${pct(s.avg_period_growth_pct, 2)}`} />
            <Stat label="Latest change" value={`${pct(s.latest_period_change_pct)} ${res.frequency === 'M' ? 'MoM' : ''}`} sub={s.latest_yoy_pct != null ? `${pct(s.latest_yoy_pct)} year-over-year` : 'Year-over-year needs 13+ months'} />
          </div>
          <Card title="Time series" subtitle={`${res.n_observations} ${res.frequency_label} observations${res.n_interpolated ? ` (${res.n_interpolated} interpolated)` : ''}`}
            actions={<div className="flex gap-3 text-xs">{([['ma3', '3-period MA'], ['ma12', '12-period MA'], ['trend', 'Linear trend']] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={(show as any)[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />{l}</label>))}</div>}>
            <MultiLine rows={rows} keys={keys} height={320} />
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Statistics">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[['Mean', compact(s.mean)], ['Minimum', compact(s.min)], ['Maximum', compact(s.max)], ['Volatility (std. of changes)', pct(s.volatility_pct, 2, false)]].map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}
              </dl>
              {res.seasonality && <p className="mt-3 text-sm text-slate-600">Seasonality: peaks in <strong>{res.seasonality.peak_month}</strong>, lowest in <strong>{res.seasonality.low_month}</strong> (relative amplitude {res.seasonality.relative_amplitude_pct}%).</p>}
            </Card>
            <Card title="Method"><p className="text-sm text-slate-600">{res.method}</p></Card>
          </div>
        </>
      )}
    </div>
  );
}

function CompareTab({ usable, areas }: { usable: any[]; areas: string[] }) {
  const [ids, setIds] = useState<number[]>([]);
  const [area, setArea] = useState('');
  const [mode, setMode] = useState<'indexed' | 'raw'>('indexed');
  const { res, err, busy, run } = useRunner<any>();
  const toggle = (id: number) => setIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 6 ? [...p, id] : p));
  const chart = res && res.periods.map((p: string, i: number) => Object.fromEntries([['period', p], ...Object.keys(res.indexed).map((k) => [k, (mode === 'indexed' ? res.indexed : res.raw)[k][i]])]));
  return (
    <div className="space-y-5">
      <Card title="Select 2–6 indicators to compare">
        <div className="mb-4 flex flex-wrap gap-2">
          {usable.map((i) => (
            <label key={i.id} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${ids.includes(i.id) ? 'border-brand-600 bg-brand-50' : 'border-slate-300'}`}>
              <input type="checkbox" checked={ids.includes(i.id)} onChange={() => toggle(i.id)} />{i.name}</label>))}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-64"><AreaSelect value={area} onChange={setArea} areas={areas} /></div>
          <button className="btn-primary" disabled={ids.length < 2 || busy} onClick={() => run(() => post('/analytics/compare', { indicator_ids: ids, area: area || undefined }))}>{busy ? 'Comparing…' : 'Compare indicators'}</button>
        </div>
      </Card>
      {err && <ErrorBox message={err} />}
      {res && (
        <>
          <Card title="Comparison" subtitle={res.note}
            actions={<select className="input !w-auto" value={mode} onChange={(e) => setMode(e.target.value as any)} aria-label="Chart scale"><option value="indexed">Indexed (first period = 100)</option><option value="raw">Raw values</option></select>}>
            <MultiLine rows={chart} keys={Object.keys(res.indexed)} height={320} fmt={mode === 'indexed' ? (v) => num(v) : compact} />
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Total growth over the period" pad={false}>
              <Table head={['Indicator', 'Growth']}>{Object.entries(res.growth_pct).map(([k, v]: any) => <tr key={k}><td className="td">{k}</td><td className={`td font-medium ${v >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{pct(v)}</td></tr>)}</Table>
            </Card>
            <Card title="Correlation of period-to-period changes" subtitle="Association only — not causation" pad={false}>
              <Table head={['', ...Object.keys(res.correlation_of_changes)]}>
                {Object.entries(res.correlation_of_changes).map(([k, row]: any) => <tr key={k}><td className="td font-medium">{k}</td>{Object.values(row).map((v: any, i) => <td key={i} className="td">{v == null ? '—' : Number(v).toFixed(2)}</td>)}</tr>)}
              </Table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function RegionsTab({ usable }: { usable: any[] }) {
  const regional = usable.filter((i) => i.n_areas >= 2);
  const [id, setId] = useState('');
  const { res, err, busy, run } = useRunner<any>();
  if (!regional.length) return <Card><Empty title="No regional data available" hint="Regional comparison requires an indicator reported for at least two geographic areas." /></Card>;
  return (
    <div className="space-y-5">
      <Card><div className="flex flex-wrap items-end gap-4"><div className="w-96 max-w-full"><IndicatorSelect value={id} onChange={setId} items={regional} /></div>
        <button className="btn-primary" disabled={!id || busy} onClick={() => run(() => post('/analytics/regions', { indicator_id: Number(id) }))}>{busy ? 'Comparing…' : 'Compare regions'}</button></div></Card>
      {err && <ErrorBox message={err} />}
      {res && (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Latest value by region" subtitle={res.indicator.name}><SimpleBars rows={res.areas} x="area" keys={['latest_value']} layout="horizontal" height={260} /></Card>
            <Card title="Growth over the period by region"><SimpleBars rows={res.areas} x="area" keys={['growth_pct']} layout="horizontal" height={260} fmt={(v) => `${Number(v).toFixed(0)}%`} /></Card>
          </div>
          <Card title="Regional detail" subtitle={res.clustering?.method} pad={false}>
            <Table head={['Rank', 'Region', 'Latest', 'Share', 'Growth', 'Volatility', 'Pattern group']}>
              {res.areas.map((a: any) => <tr key={a.area}><td className="td">{a.rank}</td><td className="td font-medium">{a.area}</td><td className="td">{compact(a.latest_value)}</td><td className="td">{pct(a.share_pct, 1, false)}</td>
                <td className={`td ${a.growth_pct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{pct(a.growth_pct)}</td><td className="td">{pct(a.volatility_pct, 2, false)}</td><td className="td"><Badge tone="teal">{a.cluster_label}</Badge></td></tr>)}
            </Table>
            <p className="px-4 py-3 text-xs text-slate-500">{res.clustering?.note}</p>
          </Card>
        </>
      )}
    </div>
  );
}
