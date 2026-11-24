"""Shared helpers: time-series preparation, frequency inference, JSON sanitising."""
import math
import numpy as np
import pandas as pd

OFFSET = {"D": "D", "W": "7D", "M": "MS", "Q": "QS", "Y": "YS"}
SEASONAL_PERIOD = {"D": 7, "W": 52, "M": 12, "Q": 4, "Y": 1}
PERIODS_PER_YEAR = {"D": 365, "W": 52, "M": 12, "Q": 4, "Y": 1}
FREQ_LABEL = {"D": "daily", "W": "weekly", "M": "monthly", "Q": "quarterly", "Y": "annual"}


class AnalyticsError(ValueError):
    """Raised for user-facing problems (bad input, insufficient data)."""


def infer_freq(index):
    """Infer regular frequency from a DatetimeIndex. Returns 'D','W','M','Q','Y' or None."""
    idx = pd.DatetimeIndex(sorted(set(index)))
    if len(idx) < 3:
        return None
    gaps = np.diff(idx.values).astype("timedelta64[D]").astype(int)
    med = float(np.median(gaps))
    if med <= 1.5:
        return "D"
    if 6 <= med <= 8:
        return "W"
    if 27 <= med <= 32:
        return "M"
    if 85 <= med <= 95:
        return "Q"
    if 355 <= med <= 375:
        return "Y"
    return None


def snap_to_period_start(ts, freq):
    ts = pd.Series(ts)
    if freq == "M":
        return ts.dt.to_period("M").dt.start_time
    if freq == "Q":
        return ts.dt.to_period("Q").dt.start_time
    if freq == "Y":
        return ts.dt.to_period("Y").dt.start_time
    return ts.dt.normalize()


def prepare_series(points):
    """points: [{'period': 'YYYY-MM-DD', 'value': number}, ...]
    Returns dict(observed, filled, freq, n_missing, missing_mask)."""
    if not points:
        raise AnalyticsError("No observations supplied.")
    s = pd.Series({pd.Timestamp(p["period"]): float(p["value"]) for p in points}).sort_index()
    freq = infer_freq(s.index)
    if freq is None:
        return {"observed": s, "filled": s.copy(), "freq": None, "n_missing": 0,
                "missing_mask": pd.Series(False, index=s.index)}
    full = pd.date_range(s.index[0], s.index[-1], freq=OFFSET[freq])
    re = s.reindex(full)
    mask = re.isna()
    filled = re.interpolate(limit_area="inside")
    return {"observed": s, "filled": filled, "freq": freq, "n_missing": int(mask.sum()), "missing_mask": mask}


def add_periods(last, n, freq):
    off = {"D": pd.DateOffset(days=1), "W": pd.DateOffset(weeks=1), "M": pd.DateOffset(months=1),
           "Q": pd.DateOffset(months=3), "Y": pd.DateOffset(years=1)}[freq]
    return [last + off * (i + 1) for i in range(n)]


def sanitize(obj):
    """Make an object JSON-safe: numpy -> python, NaN/inf -> None, Timestamps -> ISO dates."""
    if isinstance(obj, dict):
        return {str(k): sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (pd.Timestamp,)):
        return obj.strftime("%Y-%m-%d")
    if isinstance(obj, np.ndarray):
        return sanitize(obj.tolist())
    if obj is pd.NaT:
        return None
    return obj


def robust_z(x):
    """Robust z-score using median and MAD (scaled to be comparable with a std-dev)."""
    x = np.asarray(x, dtype=float)
    med = np.nanmedian(x)
    mad = np.nanmedian(np.abs(x - med))
    scale = 1.4826 * mad
    if scale < 1e-9:  # degenerate: fall back to std
        scale = np.nanstd(x)
    if scale < 1e-9:
        return np.zeros_like(x)
    return (x - med) / scale
