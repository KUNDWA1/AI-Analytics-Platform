"""Command-line bridge between the Node.js backend and the Python analytics engine.

Usage (called by backend/src/services/python.js):
    python -I analytics_cli.py <command>      # JSON payload on stdin, JSON result on stdout

Commands: inspect, process, trend, compare, regions, forecast, anomalies
Failures are returned as {"error": "...", "status": <http-like code>} (exit code 0) so the backend can
map them to API errors. This module does pure computation: no network and no database access.
"""
import json
import os
import sys
import traceback

# `python -I` (isolated mode) does not add the script directory to sys.path, so do it explicitly.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engine.common import AnalyticsError, sanitize  # noqa: E402


def _dispatch(command, payload):
    if command == "inspect":
        from engine.processing import inspect
        return inspect(payload)
    if command == "process":
        from engine.processing import process
        return process(payload)
    if command == "trend":
        from engine.trends import trend_analysis
        return trend_analysis(payload)
    if command == "compare":
        from engine.trends import compare
        return compare(payload)
    if command == "regions":
        from engine.trends import regional_comparison
        return regional_comparison(payload)
    if command == "forecast":
        from engine.forecasting import forecast
        return forecast(payload)
    if command == "anomalies":
        from engine.anomalies import detect
        return detect(payload)
    raise AnalyticsError(f"Unknown analytics command: {command!r}")


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        result = _dispatch(command, payload)
        out = sanitize(result)
    except AnalyticsError as exc:
        out = {"error": str(exc), "status": 422}
    except Exception as exc:  # keep the stack trace on stderr only; never leak it through the API
        sys.stderr.write(traceback.format_exc())
        out = {"error": f"Analytics engine failure: {exc.__class__.__name__}: {exc}", "status": 500}
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
