"""Generates SYNTHETIC DEMONSTRATION DATA for the platform. NOT OFFICIAL INSTITUTIONAL DATA.

All numbers are produced from simple growth + seasonality + noise models with a fixed random seed.
They do not describe any real bank, operator or Rwandan statistic. A handful of anomalies are
deliberately injected (listed in ground_truth_synthetic_anomalies.json) so that the detection
algorithms can be tested against known cases.

Run:  python generate_synthetic.py
"""
import json
import os
import numpy as np
import pandas as pd

LABEL = "SYNTHETIC DEMONSTRATION DATA — NOT OFFICIAL INSTITUTIONAL DATA"
HERE = os.path.dirname(os.path.abspath(__file__))
AREAS = {"Kigali City": 0.38, "Eastern Province": 0.18, "Southern Province": 0.17,
         "Western Province": 0.16, "Northern Province": 0.11}
SERVICES = {
    # name: (start monthly txn volume nationally, monthly growth, avg ticket RWF, start accounts, account growth)
    "Mobile Money": (40e6, 0.020, 14000, 3.0e6, 0.009),
    "Digital Payments": (6e6, 0.028, 32000, 0.8e6, 0.014),
    "Mobile Banking": (4e6, 0.017, 52000, 1.2e6, 0.010),
}
SEASON = np.array([-0.04, -0.03, 0.0, 0.0, 0.01, 0.0, 0.01, 0.02, 0.0, 0.01, 0.03, 0.08])

# injected anomalies: (service, area, period 'YYYY-MM', multiplier, measures affected)
INJECTED_MAIN = [
    ("Mobile Money", "Kigali City", "2023-08", 1.55, ["transaction_volume", "transaction_value"]),
    ("Digital Payments", "Eastern Province", "2024-03", 0.45, ["transaction_volume", "transaction_value"]),
    ("Mobile Banking", "Western Province", "2022-11", 1.70, ["transaction_value"]),
    ("Mobile Money", "Northern Province", "2021-06", 0.70, ["active_accounts"]),
]
INJECTED_EXT = [
    ("Digital Payments", "Kigali City", "2025-04", 1.80, ["transaction_volume", "transaction_value"]),
    ("Mobile Money", "Southern Province", "2025-05", 0.50, ["transaction_volume", "transaction_value"]),
]


def build_activity(rng, months, injected):
    rows = []
    oid = 1
    for service, (v0, g, ticket, a0, ag) in SERVICES.items():
        for area, w in AREAS.items():
            area_g = rng.normal(0, 0.002)
            for k, ts in enumerate(months):
                season = SEASON[ts.month - 1]
                covid = -0.10 if ts.strftime("%Y-%m") in ("2020-04", "2020-05") else 0.0
                vol = v0 * w * np.exp((g + area_g) * k) * (1 + season + covid) * np.exp(rng.normal(0, 0.03))
                tk = ticket * (1 + 0.004 * k) * np.exp(rng.normal(0, 0.01))
                val = vol * tk / 1e6  # RWF million
                acc = a0 * w * np.exp(ag * k) * np.exp(rng.normal(0, 0.004))
                rec = {"transaction_volume": vol, "transaction_value": val, "active_accounts": acc}
                for (s, a, p, mult, measures) in injected:
                    if s == service and a == area and p == ts.strftime("%Y-%m"):
                        for m in measures:
                            rec[m] *= mult
                rows.append({
                    "observation_id": f"SYN-{oid:06d}", "reporting_period": ts.strftime("%Y-%m"),
                    "indicator_name": service, "indicator_category": {"Mobile Money": "Mobile Money",
                    "Digital Payments": "Digital Payments", "Mobile Banking": "Mobile Banking"}[service],
                    "geographic_area": area,
                    "transaction_volume": int(round(rec["transaction_volume"])),
                    "transaction_value": round(rec["transaction_value"], 2),
                    "active_accounts": int(round(rec["active_accounts"])),
                    "data_source": LABEL, "data_type": "synthetic"})
                oid += 1
    return pd.DataFrame(rows)


def build_connectivity(rng, months):
    rows = []
    specs = [
        ("Mobile Internet Subscriptions", "Internet & Connectivity", "count", 2.6e6, 0.011, False),
        ("Active Mobile Subscriptions", "Internet & Connectivity", "count", 9.0e6, 0.006, False),
        ("Adults with Mobile Money Account", "Financial Inclusion", "%", 38.0, None, True),
    ]
    for name, cat, unit, start, g, is_pct in specs:
        for area, w in AREAS.items():
            area_shift = rng.normal(0, 2.0) if is_pct else 0
            for k, ts in enumerate(months):
                if is_pct:
                    v = 78 / (1 + np.exp(-0.045 * (k - 22))) + 20 + area_shift + rng.normal(0, 0.35)
                    v = float(np.clip(v, 0, 99))
                else:
                    v = start * w * np.exp(g * k) * (1 + SEASON[ts.month - 1] * 0.3) * np.exp(rng.normal(0, 0.012))
                    if name == "Mobile Internet Subscriptions" and area == "Northern Province" and ts.strftime("%Y-%m") == "2022-01":
                        v *= 1.5
                rows.append({"reporting_period": ts.strftime("%Y-%m"), "indicator_name": name,
                             "indicator_category": cat, "geographic_area": area,
                             "value": round(v, 2) if is_pct else int(round(v)), "unit": unit,
                             "data_source": LABEL, "data_type": "synthetic"})
    return pd.DataFrame(rows)


def main():
    rng = np.random.default_rng(20250101)
    months_all = pd.date_range("2020-01-01", "2025-06-01", freq="MS")
    full = build_activity(rng, months_all, INJECTED_MAIN + INJECTED_EXT)
    main_df = full[full["reporting_period"] <= "2024-12"].reset_index(drop=True)
    ext_df = full[full["reporting_period"] >= "2025-01"].reset_index(drop=True)
    ext_df["observation_id"] = [f"SYN-EXT-{i+1:05d}" for i in range(len(ext_df))]

    conn = build_connectivity(np.random.default_rng(7), pd.date_range("2020-01-01", "2024-12-01", freq="MS"))

    main_df.to_csv(os.path.join(HERE, "digital_financial_activity_synthetic.csv"), index=False)
    conn.to_csv(os.path.join(HERE, "connectivity_inclusion_synthetic.csv"), index=False)
    ext_df.to_csv(os.path.join(HERE, "upload_demo_2025_extension.csv"), index=False)
    ext_df.to_excel(os.path.join(HERE, "upload_demo_2025_extension.xlsx"), index=False)

    truth = [{"indicator": f"{s} – {m.replace('_', ' ').title()}", "area": a, "period": p + "-01",
              "multiplier": mult, "file": "digital_financial_activity_synthetic.csv" if (s, a, p, mult, ms) in INJECTED_MAIN
              else "upload_demo_2025_extension.csv"}
             for (s, a, p, mult, ms) in INJECTED_MAIN + INJECTED_EXT for m in ms]
    truth.append({"indicator": "Mobile Internet Subscriptions", "area": "Northern Province", "period": "2022-01-01",
                  "multiplier": 1.5, "file": "connectivity_inclusion_synthetic.csv"})
    with open(os.path.join(HERE, "ground_truth_synthetic_anomalies.json"), "w", encoding="utf-8") as f:
        json.dump({"note": LABEL + ". Anomalies were injected on purpose for testing only.", "injected": truth}, f, indent=2)
    with open(os.path.join(HERE, "SYNTHETIC_DATA_README.md"), "w", encoding="utf-8") as f:
        f.write(f"# {LABEL}\n\nThese files are generated by `generate_synthetic.py` (fixed seed) for software demonstration only.\n"
                "They are **not** official statistics from BNR, NISR, RURA, the World Bank, any bank or any mobile operator.\n\n"
                "| File | Content |\n|---|---|\n"
                "| digital_financial_activity_synthetic.csv | Monthly mobile money / digital payments / mobile banking activity by province, 2020-01 to 2024-12 (transaction_value in RWF million) |\n"
                "| connectivity_inclusion_synthetic.csv | Monthly connectivity and financial-inclusion indicators in long format, 2020-01 to 2024-12 |\n"
                "| upload_demo_2025_extension.csv / .xlsx | Jan–Jun 2025 continuation of the first file, used for the live upload demo |\n"
                "| ground_truth_synthetic_anomalies.json | Injected anomalies, used only by automated tests |\n")
    print(f"main: {len(main_df)} rows, connectivity: {len(conn)} rows, extension: {len(ext_df)} rows")


if __name__ == "__main__":
    main()
