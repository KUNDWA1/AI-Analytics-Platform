import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { errMsg, post, put } from '../api';
import { Badge, Card, ErrorBox, Field, Modal, PageHeader, Spinner, Table, useGet } from '../components/ui';
import { monthLabel, num } from '../format';

function IndicatorForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: initial?.name || '', category: initial?.category || '', unit: initial?.unit || '', description: initial?.description || '', is_active: initial?.is_active ?? true });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim() || !f.category.trim()) return setErr('Name and category are required.');
    setBusy(true); setErr(null);
    try { initial ? await put(`/indicators/${initial.id}`, f) : await post('/indicators', f); onSaved(); onClose(); }
    catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }
  return (
    <Modal title={initial ? 'Edit indicator' : 'New indicator'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <ErrorBox message={err} />}
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Category"><input className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="Unit" hint="e.g. count, %, currency (as reported)"><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        <Field label="Description"><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {initial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active (monitored)</label>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

export default function Indicators() {
  const { can } = useAuth();
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useGet<any[]>('/indicators');
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const cats = [...new Set(data?.map((i) => i.category))];
  const rows = data?.filter((i) => (!category || i.category === category) && (!q || i.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <PageHeader title="Indicator management" subtitle="Indicators are created automatically when datasets are processed. Names, categories and units can be curated here."
        actions={can('indicators.manage') && <button className="btn-primary" onClick={() => setEdit('new')}>New indicator</button>} />
      <div className="card mb-5 grid gap-3 p-4 sm:grid-cols-2" role="search">
        <Field label="Search"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Indicator name" /></Field>
        <Field label="Category"><select className="input" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
      </div>
      {loading && !data && <Spinner />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {rows && (
        <Card pad={false}>
          <Table head={['Indicator', 'Category', 'Unit', 'Observations', 'Coverage', 'Status', ...(can('indicators.manage') ? [''] : [])]} empty={!rows.length}>
            {rows.map((i) => (
              <tr key={i.id}>
                <td className="td font-medium text-slate-900">{i.name}{i.has_synthetic && <> <Badge tone="amber">Synthetic</Badge></>}<div className="text-xs font-normal text-slate-500">{i.code}</div></td>
                <td className="td">{i.category}</td><td className="td">{i.unit || '—'}</td>
                <td className="td">{num(i.n_points)} <span className="text-xs text-slate-500">({i.n_areas} areas)</span></td>
                <td className="td whitespace-nowrap">{i.first_period ? `${monthLabel(i.first_period)} – ${monthLabel(i.last_period)}` : 'No data yet'}</td>
                <td className="td">{i.is_active ? <Badge tone="green">Monitored</Badge> : <Badge>Inactive</Badge>}</td>
                {can('indicators.manage') && <td className="td text-right"><button className="btn-secondary !py-1" onClick={() => setEdit(i)}>Edit</button></td>}
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {edit && <IndicatorForm initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}
