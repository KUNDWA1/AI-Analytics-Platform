"""Automated tests for the analytics engine: preprocessing, trends, forecasting, anomaly detection, evaluation.
Run from the analytics folder:   python -m pytest tests -v
"""
import hashlib
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine.anomalies import detect  # noqa: E402
from engine.forecasting import forecast  # noqa: E402
from engine.processing import inspect, process  # noqa: E402
from engine.trends import compare, regional_comparison, trend_analysis  # noqa: E402

SAMPLES = os.path.join(os.path.dirname(__file__), "..", "..", "sample-data")
MAIN = os.path.join(SAMPLES, "digital_financial_activity_synthetic.csv")
MONTHS = pd.date_range("2020-01-01", periods=60, freq="MS")
SEAS = np.array([-0.04, -0.03, 0, 0, 0.01, 0, 0.01, 0.02, 0, 0.01, 0.03, 0.08])


def points(values, months=MONTHS):
    return [{"period": d.strftime("%Y-%m-%d"), "value": float(v)} for d, v in zip(months, values)]


def synth(rng, noise=0.03, growth=0.012, base=1e6):
    return base * np.exp(growth * np.arange(60)) * (1 + SEAS[MONTHS.month - 1]) * np.exp(rng.normal(0, noise, 60))


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


# ------------------------------------------------------------------ preprocessing
def test_inspect_detects_columns_and_suggests_mapping():
    r = inspect({"path": MAIN, "filename": "x.csv"})
    assert r["record_count"] == 900 and r["is_valid"]
    assert r["suggested_mapping"]["period"] == "reporting_period"
    assert set(r["suggested_mapping"]["values"]) == {"transaction_volume", "transaction_value", "active_accounts"}
    assert r["synthetic_hint"] is True


def test_process_clean_file_counts_and_source_traceability():
    before = sha(MAIN)
    m = inspect({"path": MAIN, "filename": "x.csv"})["suggested_mapping"]
    out = process({"path": MAIN, "filename": "x.csv", "mapping": m})
    s = out["summary"]
    assert s["original_records"] == 900 and s["valid_records"] == 900 and s["invalid_records"] == 0
    assert s["observations_created"] == 2700 and s["frequency"] == "M"
    assert all("source_row" in r and r["source_row"] >= 2 for r in out["records"][:50])
    assert sha(MAIN) == before, "original uploaded file must never be modified"
    # first observation of a series has no pct_change; moving average needs a full window
    first = [r for r in out["records"] if r["period"] == "2020-01-01"][0]
    assert first["pct_change"] is None and first["moving_avg"] is None


@pytest.fixture
def messy(tmp_path):
    p = tmp_path / "messy.csv"
    p.write_text(
        "Month,Province,Measure,Amount\n"
        "Jan-2023,East,Mobile banking volume,\"1,200.50\"\n"      # thousands separator + alias + month name
        "Feb-2023,East,Mobile banking volume,1300\n"
        "Mar-2023,East,Mobile banking volume,\n"                  # missing value
        "Apr-2023,East,Mobile banking volume,abc\n"               # non-numeric
        "May-2023,East,Mobile banking volume,-5\n"                # negative
        "Smarch 2023,East,Mobile banking volume,10\n"             # invalid date
        "Feb-2023,East,Mobile banking volume,1300\n"              # exact duplicate
        "Jan-2023,East,Mobile banking volume,999\n"               # conflicting duplicate
        "Jun-2023,Kigali,Mobile banking volume,2000\n",
        encoding="utf-8",
    )
    return str(p)


def test_process_reports_every_data_quality_problem(messy):
    # a column this messy is not auto-detected as numeric, so the user confirms the mapping (as the UI requires)
    mapping = {"period": "Month", "area": "Province", "indicator": "Measure", "values": ["Amount"], "category": None, "unit": None}
    out = process({"path": messy, "filename": "messy.csv", "mapping": mapping})
    s = out["summary"]
    assert s["original_records"] == 9
    assert s["missing_values"] >= 1
    assert s["invalid_records"] >= 3          # non-numeric + negative + bad date (+ missing)
    assert s["duplicate_records"] == 1        # one exact duplicate row
    assert s["duplicate_keys_removed"] == 2   # exact + conflicting duplicate key: first occurrence kept
    assert s["observations_created"] == s["valid_records"] - s["duplicate_keys_removed"]
    # negative values are kept but explicitly flagged for review (some indicators can legitimately be negative)
    assert any("negative" in w.lower() for w in s["warnings"])
    vals = {(r["area"], r["period"]): r["value"] for r in out["records"]}
    assert vals[("Eastern Province", "2023-01-01")] == 1200.5      # '1,200.50' parsed, 'East' standardised
    assert ("Kigali City", "2023-06-01") in vals                  # 'Kigali' -> 'Kigali City'
    assert len(out["records"]) == s["observations_created"]
    assert all(r["source_row"] >= 2 for r in out["records"])  # traceable to rows in the original file


def test_process_rejects_bad_mapping(messy):
    with pytest.raises(Exception):
        process({"path": messy, "filename": "messy.csv", "mapping": {"period": "NoSuchColumn", "values": ["Amount"]}})


# ------------------------------------------------------------------ trends
def test_trend_direction_and_growth_are_computed_from_data():
    t = trend_analysis({"points": points(100 * 1.01 ** np.arange(60)), "name": "x", "unit": "u"})
    st = t["statistics"]
    assert st["trend_direction"] == "increasing"
    assert abs(st["annualised_growth_pct"] - ((1.01 ** 12 - 1) * 100)) < 0.05   # known compound growth recovered
    assert abs(st["latest_period_change_pct"] - 1.0) < 1e-6
    flat = trend_analysis({"points": points(100 + np.random.default_rng(0).normal(0, 0.5, 60)), "name": "x"})
    assert flat["statistics"]["trend_direction"] .startswith("stable")


# ------------------------------------------------------------------ forecasting
def test_forecast_backtests_and_beats_naive_on_trending_seasonal_series():
    y = synth(np.random.default_rng(3))
    f = forecast({"points": points(y), "horizon": 6})
    assert f["status"] == "ok" and len(f["forecast"]) == 6
    ev = f["evaluation"]
    assert ev["backtest_origins"] >= 1 and ev["selected"]["mape_pct"] < 10
    names = {c["model"] for c in ev["candidates"]}
    assert len(names) >= 3, "several candidate models must be compared"
    nxt = f["forecast"][0]
    assert nxt["lower_95"] <= nxt["lower_80"] <= nxt["value"] <= nxt["upper_80"] <= nxt["upper_95"]
    # forecast is derived from data: within a sane band of the last observed level
    assert 0.7 * y[-12:].mean() < nxt["value"] < 1.6 * y[-12:].mean()
    assert f["limitations"]


def test_forecast_refuses_when_history_is_too_short():
    f = forecast({"points": points(synth(np.random.default_rng(1))[:10], MONTHS[:10]), "horizon": 6})
    assert f["status"] == "insufficient"
    assert "reason" in f or "message" in f or f.get("limitations") is not None


def test_forecast_is_deterministic():
    p = points(synth(np.random.default_rng(5)))
    a, b = forecast({"points": p, "horizon": 6}), forecast({"points": p, "horizon": 6})
    assert [x["value"] for x in a["forecast"]] == [x["value"] for x in b["forecast"]]


# ------------------------------------------------------------------ anomaly detection
def _series(k, y):
    return {"indicator_id": k, "indicator_name": f"s{k}", "area": "National", "unit": "count", "is_aggregate": True, "points": points(y)}


def test_detects_injected_spike_and_drop_with_explainable_output():
    rng = np.random.default_rng(11)
    y = synth(rng)
    y[30] *= 1.6
    y[45] *= 0.55
    out = detect({"series": [_series(1, y)], "threshold": 3, "method": "both", "peer_comparison": False})
    flagged = {a["period"]: a for a in out["anomalies"]}
    spike, drop = flagged["2022-07-01"], flagged["2023-10-01"]
    assert spike["direction"] == "increase" and drop["direction"] == "decrease"
    for a in (spike, drop):
        assert a["severity"] in ("low", "medium", "high") and a["observed_value"] > 0 and a["expected_value"] > 0
        assert "requires further investigation" in a["explanation"].lower()
        assert "fraud" in a["explanation"].lower() and "not evidence" in a["explanation"].lower()
    assert out["disclaimer"]


def test_synthetic_benchmark_precision_recall_and_noise_rate():
    """Controlled benchmark on SYNTHETIC series only — NOT a claim about accuracy on real data."""
    def run(inject, thr, seed, trials=30):
        rng = np.random.default_rng(seed)
        ser, truths = [], []
        for k in range(trials):
            y = synth(rng, noise=0.03, growth=rng.uniform(0.008, 0.02), base=rng.uniform(5e5, 5e7))
            t = set()
            if inject:
                for i in rng.choice(np.arange(8, 58), size=2, replace=False):
                    y[i] *= rng.choice([1.35, 1.5, 1.7, 0.55, 0.65, 0.7])
                    t.add(int(i))
            truths.append(t)
            ser.append(_series(k, y))
        res = detect({"series": ser, "threshold": thr, "method": "both", "peer_comparison": False})
        tp = fp = 0
        for a in res["anomalies"]:
            pos = MONTHS.get_loc(pd.Timestamp(a["period"]))
            if pos in truths[a["indicator_id"]]:
                tp += 1
            else:
                fp += 1
        return tp, fp, sum(len(t) for t in truths), len(res["anomalies"]) / trials

    tp, fp, total, _ = run(True, 4.0, seed=1)
    recall, precision = tp / total, tp / max(tp + fp, 1)
    assert recall >= 0.9, f"recall {recall:.2f}"
    assert precision >= 0.7, f"precision {precision:.2f}"
    _, _, _, flags_per_series = run(False, 4.0, seed=2)
    assert flags_per_series <= 0.6, f"{flags_per_series:.2f} false flags per noise-only series"


def test_short_series_is_skipped_not_guessed():
    out = detect({"series": [_series(1, synth(np.random.default_rng(1)))] , "threshold": 3})
    short = _series(2, np.arange(1, 9, dtype=float))
    short["points"] = short["points"][:8]
    out = detect({"series": [short], "threshold": 3, "peer_comparison": False})
    assert out["anomalies"] == []
    assert out["series_summary"][0]["status"] == "skipped"


def test_regional_peer_comparison_flags_the_odd_region():
    rng = np.random.default_rng(21)
    base = synth(rng, noise=0.02)
    ser = []
    for k, area in enumerate(["A", "B", "C", "D", "E"]):
        y = base * (0.8 + 0.1 * k) * np.exp(rng.normal(0, 0.02, 60))
        if area == "C":
            y[40] *= 1.5
        ser.append({"indicator_id": 7, "indicator_name": "ind", "area": area, "unit": "count", "points": points(y)})
    out = detect({"series": ser, "threshold": 3, "method": "both"})
    assert any(a["area"] == "C" and a["period"] == MONTHS[40].strftime("%Y-%m-%d") for a in out["anomalies"])


# ------------------------------------------------------------------ comparison
def test_compare_and_regions_use_real_series():
    rng = np.random.default_rng(2)
    c = compare({"series": [{"label": "a", "points": points(synth(rng))}, {"label": "b", "points": points(synth(rng, growth=0.02))}]})
    assert "error" not in c
    r = regional_comparison({"areas": {n: points(synth(rng, base=b)) for n, b in zip("ABCD", (1e6, 2e6, 3e6, 4e6))}})
    assert r is not None
