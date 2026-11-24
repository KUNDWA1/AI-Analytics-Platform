import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { errMsg, patch } from '../api';
import { Badge, Card, ErrorBox, Field, Notice, PageHeader, SeverityBadge, Spinner, Stat, StatusBadge, SyntheticBanner, Table, useGet } from '../components/ui';
import { AnomalyChart } from '../components/charts';
import { cap, compact, dateTime, monthLabel, num, pct } from '../format';

export default function AlertDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: a, error, loading, reload } = useGet<any>(`/alerts/${id}`);
  const [status, setStatus] = useState('new');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (a) { setStatus(a.status); setNote(a.analyst_note || ''); } }, [a]);

  if (loading && !a) return <Spinner />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!a) return null;
  const dev = a.expected_value ? ((a.observed_value - a.expected_value) / a.expected_value) * 100 : null;

  async function save(nextStatus?: string) {
    setBusy(true); setMsg(null);
    try {
      await patch(`/alerts/${a.id}`, { status: nextStatus || status, analyst_note: note });
      setMsg({ tone: 'green', text: 'Alert updated and recorded in the audit log.' });
      reload();
    } catch (e) { setMsg({ tone: 'red', text: errMsg(e) }); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={`Alert #${a.id}: ${a.indicator_name}`} subtitle={`${a.area} · ${monthLabel(a.period)}`}
        actions={<Link className="btn-secondary" to="/anomalies">← All alerts</Link>} />
      <SyntheticBanner show={a.is_synthetic} />
      <Notice tone="amber"><strong>Unusual activity detected — requires further investigation.</strong> {a.explanation}</Notice>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Severity" value={<SeverityBadge severity={a.severity} />} sub={`Score ${Number(a.anomaly_score).toFixed(2)}`} />
        <Stat label="Observed value" value={compact(a.observed_value, 2)} sub={a.unit} />
        <Stat label="Expected baseline" value={compact(a.expected_value, 2)} sub={dev != null ? `${pct(dev)} vs baseline` : undefined} />
        <Stat label="Direction" value={cap(a.direction)} sub={a.category} />
        <Stat label="Status" value={<StatusBadge status={a.status} />} sub={a.reviewed_by_name ? `Reviewed by ${a.reviewed_by_name}` : 'Not yet reviewed'} />
      </div>

      <Card title="Context in the time series"><AnomalyChart series={a.series} point={{ period: a.period, value: a.observed_value }} expected={a.expected_value} /></Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Detection details">
          <dl className="space-y-2 text-sm">
            <div><dt className="label">Detection method</dt><dd>{a.method}</dd></div>
            <div><dt className="label">Detected</dt><dd>{dateTime(a.detected_at)}</dd></div>
            <div><dt className="label">Explanation</dt><dd>{a.explanation}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">Anomaly scores are unsupervised and there are no ground-truth labels: they indicate how unusual a value is, not whether it is an error or wrongdoing.</p>
        </Card>
        <Card title="Review and analyst note">
          {can('alerts.review') ? (
            <div className="space-y-3">
              {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
              <Field label="Status"><select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Alert status">
                {['new', 'under_review', 'reviewed', 'dismissed'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select></Field>
              <Field label="Analyst note"><textarea className="input" rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Record findings, context or follow-up actions…" aria-label="Analyst note" /></Field>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save'}</button>
                {a.status !== 'reviewed' && <button className="btn-secondary" disabled={busy} onClick={() => { setStatus('reviewed'); save('reviewed'); }}>Mark as reviewed</button>}
              </div>
            </div>
          ) : (
            <div className="text-sm"><p className="text-slate-600">Your role can view alerts but not change them.</p>{a.analyst_note && <p className="mt-2 rounded bg-slate-50 p-3">{a.analyst_note}</p>}</div>
          )}
          {a.reviewed_at && <p className="mt-3 text-xs text-slate-500">Last reviewed {dateTime(a.reviewed_at)}{a.reviewed_by_name ? ` by ${a.reviewed_by_name}` : ''}.</p>}
        </Card>
      </div>

      {a.related_alerts?.length > 0 && (
        <Card title="Other alerts for this indicator and region" pad={false}>
          <Table head={['Period', 'Severity', 'Status', '']}>
            {a.related_alerts.map((r: any) => <tr key={r.id}><td className="td">{monthLabel(r.period)}</td><td className="td"><SeverityBadge severity={r.severity} /></td><td className="td"><StatusBadge status={r.status} /></td><td className="td text-right"><Link className="btn-secondary !py-1" to={`/alerts/${r.id}`}>Open</Link></td></tr>)}
          </Table>
        </Card>
      )}
    </div>
  );
}
