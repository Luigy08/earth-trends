---
name: earth-system-trend-detective
description: "Use for every task in the NASA Space Apps Earth Trend Detective project: product planning, NASA data and variables, scientific methods, implementation, review, and deployment. Preserve the challenge objectives and this project's agreed evidence standards."
---

# Earth System Trend Detective

## Always load this context

This skill is the project brief for work in this repository. Read it before responding to or changing project files. Check the current repository and deployed configuration when details may have changed; this brief records intent and invariants, not a substitute for inspecting the implementation.

## NASA Space Apps challenge

The official challenge, **“Be An Earth System Trend Detective!”**, asks teams to build a tool that selects variables measured by Earth science missions or produced by Earth science models, visualizes change over time, and determines **what is changing, where it is changing, how much it is changing, and whether the change is statistically significant**. The same variable/process may move in different directions in different regions. Do not reduce the challenge to a generic weather dashboard: NASA Earth science data and defensible trend analysis must remain central.

Official brief: <https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/?tab=details>

## Product agreed for this POC

- Public, responsive web app. Product interface, generated analysis, and exports are in **English** (the user may speak to Codex in Spanish).
- Natural-language question and a precise editable form are equivalent paths into one validated analysis request. Gemini interprets intent and asks clarifying questions; show the interpretation for user confirmation before analysis.
- Supported POC metrics: temperature and precipitation. Search global cities and allow comparisons between two locations over common complete years or between two time periods. Default range starts in 2000 and ends at the latest complete year.
- Results include location context, monthly and annual series, trend and uncertainty, coverage, comparison, provenance, a cautious report, CSV, and print-to-PDF. Clearly say when the data cannot support an inference.
- Historical trend analysis uses Meteomatics daily aggregates for `t_mean_2m_24h:C` and `precip_24h:mm`, converted to complete monthly values. Historical access and range depend on account entitlement. Never claim a source is available without a successful provider response.
- Meteomatics current weather is a separate context panel and is never mixed into historical trend calculations. Missing credentials or API access must be reported honestly.

## NASA data resource selection

Use only the datasets listed in the challenge resources or explicitly approved by the user. Verify dataset metadata before adding any NASA Earth-data source: variable meaning, units, sign convention, temporal aggregation, spatial grid/coverage, valid range, missing-value encoding, and relevance to the question.

## Giovanni and GES DISC

- Use Giovanni to inspect available NASA datasets, select variables and areas/time ranges, make exploratory plots/maps/time series, inspect missing coverage, and cross-check analysis before turning a finding into a product claim. Prefer primary NASA dataset documentation and API metadata for exact parameter semantics and units.
- NASA GES DISC dataset page shared in this project: `M2TMNXINT_5.12.4` (MERRA-2 monthly time-integrated diagnostics): <https://disc.gsfc.nasa.gov/datasets/M2TMNXINT_5.12.4/summary>.
- Its Variables table includes `lon`, `lat`, and `time` plus many process-level diagnostics. Examples visible in the shared table include `AUTNCVNR` (autoconversion loss of cloud water), `BKGERR` (vertically integrated kinetic-energy residual for background energy conservation), `COLCNVNR` (accretion loss of cloud water to rain), and `COLCNVSN` (accretion loss of cloud water to snow), with differing physical units such as `kg m-2 s-1` and `W m-2`.
- Treat this as a candidate dataset, not as a ready-to-use list of climate indicators. Before adding a variable, confirm its shortname, definition, units, sign convention, temporal aggregation, spatial grid/coverage, valid range, missing-value encoding, and suitability for the question in the authoritative metadata. Do not mix fundamentally different quantities or units in one trend/comparison. A monthly time-integrated diagnostic is not automatically equivalent to a monthly mean.
- Giovanni: <https://giovanni.gsfc.nasa.gov/giovanni/>. Dataset shortnames and catalog versions can change; re-check NASA metadata when adding or changing a data source.

## Scientific and reporting requirements

- Keep numerical analysis deterministic and server-side. Gemini may interpret the user's question and explain precomputed qualitative results, but must not invent, alter, or supply statistics. Include the app-computed numeric report and provenance independently of generated prose; use a deterministic template if Gemini is unavailable or returns unsafe numerical claims.
- Normalize data and document provider, product, resolution, units, retrieval time, location, and period. Preserve null/missing values; never silently impute or splice providers.
- Annual temperature is the calendar-day-weighted mean of valid months; annual precipitation is the sum of monthly totals. Meteomatics daily precipitation aggregates are converted to monthly totals using actual month lengths, including leap February. For the UI, monthly precipitation totals are mm/month and annual totals are mm/year.
- A valid annual value needs 12 distinct valid months. Do not infer a trend unless at least 10 complete years and 80% of the requested interval are available; label this as the POC's operational threshold. If insufficient, retain descriptive data and return an explicit insufficient-data result.
- Use OLS over actual calendar years with Newey–West autocorrelation-robust uncertainty. Report slope per decade, 95% interval, and p-value when inference is supported; use alpha 0.05. Distinguish a non-significant trend from proof of no change. Never imply causality or attribution from correlation/trend alone.
- Calculate anomalies only when all 30 complete baseline years (1991–2020) are available. Otherwise omit anomalies and state why.
- Location comparisons use the same interval and common complete years for both series. Period comparisons retain and disclose each period's own coverage and duration; differences are descriptive unless a valid significance test is explicitly implemented.
- Current Meteomatics `t_2m:C` and `precip_1h:mm` are instantaneous/hourly context. Do not compare them numerically to monthly or annual climate summaries. Show provider and valid time.
- Preserve distinct outcomes: clarification needed, insufficient data, no significant trend, significant trend, and source unavailable. A provider outage must not be presented as evidence of no trend.

## Architecture and project conventions

- Frontend: React, Vite, TypeScript, MUI, Recharts, Leaflet. Backend: Firebase Functions v2 in `us-central1`, Firestore, anonymous Auth, App Check, Genkit/Vertex AI. Project ID: `earth-trend-detective`; verify current deployed state before operational changes.
- Keep provider adapters independent. Meteomatics supplies historical aggregates and current weather through separate requests. Geocoding resolves explicit city/country matches; display the selected coordinates. Use Firebase Secret Manager for Meteomatics credentials. Never expose provider credentials in Vite variables, source control, browser logs, or chat.
- Respect Firestore owner isolation, App Check, per-user/global quotas, server-side validation, caching, and bounded Function instances. Do not weaken these protections to make a demo pass.
- Follow repository `AGENTS.md`: SOLID, reuse shared components, inspect existing `.types.ts` before adding types, keep types/constants/styles/resolvers in their corresponding files where appropriate, prefer MUI, preserve existing function/variable names, and keep files below 1,000 lines when practical. Do not add or run tests unless the user asks; use other relevant validation such as type-check/build when needed.
- User-facing site language is English by the user's request. Keep user-facing product copy, model prompts/results, error messages, metadata, CSV headings, accessible labels, and date/number formatting consistent.
- This project has an explicit user request to host on Firebase. Deployment changes the public site; inspect the build and configuration and deploy only when it is part of the user's current request/authorization. Never claim a provider is connected until a real request has succeeded.

## When working on a feature

1. Read `AGENTS.md`, this skill, and the relevant contracts/types plus implementation before editing.
2. Map the requested work to the official challenge objective and the POC requirements above. If it broadens the data scope, verify the allowed resource and its authoritative metadata and scientific meaning first.
3. Make the smallest complete change across UI, callable contracts, backend/provider, provenance, fallback, and documentation as applicable. Preserve honest partial outcomes.
4. Report concrete implementation/deployment status and any unmet dependency, such as Meteomatics account entitlement or a required map-provider key. Do not present plans as completed work.
