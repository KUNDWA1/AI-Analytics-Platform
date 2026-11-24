import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import App from '../App';
import { AuthProvider } from '../auth';
import { tokenStore } from '../api';
import { compact, pct, monthLabel } from '../format';

// The HTTP layer is mocked at the module boundary so these tests exercise UI behaviour only
// (the real API is covered by the backend integration tests and the browser smoke test).
vi.mock('../api', async () => {
  const actual: any = await vi.importActual('../api');
  return { ...actual, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), download: vi.fn(), http: { post: vi.fn() } };
});
import * as api from '../api';

const USERS: any = {
  analyst: { id: 2, email: 'a@demo.local', full_name: 'Demo Analyst', role: 'analyst', role_label: 'Data Analyst', permissions: ['dashboard.view', 'datasets.view', 'datasets.upload', 'datasets.process', 'analytics.view', 'analytics.run', 'alerts.view', 'alerts.review', 'reports.view', 'reports.generate', 'sources.view', 'indicators.view'] },
  management: { id: 4, email: 'm@demo.local', full_name: 'Demo Manager', role: 'management', role_label: 'Management / Policymaker', permissions: ['dashboard.view', 'analytics.view', 'reports.view', 'reports.generate', 'sources.view', 'indicators.view'] },
};

function mountAs(role: string | null, path = '/') {
  const g = api.get as any;
  g.mockReset();
  g.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { user: USERS[role!] };
    if (url === '/dashboard/filters') return { areas: ['Kigali City'], categories: ['Mobile Money'], sources: [], period_range: { min: '2020-01-01', max: '2024-12-01' } };
    if (url.startsWith('/dashboard/')) return { role: 'x', has_data: true, is_synthetic: true, area_label: 'All areas (national)', kpis: [{ key: 'k', label: 'Total volume', value: 1500000, unit: 'transactions' }], charts: { volume_trend: { keys: [], rows: [] }, value_trend: { keys: [], rows: [] }, inclusion_trend: { keys: [], rows: [] }, regional: { rows: [] } }, snapshot: [], anomalies: { open: 3, by_severity: { high: 1, medium: 1, low: 1 }, recent: [] }, activity: [] };
    if (url === '/datasets/meta') return { categories: ['Mobile Money'], max_upload_mb: 10 };
    if (url === '/data-sources' || url === '/system/samples') return url === '/system/samples' ? { files: [] } : [];
    return [];
  });
  if (role) tokenStore.set('t'); else tokenStore.clear();
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

describe('formatting helpers', () => {
  it('formats numbers, percentages and months', () => {
    expect(compact(1_500_000)).toBe('1.5M');
    expect(pct(12.345)).toBe('+12.3%');
    expect(pct(null)).toBe('—');
    expect(monthLabel('2024-03-01')).toBe('Mar 2024');
  });
});

describe('login and navigation', () => {
  it('redirects unauthenticated users to the login form', async () => {
    mountAs(null, '/datasets');
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('validates the login form before calling the API', async () => {
    mountAs(null, '/login');
    await userEvent.click(await screen.findByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the server error for failed sign-in', async () => {
    mountAs(null, '/login');
    (api.post as any).mockRejectedValueOnce({ response: { data: { error: { message: 'Invalid email or password.' } } } });
    await userEvent.type(await screen.findByLabelText(/email/i), 'x@demo.local');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });
});

describe('role-specific interfaces', () => {
  it('analyst sees upload and processing navigation and the synthetic-data banner', async () => {
    mountAs('analyst');
    expect(await screen.findByRole('link', { name: 'Upload dataset' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Data processing' })).toBeInTheDocument();
    expect(await screen.findByText(/SYNTHETIC DEMONSTRATION DATA/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'User management' })).not.toBeInTheDocument();
  });

  it('management has no upload/user/audit navigation and is blocked from the upload route', async () => {
    mountAs('management', '/datasets/upload');
    expect(await screen.findByText(/access denied/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Upload dataset' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit logs' })).not.toBeInTheDocument();
  });
});

describe('dashboard', () => {
  it('renders KPIs from the API and re-queries when a filter changes', async () => {
    mountAs('analyst');
    expect(await screen.findByText('Total volume')).toBeInTheDocument();
    expect(screen.getByText('1.5M')).toBeInTheDocument();
    const select = (await screen.findAllByRole('combobox')).find((s) => (s as HTMLSelectElement).textContent?.includes('Mobile Money'))!;
    await userEvent.selectOptions(select, 'Mobile Money');
    await waitFor(() => expect((api.get as any).mock.calls.some((c: any[]) => c[0] === '/dashboard/analyst' && c[1]?.category === 'Mobile Money')).toBe(true));
  });
});

describe('dataset upload form', () => {
  it('rejects unsupported file types client-side', async () => {
    mountAs('analyst', '/datasets/upload');
    const input = (await screen.findByLabelText('Dataset file')) as HTMLInputElement;
    const bad = new File(['x'], 'malware.exe', { type: 'application/octet-stream' });
    await userEvent.upload(input, bad, { applyAccept: false } as any);
    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
    expect(api.http.post).not.toHaveBeenCalled();
  });

  it('requires a category before submitting a valid CSV', async () => {
    mountAs('analyst', '/datasets/upload');
    const input = (await screen.findByLabelText('Dataset file')) as HTMLInputElement;
    await userEvent.upload(input, new File(['a,b\n1,2\n'], 'ok.csv', { type: 'text/csv' }));
    await userEvent.click(screen.getByRole('button', { name: /upload and validate/i }));
    expect(await screen.findByText(/select a dataset category/i)).toBeInTheDocument();
    expect(api.http.post).not.toHaveBeenCalled();
  });
});
