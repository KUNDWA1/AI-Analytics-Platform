import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errMsg } from '../api';
import { ErrorBox, Field } from '../components/ui';

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const valid = emailOk && password.length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      nav('/', { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <h1 className="text-2xl font-bold">AI Analytics Platform</h1>
          <p className="mt-1 text-sm text-brand-100">Digital Economy Activity Monitoring in Emerging Markets</p>
          <p className="text-xs text-brand-200">Case study: Rwanda · Adventist University of Central Africa</p>
        </div>
        <form onSubmit={submit} noValidate className="card space-y-4 p-6" aria-label="Sign in">
          <h2 className="text-lg font-semibold text-slate-900">Sign in</h2>
          {error && <ErrorBox message={error} />}
          <Field label="Email">
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={touched && !emailOk} />
            {touched && !emailOk && <span className="mt-1 block text-xs text-red-700">Enter a valid email address.</span>}
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={touched && !password} />
            {touched && !password && <span className="mt-1 block text-xs text-red-700">Password is required.</span>}
          </Field>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="text-xs leading-relaxed text-slate-500">
            Prototype for academic demonstration. Demo accounts (admin, analyst, regulator, management @demo.local) are listed in the README.
            The platform is an analytical tool; it does not process payments or control financial transactions.
          </p>
        </form>
      </div>
    </div>
  );
}
