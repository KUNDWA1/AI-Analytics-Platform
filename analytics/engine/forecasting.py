"""Module 3: forecasting with rolling-origin backtesting and automatic model selection.

Candidate models (all fitted on the real observations, no random values):
  naive, seasonal_naive, linear, linear_seasonal, loglinear, loglinear_seasonal, holt
The model with the lowest backtest RMSE is refitted on the full history and used to forecast.
"""
import numpy as np
from sklearn.linear_model import Ridge

from .common import AnalyticsError, FREQ_LABEL, SEASONAL_PERIOD, add_periods, prepare_series

MIN_OBS = {"D": 60, "W": 52, "M": 18, "Q": 10, "Y": 8}

DESCRIPTIONS = {
    "naive": "Naive: repeats the last observed value (benchmark).",
    "seasonal_naive": "Seasonal naive: repeats the value from the same season in the last cycle.",
    "linear": "Linear regression on a time index (scikit-learn).",
    "linear_seasonal": "Linear trend + seasonal dummy variables (Ridge regression).",
    "loglinear": "Log-linear (exponential growth) trend regression.",
    "loglinear_seasonal": "Log-linear trend with multiplicative seasonality (Ridge on log values).",
    "holt": "Holt's additive exponential smoothing with grid-searched smoothing parameters.",
}


def _design(n_train, idx, m, seasonal):
    t = np.asarray(idx, dtype=float).reshape(-1, 1)
    if not seasonal:
        return t
    dummies = np.zeros((len(idx), m - 1))
    for r, i in enumerate(idx):
        k = int(i) % m
        if k > 0:
            dummies[r, k - 1] = 1.0
    return np.hstack([t, dummies])


def _fit_predict(name, y, h, m):
    """Fit `name` on y and return predictions for the next h steps."""
    n = len(y)
    if name == "naive":
        return np.repeat(y[-1], h)
    if name == "seasonal_naive":
        return np.array([y[n - m + (i % m)] for i in range(h)])
    if name == "holt":
        best = None
        for a in (0.2, 0.4, 0.6, 0.8):
            for b in (0.05, 0.1, 0.2, 0.4):
                lvl, tr, sse = y[0], y[1] - y[0], 0.0
                for v in y[1:]:
                    pred = lvl + tr
                    sse += (v - pred) ** 2
                    new_l = a * v + (1 - a) * (lvl + tr)
                    tr = b * (new_l - lvl) + (1 - b) * tr
                    lvl = new_l
                if best is None or sse < best[0]:
                    best = (sse, lvl, tr)
        _, lvl, tr = best
        return np.array([lvl + (i + 1) * tr for i in range(h)])
    seasonal = name.endswith("_seasonal")
    use_log = name.startswith("loglinear")
    target = np.log(y) if use_log else y
    X = _design(n, range(n), m, seasonal)
    Xf = _design(n, range(n, n + h), m, seasonal)
    model = Ridge(alpha=1e-6).fit(X, target)
    pred = model.predict(Xf)
    return np.exp(pred) if use_log else pred


def _applicable(name, y, m):
    n = len(y)
    if name in ("seasonal_naive", "linear_seasonal", "loglinear_seasonal"):
        return m > 1 and n >= 2 * m
    if name == "loglinear" or name == "loglinear_seasonal":
        return bool(np.all(y > 0))
    return n >= 4


def _metrics(actual, pred):
    err = actual - pred
    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err ** 2)))
    nz = np.abs(actual) > 1e-12
    mape = float(np.mean(np.abs(err[nz] / actual[nz])) * 100) if nz.any() else None
    return mae, rmse, mape


def forecast(payload):
    horizon = int(payload.get("horizon", 6))
    if not 1 <= horizon <= 36:
        raise AnalyticsError("Forecast horizon must be between 1 and 36 periods.")
    prep = prepare_series(payload["points"])
    s, freq = prep["filled"], prep["freq"]
    n = len(s)
    base = {"frequency": freq, "frequency_label": FREQ_LABEL.get(freq, "irregular"), "n_observations": n,
            "history": [{"period": ts, "value": float(v)} for ts, v in s.items()]}

    if freq is None:
        return {**base, "status": "insufficient",
                "reason": "Reporting periods are irregularly spaced, so a time-series forecast cannot be fitted reliably. "
                          "Descriptive trend analysis is shown instead."}
    if n < MIN_OBS[freq]:
        return {**base, "status": "insufficient",
                "reason": f"Only {n} {FREQ_LABEL[freq]} observations are available; at least {MIN_OBS[freq]} are needed for a "
                          f"reliable forecast. Descriptive trend analysis is shown instead."}

    y = s.values.astype(float)
    m = SEASONAL_PERIOD[freq]
    test = int(max(3, min(12, n // 5)))
    step = max(1, test // 2)
    min_train = 8
    origins = [n - test - k * step for k in range(3) if n - test - k * step >= min_train]
    if not origins:
        return {**base, "status": "insufficient", "reason": "Not enough history to run a backtest."}

    results = []
    for name in DESCRIPTIONS:
        if not _applicable(name, y, m):
            continue
        errs, ok = [], True
        for o in origins:
            train = y[:o]
            if not _applicable(name, train, m):
                ok = False
                break
            try:
                pred = _fit_predict(name, train, test, m)
            except Exception:
                ok = False
                break
            errs.append((y[o:o + test], pred))
        if not ok:
            continue
        actual = np.concatenate([a for a, _ in errs])
        pred = np.concatenate([p for _, p in errs])
        mae, rmse, mape = _metrics(actual, pred)
        results.append({"model": name, "description": DESCRIPTIONS[name], "mae": mae, "rmse": rmse, "mape_pct": mape})
    if not results:
        return {**base, "status": "insufficient", "reason": "No candidate model could be evaluated on this series."}

    results.sort(key=lambda r: r["rmse"])
    best = results[0]
    naive = next((r for r in results if r["model"] == "naive"), None)
    beats_naive = None if naive is None else best["rmse"] < naive["rmse"] or best["model"] == "naive"

    pred = _fit_predict(best["model"], y, horizon, m)
    nonneg = bool(np.all(y >= 0))
    # Approximate prediction intervals from pooled backtest RMSE, widened with the horizon.
    mean_h = (test + 1) / 2
    sig = np.array([best["rmse"] * np.sqrt((h + 1) / mean_h) for h in range(horizon)])
    lo80, hi80 = pred - 1.2816 * sig, pred + 1.2816 * sig
    lo95, hi95 = pred - 1.96 * sig, pred + 1.96 * sig
    if nonneg:
        lo80, lo95 = np.maximum(lo80, 0), np.maximum(lo95, 0)
    dates = add_periods(s.index[-1], horizon, freq)
    fc = [{"period": d, "value": float(pred[i]), "lower_80": float(lo80[i]), "upper_80": float(hi80[i]),
           "lower_95": float(lo95[i]), "upper_95": float(hi95[i])} for i, d in enumerate(dates)]

    limitations = [
        "The forecast extrapolates historical patterns; it cannot anticipate policy changes, shocks or structural breaks.",
        f"Accuracy was estimated with rolling-origin backtesting ({len(origins)} origin(s), {test} periods ahead each) "
        "on the same history, which is a small sample for judging future accuracy.",
        "Prediction intervals are approximate: they are derived from pooled backtest errors, not from a fully specified probabilistic model.",
    ]
    if n < 2 * m and m > 1:
        limitations.append("Fewer than two full seasonal cycles are available, so seasonal models were not considered.")
    if prep["n_missing"]:
        limitations.append(f"{prep['n_missing']} missing period(s) were linearly interpolated before fitting.")
    if beats_naive is False:
        limitations.append("The selected model did not outperform the naive benchmark; treat the forecast with caution.")

    return {**base, "status": "ok", "horizon": horizon, "method": best["model"], "method_description": best["description"],
            "forecast": fc, "evaluation": {
                "selection_metric": "RMSE (rolling-origin backtest)", "backtest_origins": len(origins), "backtest_horizon": test,
                "selected": best, "candidates": results, "beats_naive_benchmark": beats_naive},
            "training": {"input_feature": "time index" + (" + seasonal dummies" if best["model"].endswith("seasonal") else ""),
                         "training_window": [s.index[0], s.index[-1]], "n_training_points": n},
            "limitations": limitations}
