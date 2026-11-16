# Earth Trend Detective

Earth Trend Detective is a web application for exploring how environmental variables change over time. It turns a question about a place and period into visual evidence, coverage information, and, when the data supports it, a statistical estimate of a linear trend.

The project addresses the NASA Space Apps Challenge [Be An Earth System Trend Detective!](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/): select Earth science variables, visualize their evolution, and investigate **what is changing, where, by how much, and whether the change is statistically significant**.

## From the challenge to the application

| Challenge question | How the project addresses it |
| --- | --- |
| What is changing? | Explore temperature and precipitation in the trend workflow, or browse additional variables in the NASA Giovanni and Earthdata workflows. |
| Where is it changing? | Select a geocoded location, compare two locations, or explore stored satellite averages for departments of Honduras. Coordinates and source context accompany results. |
| How much is it changing? | View monthly and annual observations and, when supported, a linear slope per decade with a 95% confidence interval. |
| Is the change significant? | The trend workflow reports a p-value and significance at the 0.05 threshold, subject to its coverage requirements. |

NASA data is available through Giovanni and AppEEARS integrations. Meteomatics is a separate commercial data source and is not NASA data. Availability of each source depends on credentials, provider access, coverage, and, for stored data, successful ingestion; the presence of an integration does not guarantee live access.

## How to investigate

1. Sign in with Google and choose a workflow in **Explore**.
2. Ask a question in English, including the variable, location, and dates. The assistant interprets the request and asks for clarification when needed.
3. Review the proposed request and confirm it. For trend analysis, select either NASA Giovanni or Meteomatics, NASA AppEEARS as the historical source.
4. Explore the returned series and source information. Trend results include coverage, the estimated slope, uncertainty, and statistical evidence when inference is supported.
5. For trend results with observations, download the data and provenance as JSON or use the print dialog to save a PDF report. Sessions and analyses can be revisited from the sidebar.
6. Optionally, compare the result with another of your sessions: below the results, choose a series from this session, another session and its series, then select **Compare sessions**. Each session holds one comparison; once it is made, the selector disappears and the comparison is shown whenever the session is reopened.

For example, choose **Trend analysis** and ask: “How has temperature changed in Tegucigalpa since 2000?” A second city or a second period can be included for comparison. A trend is an estimate over the selected period, not an explanation of its cause.

## Workflows and data

- **Trend analysis:** analyzes temperature or precipitation for a location, compares two locations over common complete years, or compares two periods at one location. Each analysis uses one provider; data from different providers are not spliced together. Giovanni uses MERRA-2 point data from the nearest grid cell. Meteomatics uses historical daily aggregates, subject to account entitlement.
- **NASA Giovanni data:** queries a curated catalog of NASA Earth science variables for a point and date range. The reviewed request returns provider series and source details. This is a separate exploratory workflow from the temperature and precipitation analysis.
- **NASA Earthdata:** explores satellite data from NASA AppEEARS stored as averages over departments of Honduras. Its catalog and results depend on data ingested into the project's PostgreSQL store. Department boundaries are from geoBoundaries / OpenStreetMap contributors.
- **Meteomatics data:** builds and confirms requests to the Meteomatics Weather API, checks source availability, and displays provider results. Supported parameters and coverage depend on the account and source.

## How trend analysis works

The server validates the request, retrieves observations from the selected provider, and converts complete daily records into monthly values. A year is included only when it has 12 distinct valid months. Annual temperature is the calendar-day-weighted mean of monthly temperatures; annual precipitation is the sum of monthly totals. Missing values are not interpolated.

A linear trend is inferred only when at least **10 complete years** and **80% of the requested years** are available. These are operational thresholds for this proof of concept, not a universal definition of adequate climate data. The application fits ordinary least squares against calendar years and uses Newey–West autocorrelation-robust uncertainty to report the slope per decade, a 95% confidence interval, and a two-sided p-value. Results below the threshold remain descriptive and explicitly report insufficient data.

A non-significant result does not prove that nothing changed. A significant trend does not establish its cause. Provider outages and missing coverage are reported separately from statistical results. The numerical analysis and report are calculated by the server; Gemini can help interpret a question and add a qualitative explanation, with a deterministic report available when generated text is unsuitable or unavailable.

## How session comparisons work

After a request is submitted in any workflow, its results can be compared with one series from another of your sessions, for example precipitation in two cities, or rainfall against evaporation at one place. The comparison asks whether the two series move together and how strongly.

1. **Series.** Each session contributes a monthly series: a query result that has monthly values (Meteomatics, NASA Giovanni, or NASA Earthdata) or a location from a finished trend analysis. Results without monthly values cannot be compared, and the selector says so.
2. **Alignment.** Only months where both series have a valid value are used; nothing is interpolated or filled in. At least **36 common months** are required to estimate a correlation, and **10 common complete years** for the annual figures. These are operational thresholds of this proof of concept. Below them, the chart is still shown and the result is reported as insufficient data.
3. **Seasonal cycle removed.** Two places with the same rainy season correlate strongly even when their year-to-year behavior is unrelated. The headline figure therefore uses monthly **anomalies**: each series minus its own average for that calendar month over the common period. The raw monthly correlation is also shown, labeled as inflated by seasonality.
4. **Correlation and significance.** The app computes the Pearson correlation of the anomalies with a 95% confidence interval and a two-sided p-value. Consecutive months are not independent, so the sample size is reduced for autocorrelation before testing (an effective sample size, following Bretherton et al. 1999). A result is called significant when p < 0.05.
5. **Supporting measures.** The app also reports the rank (Spearman) correlation of anomalies, the correlation of annual values with and without each series' linear trend, the strongest correlation when one series is shifted by up to 6 months (descriptive only), how much series B changes per unit of series A, and whether both annual trends point in the same direction.
6. **Chart.** Both series are drawn on one time axis in different colors, each with its own unit and axis. A switch rescales both to standard deviations from their own mean so their shapes can be compared on a single axis. The annual view can show each series' trend line.
7. **Report.** Gemini writes a short report (headline, findings, caveats, and next steps) from the statistics the server computed. It may quote those numbers but cannot introduce new ones: every number in its reply is checked against the computed values, and any mismatch, formatting problem, error, or timeout replaces it with a deterministic report built from the same statistics. The report states which of the two was used.

A correlation describes how two series vary together; it does not show that one causes the other. A non-significant correlation does not prove the series are unrelated. Differences in provider, dataset, unit, and spatial support (a point, a grid cell, or an area average) can weaken or distort a relationship, and the report notes them. The aligned monthly values of both series can be downloaded as CSV, and provenance for both sessions is included.

## Architecture

- **Interface:** React, TypeScript, Vite, MUI, Recharts, and Leaflet.
- **Application backend:** Firebase Functions v2, Firestore, Firebase Authentication, Genkit, and Vertex AI. Analysis requests are processed asynchronously and saved with their results and provenance.
- **Data providers:** NASA GES DISC Giovanni, NASA AppEEARS, Meteomatics, and Open-Meteo geocoding. The Balam ingestion subsystem stores multi-source data in PostgreSQL through Prisma.
- **Access and limits:** authenticated callable functions validate requests and apply quotas; Firestore rules protect user-owned data and server-only collections. App Check enforcement is configurable and is disabled in the example configuration.

For backend contracts, detailed scientific methods, credentials, and operational configuration, see [functions/README.md](functions/README.md) and [the data source documentation](functions/src/datasources/README.md).

## Run locally

Prerequisites: Node.js 22, a Firebase project configured for Google sign-in, and access to the services required by the workflows you want to use.

```bash
npm install
npm --prefix functions install
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with the Firebase web app configuration and, if used, the public CARTO basemap key. Set `VITE_USE_FIREBASE_EMULATORS` as appropriate. The frontend needs a configured backend or running Firebase emulators for live workflows; starting Vite alone does not create provider access.

Backend environment names are documented in [functions/.env.example](functions/.env.example). Gemini uses Vertex AI credentials; Giovanni requires NASA Earthdata access; Meteomatics requires account credentials and suitable data entitlement. The AppEEARS workflow also requires a configured PostgreSQL store and ingested data. Keep provider credentials and database URLs in server-side secrets or ignored local files, never in `VITE_` variables or source control.

To build the frontend and backend:

```bash
npm run build
npm --prefix functions run build
```

## References

- [NASA Space Apps challenge](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/)
- [NASA Giovanni](https://giovanni.gsfc.nasa.gov/giovanni/)
- [NASA AppEEARS](https://appeears.earthdatacloud.nasa.gov/)
- [Meteomatics Weather API](https://www.meteomatics.com/en/api/getting-started/)
- [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api)
