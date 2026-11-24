import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { errMsg, post } from '../api';
import { Badge, Card, Empty, ErrorBox, Field, Notice, PageHeader, SeverityBadge, Spinner, Stat, StatusBadge, SyntheticBanner, Table, useGet } from '../components/ui';
import { cap, compact, dateTime, monthLabel, num } from '../format';

export default function Anomalies() {
  const { can } = useAuth();
  const [flt, setFlt] = useState({ status: '', severity: '', category: '', area: '', from: '', to: '', q: '' });
  const set = (k: string, v: string) => setFlt((p) => ({ ...p, [k]: v }));
  const alerts = useGet<any[]>('/alerts', { ...flt, limit: 200 });
  const summary = useGet<any>('/alerts/summary');
  const opts = useGet<any>('/dashboard/filters');
  const [run, setRun] = useState({ method: 'both', threshold: '3' });
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function detect() {
    setBusy(true); setErr(null);
    try { setRes(await post('/analytics/anomalies', { method: run.method, threshold: Number(run.threshold) })); alerts.reload(); summary.reload(); }
    catch (e) { setRes(null); setErr(errMsg(e)); } finally { setBusy(false); }
  }
  const sev = summary.data?.open_by_severity || {};
  const filtered = Object.values(flt).some(Boolean);

  return (
    <div className="space-y-5">
      <PageHeader title="Anomaly and risk monitoring" subtitle="Unusual activity detected with statistical methods. Alerts require further investigation and are not evidence of misconduct or violations." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total alerts" value={num(summary.data?.total)} />
        <Stat label="High (open)" value={<span className="text-red-700">{sev.high ?? 0}</span>} />
        <Stat label="Medium (open)" value={<span className="text-amber-700">{sev.medium ?? 0}</span>} />
        <Stat label="Low (open)" value={<span className="text-sky-700">{sev.low ?? 0}</span>} />
      </div>

      {can('analytics.run') && (
        <Card title="Run anomaly detection" subtitle="Analyses every active indicator and region in the processed data">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Method"><select className="input" value={run.method} onChange={(e) => setRun({ ...run, method: e.target.value })} aria-label="Detection method">
              <option value="both">Robust z-score + Isolation Forest</option><option value="zscore">Robust z-score only</option><option value="isolation_forest">Isolation Forest only</option></select></Field>
            <Field label="Z-score threshold" hint="Higher = fewer, stronger alerts (2–6)"><input className="input" type="number" min={2} max={6} step={0.5} value={run.threshold} onChange={(e) => setRun({ ...run, threshold: e.target.value })} /></Field>
            <div className="flex items-end"><button className="btn-primary" disabled={busy} onClick={detect}>{busy ? 'Detecting…' : 'Run detection'}</button></div>
          </div>
          {err && <div className="mt-3"><ErrorBox message={err} /></div>}
          {res && (
            <div className="mt-4 space-y-2">
              <Notice tone="green"><strong>{res.detected}</strong> unusual observations found across {res.series_analysed} series; <strong>{res.new_alerts}</strong> new alerts created
                (high {res.by_severity.high}, medium {res.by_severity.medium}, low {res.by_severity.low}).</Notice>
              <p className="text-xs text-slate-600">{res.evaluation_note}</p>
              {res.series_skipped?.length > 0 && <p className="text-xs text-amber-800">{res.series_skipped.length} series were skipped (too little history).</p>}
            </div>
          )}
        </Card>
      )}

      <Card title="Alerts" actions={<button className="btn-secondary !py-1" disabled={!filtered} onClick={() => setFlt({ status: '', severity: '', category: '', area: '', from: '', to: '', q: '' })}>Clear filters</button>} pad={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Alert filters">
          <Field label="Search"><input className="input" placeholder="Indicator or explanation" value={flt.q} onChange={(e) => set('q', e.target.value)} /></Field>
          <Field label="Severity"><select className="input" value={flt.severity} onChange={(e) => set('severity', e.target.value)} aria-label="Severity"><option value="">All</option>{['high', 'medium', 'low'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select></Field>
          <Field label="Status"><select className="input" value={flt.status} onChange={(e) => set('status', e.target.value)} aria-label="Status"><option value="">All</option>{['new', 'under_review', 'reviewed', 'dismissed'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select></Field>
          <Field label="Category"><select className="input" value={flt.category} onChange={(e) => set('category', e.target.value)}><option value="">All</option>{opts.data?.categories?.map((c: string) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Region"><select className="input" value={flt.area} onChange={(e) => set('area', e.target.value)}><option value="">All</option>{opts.data?.areas?.filter((a: string) => a !== 'National').map((a: string) => <option key={a}>{a}</option>)}</select></Field>
          <Field label="Period from"><input className="input" type="month" value={flt.from.slice(0, 7)} onChange={(e) => set('from', e.target.value ? `${e.target.value}-01` : '')} /></Field>
          <Field label="Period to"><input className="input" type="month" value={flt.to.slice(0, 7)} onChange={(e) => set('to', e.target.value ? `${e.target.value}-01` : '')} /></Field>
        </div>
        {alerts.loading && !alerts.data && <Spinner />}
        {alerts.error && <div className="p-4"><ErrorBox message={alerts.error} onRetry={alerts.reload} /></div>}
        {alerts.data && (alerts.data.length ? (
          <>
            {alerts.data.some((a) => a.is_synthetic) && <div className="p-4 pb-0"><SyntheticBanner compact /></div>}
            <Table head={['Severity', 'Indicator', 'Region', 'Period', 'Observed', 'Expected', 'Score', 'Status', '']}>
              {alerts.data.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="td"><SeverityBadge severity={a.severity} /></td>
                  <td className="td font-medium text-slate-900">{a.indicator_name}<div className="text-xs font-normal text-slate-500">{a.category} · unusual {a.direction}</div></td>
                  <td className="td">{a.area}</td><td className="td whitespace-nowrap">{monthLabel(a.period)}</td>
                  <td className="td">{compact(a.observed_value, 2)}</td><td className="td">{compact(a.expected_value, 2)}</td><td className="td">{Number(a.anomaly_score).toFixed(1)}</td>
                  <td className="td"><StatusBadge status={a.status} /></td>
                  <td className="td text-right"><Link className="btn-secondary !py-1" to={`/alerts/${a.id}`}>Investigate</Link></td>
                </tr>
              ))}
            </Table>
            <p className="px-4 py-2 text-xs text-slate-500">Showing {alerts.data.length} alerts, most severe first. Detected {dateTime(alerts.data[0].detected_at)}.</p>
          </>
        ) : <Empty title={filtered ? 'No alerts match these filters' : 'No unusual activity detected'} hint={filtered ? 'Try clearing a filter.' : can('analytics.run') ? 'Run anomaly detection to analyse the processed data.' : undefined} />)}
      </Card>
    </div>
  );
}
