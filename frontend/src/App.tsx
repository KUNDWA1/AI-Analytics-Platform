import { Navigate, Route, Routes } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from './auth';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sources from './pages/Sources';
import Datasets from './pages/Datasets';
import DatasetDetail from './pages/DatasetDetail';
import Upload from './pages/Upload';
import Processing from './pages/Processing';
import Indicators from './pages/Indicators';
import Trends from './pages/Trends';
import Forecasting from './pages/Forecasting';
import Anomalies from './pages/Anomalies';
import AlertDetail from './pages/AlertDetail';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Audit from './pages/Audit';
import Profile from './pages/Profile';

function Forbidden() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold">Access denied</h1>
      <p className="mt-2 text-sm text-slate-600">Your role does not include access to this page. The server enforces this on every request.</p>
    </div>
  );
}

/** Route guard. UI convenience only — the backend independently enforces every permission. */
function Guard({ perm, children }: { perm?: string[]; children: ReactNode }) {
  const { user, loading, can } = useAuth();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (perm && !can(...perm)) return <Forbidden />;
  return <>{children}</>;
}

const g = (perm: string[] | undefined, el: ReactNode) => <Guard perm={perm}>{el}</Guard>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={g(['dashboard.view'], <Dashboard />)} />
        <Route path="sources" element={g(['sources.view'], <Sources />)} />
        <Route path="datasets" element={g(['datasets.view'], <Datasets />)} />
        <Route path="datasets/upload" element={g(['datasets.upload'], <Upload />)} />
        <Route path="datasets/:id" element={g(['datasets.view'], <DatasetDetail />)} />
        <Route path="processing" element={g(['datasets.process'], <Processing />)} />
        <Route path="indicators" element={g(['indicators.view'], <Indicators />)} />
        <Route path="trends" element={g(['analytics.view'], <Trends />)} />
        <Route path="forecasting" element={g(['analytics.view'], <Forecasting />)} />
        <Route path="anomalies" element={g(['alerts.view'], <Anomalies />)} />
        <Route path="alerts/:id" element={g(['alerts.view'], <AlertDetail />)} />
        <Route path="reports" element={g(['reports.view'], <Reports />)} />
        <Route path="users" element={g(['users.manage'], <Users />)} />
        <Route path="audit" element={g(['audit.view'], <Audit />)} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<Forbidden />} />
      </Route>
    </Routes>
  );
}
