import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { errMsg, post, put } from '../api';
import { Badge, Card, ErrorBox, Field, Modal, PageHeader, Spinner, Table, useGet } from '../components/ui';

const TYPES = ['public', 'manual', 'synthetic'];

function SourceForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: initial?.name || '', organization: initial?.organization || '', url: initial?.url || '', description: initial?.description || '', source_type: initial?.source_type || 'public', is_active: initial?.is_active ?? true });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setErr('Name is required.');
    setBusy(true); setErr(null);
    try {
      initial ? await put(`/data-sources/${initial.id}`, f) : await post('/data-sources', f);
      onSaved(); onClose();
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }
  return (
    <Modal title={initial ? 'Edit data source' : 'Register data source'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <ErrorBox message={err} />}
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Organization"><input className="input" value={f.organization} onChange={(e) => setF({ ...f, organization: e.target.value })} /></Field>
        <Field label="Website URL" hint="Public page where the dataset is downloaded manually.">
          <input className="input" type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" />
        </Field>
        <Field label="Source type">
          <select className="input" value={f.source_type} onChange={(e) => setF({ ...f, source_type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        </Field>
        <Field label="Description"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {initial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active</label>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

export default function Sources() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useGet<any[]>('/data-sources');
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  return (
    <div>
      <PageHeader title="Data sources" subtitle="Registered origins of datasets. Public datasets are downloaded manually from the official sites and then uploaded; no institutional APIs are assumed."
        actions={can('sources.manage') && <button className="btn-primary" onClick={() => setEdit('new')}>Register source</button>} />
      {loading && !data && <Spinner />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <Card pad={false}>
          <Table head={['Source', 'Type', 'Datasets', 'Status', ...(can('sources.manage') ? [''] : [])]} empty={!data.length}>
            {data.map((s) => (
              <tr key={s.id}>
                <td className="td"><div className="font-medium text-slate-900">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.organization}</div>
                  {s.url && <a className="text-xs text-brand-700 hover:underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>}
                  {s.description && <div className="mt-1 max-w-xl text-xs text-slate-500">{s.description}</div>}</td>
                <td className="td"><Badge tone={s.source_type === 'synthetic' ? 'amber' : s.source_type === 'public' ? 'teal' : 'gray'}>{s.source_type}</Badge></td>
                <td className="td">{s.dataset_count}</td>
                <td className="td">{s.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                {can('sources.manage') && <td className="td text-right"><button className="btn-secondary !py-1" onClick={() => setEdit(s)}>Edit</button></td>}
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {edit && <SourceForm initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}
