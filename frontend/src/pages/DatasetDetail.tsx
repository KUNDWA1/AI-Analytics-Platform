import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { errMsg, post, put } from '../api';
import { Badge, Card, ErrorBox, Field, Notice, PageHeader, Spinner, Stat, StatusBadge, SyntheticBanner, Table, useGet } from '../components/ui';
import { bytes, dateTime, num } from '../format';

const text = (x: any) => (typeof x === 'string' ? x : x?.message || JSON.stringify(x));

export function ProcessingSummary({ s }: { s: any }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Original records" value={num(s.original_records)} />
        <Stat label="Valid records" value={num(s.valid_records)} />
        <Stat label="Invalid records" value={num(s.invalid_records)} />
        <Stat label="Duplicate records" value={num(s.duplicate_records)} />
        <Stat label="Missing values" value={num(s.missing_values)} />
        <Stat label="Indicators created" value={num(s.indicators_created)} />
        <Stat label="Observations stored" value={num(s.observations_created)} />
        <Stat label="Period" value={<span className="text-base">{s.period_start?.slice(0, 7)} → {s.period_end?.slice(0, 7)}</span>} sub={`${s.frequency === 'M' ? 'Monthly' : s.frequency === 'Q' ? 'Quarterly' : s.frequency === 'A' ? 'Annual' : s.frequency || ''} · ${s.areas?.length || 0} areas`} />
      </div>
      {s.warnings?.length > 0 && <ul className="mt-3 space-y-1 text-sm text-amber-800">{s.warnings.map((w: any, i: number) => <li key={i}>⚠ {text(w)}</li>)}</ul>}
    </div>
  );
}

function MappingEditor({ ds, onSaved }: { ds: any; onSaved: () => void }) {
  const cols: any[] = ds.columns;
  const m0 = ds.column_mapping || ds.validation_report?.suggested_mapping || {};
  const [m, setM] = useState<any>({ period: m0.period || '', indicator: m0.indicator || '', category: m0.category || '', area: m0.area || '', unit: m0.unit || '', values: m0.values || [], default_category: m0.default_category || '' });
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSaved(false), [m]);
  const opt = (c: any) => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>;
  const optional = (key: string, label: string, hint: string) => (
    <Field label={label} hint={hint}>
      <select className="input" value={m[key]} onChange={(e) => setM({ ...m, [key]: e.target.value })} aria-label={label}>
        <option value="">— none —</option>{cols.map(opt)}
      </select>
    </Field>
  );
  const toggle = (name: string) => setM({ ...m, values: m.values.includes(name) ? m.values.filter((v: string) => v !== name) : [...m.values, name] });
  async function save() {
    setErr(null); setBusy(true);
    try {
      await put(`/datasets/${ds.id}/mapping`, { mapping: { ...m, indicator: m.indicator || null, category: m.category || null, area: m.area || null, unit: m.unit || null, default_category: m.default_category || null } });
      setSaved(true); onSaved();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Datasets differ in structure. Tell the platform which column holds the period, which columns hold the numeric values, and (optionally) the indicator name, category, region and unit.</p>
      {err && <ErrorBox message={err} />}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Period / date column (required)">
          <select className="input" value={m.period} onChange={(e) => setM({ ...m, period: e.target.value })} aria-label="Period column"><option value="">Select…</option>{cols.map(opt)}</select>
        </Field>
        {optional('indicator', 'Indicator name column', 'If empty, each value column becomes an indicator.')}
        {optional('category', 'Indicator category column', 'Otherwise the default category below is used.')}
        {optional('area', 'Geographic area column', 'If empty, rows are treated as national.')}
        {optional('unit', 'Unit column', 'Optional; units are standardised where possible.')}
        <Field label="Default category"><input className="input" value={m.default_category} onChange={(e) => setM({ ...m, default_category: e.target.value })} placeholder="e.g. Mobile Money" /></Field>
      </div>
      <fieldset>
        <legend className="label">Numeric value columns (required)</legend>
        <div className="flex flex-wrap gap-2">
          {cols.map((c) => (
            <label key={c.name} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${m.values.includes(c.name) ? 'border-brand-600 bg-brand-50' : 'border-slate-300'}`}>
              <input type="checkbox" checked={m.values.includes(c.name)} onChange={() => toggle(c.name)} />{c.name}
              <span className="text-xs text-slate-500">{c.type}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3"><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save mapping'}</button>{saved && <span className="text-sm text-emerald-700">Mapping saved.</span>}</div>
    </div>
  );
}

export default function DatasetDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: ds, error, loading, reload } = useGet<any>(`/datasets/${id}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  if (loading && !ds) return <Spinner />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!ds) return null;
  const v = ds.validation_report;
  const canProcess = can('datasets.process') && ds.status !== 'archived' && ds.status !== 'processing';

  async function process() {
    setBusy(true); setErr(null); setOk(null);
    try { const s = await post(`/datasets/${ds.id}/process`); setOk(`Processing complete: ${num(s.observations_created)} observations stored.`); reload(); }
    catch (e) { setErr(errMsg(e)); reload(); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={ds.name} subtitle={ds.description || undefined}
        actions={<><Link className="btn-secondary" to="/datasets">← All datasets</Link>
          {canProcess && <button className="btn-primary" onClick={process} disabled={busy}>{busy ? 'Processing…' : ds.status === 'processed' ? 'Re-process dataset' : 'Process dataset'}</button>}</>} />
      <SyntheticBanner show={ds.is_synthetic} />
      {err && <ErrorBox message={err} />}
      {ok && <Notice tone="green">{ok}</Notice>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Status" value={<StatusBadge status={ds.status} />} />
        <Stat label="Records" value={num(ds.record_count)} sub={`${ds.column_count ?? ds.columns?.length} columns`} />
        <Stat label="Source" value={<span className="text-base">{ds.source_name || 'Not specified'}</span>} sub={ds.category} />
        <Stat label="Uploaded" value={<span className="text-base">{dateTime(ds.created_at)}</span>} sub={`by ${ds.uploaded_by_name || 'unknown'}`} />
        <Stat label="Original file" value={<span className="break-all text-sm">{ds.original_filename}</span>} sub={`${bytes(ds.file_size)} · SHA-256 ${ds.file_hash?.slice(0, 12)}…`} />
      </div>

      <Card title="Validation results" subtitle="Format, column, type, missing-value and duplicate checks performed on upload">
        {v ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge tone={v.is_valid ? 'green' : 'red'}>{v.is_valid ? 'Valid file' : 'Issues found'}</Badge>
              <span>{num(v.record_count)} records</span><span>{num(v.missing_cells)} missing cells</span><span>{num(v.duplicate_rows)} duplicate rows</span>
            </div>
            {[...(v.issues || []).map((x: any) => ['red', x]), ...(v.warnings || []).map((x: any) => ['amber', x])].map(([t, x]: any, i) => (
              <Notice key={i} tone={t}>{text(x)}</Notice>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">No validation report available.</p>}
      </Card>

      <Card title="Detected columns" pad={false}>
        <Table head={['Column', 'Detected type', 'Missing', 'Sample values']}>
          {ds.columns.map((c: any) => (
            <tr key={c.name}><td className="td font-medium">{c.name}</td><td className="td"><Badge tone="teal">{c.type}</Badge></td>
              <td className="td">{num(c.missing)} <span className="text-xs text-slate-500">({c.missing_pct}%)</span></td>
              <td className="td max-w-xs truncate text-xs text-slate-500">{c.sample?.join(', ')}</td></tr>
          ))}
        </Table>
      </Card>

      {v?.preview?.length > 0 && (
        <Card title="Data preview" subtitle="First rows of the uploaded file" pad={false}>
          <div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-slate-50"><tr>{Object.keys(v.preview[0]).map((k) => <th key={k} className="th">{k}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{v.preview.map((r: any, i: number) => <tr key={i}>{Object.values(r).map((x: any, j) => <td key={j} className="td !py-1.5">{String(x)}</td>)}</tr>)}</tbody></table></div>
        </Card>
      )}

      {can('datasets.process') && ds.status !== 'archived' && (
        <Card title="Column mapping" subtitle="Flexible mapping for datasets with different layouts"><MappingEditor ds={ds} onSaved={reload} /></Card>
      )}

      <Card title="Processing summary" subtitle={ds.processed_at ? `Processed ${dateTime(ds.processed_at)}` : 'Not processed yet'}>
        {ds.processing_summary ? <ProcessingSummary s={ds.processing_summary} /> : <p className="text-sm text-slate-500">Process this dataset to generate observations, percentage changes and moving averages. The original file is never modified.</p>}
        {ds.stored && <p className="mt-3 text-xs text-slate-500">Stored observations linked to this dataset: {num(ds.stored.observations)} across {num(ds.stored.indicators)} indicators</p>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Upload history" pad={false}>
          <Table head={['File', 'Size', 'Uploaded']}>{ds.files.map((f: any) => <tr key={f.id}><td className="td">{f.original_name}<div className="text-xs text-slate-500">SHA-256 {f.file_hash?.slice(0, 10)}…</div></td><td className="td">{bytes(f.file_size)}</td><td className="td">{dateTime(f.uploaded_at)}</td></tr>)}</Table>
        </Card>
        <Card title="Processing jobs" pad={false}>
          {ds.jobs.length ? <Table head={['Job', 'Status', 'Started', 'Finished']}>{ds.jobs.map((j: any) => <tr key={j.id}><td className="td">#{j.id}</td><td className="td"><StatusBadge status={j.status} /></td><td className="td">{dateTime(j.started_at)}</td><td className="td">{dateTime(j.finished_at)}</td></tr>)}</Table>
            : <p className="p-4 text-sm text-slate-500">No processing jobs yet.</p>}
        </Card>
      </div>
    </div>
  );
}
