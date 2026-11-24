import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { download, errMsg, post, get } from '../api';
import { Badge, Card, Empty, ErrorBox, Field, Modal, Notice, PageHeader, Spinner, Stat, SyntheticBanner, Table, useGet } from '../components/ui';
import { MultiLine } from '../components/charts';
import { cap, compact, dateTime, monthLabel, num, pct } from '../format';

function ReportView({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, error, loading } = useGet<any>(`/reports/${id}`);
  const c = data?.content;
  return (
    <Modal title={data?.title || 'Report'} onClose={onClose} wide>
      {loading && <Spinner />}
      {error && <ErrorBox message={error} />}
      {c && (
        <div className="space-y-4 text-sm">
          <SyntheticBanner show={c.is_synthetic} />
          <p className="text-slate-600">Generated {dateTime(c.generated_at)} by {c.generated_by?.name} · Period {monthLabel(c.period?.from)} – {monthLabel(c.period?.to)} · {c.area}</p>
          <div><h3 className="label">Summary of findings</h3><ul className="list-disc space-y-1 pl-5">{c.summary.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Indicators" value={num(c.statistics.indicators)} />
            <Stat label="Total volume" value={compact(c.statistics.total_volume)} />
            <Stat label="Alerts" value={num(c.statistics.alerts_total)} sub={`${c.statistics.alerts_high} high`} />
            <Stat label="Sources" value={num(c.sources?.length)} />
          </div>
          <MultiLine rows={c.volume_chart?.rows} keys={c.volume_chart?.keys || []} height={220} />
          <Table head={['Indicator', 'Latest', 'YoY', 'Trend']}>{c.indicators.map((i: any) => <tr key={i.name}><td className="td">{i.name}</td><td className="td">{compact(i.latest_value)}</td><td className="td">{pct(i.yoy_pct)}</td><td className="td">{cap(i.trend_direction)}</td></tr>)}</Table>
          <p className="text-xs text-slate-500">{c.anomalies?.length || 0} unusual-activity findings included. They require further investigation and are not proof of misconduct. The PDF contains the full report, data-source references and methodological limitations.</p>
        </div>
      )}
      <div className="mt-4 flex justify-end"><button className="btn-primary" onClick={() => download(`/reports/${id}/download`, undefined, 'report.pdf')}>Download PDF</button></div>
    </Modal>
  );
}

export default function Reports() {
  const { can } = useAuth();
  const list = useGet<any[]>('/reports');
  const opts = useGet<any>('/dashboard/filters');
  const [f, setF] = useState({ title: '', from: '', to: '', area: '', categories: [] as string[], include_anomalies: true });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [exp, setExp] = useState<string | null>(null);

  const toggle = (c: string) => setF((p) => ({ ...p, categories: p.categories.includes(c) ? p.categories.filter((x) => x !== c) : [...p.categories, c] }));

  async function generate(e: FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return setErr('Enter a report title.');
    if (f.from && f.to && f.from > f.to) return setErr('The start of the period must be before its end.');
    setBusy(true); setErr(null); setOkMsg(null);
    try {
      const r = await post('/reports/generate', { title: f.title, from: f.from || undefined, to: f.to || undefined, area: f.area || undefined, categories: f.categories, include_anomalies: f.include_anomalies });
      setOkMsg('Report generated.'); list.reload(); setViewing(r.id);
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }

  async function exportCsv() {
    setExp(null);
    try {
      const params = { from: f.from || undefined, to: f.to || undefined, area: f.area || undefined, category: f.categories.length === 1 ? f.categories[0] : undefined };
      await download('/reports/export/csv', params, 'observations.csv');
      setExp('CSV exported using the period, region and (single) category selected above.');
    } catch (e) { setExp(errMsg(e)); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle="Generate analytical reports with trends, statistics, anomaly findings, data-source references and methodological limitations; download as PDF or export data as CSV." />
      {can('reports.generate') && (
        <Card title="Generate a report">
          <form onSubmit={generate} className="space-y-4" aria-label="Generate report">
            {err && <ErrorBox message={err} />}
            {okMsg && <Notice tone="green">{okMsg}</Notice>}
            <div className="grid gap-4 md:grid-cols-4">
              <div className="md:col-span-2"><Field label="Report title"><input className="input" value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Digital financial activity — 2024 review" /></Field></div>
              <Field label="Period from"><input className="input" type="month" value={f.from.slice(0, 7)} onChange={(e) => setF({ ...f, from: e.target.value ? `${e.target.value}-01` : '' })} /></Field>
              <Field label="Period to"><input className="input" type="month" value={f.to.slice(0, 7)} onChange={(e) => setF({ ...f, to: e.target.value ? `${e.target.value}-01` : '' })} /></Field>
              <Field label="Region"><select className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}><option value="">All regions (national)</option>{opts.data?.areas?.filter((a: string) => a !== 'National').map((a: string) => <option key={a}>{a}</option>)}</select></Field>
            </div>
            <fieldset><legend className="label">Indicator categories (none selected = all)</legend>
              <div className="flex flex-wrap gap-2">{opts.data?.categories?.map((c: string) => (
                <label key={c} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${f.categories.includes(c) ? 'border-brand-600 bg-brand-50' : 'border-slate-300'}`}>
                  <input type="checkbox" checked={f.categories.includes(c)} onChange={() => toggle(c)} />{c}</label>))}</div></fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.include_anomalies} onChange={(e) => setF({ ...f, include_anomalies: e.target.checked })} /> Include detected anomalies</label>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy}>{busy ? 'Generating…' : 'Generate report'}</button>
              <button type="button" className="btn-secondary" onClick={exportCsv}>Export data as CSV</button>
            </div>
            {exp && <p className="text-xs text-slate-600">{exp}</p>}
          </form>
        </Card>
      )}
      <Card title="Generated reports" pad={false}>
        {list.loading && !list.data && <Spinner />}
        {list.error && <div className="p-4"><ErrorBox message={list.error} onRetry={list.reload} /></div>}
        {list.data && (list.data.length ? (
          <Table head={['Title', 'Period', 'Created', '']}>
            {list.data.map((r) => (
              <tr key={r.id}><td className="td font-medium">{r.title}{r.is_synthetic && <> <Badge tone="amber">Synthetic data</Badge></>}</td>
                <td className="td">{r.period?.from ? `${monthLabel(r.period.from)} – ${monthLabel(r.period.to)}` : 'All available'}</td>
                <td className="td">{dateTime(r.created_at)}<div className="text-xs text-slate-500">{r.created_by_name}</div></td>
                <td className="td whitespace-nowrap text-right"><button className="btn-secondary !py-1" onClick={() => setViewing(r.id)}>View</button>{' '}
                  <button className="btn-primary !py-1" onClick={() => download(`/reports/${r.id}/download`, undefined, 'report.pdf').catch(async (e) => setErr(errMsg(e)))}>PDF</button></td></tr>
            ))}
          </Table>
        ) : <Empty title="No reports yet" hint={can('reports.generate') ? 'Generate the first report above.' : 'Reports generated by analysts will appear here.'} />)}
      </Card>
      {viewing && <ReportView id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
