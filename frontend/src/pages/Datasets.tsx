import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { del, post } from '../api';
import { Badge, Card, Confirm, ErrorBox, Field, PageHeader, Spinner, StatusBadge, Table, useGet } from '../components/ui';
import { bytes, dateTime, num } from '../format';

export default function Datasets() {
  const { can } = useAuth();
  const [flt, setFlt] = useState({ q: '', status: '', category: '' });
  const meta = useGet<any>('/datasets/meta');
  const { data, error, loading, reload } = useGet<any[]>('/datasets', flt);
  const [confirm, setConfirm] = useState<{ kind: 'archive' | 'delete'; ds: any } | null>(null);

  return (
    <div>
      <PageHeader title="Dataset management" subtitle="Uploaded files are stored unchanged; processed observations stay linked to their source dataset."
        actions={can('datasets.upload') && <Link className="btn-primary" to="/datasets/upload">Upload dataset</Link>} />
      <div className="card mb-5 grid gap-3 p-4 sm:grid-cols-3" role="search">
        <Field label="Search"><input className="input" placeholder="Name or file name" value={flt.q} onChange={(e) => setFlt({ ...flt, q: e.target.value })} /></Field>
        <Field label="Status">
          <select className="input" value={flt.status} onChange={(e) => setFlt({ ...flt, status: e.target.value })}>
            <option value="">All</option>{['uploaded', 'validated', 'processed', 'failed', 'archived'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select className="input" value={flt.category} onChange={(e) => setFlt({ ...flt, category: e.target.value })}>
            <option value="">All</option>{meta.data?.categories?.map((c: string) => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      {loading && !data && <Spinner />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <Card pad={false}>
          <Table head={['Dataset', 'Source', 'Records', 'Columns', 'Uploaded', 'Status', '']} empty={!data.length}>
            {data.map((d) => (
              <tr key={d.id}>
                <td className="td"><Link to={`/datasets/${d.id}`} className="font-medium text-brand-700 hover:underline">{d.name}</Link>
                  <div className="text-xs text-slate-500">{d.original_filename} · {bytes(d.file_size)} · {d.category}</div>
                  {d.is_synthetic && <Badge tone="amber">Synthetic</Badge>}</td>
                <td className="td">{d.source_name || '—'}</td>
                <td className="td">{num(d.record_count)}</td>
                <td className="td">{d.column_count ?? '—'}</td>
                <td className="td whitespace-nowrap">{dateTime(d.created_at)}<div className="text-xs text-slate-500">{d.uploaded_by_name}</div></td>
                <td className="td"><StatusBadge status={d.status} /></td>
                <td className="td whitespace-nowrap text-right">
                  <Link className="btn-secondary !py-1" to={`/datasets/${d.id}`}>Open</Link>{' '}
                  {can('datasets.delete') && d.status !== 'archived' && <button className="btn-secondary !py-1" onClick={() => setConfirm({ kind: 'archive', ds: d })}>Archive</button>}{' '}
                  {can('datasets.delete') && <button className="btn-secondary !py-1 text-red-700" onClick={() => setConfirm({ kind: 'delete', ds: d })}>Delete</button>}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {confirm && (
        <Confirm danger={confirm.kind === 'delete'} title={confirm.kind === 'delete' ? 'Delete dataset permanently' : 'Archive dataset'}
          confirmLabel={confirm.kind === 'delete' ? 'Delete' : 'Archive'}
          message={confirm.kind === 'delete'
            ? <>Permanently delete <strong>{confirm.ds.name}</strong>, its processed observations and the stored file? Analysis results already saved are kept. This cannot be undone.</>
            : <>Archive <strong>{confirm.ds.name}</strong>? Its observations are excluded from dashboards and analytics but the file and history are kept.</>}
          onConfirm={async () => { confirm.kind === 'delete' ? await del(`/datasets/${confirm.ds.id}`) : await post(`/datasets/${confirm.ds.id}/archive`); reload(); }}
          onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}
