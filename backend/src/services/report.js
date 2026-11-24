// Report generation: assembles findings from stored data + analytics, renders PDF (pdfkit) and CSV.
const PDFDocument = require('pdfkit');
const db = require('../db');
const { AppError } = require('../errors');
const { runAnalytics } = require('./python');
const S = require('./series');
const D = require('./dashboard');

const SYNTH = 'SYNTHETIC DEMONSTRATION DATA — NOT OFFICIAL INSTITUTIONAL DATA';

const METHODOLOGY = [
  'Data: manually imported CSV/Excel datasets from registered sources (public secondary data and/or labelled synthetic demonstration data). The platform has no live connection to BNR, NISR, RURA, MTN or any bank system.',
  'Processing: dates normalised, numeric values validated, duplicates removed, and period-over-period change and 3-period moving averages computed (pandas).',
  'Trend analysis: log-linear/linear least-squares trend, growth rates and moving averages; direction is reported only when the fit explains a meaningful share of variance.',
  'Anomaly detection: robust z-score on residuals of a trend+seasonal baseline, Isolation Forest corroboration, and cross-area peer comparison. Scores are unsupervised.',
];
const LIMITATIONS = [
  'Findings describe statistical patterns in the imported data only; they are not causal explanations.',
  'An anomaly is an unusual statistical pattern. It is NOT proof of fraud, misconduct or a regulatory violation and requires further investigation.',
  'No labelled anomaly data exist for real datasets, so detection accuracy (precision/recall) cannot be claimed.',
  'Results depend on the completeness, definitions and reporting units of the imported datasets.',
];

// ------------------------------------------------------------------ content
async function buildContent(params, user) {
  const filters = S.parseFilters({ from: params.from, to: params.to, area: params.area });
  const cats = Array.isArray(params.categories) ? params.categories : [];
  let rows = await S.seriesRows(filters);
  if (cats.length) rows = rows.filter((r) => cats.includes(r.category));
  if (!rows.length) throw new AppError(422, 'No processed data matches the selected period, categories and area.');
  const inds = D.group(rows);
  const synthetic = inds.some((i) => i.synthetic);
  const vol = inds.filter((i) => /volume/.test(i.code));
  const val = inds.filter((i) => /transaction_value|_value$/.test(i.code));
  const allPoints = rows.map((r) => r.period).sort();

  // anomaly findings for the same scope
  const av = [];
  const aw = [];
  const addA = (sql, v) => { av.push(v); aw.push(sql.replaceAll('?', `$${av.length}`)); };
  if (filters.from) addA('r.period >= ?', filters.from);
  if (filters.to) addA('r.period <= ?', filters.to);
  if (filters.area) addA('r.geographic_area = ?', filters.area);
  if (cats.length) addA('i.category = ANY(?)', cats);
  const an = await db.query(
    `SELECT i.name AS indicator, r.geographic_area AS area, r.period, r.observed_value, r.expected_value, r.anomaly_score,
            r.severity, r.direction, r.method, a.status, a.analyst_note, r.is_synthetic
     FROM alerts a JOIN anomaly_results r ON r.id = a.anomaly_id JOIN indicators i ON i.id = r.indicator_id
     ${aw.length ? 'WHERE ' + aw.join(' AND ') : ''}
     ORDER BY CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.anomaly_score DESC`,
    av
  );
  const anomalies = params.include_anomalies === false ? [] : an.rows;

  // per-indicator trend (Python engine) for the most relevant indicators
  const focus = [...vol, ...inds.filter((i) => !vol.includes(i))].slice(0, 9);
  const indicatorFindings = await Promise.all(
    focus.map(async (i) => {
      const lc = D.latestChange(i.points);
      const base = { name: i.name, category: i.category, unit: i.unit, n_points: i.points.length,
        first_period: i.points[0].period, last_period: i.points[i.points.length - 1].period,
        first_value: i.points[0].value, latest_value: lc.latest, mom_pct: lc.mom, yoy_pct: lc.yoy,
        series: i.points.slice(-60) };
      try {
        const t = await runAnalytics('trend', { points: i.points, name: i.name, unit: i.unit });
        return { ...base, trend_direction: t.statistics.trend_direction, annualised_growth_pct: t.statistics.annualised_growth_pct,
          total_change_pct: t.statistics.total_change_pct, volatility_pct: t.statistics.volatility_pct, summary: t.summary };
      } catch {
        return { ...base, trend_direction: 'n/a', summary: 'Trend analysis could not be computed for this indicator.' };
      }
    })
  );

  const srcQ = await db.query(
    `SELECT DISTINCT ds.id AS dataset_id, ds.name AS dataset_name, ds.original_filename, ds.record_count, ds.is_synthetic,
            ds.processed_at, s.name AS source_name, s.organization, s.url
     FROM datasets ds LEFT JOIN data_sources s ON s.id = ds.data_source_id
     WHERE ds.id IN (SELECT DISTINCT e.dataset_id FROM effective_observations e WHERE e.indicator_id = ANY($1))
     ORDER BY ds.id`,
    [inds.map((i) => i.id)]
  );

  // summary of findings (all derived from the numbers above)
  const summary = [];
  summary.push(`${inds.length} indicator(s) across ${[...new Set(inds.map((i) => i.category))].join(', ')} were analysed for ${allPoints[0].slice(0, 7)} to ${allPoints[allPoints.length - 1].slice(0, 7)} (${filters.area || 'all areas'}).`);
  const totalVol = D.sumByPeriod(vol);
  if (totalVol.length) {
    const lc = D.latestChange(totalVol.map(([period, value]) => ({ period, value })));
    summary.push(`Total reported transaction volume in ${lc.period.slice(0, 7)} was ${Math.round(lc.latest).toLocaleString('en-US')}${lc.yoy !== null ? ` (${lc.yoy >= 0 ? '+' : ''}${lc.yoy.toFixed(1)}% year-on-year)` : ''}.`);
  }
  const up = indicatorFindings.filter((f) => f.trend_direction === 'increasing').length;
  const down = indicatorFindings.filter((f) => f.trend_direction === 'decreasing').length;
  summary.push(`Of the ${indicatorFindings.length} indicator(s) with a trend assessment, ${up} show an increasing and ${down} a decreasing trend.`);
  const hi = anomalies.filter((a) => a.severity === 'high').length;
  summary.push(anomalies.length
    ? `${anomalies.length} unusual-activity alert(s) fall in this scope (${hi} high severity). These require further investigation and are not evidence of misconduct.`
    : 'No unusual-activity alerts were recorded for this scope.');
  if (synthetic) summary.push(`NOTE: this report includes ${SYNTH}.`);

  const volPivot = D.pivot(vol, (i) => i.category);
  return {
    title: params.title,
    generated_at: new Date().toISOString(),
    generated_by: { name: user.full_name, role: user.role_label },
    period: { from: allPoints[0], to: allPoints[allPoints.length - 1] },
    requested_period: { from: filters.from || null, to: filters.to || null },
    area: filters.area || 'All areas (national)',
    categories: cats.length ? cats : [...new Set(inds.map((i) => i.category))],
    is_synthetic: synthetic,
    synthetic_notice: synthetic ? SYNTH : null,
    summary,
    statistics: {
      indicators: inds.length,
      total_volume: totalVol.reduce((s, [, v]) => s + v, 0) || null,
      total_value: D.sumByPeriod(val).reduce((s, [, v]) => s + v, 0) || null,
      alerts_total: anomalies.length,
      alerts_high: hi,
    },
    indicators: indicatorFindings,
    volume_chart: volPivot.rows.length ? volPivot : null,
    anomalies: anomalies.slice(0, 25),
    anomalies_truncated: anomalies.length > 25,
    sources: srcQ.rows,
    methodology: METHODOLOGY,
    limitations: LIMITATIONS,
  };
}

// ------------------------------------------------------------------ PDF
const clean = (t) => String(t ?? '')
  .replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/…/g, '...').replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•]/g, '?');
const fmt = (v, d = 1) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString('en-US', { maximumFractionDigits: a < 100 ? 2 : d });
};
const sgn = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
const COLORS = ['#1d4ed8', '#0f766e', '#b45309', '#7c3aed', '#be123c', '#475569'];
const NAVY = '#0f2a4a';

function renderPdf(content) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: clean(content.title), Author: 'AI Analytics Platform for Digital Economy Activity Monitoring' } });
  const W = doc.page.width - 96;
  const left = 48;
  const ensure = (h) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
  const h1 = (t) => { ensure(40); doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(clean(t), left, doc.y, { width: W }); doc.moveTo(left, doc.y + 2).lineTo(left + W, doc.y + 2).strokeColor('#cbd5e1').lineWidth(0.7).stroke(); doc.moveDown(0.5); };
  const p = (t, o = {}) => doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 9.5).fillColor(o.color || '#1e293b').text(clean(t), left, doc.y, { width: W, lineGap: 2 });
  const bullet = (t) => { ensure(20); doc.font('Helvetica').fontSize(9.5).fillColor('#1e293b').text(`•  ${clean(t)}`, left + 6, doc.y, { width: W - 6, lineGap: 2 }); doc.moveDown(0.25); };

  function table(head, rows, widths) {
    const total = widths.reduce((a, b) => a + b, 0);
    const w = widths.map((x) => (x / total) * W);
    const drawRow = (cells, header) => {
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(clean(c), { width: w[i] - 6 }))) + 6;
      ensure(h + 2);
      const y = doc.y;
      if (header) doc.rect(left, y, W, h).fill('#e2e8f0');
      let x = left;
      cells.forEach((c, i) => { doc.fillColor(header ? NAVY : '#1e293b').text(clean(c), x + 3, y + 3, { width: w[i] - 6 }); x += w[i]; });
      doc.moveTo(left, y + h).lineTo(left + W, y + h).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.y = y + h;
    };
    drawRow(head, true);
    rows.forEach((r) => drawRow(r, false));
    doc.moveDown(0.5);
  }

  function lineChart(title, rows, keys, unitLabel) {
    const H = 150;
    ensure(H + 50);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(clean(title), left, doc.y);
    const top = doc.y + 6;
    const x0 = left + 46, x1 = left + W - 8, y0 = top + H - 18, y1 = top + 4;
    const vals = rows.flatMap((r) => keys.map((k) => r[k]).filter((v) => typeof v === 'number'));
    if (!vals.length) { doc.y = top + H; return; }
    const lo = 0, hi = Math.max(...vals) * 1.08 || 1;
    const X = (i) => x0 + (rows.length === 1 ? 0 : (i / (rows.length - 1)) * (x1 - x0));
    const Y = (v) => y0 - ((v - lo) / (hi - lo)) * (y0 - y1);
    doc.lineWidth(0.4).strokeColor('#e2e8f0').fontSize(7).fillColor('#64748b');
    for (let g = 0; g <= 4; g++) {
      const v = lo + ((hi - lo) * g) / 4;
      doc.moveTo(x0, Y(v)).lineTo(x1, Y(v)).stroke();
      doc.text(fmt(v), left, Y(v) - 3, { width: 42, align: 'right' });
    }
    const step = Math.max(1, Math.floor(rows.length / 6));
    rows.forEach((r, i) => { if (i % step === 0) doc.text(r.period.slice(0, 7), X(i) - 16, y0 + 4, { width: 40, align: 'center' }); });
    keys.forEach((k, ki) => {
      doc.lineWidth(1.3).strokeColor(COLORS[ki % COLORS.length]);
      let started = false;
      rows.forEach((r, i) => { if (typeof r[k] !== 'number') return; started ? doc.lineTo(X(i), Y(r[k])) : doc.moveTo(X(i), Y(r[k])); started = true; });
      doc.stroke();
    });
    let lx = x0;
    keys.forEach((k, ki) => {
      doc.rect(lx, y0 + 15, 8, 4).fill(COLORS[ki % COLORS.length]);
      doc.font('Helvetica').fontSize(7).fillColor('#334155').text(clean(k), lx + 11, y0 + 13, { lineBreak: false });
      lx += 24 + doc.widthOfString(clean(k));
    });
    doc.y = top + H + 4;
    if (unitLabel) doc.font('Helvetica-Oblique').fontSize(7).fillColor('#64748b').text(clean(unitLabel), left, doc.y);
    doc.moveDown(0.4);
  }

  // --- title block
  doc.rect(0, 0, doc.page.width, 92).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#93c5fd').text('AI ANALYTICS PLATFORM FOR DIGITAL ECONOMY ACTIVITY MONITORING', left, 28, { width: W });
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff').text(clean(content.title), left, 44, { width: W });
  doc.y = 108;
  if (content.synthetic_notice) {
    doc.rect(left, doc.y, W, 22).fill('#fee2e2');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#991b1b').text(clean(content.synthetic_notice), left + 6, doc.y + 7, { width: W - 12 });
    doc.y += 30;
  }
  table(['Generated', 'Prepared by', 'Reporting period', 'Area', 'Categories'], [[
    new Date(content.generated_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    `${content.generated_by.name} (${content.generated_by.role})`,
    `${content.period.from.slice(0, 7)} to ${content.period.to.slice(0, 7)}`,
    content.area, content.categories.join(', '),
  ]], [2, 2.4, 2, 1.6, 3]);

  h1('1. Summary of findings');
  content.summary.forEach(bullet);

  h1('2. Key statistics');
  const st = content.statistics;
  table(['Measure', 'Value'], [
    ['Indicators analysed', st.indicators],
    ['Total reported transaction volume (selected period)', st.total_volume ? Math.round(st.total_volume).toLocaleString('en-US') : 'not available in selected data'],
    ['Total reported transaction value (selected period, units as reported)', st.total_value ? Math.round(st.total_value).toLocaleString('en-US') : 'not available in selected data'],
    ['Unusual-activity alerts in scope', `${st.alerts_total} (${st.alerts_high} high severity)`],
  ], [4, 3]);
  if (content.volume_chart) lineChart('Reported transaction volume by category', content.volume_chart.rows, content.volume_chart.keys, 'Transactions per period (sum across areas)');

  h1('3. Trend analysis');
  table(['Indicator', 'Latest', 'MoM', 'YoY', 'Growth p.a.', 'Trend'],
    content.indicators.map((i) => [i.name, `${fmt(i.latest_value)}${i.unit ? ' ' + i.unit : ''}`, sgn(i.mom_pct), sgn(i.yoy_pct), sgn(i.annualised_growth_pct), i.trend_direction]),
    [4, 2.4, 1, 1, 1.3, 2]);
  content.indicators.slice(0, 4).forEach((i) => {
    if (i.series && i.series.length > 2) lineChart(`${i.name}${i.unit ? ' (' + i.unit + ')' : ''}`, i.series.map((s) => ({ period: s.period, v: s.value })), ['v']);
    p(i.summary, { size: 8.5, color: '#475569' });
    doc.moveDown(0.4);
  });

  h1('4. Anomaly findings');
  p('Unusual activity detected below is a statistical pattern that requires further investigation. It is not evidence of fraud, misconduct or a regulatory violation.', { size: 9, color: '#92400e' });
  doc.moveDown(0.4);
  if (content.anomalies.length) {
    table(['Indicator', 'Area', 'Period', 'Observed', 'Expected', 'Score', 'Severity', 'Status'],
      content.anomalies.map((a) => [a.indicator, a.area, a.period.slice(0, 7), fmt(a.observed_value), fmt(a.expected_value), Number(a.anomaly_score).toFixed(1), a.severity, String(a.status).replace('_', ' ')]),
      [3.4, 2.2, 1.2, 1.4, 1.4, 0.9, 1.1, 1.3]);
    if (content.anomalies_truncated) p(`Showing the 25 highest-ranked alerts of ${st.alerts_total}.`, { size: 8, color: '#64748b' });
  } else p('No unusual-activity alerts were recorded for this scope.');

  h1('5. Data source references');
  table(['Dataset', 'Source', 'Records', 'Type'], content.sources.map((s) => [
    `${s.dataset_name} (${s.original_filename})`, [s.source_name, s.organization, s.url].filter(Boolean).join(' - ') || 'Manual upload', s.record_count, s.is_synthetic ? 'SYNTHETIC' : 'Imported']), [4, 4, 1, 1.4]);

  h1('6. Methodology');
  content.methodology.forEach(bullet);
  h1('7. Methodological limitations');
  content.limitations.forEach(bullet);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7).fillColor('#64748b');
    const foot = `${content.synthetic_notice ? content.synthetic_notice + '  |  ' : ''}Page ${i + 1} of ${range.count}`;
    doc.text(clean(foot), left, doc.page.height - 36, { width: W, align: 'center', lineBreak: false });
  }
  doc.end();
  return doc;
}

// ------------------------------------------------------------------ CSV
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function exportCsv(q) {
  const f = S.parseFilters(q);
  const vals = [];
  const where = ['i.is_active'];
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  if (f.from) add('e.period >= ?', f.from);
  if (f.to) add('e.period <= ?', f.to);
  if (f.area) add('e.geographic_area = ?', f.area);
  if (f.category) add('i.category = ?', f.category);
  if (f.source) add('e.data_source_id = ?', f.source);
  if (q.indicator_id && Number.isInteger(Number(q.indicator_id))) add('e.indicator_id = ?', Number(q.indicator_id));
  if (q.dataset_id && Number.isInteger(Number(q.dataset_id))) add('e.dataset_id = ?', Number(q.dataset_id));
  const { rows } = await db.query(
    `SELECT e.period, i.code, i.name, i.category, i.unit, e.geographic_area, e.value, e.pct_change, e.moving_avg,
            e.dataset_id, ds.name AS data_source, e.is_synthetic
     FROM effective_observations e JOIN indicators i ON i.id = e.indicator_id
     LEFT JOIN data_sources ds ON ds.id = e.data_source_id
     WHERE ${where.join(' AND ')} ORDER BY i.name, e.geographic_area, e.period LIMIT 200000`,
    vals
  );
  const head = ['period', 'indicator_code', 'indicator_name', 'category', 'unit', 'geographic_area', 'value', 'pct_change', 'moving_avg_3', 'dataset_id', 'data_source', 'data_label'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([r.period, r.code, r.name, r.category, r.unit, r.geographic_area, r.value, r.pct_change, r.moving_avg, r.dataset_id, r.data_source,
      r.is_synthetic ? SYNTH : 'imported data'].map(csvCell).join(','));
  }
  return { csv: '﻿' + lines.join('\r\n') + '\r\n', rows: rows.length, synthetic: rows.some((r) => r.is_synthetic) };
}

module.exports = { buildContent, renderPdf, exportCsv, SYNTH };
