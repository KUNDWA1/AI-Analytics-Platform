# Presentation scenario (≈10 minutes)

Preparation: `cd backend; npm run seed -- --reset`, then start the API (`npm start`) with a built frontend, or the two dev servers.
Open http://localhost:4000 (or :5173 in dev). Password = `DEMO_PASSWORD`.

1. **Administrator** (`admin@demo.local`) – open the *system overview*: health checks, users by role, totals.
2. Open **Audit logs** to show recorded actions; mention backend-enforced roles.
3. **Upload dataset** → choose `sample-data/upload_demo_2025_extension.csv` (Jan–Jun 2025 continuation), category *Mobile Money*,
   source *Synthetic demonstration data*. Show the validation report, detected columns and record count.
   (Sample files can also be downloaded from the upload page.) To show the flexible mapping, upload a CSV with different
   column names and set the period / value / area columns in *Column mapping*.
4. **Process dataset** – show the processing summary: original/valid/invalid records, missing values, duplicates, date.
5. Sign out; sign in as **Analyst** (`analyst@demo.local`) – landing page shows processing results and model evaluation.
6. **Trend analysis** – choose *Mobile Money – Transaction Volume*: direction, growth, MoM/YoY, moving averages, seasonality.
   Try *Indicator comparison* and *Regional comparison*.
7. **Forecasting** – run a 6-month forecast: chosen method, back-test table (MAE/RMSE/MAPE), prediction intervals, limitations.
   Pick a series with too little history to show the platform refusing to forecast.
8. **Anomaly monitoring** – *Run detection*; filter by severity; open a high alert: observed vs expected value, score,
   method, explanation. Add an analyst note and **Mark as reviewed**.
9. Sign in as **Regulator** (`regulator@demo.local`) – overview dashboard: KPIs, regional comparison, open alerts.
   Use the filters (date range, category, region, source). Open an alert (can review, cannot run models).
10. **Reports** – generate a report (title, period, categories, include anomalies) → *View* → **Download PDF**.
    Also **Export data as CSV**.
11. (Optional) Sign in as **Management** – show the executive summary and that upload / users / audit are not accessible
    (navigating to `/users` shows *Access denied*; the API returns 403).

Talking points: synthetic data is clearly labelled; anomalies ≠ fraud; no ground-truth labels for real data so no accuracy
claim; forecasts are evaluated by back-testing against a naive benchmark.
