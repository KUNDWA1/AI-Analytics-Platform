import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errMsg, post } from '../api';
import { Card, ErrorBox, Field, Notice, PageHeader, useGet } from '../components/ui';

export default function Profile() {
  const { user, logout, can } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const health = useGet<any>('/health');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setDone(false);
    if (f.new_password.length < 8 || !/[A-Za-z]/.test(f.new_password) || !/\d/.test(f.new_password)) return setErr('New password must be at least 8 characters and include a letter and a digit.');
    if (f.new_password !== f.confirm) return setErr('The new passwords do not match.');
    setBusy(true);
    try { await post('/auth/change-password', { current_password: f.current_password, new_password: f.new_password }); setDone(true); setF({ current_password: '', new_password: '', confirm: '' }); }
    catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Profile & settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Account">
          <dl className="space-y-3 text-sm">
            <div><dt className="label">Name</dt><dd>{user?.full_name}</dd></div>
            <div><dt className="label">Email</dt><dd>{user?.email}</dd></div>
            <div><dt className="label">Role</dt><dd>{user?.role_label}</dd></div>
            <div><dt className="label">Permissions</dt><dd className="flex flex-wrap gap-1.5">{user?.permissions.map((p) => <code key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{p}</code>)}</dd></div>
          </dl>
          <button className="btn-secondary mt-4" onClick={async () => { await logout(); nav('/login'); }}>Sign out</button>
        </Card>
        <Card title="Change password">
          <form onSubmit={submit} className="space-y-3" aria-label="Change password">
            {err && <ErrorBox message={err} />}
            {done && <Notice tone="green">Password updated. Your other sessions were signed out.</Notice>}
            <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
            <Field label="New password"><input className="input" type="password" autoComplete="new-password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
            <Field label="Confirm new password"><input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
            <button className="btn-primary" disabled={busy || !f.current_password}>{busy ? 'Updating…' : 'Update password'}</button>
          </form>
        </Card>
      </div>
      <Card title="About this platform">
        <p className="text-sm text-slate-600">AI Analytics Platform for Digital Economy Activity Monitoring in Emerging Markets — a BSc Software Engineering project (AUCA). It is an analytical intelligence system: it does not process payments, move money or control transactions. Data comes from manually imported public datasets or clearly labelled synthetic demonstration data.</p>
        <p className="mt-2 text-xs text-slate-500">API status: {health.data?.status || '…'} {can('system.manage') ? '· Demo reset is available via the API (POST /api/system/demo/reset) or `npm run seed -- --reset`.' : ''}</p>
      </Card>
    </div>
  );
}
