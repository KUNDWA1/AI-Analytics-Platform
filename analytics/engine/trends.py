"""Module 3: descriptive trend analysis, indicator comparison, regional comparison + clustering."""
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.linear_model import LinearRegression

from .common import (AnalyticsError, FREQ_LABEL, PERIODS_PER_YEAR, SEASONAL_PERIOD, prepare_series)

SLOPE_THRESHOLD = {"D": 0.05, "W": 0.1, "M": 0.25, "Q": 0.5, "Y": 1.0}  # % per period
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _linear_fit(values):
    """Linear fit on log(value) when strictly positive (compound growth), else on raw values."""
    t = np.arange(len(values)).reshape(-1, 1)
    y = np.asarray(values, dtype=float)
    use_log = bool(np.all(y > 0))
    target = np.log(y) if use_log else y
    lr = LinearRegression().fit(t, target)
    fitted = lr.predict(t)
    ss_res = float(np.sum((target - fitted) ** 2))
    ss_tot = float(np.sum((target - target.mean()) ** 2))
    r2 = 0.0 if ss_tot < 1e-12 else 1 - ss_res / ss_tot
    slope = float(lr.coef_[0])
    slope_pct = (np.exp(slope) - 1) * 100 if use_log else (slope / abs(y.mean()) * 100 if abs(y.mean()) > 1e-12 else 0.0)
    trend_line = np.exp(fitted) if use_log else fitted
    return slope_pct, r2, trend_line, use_log


def trend_analysis(payload):
    prep = prepare_series(payload["points"])
    s, freq = prep["filled"], prep["freq"]
    n = len(s)
    if n < 3:
        raise AnalyticsError("At least 3 observations are required for trend analysis.")

    ppy = PERIODS_PER_YEAR.get(freq, 1)
    pct = s.pct_change() * 100
    ma3 = s.rolling(3, min_periods=3).mean()
    ma12 = s.rolling(12, min_periods=12).mean() if n >= 12 and freq in ("M", "D", "W") else pd.Series(np.nan, index=s.index)
    yoy = s.pct_change(ppy) * 100 if freq in ("M", "Q") and n > ppy else pd.Series(np.nan, index=s.index)

    slope_pct, r2, trend_line, use_log = _linear_fit(s.values)
    thr = SLOPE_THRESHOLD.get(freq, 0.25)
    if r2 >= 0.3 and slope_pct > thr:
        direction = "increasing"
    elif r2 >= 0.3 and slope_pct < -thr:
        direction = "decreasing"
    else:
        direction = "stable / no clear trend"

    first, last = float(s.iloc[0]), float(s.iloc[-1])
    total_change = (last - first) / abs(first) * 100 if abs(first) > 1e-12 else None
    cagr = None
    if first > 0 and last > 0 and n > 1:
        g = (last / first) ** (1 / (n - 1)) - 1
        cagr = ((1 + g) ** ppy - 1) * 100
    pct_valid = pct.replace([np.inf, -np.inf], np.nan).dropna()
    volatility = float(pct_valid.std()) if len(pct_valid) > 2 else None

    seasonality = None
    if freq == "M" and n >= 24:
        detr = s.values / trend_line if use_log else s.values - trend_line
        by_month = pd.Series(detr, index=s.index.month).groupby(level=0).mean()
        spread = float(by_month.max() - by_month.min())
        seasonality = {"peak_month": MONTHS[int(by_month.idxmax()) - 1], "low_month": MONTHS[int(by_month.idxmin()) - 1],
                       "relative_amplitude_pct": round(spread / abs(by_month.mean()) * 100 if use_log else spread / abs(np.mean(s.values)) * 100, 2)}

    points = []
    for i, ts in enumerate(s.index):
        points.append({
            "period": ts, "value": float(s.iloc[i]),
            "interpolated": bool(prep["missing_mask"].iloc[i]),
            "pct_change": pct.iloc[i], "moving_avg_3": ma3.iloc[i], "moving_avg_12": ma12.iloc[i],
            "yoy_pct": yoy.iloc[i], "trend_line": float(trend_line[i]),
        })

    unit_txt = payload.get("unit") or ""
    name = payload.get("name") or "The indicator"
    parts = [f"{name} shows a {direction} pattern over {n} {FREQ_LABEL.get(freq, '')} observations "
             f"({s.index[0]:%b %Y} – {s.index[-1]:%b %Y})."]
    if total_change is not None:
        parts.append(f"The latest value is {total_change:+.1f}% versus the first observation.")
    if cagr is not None:
        parts.append(f"The compound growth rate is about {cagr:+.1f}% per year.")
    if seasonality:
        parts.append(f"Activity tends to peak in {seasonality['peak_month']} and dip in {seasonality['low_month']}.")
    parts.append("This is a descriptive statistical summary, not a causal explanation.")

    return {
        "frequency": freq, "frequency_label": FREQ_LABEL.get(freq, "irregular"),
        "n_observations": int(len(prep["observed"])), "n_interpolated": prep["n_missing"],
        "unit": unit_txt, "points": points,
        "statistics": {
            "first_value": first, "latest_value": last, "total_change_pct": total_change,
            "annualised_growth_pct": cagr, "avg_period_growth_pct": slope_pct,
            "latest_period_change_pct": None if np.isnan(pct.iloc[-1]) else float(pct.iloc[-1]),
            "latest_yoy_pct": None if np.isnan(yoy.iloc[-1]) else float(yoy.iloc[-1]),
            "volatility_pct": volatility, "mean": float(s.mean()), "min": float(s.min()), "max": float(s.max()),
            "trend_direction": direction, "trend_r2": r2,
        },
        "seasonality": seasonality,
        "summary": " ".join(parts),
        "method": "Descriptive analytics: period-over-period change, 3/12-period moving averages, "
                  + ("log-linear" if use_log else "linear") + " least-squares trend (scikit-learn).",
    }


def compare(payload):
    """Compare several indicators: index each to 100 at the first common period + growth + correlation."""
    series = payload["series"]
    if len(series) < 2:
        raise AnalyticsError("Select at least two indicators to compare.")
    frames = {}
    for sr in series:
        ps = prepare_series(sr["points"])["observed"]
        frames[sr["label"]] = ps
    df = pd.DataFrame(frames).sort_index()
    common = df.dropna()
    if len(common) < 3:
        raise AnalyticsError("The selected indicators do not share at least 3 common reporting periods.")
    base = common.iloc[0]
    indexed = common / base * 100
    growth = {c: float((common[c].iloc[-1] / common[c].iloc[0] - 1) * 100) if abs(common[c].iloc[0]) > 1e-12 else None for c in common}
    chg = common.pct_change().dropna()
    corr = chg.corr().round(3) if len(chg) >= 4 else None
    return {
        "base_period": common.index[0],
        "periods": [ts for ts in common.index],
        "indexed": {c: [float(v) for v in indexed[c].values] for c in indexed},
        "raw": {c: [float(v) for v in common[c].values] for c in common},
        "growth_pct": growth,
        "correlation_of_changes": None if corr is None else {c: {k: float(v) for k, v in corr[c].items()} for c in corr},
        "note": "Indexed series (first common period = 100) allow comparison across different units. "
                "Correlation measures co-movement of period-over-period changes and does not imply causation.",
    }


def regional_comparison(payload):
    """payload: {'areas': {area: points}} for ONE indicator. Returns latest values, growth, share
    and a K-Means activity clustering of areas (level, growth, volatility)."""
    rows = []
    for area, pts in payload["areas"].items():
        prep = prepare_series(pts)
        s = prep["filled"]
        if len(s) < 3:
            continue
        ppy = PERIODS_PER_YEAR.get(prep["freq"], 1)
        lookback = min(ppy, len(s) - 1)
        growth = (s.iloc[-1] / s.iloc[-1 - lookback] - 1) * 100 if abs(s.iloc[-1 - lookback]) > 1e-12 else np.nan
        pct = s.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
        rows.append({"area": area, "latest_period": s.index[-1], "latest_value": float(s.iloc[-1]),
                     "growth_pct": float(growth) if not np.isnan(growth) else None,
                     "volatility_pct": float(pct.std() * 100) if len(pct) > 2 else 0.0,
                     "mean": float(s.mean())})
    if not rows:
        raise AnalyticsError("No area has enough observations for comparison.")
    df = pd.DataFrame(rows)
    total = df["latest_value"].sum()
    df["share_pct"] = df["latest_value"] / total * 100 if abs(total) > 1e-12 else np.nan
    df["rank"] = df["latest_value"].rank(ascending=False).astype(int)

    clustering = None
    if len(df) >= 4:
        feats = pd.DataFrame({
            "level": np.log1p(df["latest_value"].clip(lower=0)),
            "growth": df["growth_pct"].fillna(0),
            "vol": df["volatility_pct"],
        })
        z = (feats - feats.mean()) / feats.std(ddof=0).replace(0, 1)
        k = 3 if len(df) >= 6 else 2
        km = KMeans(n_clusters=k, n_init=10, random_state=42).fit(z.values)
        df["cluster"] = km.labels_
        order = df.groupby("cluster")["latest_value"].mean().sort_values(ascending=False).index.tolist()
        names = {2: ["Higher-activity group", "Lower-activity group"],
                 3: ["Higher-activity group", "Mid-activity group", "Lower-activity group"]}[k]
        label = {c: names[i] for i, c in enumerate(order)}
        df["cluster_label"] = df["cluster"].map(label)
        clustering = {"method": f"K-Means (k={k}) on standardised log-level, growth and volatility",
                      "note": "Clusters describe similarity of activity patterns only; they carry no judgement about compliance or risk."}
    return {"areas": df.sort_values("rank").astype(object).where(df.notna(), None).to_dict(orient="records"),
            "clustering": clustering}
