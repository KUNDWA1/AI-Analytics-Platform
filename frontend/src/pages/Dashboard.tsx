import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DASH, useAuth } from '../auth';
import { Badge, Card, Empty, ErrorBox, Field, PageHeader, SeverityBadge, Spinner, StatusBadge, SyntheticBanner, Table, useGet } from '../components/ui';
import { MultiLine, SimpleBars, Sparkline } from '../components/charts';
import { cap, compact, dateTime, monthLabel, num, pct } from '../format';

const TITLES: Record<string, [string, string]> = {
  regulator: ['Digital financial activity overview', 'Key indicators, regional activity, unusual-activity alerts and trend monitoring.'],
  analyst: ['Analyst workspace', 'Dataset processing results, analytical activity and model evaluation.'],
  management: ['Executive summary', 'High-level financial indicators, growth patterns, financial inclusion and key trends.'],
  admin: ['System overview', 'Users, system activity, datasets, audit events and system health.'],
};

function Kpi({ k }: { k: any }) {
  const val = k.is_pct ? pct(k.value, 1, false) : compact(k.value);
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k.label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-slate-900">{val}</span>
        {!k.is_pct && k.unit && <span className="text-xs text-slate-500">{k.unit}</span>}
      </div>
      {k.change_pct != null && (
        <div className={`mt-1 text-xs font-medium ${k.change_pct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          {k.change_pct >= 0 ? '▲' : '▼'} {pct(k.change_pct)} <span className="font-normal text-slate-500">{k.change_label}</span>
        </div>
      )}
      {k.sub && <div className="mt-1 text-xs text-slate-500">{k.sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const role = DASH[user!.role];
  const [f, setF] = useState({ from: '', to: '', category: '', area: '', source: '' });
  const opts = useGet<any>('/dashboard/filters');
  const dash = useGet<any>(`/dashboard/${role}`, f);
  const [title, sub] = TITLES[role];
  const d = dash.data;
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const filtered = Object.values(f).some(Boolean);

  return (
    <div>
      <PageHeader title={title} subtitle={sub} />
      <div className="card mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" role="search" aria-label="Dashboard filters">
        <Field label="From">
          <input className="input" type="month" value={f.from.slice(0, 7)} min={opts.data?.period_range?.min?.slice(0, 7)} max={opts.data?.period_range?.max?.slice(0, 7)}
            onChange={(e) => set('from', e.target.value ? `${e.target.value}-01` : '')} />
        </Field>
        <Field label="To">
          <input className="input" type="month" value={f.to.slice(0, 7)} min={opts.data?.period_range?.min?.slice(0, 7)} max={opts.data?.period_range?.max?.slice(0, 7)}
            onChange={(e) => set('to', e.target.value ? `${e.target.value}-01` : '')} />
        </Field>
        <Field label="Indicator category">
          <select className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">All categories</option>
            {opts.data?.categories?.map((c: string) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Region">
          <select className="input" value={f.area} onChange={(e) => set('area', e.target.value)}>
            <option value="">All regions (national)</option>
            {opts.data?.areas?.filter((a: string) => a !== 'National').map((a: string) => <option key={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Data source">
          <select className="input" value={f.source} onChange={(e) => set('source', e.target.value)}>
            <option value="">All sources</option>
            {opts.data?.sources?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <div className="flex items-end">
          <button className="btn-secondary w-full" disabled={!filtered} onClick={() => setF({ from: '', to: '', category: '', area: '', source: '' })}>Clear filters</button>
        </div>
      </div>

      {dash.loading && !d && <Spinner label="Loading dashboard…" />}
      {dash.error && <ErrorBox message={dash.error} onRetry={dash.reload} />}
      {d && !d.has_data && (
        <Card><Empty title="No processed data matches the current selection"
          hint={filtered ? 'Try widening the filters.' : 'Upload and process a dataset to populate the dashboard.'}
          action={!filtered && <Link className="btn-primary" to="/datasets/upload">Upload a dataset</Link>} /></Card>
      )}

      {d?.has_data && (
        <div className={`space-y-5 ${dash.loading ? 'opacity-60' : ''}`}>
          <SyntheticBanner show={d.is_synthetic} />
          <p className="text-xs text-slate-500">Showing: <strong>{d.area_label}</strong></p>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{d.kpis.map((k: any) => <Kpi key={k.key} k={k} />)}</div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Transaction volume trend" subtitle="Reported number of transactions per month, by category">
              <MultiLine rows={d.charts.volume_trend?.rows} keys={d.charts.volume_trend?.keys || []} />
            </Card>
            <Card title="Transaction value trend" subtitle="Reported transaction value per month (currency as reported)">
              <MultiLine rows={d.charts.value_trend?.rows} keys={d.charts.value_trend?.keys || []} />
            </Card>
            <Card title="Financial inclusion & connectivity" subtitle="Share of adults / population (%), where reported">
              <MultiLine rows={d.charts.inclusion_trend?.rows} keys={d.charts.inclusion_trend?.keys || []} fmt={(v) => `${Number(v).toFixed(0)}%`} />
            </Card>
            <Card title="Regional comparison"
              subtitle={d.charts.regional?.window ? `Transaction volume, ${monthLabel(d.charts.regional.window[0])} – ${monthLabel(d.charts.regional.window[1])}` : 'Transaction volume by region'}>
              {d.charts.regional?.rows?.length ? (
                <>
                  <SimpleBars rows={d.charts.regional.rows} x="area" keys={['volume']} layout="horizontal" height={220} />
                  <Table head={['Region', 'Share', 'Growth (vs prior period)']}>
                    {d.charts.regional.rows.map((r: any) => (
                      <tr key={r.area}><td className="td font-medium">{r.area}</td><td className="td">{pct(r.share_pct, 1, false)}</td>
                        <td className={`td ${r.growth_pct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{pct(r.growth_pct)}</td></tr>
                    ))}
                  </Table>
                </>
              ) : <Empty title="No regional data" hint="Regional comparison needs data with at least two geographic areas." />}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Monitored indicators" subtitle="Latest value and change" className="xl:col-span-2" pad={false}>
              <Table head={['Indicator', 'Latest', 'MoM', 'YoY', 'Trend']}>
                {d.snapshot.map((s: any) => (
                  <tr key={s.id}>
                    <td className="td"><div className="font-medium text-slate-900">{s.name}</div><div className="text-xs text-slate-500">{s.category} · {monthLabel(s.period)}</div></td>
                    <td className="td">{s.unit === '%' ? pct(s.latest, 1, false) : compact(s.latest)}</td>
                    <td className={`td ${s.mom >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{pct(s.mom)}</td>
                    <td className={`td ${s.yoy >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{pct(s.yoy)}</td>
                    <td className="td"><Sparkline values={s.spark} /></td>
                  </tr>
                ))}
              </Table>
            </Card>

            <div className="space-y-5">
              {d.anomalies && (
                <Card title="Unusual activity detected" subtitle="Statistical patterns requiring further investigation"
                  actions={<Link className="text-sm font-medium text-brand-700 hover:underline" to="/anomalies">View all</Link>}>
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="gray">{d.anomalies.open} open</Badge>
                    {['high', 'medium', 'low'].map((s) => <span key={s} className="flex items-center gap-1"><SeverityBadge severity={s} /><span className="text-slate-600">{d.anomalies.by_severity?.[s] ?? 0}</span></span>)}
                  </div>
                  {d.anomalies.recent?.length ? (
                    <ul className="divide-y divide-slate-100">
                      {d.anomalies.recent.map((a: any) => (
                        <li key={a.id} className="py-2">
                          <Link to={`/alerts/${a.id}`} className="block hover:bg-slate-50">
                            <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-800">{a.indicator_name}</span><SeverityBadge severity={a.severity} /></div>
                            <div className="text-xs text-slate-500">{a.area} · {monthLabel(a.period)} · {a.direction}</div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-slate-500">No open alerts.</p>}
                  <p className="mt-3 text-xs text-slate-500">An anomaly is an unusual statistical pattern, not proof of misconduct or a violation.</p>
                </Card>
              )}
            </div>
          </div>

          {d.extras && role === 'analyst' && <AnalystExtras x={d.extras} />}
          {d.extras && role === 'admin' && <AdminExtras x={d.extras} />}
          {d.extras && role === 'management' && <ManagementExtras x={d.extras} />}

          {d.activity && (
            <Card title="Recent analytical activity" pad={false}>
              {d.activity.length ? (
                <Table head={['When', 'Action', 'User']}>
                  {d.activity.map((a: any, i: number) => (
                    <tr key={i}><td className="td whitespace-nowrap">{dateTime(a.created_at)}</td><td className="td">{cap(a.action.toLowerCase())}</td><td className="td">{a.user_email || 'system'}</td></tr>
                  ))}
                </Table>
              ) : <Empty title="No recent activity" />}
            </Card>
          )}
        </div>
      )}
      {d && !d.has_data && role === 'admin' && d.extras && <div className="mt-5"><AdminExtras x={d.extras} /></div>}
    </div>
  );
}

function AnalystExtras({ x }: { x: any }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Processing results" subtitle="Most recent processing jobs" pad={false}>
        {x.recent_jobs.length ? (
          <Table head={['Dataset', 'Status', 'Valid / total', 'Missing', 'Duplicates']}>
            {x.recent_jobs.map((j: any) => (
              <tr key={j.id}><td className="td">{j.dataset_name}</td><td className="td"><StatusBadge status={j.status} /></td>
                <td className="td">{num(j.summary?.valid_records)} / {num(j.summary?.original_records)}</td>
                <td className="td">{num(j.summary?.missing_values)}</td><td className="td">{num(j.summary?.duplicate_records)}</td></tr>
            ))}
          </Table>
        ) : <Empty title="No processing jobs yet" />}
      </Card>
      <Card title="Model evaluation" subtitle="Forecast back-test error of the selected model (lower is better)" pad={false}>
        {x.model_evaluation.length ? (
          <Table head={['Indicator', 'Method', 'MAPE', 'Beats naive']}>
            {x.model_evaluation.map((m: any) => (
              <tr key={m.id}><td className="td">{m.indicator_name}<div className="text-xs text-slate-500">{m.area}</div></td><td className="td">{m.method}</td>
                <td className="td">{m.mape != null ? `${Number(m.mape).toFixed(2)}%` : '—'}</td>
                <td className="td">{m.beats_naive === 'true' ? <Badge tone="green">Yes</Badge> : <Badge tone="gray">No</Badge>}</td></tr>
            ))}
          </Table>
        ) : <Empty title="No forecasts run yet" action={<Link className="btn-primary" to="/forecasting">Run a forecast</Link>} />}
      </Card>
    </div>
  );
}

function ManagementExtras({ x }: { x: any }) {
  const List = ({ rows }: { rows: any[] }) => (
    <Table head={['Indicator', 'YoY change', 'Latest']}>
      {rows.map((r) => <tr key={r.id}><td className="td">{r.name}</td><td className={`td font-medium ${r.yoy >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{pct(r.yoy)}</td><td className="td">{compact(r.latest)}</td></tr>)}
    </Table>
  );
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card title="Fastest-growing indicators" subtitle="Year-over-year" pad={false}><List rows={x.top_growth} /></Card>
      <Card title="Slowest-growing indicators" subtitle="Year-over-year" pad={false}><List rows={x.lowest_growth} /></Card>
      <Card title="Recent reports" pad={false}>
        {x.recent_reports?.length ? (
          <ul className="divide-y divide-slate-100">{x.recent_reports.map((r: any) => <li key={r.id} className="px-4 py-2.5 text-sm"><Link to="/reports" className="font-medium text-brand-700 hover:underline">{r.title}</Link><div className="text-xs text-slate-500">{dateTime(r.created_at)}</div></li>)}</ul>
        ) : <Empty title="No reports yet" action={<Link className="btn-primary" to="/reports">Open reports</Link>} />}
      </Card>
    </div>
  );
}

function AdminExtras({ x }: { x: any }) {
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card title="System health">
        <ul className="space-y-2 text-sm">{x.health.map((h: any) => (
          <li key={h.name} className="flex items-start gap-2"><Badge tone={h.ok ? 'green' : 'red'}>{h.ok ? 'OK' : 'Issue'}</Badge><span><span className="font-medium">{h.name}</span><br /><span className="text-xs text-slate-500">{h.detail}</span></span></li>
        ))}</ul>
      </Card>
      <Card title="System totals">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {Object.entries(x.totals).map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{cap(k)}</dt><dd className="text-lg font-semibold">{num(v as number)}</dd></div>)}
        </dl>
      </Card>
      <Card title="Users by role" actions={<Link to="/users" className="text-sm font-medium text-brand-700 hover:underline">Manage</Link>}>
        <ul className="space-y-1 text-sm">{x.users_by_role.map((u: any) => <li key={u.role} className="flex justify-between"><span>{u.role}</span><span className="font-medium">{u.n}</span></li>)}</ul>
        <h3 className="label mt-4">Recent sign-ins</h3>
        <ul className="space-y-1 text-xs text-slate-600">{x.recent_logins.map((u: any) => <li key={u.email}>{u.full_name} · {dateTime(u.last_login)}</li>)}</ul>
      </Card>
    </div>
  );
}
