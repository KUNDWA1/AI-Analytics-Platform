import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

interface NavItem { to: string; label: string; perm?: string[]; admin?: boolean }
interface NavGroup { title: string; items: NavItem[] }

// Navigation is only a convenience: every route and API call is authorised again on the server.
const NAV: NavGroup[] = [
  { title: 'Overview', items: [{ to: '/', label: 'Dashboard', perm: ['dashboard.view'] }] },
  {
    title: 'Data',
    items: [
      { to: '/sources', label: 'Data sources', perm: ['sources.view'] },
      { to: '/datasets', label: 'Datasets', perm: ['datasets.view'] },
      { to: '/datasets/upload', label: 'Upload dataset', perm: ['datasets.upload'] },
      { to: '/processing', label: 'Data processing', perm: ['datasets.process'] },
      { to: '/indicators', label: 'Indicators', perm: ['indicators.view'] },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { to: '/trends', label: 'Trend analysis', perm: ['analytics.view'] },
      { to: '/forecasting', label: 'Forecasting', perm: ['analytics.view'] },
      { to: '/anomalies', label: 'Anomaly monitoring', perm: ['alerts.view'] },
    ],
  },
  { title: 'Reporting', items: [{ to: '/reports', label: 'Reports', perm: ['reports.view'] }] },
  {
    title: 'Administration',
    items: [
      { to: '/users', label: 'User management', perm: ['users.manage'] },
      { to: '/audit', label: 'Audit logs', perm: ['audit.view'] },
    ],
  },
];

export default function Layout() {
  const { user, logout, can } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(...i.perm)) })).filter((g) => g.items.length);

  const sidebar = (
    <nav aria-label="Main navigation" className="flex h-full flex-col overflow-y-auto bg-brand-900 px-3 py-4 text-brand-100">
      <div className="mb-5 px-2">
        <div className="text-sm font-bold leading-tight text-white">AI Analytics Platform</div>
        <div className="text-xs text-brand-200">Digital Economy Monitoring · Rwanda</div>
      </div>
      {groups.map((g) => (
        <div key={g.title} className="mb-4">
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-brand-200/70">{g.title}</div>
          {g.items.map((i) => (
            <NavLink key={i.to} to={i.to} end onClick={() => setOpen(false)}
              className={({ isActive }) => `block rounded-md px-2.5 py-1.5 text-sm ${isActive ? 'bg-brand-700 font-medium text-white' : 'hover:bg-brand-800 hover:text-white'}`}>
              {i.label}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="mt-auto px-2 pt-4 text-[11px] leading-snug text-brand-200/70">
        Analytical intelligence only. Does not process payments or control transactions.
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/50" />
          <aside className="absolute left-0 top-0 h-full w-64" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="flex items-center gap-3">
            <button className="btn-secondary !px-2 lg:hidden" aria-label="Open navigation menu" onClick={() => setOpen(true)}>☰</button>
            <span className="hidden text-sm text-slate-500 sm:inline">FinTech &amp; Digital Financial Services — Analytics</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => nav('/profile')} className="text-right text-sm leading-tight hover:text-brand-700" aria-label="Open profile and settings">
              <div className="font-medium text-slate-800">{user?.full_name}</div>
              <div className="text-xs text-slate-500">{user?.role_label}</div>
            </button>
            <button className="btn-secondary" onClick={async () => { await logout(); nav('/login'); }}>Sign out</button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6"><Outlet /></main>
      </div>
    </div>
  );
}
