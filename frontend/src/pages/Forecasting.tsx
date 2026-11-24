import { useState } from 'react';
import { useAuth } from '../auth';
import { errMsg, post } from '../api';
import { AreaSelect, IndicatorSelect, useSelectorData } from '../components/Selectors';
import { Badge, Card, Empty, ErrorBox, Field, Notice, PageHeader, Spinner, Stat, SyntheticBanner, Table, useGet } from '../components/ui';
import { ForecastChart } from '../components/charts';
import { compact, dateTime, monthLabel } from '../format';

const MODEL_NAMES: Record<string, string> = {
  naive: 'Naive (last value)', seasonal_naive: 'Seasonal naive', linear: 'Linear trend regression', linear_seasonal: 'Linear trend + seasonality (Ridge)',
  loglinear: 'Log-linear (exponential) trend', loglinear_seasonal: 'Log-linear trend + seasonality', holt: "Holt's exponential smoothing",
};
const mn = (k: string) => MODEL_NAMES[k] || k;

function ForecastResult({ r }: { r: any }) {
  if (r.status !== 'ok') {
    return (
      <div className="space-y-4">
        <SyntheticBanner show={r.is_synthetic} />
        <Notice tone="amber"><strong>A reliable forecast cannot be produced for this series.</strong> {r.reason}</Notice>
        {r.history?.length > 0 && <Card title="Historical values (descriptive view)"><ForecastChart history={r.history} forecast={[]} /></Card>}
      </div>
    );
  }
  const ev = r.evaluation, sel = ev.selected;
  return (
    <div className="space-y-5">
      <SyntheticBanner show={r.is_synthetic} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Method selected" value={<span className="text-base">{mn(r.method)}</span>} sub={`by lowest RMSE in back-test`} />
        <Stat label="Forecast period" value={<span className="text-base">{monthLabel(r.forecast[0].period)} – {monthLabel(r.forecast[r.forecast.length - 1].period)}</span>} sub={`${r.horizon} ${r.frequency_label} steps`} />
        <Stat label="Back-test MAPE" value={`${sel.mape_pct.toFixed(2)}%`} sub={`MAE ${compact(sel.mae)} · RMSE ${compact(sel.rmse)}`} />
        <Stat label="vs naive benchmark" value={<Badge tone={ev.beats_naive_benchmark ? 'green' : 'amber'}>{ev.beats_naive_benchmark ? 'Better than naive' : 'Not better than naive'}</Badge>} sub={`${r.n_observations} observations used`} />
      </div>
      <Card title={`${r.indicator.name} — ${r.area}`} subtitle="Historical values, forecast, and 80% / 95% prediction intervals"><ForecastChart history={r.history} forecast={r.forecast} unit={r.indicator.unit} /></Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Forecast values" pad={false}>
          <Table head={['Period', 'Forecast', '80% interval', '95% interval']}>
            {r.forecast.map((f: any) => <tr key={f.period}><td className="td">{monthLabel(f.period)}</td><td className="td font-medium">{compact(f.value, 2)}</td>
              <td className="td text-xs">{compact(f.lower_80, 2)} – {compact(f.upper_80, 2)}</td><td className="td text-xs">{compact(f.lower_95, 2)} – {compact(f.upper_95, 2)}</td></tr>)}
          </Table>
        </Card>
        <Card title="Model evaluation" subtitle={`${ev.selection_metric}; ${ev.backtest_origins} origins × ${ev.backtest_horizon}-step horizon`} pad={false}>
          <Table head={['Model', 'MAE', 'RMSE', 'MAPE']}>
            {ev.candidates.map((c: any) => (
              <tr key={c.model} className={c.model === sel.model ? 'bg-brand-50' : ''}><td className="td">{mn(c.model)} {c.model === sel.model && <Badge tone="teal">selected</Badge>}</td>
                <td className="td">{compact(c.mae)}</td><td className="td">{compact(c.rmse)}</td><td className="td">{c.mape_pct?.toFixed(2)}%</td></tr>
            ))}
          </Table>
        </Card>
      </div>
      <Card title="How this forecast was produced">
        <dl className="space-y-2 text-sm text-slate-700">
          <div><dt className="inline font-semibold">Method: </dt><dd className="inline">{r.method_description}</dd></div>
          <div><dt className="inline font-semibold">Input features: </dt><dd className="inline">{r.training?.input_feature}; training window {monthLabel(r.training?.training_window?.[0])} – {monthLabel(r.training?.training_window?.[1])} ({r.training?.n_training_points} points).</dd></div>
          <div><dt className="inline font-semibold">Evaluation: </dt><dd className="inline">Rolling-origin back-test — each candidate is trained on earlier data and scored on held-out later months; the lowest-RMSE model is retrained on all data. Errors are in the indicator's own units (MAPE in %).</dd></div>
        </dl>
        <h3 className="label mt-4">Limitations and uncertainty</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">{r.limitations?.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>
      </Card>
    </div>
  );
}

export default function Forecasting() {
  const { can } = useAuth();
  const { indicators, filters, usable } = useSelectorData();
  const [f, setF] = useState({ indicator_id: '', area: '', horizon: '6' });
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useGet<any[]>('/analytics/forecasts');

  async function run() {
    setBusy(true); setErr(null);
    try { setRes(await post('/analytics/forecast', { indicator_id: Number(f.indicator_id), area: f.area || undefined, horizon: Number(f.horizon) })); saved.reload(); }
    catch (e) { setRes(null); setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Forecasting" subtitle="Time-series forecasts trained on stored observations, selected by rolling-origin back-testing. If history is too short, the platform says so instead of guessing." />
      {can('analytics.run') ? (
        <Card title="Run a forecast">
          {indicators.loading && !indicators.data && <Spinner />}
          {indicators.error && <ErrorBox message={indicators.error} onRetry={indicators.reload} />}
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2"><IndicatorSelect value={f.indicator_id} onChange={(v) => setF({ ...f, indicator_id: v })} items={usable} /></div>
            <AreaSelect value={f.area} onChange={(v) => setF({ ...f, area: v })} areas={filters.data?.areas || []} />
            <Field label="Horizon (periods)"><input className="input" type="number" min={1} max={36} value={f.horizon} onChange={(e) => setF({ ...f, horizon: e.target.value })} /></Field>
          </div>
          <div className="mt-4"><button className="btn-primary" disabled={!f.indicator_id || busy || !(Number(f.horizon) >= 1 && Number(f.horizon) <= 36)} onClick={run}>{busy ? 'Training and back-testing models…' : 'Run forecast'}</button></div>
        </Card>
      ) : <Notice tone="blue">Your role can view stored forecasts. Running new forecasts requires the Data Analyst role.</Notice>}
      {err && <ErrorBox message={err} />}
      {res && <ForecastResult r={res} />}

      <Card title="Stored forecasts" subtitle="Click a row to view the full result" pad={false}>
        {saved.loading && !saved.data && <Spinner />}
        {saved.data && (saved.data.length ? (
          <Table head={['Indicator', 'Region', 'Method', 'Horizon', 'MAPE', 'Created']}>
            {saved.data.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-slate-50" tabIndex={0} onClick={() => setRes({ ...s.result, is_synthetic: s.is_synthetic })} onKeyDown={(e) => e.key === 'Enter' && setRes({ ...s.result, is_synthetic: s.is_synthetic })}>
                <td className="td font-medium">{s.indicator_name}{s.is_synthetic && <> <Badge tone="amber">Synthetic</Badge></>}</td><td className="td">{s.area}</td><td className="td">{mn(s.method)}</td>
                <td className="td">{s.horizon}</td><td className="td">{s.selected?.mape_pct != null ? `${Number(s.selected.mape_pct).toFixed(2)}%` : '—'}</td><td className="td">{dateTime(s.created_at)}<div className="text-xs text-slate-500">{s.created_by_name}</div></td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="No forecasts stored yet" />)}
      </Card>
      <p className="text-xs text-slate-500">Forecasts extrapolate historical patterns and cannot anticipate policy changes, shocks or structural breaks. They are decision-support estimates, not guarantees.</p>
    </div>
  );
}
