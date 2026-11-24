import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { del, errMsg, post, put } from '../api';
import { Badge, Card, Confirm, ErrorBox, Field, Modal, PageHeader, Spinner, Table, useGet } from '../components/ui';
import { dateTime } from '../format';

function UserForm({ initial, roles, onClose, onSaved }: { initial?: any; roles: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ email: initial?.email || '', full_name: initial?.full_name || '', role: initial?.role || 'analyst', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!initial && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return setErr('Enter a valid email address.');
    if (!f.full_name.trim()) return setErr('Full name is required.');
    if ((!initial || f.password) && (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password))) return setErr('Password must be at least 8 characters and include a letter and a digit.');
    setBusy(true); setErr(null);
    try {
      if (initial) await put(`/users/${initial.id}`, { full_name: f.full_name, role: f.role, ...(f.password ? { password: f.password } : {}) });
      else await post('/users', f);
      onSaved(); onClose();
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }
  return (
    <Modal title={initial ? `Edit ${initial.full_name}` : 'Create user'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {err && <ErrorBox message={err} />}
        {!initial && <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>}
        <Field label="Full name"><input className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} aria-label="Role">{roles.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}</select></Field>
        <Field label={initial ? 'New password (leave blank to keep)' : 'Password'} hint="Minimum 8 characters with a letter and a digit. Stored as a bcrypt hash.">
          <input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const users = useGet<any[]>('/users');
  const roles = useGet<any[]>('/users/roles');
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const [del_, setDel] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggleActive(u: any) {
    setErr(null);
    try { await put(`/users/${u.id}`, { is_active: !u.is_active }); users.reload(); } catch (e) { setErr(errMsg(e)); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="User management" subtitle="Create users, assign roles and deactivate accounts. Role permissions are enforced by the backend on every request."
        actions={<button className="btn-primary" onClick={() => setEdit('new')}>Create user</button>} />
      {err && <ErrorBox message={err} />}
      {users.loading && !users.data && <Spinner />}
      {users.error && <ErrorBox message={users.error} onRetry={users.reload} />}
      {users.data && (
        <Card pad={false}>
          <Table head={['User', 'Role', 'Status', 'Last sign-in', '']}>
            {users.data.map((u) => (
              <tr key={u.id}>
                <td className="td"><div className="font-medium text-slate-900">{u.full_name}{u.id === me?.id && <> <Badge tone="teal">You</Badge></>}</div><div className="text-xs text-slate-500">{u.email}</div></td>
                <td className="td">{u.role_label || u.role}</td>
                <td className="td">{u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}</td>
                <td className="td">{u.last_login ? dateTime(u.last_login) : 'Never'}</td>
                <td className="td whitespace-nowrap text-right">
                  <button className="btn-secondary !py-1" onClick={() => setEdit(u)}>Edit</button>{' '}
                  {u.id !== me?.id && <><button className="btn-secondary !py-1" onClick={() => toggleActive(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</button>{' '}
                    <button className="btn-secondary !py-1 text-red-700" onClick={() => setDel(u)}>Delete</button></>}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Card title="Roles and permissions">
        <dl className="grid gap-3 md:grid-cols-2">{roles.data?.map((r) => <div key={r.id}><dt className="font-medium text-slate-900">{r.label}</dt><dd className="text-sm text-slate-600">{r.description}</dd></div>)}</dl>
      </Card>
      {edit && roles.data && <UserForm initial={edit === 'new' ? undefined : edit} roles={roles.data} onClose={() => setEdit(null)} onSaved={users.reload} />}
      {del_ && <Confirm danger title="Delete user" confirmLabel="Delete" message={<>Delete <strong>{del_.full_name}</strong> ({del_.email})? Their audit-log history is kept. This cannot be undone.</>}
        onConfirm={async () => { await del(`/users/${del_.id}`); users.reload(); }} onClose={() => setDel(null)} />}
    </div>
  );
}
