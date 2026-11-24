import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errMsg, post } from '../api';
import { Card, Empty, ErrorBox, Notice, PageHeader, Spinner, StatusBadge, Table, useGet } from '../components/ui';
import { dateTime, num } from '../format';

export default function Processing() {
  const ds = useGet<any[]>('/datasets');
  const jobs = useGet<any[]>('/datasets/jobs/all');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);

  async function run(d: any) {
    setBusyId(d.id); setMsg(null);
    try {
      const s = await post(`/datasets/${d.id}/process`);
      setMsg({ tone: 'green', text: `“${d.name}” processed: ${num(s.valid_records)} valid records, ${num(s.invalid_records)} invalid, ${num(s.duplicate_records)} duplicates, ${num(s.observations_created)} observations stored.` });
    } catch (e) { setMsg({ tone: 'red', text: errMsg(e) }); }
    finally { setBusyId(null); ds.reload(); jobs.reload(); }
  }

  const queue = ds.data?.filter((d) => d.status !== 'archived') || [];
  return (
    <div className="space-y-5">
      <PageHeader title="Data processing" subtitle="Normalise dates, validate values, remove duplicates, compute percentage changes and moving averages, and store observations traceable to their source file." />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {ds.loading && !ds.data && <Spinner />}
      {ds.error && <ErrorBox message={ds.error} onRetry={ds.reload} />}
      {ds.data && (
        <Card title="Datasets" pad={false}>
          {queue.length ? (
            <Table head={['Dataset', 'Status', 'Records', 'Last processed', '']}>
              {queue.map((d) => (
                <tr key={d.id}>
                  <td className="td"><Link className="font-medium text-brand-700 hover:underline" to={`/datasets/${d.id}`}>{d.name}</Link><div className="text-xs text-slate-500">{d.original_filename}</div></td>
                  <td className="td"><StatusBadge status={d.status} /></td>
                  <td className="td">{num(d.record_count)}</td>
                  <td className="td">{d.processed_at ? dateTime(d.processed_at) : '—'}</td>
                  <td className="td text-right"><button className="btn-primary !py-1" disabled={busyId === d.id || d.status === 'processing'} onClick={() => run(d)}>
                    {busyId === d.id ? 'Processing…' : d.status === 'processed' ? 'Re-process' : 'Process'}</button></td>
                </tr>
              ))}
            </Table>
          ) : <Empty title="No datasets to process" action={<Link className="btn-primary" to="/datasets/upload">Upload a dataset</Link>} />}
        </Card>
      )}
      <Card title="Processing history" subtitle="Summary of each processing run" pad={false}>
        {jobs.data?.length ? (
          <Table head={['Job', 'Dataset', 'Status', 'Original', 'Valid', 'Invalid', 'Missing', 'Duplicates', 'Finished']}>
            {jobs.data.map((j) => (
              <tr key={j.id}><td className="td">#{j.id}</td><td className="td">{j.dataset_name}</td><td className="td"><StatusBadge status={j.status} />{j.error && <div className="max-w-xs text-xs text-red-700">{j.error}</div>}</td>
                <td className="td">{num(j.summary?.original_records)}</td><td className="td">{num(j.summary?.valid_records)}</td><td className="td">{num(j.summary?.invalid_records)}</td>
                <td className="td">{num(j.summary?.missing_values)}</td><td className="td">{num(j.summary?.duplicate_records)}</td><td className="td whitespace-nowrap">{dateTime(j.finished_at || j.started_at)}</td></tr>
            ))}
          </Table>
        ) : <Empty title="No processing runs yet" />}
      </Card>
    </div>
  );
}
