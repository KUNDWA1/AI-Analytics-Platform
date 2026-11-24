import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { errMsg, get } from '../api';
import { SYNTH_LABEL, SEVERITY_COLOR, cap } from '../format';

/** Fetch data with loading/error state. `deps` re-triggers the request. */
export function useAsync<T = any>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    fn().then((d) => { if (id === seq.current) setData(d); })
      .catch((e) => { if (id === seq.current) setError(errMsg(e)); })
      .finally(() => { if (id === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

export const useGet = <T = any,>(url: string, params?: Record<string, any>) =>
  useAsync<T>(() => get<T>(url, params), [url, JSON.stringify(params ?? {})]);

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <span>{message}</span>
      {onRetry && <button className="btn-secondary !py-1" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = '', pad = true }: {
  title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

const TONES: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-800', amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800', blue: 'bg-sky-100 text-sky-800', teal: 'bg-brand-100 text-brand-800', purple: 'bg-violet-100 text-violet-800',
};
export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: keyof typeof TONES | string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone] || TONES.gray}`}>{children}</span>;
}

export const SeverityBadge = ({ severity }: { severity: string }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
    style={{ background: `${SEVERITY_COLOR[severity]}1a`, color: SEVERITY_COLOR[severity] }}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: SEVERITY_COLOR[severity] }} />{cap(severity)}
  </span>
);

const STATUS_TONE: Record<string, string> = {
  processed: 'green', validated: 'blue', uploaded: 'gray', processing: 'amber', failed: 'red', archived: 'gray',
  new: 'amber', under_review: 'blue', reviewed: 'green', dismissed: 'gray', completed: 'green', running: 'amber',
};
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] || 'gray'}>{cap(status)}</Badge>;

export const SyntheticBanner = ({ show = true, compact = false }: { show?: boolean; compact?: boolean }) =>
  show ? (
    <div role="note" className={`rounded-md border border-amber-300 bg-amber-50 font-semibold text-amber-900 ${compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}>
      {SYNTH_LABEL}
    </div>
  ) : null;

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[90vh] w-full overflow-auto rounded-lg bg-white shadow-xl ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button aria-label="Close dialog" className="text-slate-400 hover:text-slate-700" onClick={onClose}>✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Confirmation dialog that runs an async action and shows its error. */
export function Confirm({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }: {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4 text-sm text-slate-700">
        <div>{message}</div>
        {err && <ErrorBox message={err} />}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy}
            onClick={async () => { setBusy(true); setErr(null); try { await onConfirm(); onClose(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Notice({ tone = 'blue', children }: { tone?: 'blue' | 'amber' | 'green' | 'red'; children: ReactNode }) {
  const t = { blue: 'border-sky-200 bg-sky-50 text-sky-900', amber: 'border-amber-200 bg-amber-50 text-amber-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900', red: 'border-red-200 bg-red-50 text-red-800' }[tone];
  return <div className={`rounded-md border px-4 py-3 text-sm ${t}`}>{children}</div>;
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50"><tr>{head.map((h) => <th key={h} className="th" scope="col">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <Empty title="Nothing to show" hint="No records match the current selection." />}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
