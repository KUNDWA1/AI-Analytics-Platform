import { useState } from 'react';
import { Card, Empty, ErrorBox, Field, PageHeader, Spinner, Table, useGet } from '../components/ui';
import { dateTime, num } from '../format';

const PAGE = 50;

export default function Audit() {
  const [flt, setFlt] = useState({ action: '', user: '', from: '', to: '' });
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useGet<any>('/audit-logs', { ...flt, limit: PAGE, offset: page * PAGE });
  const set = (k: string, v: string) => { setPage(0); setFlt((p) => ({ ...p, [k]: v })); };
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  return (
    <div className="space-y-5">
      <PageHeader title="Audit logs" subtitle="A tamper-evident trail of important actions: sign-ins, uploads, processing, analyses, alert reviews, exports and user changes." />
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Audit log filters">
        <Field label="Action"><select className="input" value={flt.action} onChange={(e) => set('action', e.target.value)} aria-label="Action"><option value="">All actions</option>{data?.actions?.map((a: string) => <option key={a}>{a}</option>)}</select></Field>
        <Field label="User email"><input className="input" value={flt.user} onChange={(e) => set('user', e.target.value)} placeholder="Contains…" /></Field>
        <Field label="From"><input className="input" type="date" value={flt.from} onChange={(e) => set('from', e.target.value)} /></Field>
        <Field label="To"><input className="input" type="date" value={flt.to} onChange={(e) => set('to', e.target.value)} /></Field>
      </div>
      {loading && !data && <Spinner />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <Card pad={false}>
          {data.items.length ? (
            <Table head={['Time', 'User', 'Action', 'Entity', 'Details', 'IP']}>
              {data.items.map((r: any) => (
                <tr key={r.id}><td className="td whitespace-nowrap">{dateTime(r.created_at)}</td><td className="td">{r.user_email || '—'}</td>
                  <td className="td font-mono text-xs">{r.action}</td><td className="td">{r.entity_type ? `${r.entity_type} ${r.entity_id ?? ''}` : '—'}</td>
                  <td className="td max-w-sm truncate text-xs text-slate-500" title={r.details ? JSON.stringify(r.details) : ''}>{r.details ? JSON.stringify(r.details) : ''}</td><td className="td text-xs">{r.ip_address}</td></tr>
              ))}
            </Table>
          ) : <Empty title="No audit events match" />}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-slate-500">{num(data.total)} events</span>
            <div className="flex items-center gap-2"><button className="btn-secondary !py-1" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span>Page {page + 1} of {pages}</span><button className="btn-secondary !py-1" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
          </div>
        </Card>
      )}
    </div>
  );
}
