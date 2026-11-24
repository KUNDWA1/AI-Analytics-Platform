// Display helpers. Values come straight from the backend; these only format them for reading.
export const SYNTH_LABEL = 'SYNTHETIC DEMONSTRATION DATA — NOT OFFICIAL INSTITUTIONAL DATA.';

// Colour-blind-safe categorical palette (Okabe–Ito inspired), used consistently across all charts.
export const PALETTE = ['#1f7a8c', '#e69f00', '#56b4e9', '#cc79a7', '#009e73', '#d55e00', '#6a5acd', '#7f8c8d'];
export const SEVERITY_COLOR: Record<string, string> = { high: '#b91c1c', medium: '#b45309', low: '#1d6fa5' };

export function num(v: any, digits = 0): string {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Compact notation for large values: 1.2M, 4.5B. */
export function compact(v: any, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const n = Number(v), a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(digits)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function pct(v: any, digits = 1, sign = true): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return `${sign && n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

export function monthLabel(p: string | null | undefined): string {
  if (!p) return '—';
  const d = new Date(`${p.slice(0, 10)}T00:00:00Z`);
  if (isNaN(d.getTime())) return p;
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function dateTime(p: string | null | undefined): string {
  if (!p) return '—';
  const d = new Date(p);
  return isNaN(d.getTime()) ? p : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);
