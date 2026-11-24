"""Module 4: explainable anomaly detection.

Methods
  1. Robust z-score on residuals of a trend(+seasonal) baseline (iteratively re-fitted without outliers).
  2. Isolation Forest on [residual z, change z] — only reported when corroborated (|level z| and |change z| both >= 2.5),
     to limit false alarms because no labelled anomalies exist.
  3. Peer comparison: robust cross-sectional z-score of an area's period-over-period change versus other areas.

An anomaly is an unusual statistical pattern, NOT evidence of fraud, misconduct or a regulatory breach.
There are no ground-truth labels, so no accuracy/precision claim can be made on real data.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import Ridge

from .common import SEASONAL_PERIOD, prepare_series, robust_z

MIN_POINTS = 12
PEER_MIN_SCALE = 0.03  # 3% log-change floor for the cross-area peer comparison
DISCLAIMER = ("Unusual activity detected — requires further investigation. "
              "This is a statistical pattern and is not evidence of fraud, misconduct or a regulatory violation.")


def severity_for(score, thr):
    if score >= thr + 3:
        return "high"
    if score >= thr + 1:
        return "medium"
    return "low"


def _design(idx, m, seasonal):
    t = np.asarray(idx, dtype=float).reshape(-1, 1)
    if not seasonal:
        return t
    d = np.zeros((len(idx), m - 1))
    for r, i in enumerate(idx):
        k = int(i) % m
        if k:
            d[r, k - 1] = 1
    return np.hstack([t, d])


def baseline(values, m):
    """Robust baseline. Returns (expected, residual, used_log, seasonal)."""
    y = np.asarray(values, dtype=float)
    n = len(y)
    use_log = bool(np.all(y > 0))
    target = np.log(y) if use_log else y
    seasonal = m > 1 and n >= 2 * m
    X = _design(range(n), m, seasonal)
    mask = np.ones(n, dtype=bool)
    for _ in range(3):
        mdl = Ridge(alpha=1e-6).fit(X[mask], target[mask])
        fitted = mdl.predict(X)
        res = target - fitted
        z = robust_z(res[mask])
        full = (res - np.median(res[mask])) / max(1.4826 * np.median(np.abs(res[mask] - np.median(res[mask]))), 1e-9)
        new_mask = np.abs(full) < 3.0
        if new_mask.sum() < max(8, n // 2) or (new_mask == mask).all():
            break
        mask = new_mask
    expected = np.exp(fitted) if use_log else fitted
    return expected, res, use_log, seasonal, mask


def _fmt(v):
    a = abs(v)
    if a >= 1e9:
        return f"{v/1e9:,.2f}B"
    if a >= 1e6:
        return f"{v/1e6:,.2f}M"
    if a >= 1e3:
        return f"{v:,.0f}"
    return f"{v:,.2f}"


def _explain(item, ts, observed, expected, score, methods, unit, thr):
    pct = (observed - expected) / abs(expected) * 100 if expected and abs(expected) > 1e-12 else None
    word = "above" if observed > expected else "below"
    txt = (f"Unusual activity detected: {item['indicator_name']} ({item['area']}) in {ts:%b %Y} was {_fmt(observed)}"
           f"{' ' + unit if unit and unit != '%' else ('%' if unit == '%' else '')}, "
           f"{abs(pct):.1f}% {word} the expected baseline of {_fmt(expected)}. " if pct is not None else
           f"Unusual activity detected: {item['indicator_name']} ({item['area']}) in {ts:%b %Y} was {_fmt(observed)}. ")
    txt += f"Anomaly score {score:.2f} (threshold {thr:g}); detected by {', '.join(methods)}. "
    txt += "Requires further investigation — this is a statistical pattern, not evidence of fraud, misconduct or a regulatory violation."
    return txt


def detect(payload):
    thr = float(payload.get("threshold", 3.0))
    method = payload.get("method", "both")
    series = payload["series"]
    found = {}   # (indicator_id, area, period) -> record
    summary = []

    for item in series:
        prep = prepare_series(item["points"])
        s, freq = prep["filled"], prep["freq"]
        label = {"indicator_id": item["indicator_id"], "area": item["area"], "indicator": item["indicator_name"]}
        if freq is None or len(s) < MIN_POINTS:
            summary.append({**label, "n": len(s), "status": "skipped",
                            "reason": f"Needs at least {MIN_POINTS} regularly spaced observations."})
            continue
        m = SEASONAL_PERIOD[freq]
        expected, res, used_log, seasonal, fitmask = baseline(s.values, m)
        # robust z on residuals, scaled by non-outlying points
        ref = res[fitmask]
        scale = max(1.4826 * np.median(np.abs(ref - np.median(ref))), 1e-9)
        scale = max(scale, np.std(ref) * 0.25, 1e-6)
        z = (res - np.median(ref)) / scale

        pct_log = np.diff(np.log(s.values)) if used_log else np.diff(s.values)
        pct_log = np.concatenate([[0.0], pct_log])
        zc = robust_z(pct_log)

        z_flag = np.abs(z) >= thr
        if_flag = np.zeros(len(s), dtype=bool)
        if method in ("both", "isolation_forest"):
            feats = np.column_stack([z, zc])
            iso = IsolationForest(n_estimators=200, contamination="auto", random_state=42).fit(feats)
            # Corroboration: both the level residual AND the period-over-period change must look unusual.
            if_flag = (iso.predict(feats) == -1) & (np.abs(z) >= 2.5) & (np.abs(zc) >= 2.5)

        use_z = method in ("both", "zscore")
        n_flag = 0
        for i, ts in enumerate(s.index):
            if prep["missing_mask"].iloc[i]:
                continue  # never flag interpolated points
            methods = []
            if use_z and z_flag[i]:
                methods.append("Robust z-score")
            if if_flag[i]:
                methods.append("Isolation Forest")
            if not methods:
                continue
            score = float(abs(z[i]))
            key = (item["indicator_id"], item["area"], ts.strftime("%Y-%m-%d"))
            found[key] = {
                "indicator_id": item["indicator_id"], "area": item["area"], "period": ts.strftime("%Y-%m-%d"),
                "observed": float(s.iloc[i]), "expected": float(expected[i]), "score": score, "methods": methods,
                "direction": "increase" if s.iloc[i] > expected[i] else "decrease",
                "item": item, "ts": ts, "unit": item.get("unit"),
            }
            n_flag += 1
        summary.append({**label, "n": len(s), "status": "analysed", "flagged": n_flag,
                        "baseline": ("log-linear" if used_log else "linear") + " trend" + (" + seasonality" if seasonal else ""),
                        "residual_scale": float(scale)})

    # ---- peer comparison across areas of the same indicator
    if method in ("both", "zscore", "isolation_forest") and payload.get("peer_comparison", True):
        by_ind = {}
        for item in series:
            if item.get("is_aggregate"):
                continue
            by_ind.setdefault(item["indicator_id"], []).append(item)
        for ind_id, items in by_ind.items():
            if len(items) < 4:
                continue
            frame = {}
            for it in items:
                ps = prepare_series(it["points"])["filled"]
                if (ps > 0).all() and len(ps) >= MIN_POINTS:
                    frame[it["area"]] = np.log(ps).diff()
            if len(frame) < 4:
                continue
            df = pd.DataFrame(frame).dropna(how="all")
            lookup = {it["area"]: it for it in items}
            for ts, row in df.iterrows():
                vals = row.dropna()
                if len(vals) < 4:
                    continue
                med = float(np.median(vals.values))
                # Scale floor: peers must differ by a meaningful margin (>= PEER_MIN_SCALE in log-change),
                # otherwise tiny differences between very stable areas would produce huge z-scores.
                scale = max(1.4826 * float(np.median(np.abs(vals.values - med))), PEER_MIN_SCALE)
                zz = (vals.values - med) / scale
                for (area, lv), zv in zip(vals.items(), zz):
                    if abs(zv) < max(thr, 3.5):
                        continue
                    it = lookup[area]
                    prep = prepare_series(it["points"])
                    if prep["missing_mask"].get(ts, False):
                        continue
                    sr = prep["filled"]
                    pos = sr.index.get_loc(ts)
                    if pos == 0:
                        continue
                    # Suppress the "rebound" month that follows an already flagged point in the same series.
                    prev_key = (ind_id, area, sr.index[pos - 1].strftime("%Y-%m-%d"))
                    if prev_key in found:
                        continue
                    observed = float(sr.iloc[pos])
                    exp = float(sr.iloc[pos - 1] * np.exp(med))
                    key = (ind_id, area, ts.strftime("%Y-%m-%d"))
                    rec = found.get(key)
                    if rec:
                        if "Peer comparison" not in rec["methods"]:
                            rec["methods"].append("Peer comparison")
                        rec["score"] = max(rec["score"], float(abs(zv)))
                    else:
                        found[key] = {"indicator_id": ind_id, "area": area, "period": ts.strftime("%Y-%m-%d"),
                                      "observed": observed, "expected": exp, "score": float(abs(zv)),
                                      "methods": ["Peer comparison"],
                                      "direction": "increase" if observed > exp else "decrease",
                                      "item": it, "ts": ts, "unit": it.get("unit")}

    out = []
    for rec in found.values():
        sev = severity_for(rec["score"], thr)
        out.append({
            "indicator_id": rec["indicator_id"], "area": rec["area"], "period": rec["period"],
            "observed_value": rec["observed"], "expected_value": rec["expected"],
            "anomaly_score": round(rec["score"], 4), "severity": sev, "direction": rec["direction"],
            "method": " + ".join(rec["methods"]),
            "explanation": _explain(rec["item"], rec["ts"], rec["observed"], rec["expected"], rec["score"],
                                    rec["methods"], rec["unit"], thr),
        })
    out.sort(key=lambda r: (-r["anomaly_score"]))
    return {
        "anomalies": out,
        "series_summary": summary,
        "parameters": {"method": method, "threshold": thr, "min_points": MIN_POINTS,
                       "severity_bands": {"low": f"{thr:g} ≤ score < {thr + 1:g}", "medium": f"{thr + 1:g} ≤ score < {thr + 3:g}",
                                          "high": f"score ≥ {thr + 3:g}"}},
        "evaluation_note": "No labelled anomalies exist for real data, so detection accuracy (precision/recall) cannot be "
                           "claimed. Results are unsupervised and explainable; each flag lists its baseline and score. "
                           "On synthetic data with injected anomalies, recall is checked in the automated tests.",
        "disclaimer": DISCLAIMER,
    }
