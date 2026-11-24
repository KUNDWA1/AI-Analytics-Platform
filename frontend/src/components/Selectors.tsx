import { Field, useGet } from './ui';

/** Indicator + region picker shared by the trend and forecasting screens. */
export function useSelectorData() {
  const indicators = useGet<any[]>('/indicators');
  const filters = useGet<any>('/dashboard/filters');
  const usable = indicators.data?.filter((i) => i.is_active && i.n_points > 0) || [];
  return { indicators, filters, usable };
}

export function IndicatorSelect({ value, onChange, items, label = 'Indicator' }: { value: string; onChange: (v: string) => void; items: any[]; label?: string }) {
  const cats = [...new Set(items.map((i) => i.category))];
  return (
    <Field label={label}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Select an indicator…</option>
        {cats.map((c) => <optgroup key={c} label={c}>{items.filter((i) => i.category === c).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup>)}
      </select>
    </Field>
  );
}

export function AreaSelect({ value, onChange, areas }: { value: string; onChange: (v: string) => void; areas: string[] }) {
  return (
    <Field label="Region">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Region">
        <option value="">All regions (national)</option>
        {areas.filter((a) => a !== 'National').map((a) => <option key={a}>{a}</option>)}
      </select>
    </Field>
  );
}
