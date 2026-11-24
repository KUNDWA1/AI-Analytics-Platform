"""Module 1/2: dataset inspection, validation and the data-processing pipeline.
Original files are only ever READ here — never modified."""
import csv
import os
import re
import numpy as np
import pandas as pd

from .common import AnalyticsError, infer_freq, snap_to_period_start

MAX_ROWS = 200_000
NA_TOKENS = {"", "na", "n/a", "nan", "null", "none", "-", "--", "..", "…", "#n/a"}

AREA_ALIASES = {
    "kigali": "Kigali City", "kigali city": "Kigali City", "city of kigali": "Kigali City",
    "north": "Northern Province", "northern": "Northern Province", "northern province": "Northern Province",
    "south": "Southern Province", "southern": "Southern Province", "southern province": "Southern Province",
    "east": "Eastern Province", "eastern": "Eastern Province", "eastern province": "Eastern Province",
    "west": "Western Province", "western": "Western Province", "western province": "Western Province",
    "rwanda": "National", "national": "National", "all": "National", "total": "National",
}

GENERIC_VALUE_NAMES = {"value", "val", "amount", "figure", "number", "obs_value", "observation"}


# ----------------------------------------------------------------- reading
def read_table(path, filename=None):
    ext = os.path.splitext((filename or path))[1].lower()
    try:
        if ext == ".xlsx":
            df = pd.read_excel(path, dtype=object, sheet_name=0, engine="openpyxl")
        elif ext == ".csv":
            df = None
            last = None
            for enc in ("utf-8-sig", "cp1252", "latin-1"):
                try:
                    with open(path, "r", encoding=enc, newline="") as fh:
                        sample = fh.read(8192)
                    try:
                        sep = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
                    except csv.Error:
                        sep = ","
                    df = pd.read_csv(path, dtype=object, sep=sep, encoding=enc, skipinitialspace=True)
                    break
                except UnicodeDecodeError as e:
                    last = e
            if df is None:
                raise AnalyticsError(f"Could not decode the CSV file: {last}")
        else:
            raise AnalyticsError("Unsupported file type. Only .csv and .xlsx files are accepted.")
    except AnalyticsError:
        raise
    except Exception as e:  # corrupt file, bad zip, parser error...
        raise AnalyticsError(f"The file could not be read as a valid {ext} table: {e}")

    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(how="all")
    df = df.loc[:, [c for c in df.columns if not (c.startswith("Unnamed") and df[c].isna().all())]]
    if len(df) == 0:
        raise AnalyticsError("The file contains no data rows.")
    if len(df.columns) < 2:
        raise AnalyticsError("The file must contain at least two columns (a period and a value).")
    if len(df) > MAX_ROWS:
        raise AnalyticsError(f"The file has more than {MAX_ROWS:,} rows, which exceeds the prototype limit.")
    return df.reset_index(drop=True)


# ----------------------------------------------------------------- parsing
def to_numeric_clean(series):
    """Returns (values, missing_mask, invalid_mask). Blank/NA tokens are 'missing',
    non-blank unparseable text is 'invalid'."""
    raw = series.astype(object)
    out = np.full(len(raw), np.nan)
    missing = np.zeros(len(raw), dtype=bool)
    invalid = np.zeros(len(raw), dtype=bool)
    for i, v in enumerate(raw):
        if v is None or (isinstance(v, float) and np.isnan(v)):
            missing[i] = True
            continue
        if isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, bool):
            out[i] = float(v)
            continue
        t = str(v).strip()
        if t.lower() in NA_TOKENS:
            missing[i] = True
            continue
        neg = t.startswith("(") and t.endswith(")")
        t2 = re.sub(r"[,\s%$]|RWF|Rwf|rwf|FRW|Frw", "", t.strip("()"))
        try:
            f = float(t2)
            out[i] = -f if neg else f
        except ValueError:
            invalid[i] = True
    return pd.Series(out, index=series.index), pd.Series(missing, index=series.index), pd.Series(invalid, index=series.index)


_Q1 = re.compile(r"^\s*(\d{4})\s*[-_ ]?\s*Q([1-4])\s*$", re.I)
_Q2 = re.compile(r"^\s*Q([1-4])\s*[-_ ]?\s*(\d{4})\s*$", re.I)
_Y = re.compile(r"^\s*(\d{4})(\.0)?\s*$")


def parse_periods(series):
    """Normalise mixed date representations to Timestamps. Returns (timestamps, missing_mask, invalid_mask)."""
    vals = []
    missing = []
    invalid = []
    for v in series:
        if v is None or (isinstance(v, float) and np.isnan(v)) or (isinstance(v, str) and v.strip().lower() in NA_TOKENS):
            vals.append(pd.NaT); missing.append(True); invalid.append(False); continue
        ts = pd.NaT
        if isinstance(v, (pd.Timestamp,)) or hasattr(v, "year") and hasattr(v, "month") and not isinstance(v, str):
            ts = pd.Timestamp(v)
        elif isinstance(v, (int, float, np.integer, np.floating)) and 1900 <= float(v) <= 2100:
            ts = pd.Timestamp(year=int(v), month=1, day=1)
        else:
            t = str(v).strip()
            m1, m2, my = _Q1.match(t), _Q2.match(t), _Y.match(t)
            if m1:
                ts = pd.Timestamp(year=int(m1.group(1)), month=3 * (int(m1.group(2)) - 1) + 1, day=1)
            elif m2:
                ts = pd.Timestamp(year=int(m2.group(2)), month=3 * (int(m2.group(1)) - 1) + 1, day=1)
            elif my:
                ts = pd.Timestamp(year=int(my.group(1)), month=1, day=1)
            else:
                try:
                    ts = pd.to_datetime(t, errors="raise", format="mixed")
                except Exception:
                    ts = pd.NaT
        if pd.isna(ts) or not (1900 <= ts.year <= 2100):
            vals.append(pd.NaT); missing.append(False); invalid.append(True)
        else:
            vals.append(pd.Timestamp(ts).tz_localize(None) if getattr(ts, "tzinfo", None) else pd.Timestamp(ts))
            missing.append(False); invalid.append(False)
    return pd.Series(pd.to_datetime(vals), index=series.index), np.array(missing), np.array(invalid)


# ----------------------------------------------------------------- inspect
def _col_kind(name, s):
    nn = s.dropna()
    if len(nn) == 0:
        return "empty"
    vals, miss, inval = to_numeric_clean(nn)
    if (~inval).mean() >= 0.9 and not (name.lower() in ("period", "date", "month", "reporting_period")):
        # numeric, unless it looks like quarter/date text
        return "numeric"
    ts, _, bad = parse_periods(nn.head(200))
    if (~bad).mean() >= 0.9:
        return "date"
    return "text"


def suggest_mapping(df, kinds):
    cols = list(df.columns)
    low = {c: c.lower() for c in cols}

    def find(keys, kind=None):
        for c in cols:
            if any(k in low[c] for k in keys) and (kind is None or kinds[c] in kind):
                return c
        return None

    period = find(["period", "date", "month", "quarter", "time"], {"date", "text", "numeric"}) or find(["year"], {"date", "numeric", "text"})
    if period is None:
        period = next((c for c in cols if kinds[c] == "date"), None)
    indicator = find(["indicator"], {"text"})
    category = find(["category"], {"text"})
    area = find(["area", "region", "province", "district", "geograph", "location"], {"text"})
    unit = find(["unit"], {"text"})
    skip = {x for x in (period, indicator, category, area, unit) if x}
    numeric = [c for c in cols if kinds[c] == "numeric" and c not in skip
               and not re.search(r"(^id$|_id$|^id_|observation|^index$|^no$|^year$)", low[c])]
    if indicator and "value" in [low[c] for c in numeric]:
        numeric = [c for c in numeric if low[c] == "value"]
    return {"period": period, "indicator": indicator, "category": category, "area": area,
            "unit": unit, "values": numeric, "default_category": None}


def inspect(payload):
    path, filename = payload["path"], payload.get("filename")
    df = read_table(path, filename)
    n = len(df)
    kinds = {c: _col_kind(c, df[c]) for c in df.columns}
    columns = []
    for c in df.columns:
        s = df[c]
        miss = int(s.isna().sum() + (s.astype(str).str.strip().str.lower().isin(NA_TOKENS) & s.notna()).sum())
        columns.append({"name": c, "type": kinds[c], "missing": miss,
                        "missing_pct": round(100 * miss / n, 2),
                        "sample": [str(x) for x in s.dropna().astype(str).unique()[:3]]})
    dup_rows = int(df.duplicated().sum())
    mapping = suggest_mapping(df, kinds)
    issues, warnings = [], []
    if mapping["period"] is None:
        issues.append("No date/period column was detected. Choose one in the column mapping.")
    if not mapping["values"]:
        issues.append("No numeric value column was detected. Choose at least one in the column mapping.")
    if dup_rows:
        warnings.append(f"{dup_rows} exact duplicate row(s) detected; duplicates will be removed during processing.")
    for c in columns:
        if c["missing_pct"] >= 20:
            warnings.append(f"Column '{c['name']}' has {c['missing_pct']}% missing values.")
    synthetic_hint = False
    for c in df.columns:
        if re.search(r"data_type|data_source|source", c.lower()):
            if df[c].astype(str).str.lower().str.contains("synthetic").any():
                synthetic_hint = True
    return {
        "synthetic_hint": synthetic_hint,
        "record_count": n,
        "columns": columns,
        "duplicate_rows": dup_rows,
        "missing_cells": int(sum(c["missing"] for c in columns)),
        "suggested_mapping": mapping,
        "preview": df.head(8).where(df.head(8).notna(), None).astype(object).to_dict(orient="records"),
        "issues": issues,
        "warnings": warnings,
        "is_valid": not issues,
    }


# ----------------------------------------------------------------- process
def _slug(text):
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", str(text).lower())).strip("_")[:80]


def _pretty(col):
    return re.sub(r"\s+", " ", str(col).replace("_", " ")).strip().title()


def _guess_unit(col):
    c = col.lower()
    if re.search(r"pct|percent|rate|share|%|penetration|inclusion|ratio", c):
        return "%"
    if re.search(r"value|amount|rwf|frw|revenue|balance", c):
        return "currency (as reported)"
    if re.search(r"volume|count|number|accounts|subscri|users|transactions|agents", c):
        return "count"
    return None


def process(payload):
    path, filename, mp = payload["path"], payload.get("filename"), payload["mapping"]
    df = read_table(path, filename)
    cols = set(df.columns)
    for key in ("period",):
        if not mp.get(key) or mp[key] not in cols:
            raise AnalyticsError("A valid period/date column must be selected in the mapping.")
    values = mp.get("values") or []
    if not values or any(v not in cols for v in values):
        raise AnalyticsError("At least one valid numeric value column must be selected in the mapping.")
    for key in ("indicator", "category", "area", "unit"):
        if mp.get(key) and mp[key] not in cols:
            raise AnalyticsError(f"Mapped column '{mp[key]}' does not exist in the file.")

    n_rows = len(df)
    exact_dups = int(df.duplicated().sum())
    periods, p_missing, p_invalid = parse_periods(df[mp["period"]])
    valid_dates = periods.dropna()
    freq = infer_freq(valid_dates) if len(valid_dates) >= 3 else None
    if freq in ("M", "Q", "Y"):
        snapped = snap_to_period_start(periods, freq)
        periods = snapped.where(periods.notna(), pd.NaT)

    default_cat = mp.get("default_category") or "Uncategorised"
    default_area = "National"
    overrides = mp.get("unit_overrides") or {}

    frames = []
    cell_missing = int(p_missing.sum())
    cell_invalid = int(p_invalid.sum())
    row_has_value = np.zeros(n_rows, dtype=bool)
    for vc in values:
        vals, miss, inval = to_numeric_clean(df[vc])
        cell_missing += int(miss.sum())
        cell_invalid += int(inval.sum())
        ok = vals.notna() & periods.notna()
        row_has_value |= ok.values
        sub = pd.DataFrame({"period": periods, "value": vals, "source_row": df.index + 2})[ok]
        if mp.get("indicator"):
            base = df.loc[ok, mp["indicator"]].astype(str).str.strip()
            if len(values) > 1 or vc.lower() not in GENERIC_VALUE_NAMES:
                sub["indicator_name"] = base + " – " + _pretty(vc)
            else:
                sub["indicator_name"] = base
        else:
            sub["indicator_name"] = _pretty(vc)
        sub["category"] = df.loc[ok, mp["category"]].astype(str).str.strip() if mp.get("category") else default_cat
        sub["area"] = df.loc[ok, mp["area"]].astype(str).str.strip() if mp.get("area") else default_area
        if mp.get("unit"):
            sub["unit"] = df.loc[ok, mp["unit"]].astype(str).str.strip()
        else:
            sub["unit"] = overrides.get(vc) or _guess_unit(vc)
        frames.append(sub)

    long = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    invalid_rows = int((~row_has_value).sum())
    if long.empty:
        raise AnalyticsError("No valid observations could be produced: check the period and value column mapping.")

    long["area"] = long["area"].map(lambda a: AREA_ALIASES.get(str(a).lower().strip(), str(a).strip() if str(a).strip() and str(a).lower() not in NA_TOKENS else "National"))
    long["indicator_code"] = long["indicator_name"].map(_slug)
    long.loc[long["category"].isin(["nan", "", "None"]), "category"] = default_cat

    before = len(long)
    long = long.sort_values(["indicator_code", "area", "period", "source_row"])
    long = long.drop_duplicates(subset=["indicator_code", "area", "period"], keep="first")
    dup_keys = before - len(long)

    neg = int(((long["value"] < 0) & (long["unit"] != "%")).sum())
    pct_out = int(((long["unit"] == "%") & ((long["value"] < 0) | (long["value"] > 100))).sum())

    long = long.sort_values(["indicator_code", "area", "period"]).reset_index(drop=True)
    grp = long.groupby(["indicator_code", "area"], sort=False)["value"]
    prev = grp.shift(1)
    long["pct_change"] = np.where(prev.abs() > 1e-12, (long["value"] - prev) / prev.abs() * 100, np.nan)
    long["moving_avg"] = grp.transform(lambda s: s.rolling(3, min_periods=3).mean())
    long["period"] = long["period"].dt.strftime("%Y-%m-%d")

    warnings = []
    if exact_dups:
        warnings.append(f"{exact_dups} exact duplicate row(s) found; only the first occurrence of each key was kept.")
    if dup_keys:
        warnings.append(f"{dup_keys} observation(s) shared an indicator/area/period key with another row and were dropped (first kept).")
    if neg:
        warnings.append(f"{neg} negative value(s) found in non-percentage indicators — please verify the source.")
    if pct_out:
        warnings.append(f"{pct_out} percentage value(s) outside 0–100 — please verify the source.")
    if cell_invalid:
        warnings.append(f"{cell_invalid} cell(s) contained non-numeric/unparseable text and were excluded.")
    if freq is None:
        warnings.append("Reporting periods are irregularly spaced; trend/forecast results may be limited.")

    ind_meta = (long.groupby("indicator_code")
                .agg(name=("indicator_name", "first"), category=("category", "first"),
                     unit=("unit", lambda s: s.dropna().mode().iloc[0] if s.dropna().size else None))
                .reset_index()
                .rename(columns={"indicator_code": "code"}))

    summary = {
        "original_records": n_rows,
        "valid_records": n_rows - invalid_rows,
        "invalid_records": invalid_rows,
        "missing_values": cell_missing,
        "invalid_cells": cell_invalid,
        "duplicate_records": exact_dups,
        "duplicate_keys_removed": dup_keys,
        "observations_created": int(len(long)),
        "indicators_created": int(len(ind_meta)),
        "areas": sorted(long["area"].unique().tolist()),
        "period_start": long["period"].min(),
        "period_end": long["period"].max(),
        "frequency": freq,
        "warnings": warnings,
    }
    rec = long[["indicator_code", "area", "period", "value", "pct_change", "moving_avg", "source_row"]]
    rec = rec.astype(object).where(rec.notna(), None)
    return {"summary": summary, "indicators": ind_meta.to_dict(orient="records"),
            "records": rec.to_dict(orient="records")}
