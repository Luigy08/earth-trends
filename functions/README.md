# Earth Trend Detective backend

TypeScript / Node 22, an Express HTTP server (deployed as one Render web service, see `../render.yaml`), Firestore queue, Genkit with Vertex AI. Firebase is still used for Auth token verification and Firestore through `firebase-admin`; there are no Cloud Functions. Deployment belongs to the parent project; no deployment is performed by this package.

## Server

`src/server.ts` is the entry point (`npm start`; `npm run dev` builds and loads the ignored `.env.local`). Every handler exported from `src/index.ts` through `onCall` is served as `POST /api/<name>` with body `{ "data": ... }` and an `Authorization: Bearer <Firebase ID token>` header. It answers `{ "result": ... }`, or `{ "error": { "code", "message" } }` with the matching HTTP status; codes are the former callable codes (`unauthenticated`, `invalid-argument`, `resource-exhausted`, `unavailable`, …) and the frontend reads them as `functions/<code>`. `GET /healthz` is the health check and the Balam HTTP API is mounted under `/balam`. CORS allows only `CORS_ORIGINS` (default: the two Firebase Hosting domains, plus localhost outside production); it is not access control, every endpoint verifies the caller.

## Contract

`../shared/types.ts` is the public frontend contract. `npm run build` emits `lib/functions/src/server.js` and `lib/shared/types.js` / `.d.ts`. The frontend imports source types with `import type`.

All callables require Google Firebase Authentication. App Check enforcement is disabled for this test project with `ENFORCE_APP_CHECK=false`; when enabled, every request must carry a valid `X-Firebase-AppCheck` token. Invalid boolean values stop the server at startup.

| Callable | Input | Output |
| --- | --- | --- |
| `interpretQuery` | `{ query }` | `{ status: 'ready' \| 'needs_clarification', spec?, summary, warnings, clarificationQuestions }` |
| `getMeteomaticsCatalog` | `{}` | Versioned complete parameter catalog snapshot |
| `interpretMeteomatics` | `{ query }` | Meteomatics request draft or clarification questions |
| `checkMeteomaticsAvailability` | `{ spec }` | Per-parameter source time ranges and availability |
| `executeMeteomaticsQuery` | `{ spec, confirmed: true }` | Raw result, request details and provenance |
| `searchLocations` | `{ query, limit?: 1..10 }` | `{ locations }` |
| `createAnalysis` | `{ spec, requestId }` | `{ analysisId, status }` |
| `getAnalysis` | `{ analysisId }` | `{ analysis }` |

`spec`: metric `temperature` or `precipitation`, locations, `startYear`, `endYear`, `comparisonMode` (`none`, `locations`, `periods`), optional `secondPeriod`. Location comparison requires exactly two distinct coordinate pairs; other modes require one location. Period comparison requires the second ordered period. Years range from 1981 through the last complete UTC calendar year; a one-year period is valid but will not receive a trend inference. `requestId` is 8–128 ASCII letters/digits/underscore/hyphen; reuse the same ID for retries. Reusing it with another spec is rejected. Repeated submissions return the original job and do not consume quota again.

Interpretation asks clarification for missing fields, ambiguous locations, unsupported metrics or invalid periods; Gemini supplies neither coordinates nor numerical analysis. Geocoding uses Open-Meteo / GeoNames; results are canonicalized by the provider. User-facing narratives, notices and errors are in English. Manual specifications bypass Gemini but use the same validation.

## Processing and access

`createAnalysis` atomically reserves quota and creates `analyses/{id}` and `analysisJobs/{id}`. An in-process worker (`analysis-worker.ts`) starts the job right after creation and sweeps `analysisJobs` every 30 seconds for queued jobs and expired leases, so work survives a restart or deploy. The lease lasts 600 seconds. Transactional lease tokens fence duplicate/stale workers; a job with a live lease is never claimed twice. Expired leases are reclaimable. Unexpected processing errors release the lease and retry up to three processing attempts. Scientific source/quality failures are terminal reportable outcomes rather than internal exceptions.

Analysis states: `queued`, `processing`, `completed`, `insufficient_data`, `source_unavailable`, `failed`. `result.outcome` is `sufficient_data`, `insufficient_data` or `source_unavailable`. Scientific outcomes contain available descriptive data, quality warnings and `trend: null` when inference is invalid. `failed` is reserved for exhausted unexpected failures. The client may poll `getAnalysis` until any terminal state; use backoff to respect read quotas.

The parent must deploy Firestore rules denying all client access to `analysisJobs`, `quotas` and `serverCache`, and all writes to `analyses`. Owner-only analysis reads may be allowed; callable reads also check owner identity and return not-found for other users. Admin code uses the runtime identity, never trusts an owner ID in request input. The server runs as a dedicated Google service account, supplied to the host as a secret file through `GOOGLE_APPLICATION_CREDENTIALS`; it needs only Cloud Datastore User and Vertex AI User (plus Firebase App Check Token Verifier when enforcement is on). No service account credentials belong in the repo.

Per-user transactional quotas default to **10 new analyses per UTC hour**; interpretation 20, search 100 and reads 1000 per UTC day. Global UTC daily budgets are independent: **100 new analyses**, 200 interpretations and 2000 searches. Search and interpretation never spend the analysis budget; reads are excluded from global budgets. Cache hits still consume their respective endpoint budget. Idempotent creation retries consume no quota. Configure the `QUOTA_*` environment settings before deployment. Input validation caps callable JSON at 20 KB before Zod walks arrays. The service runs as a single instance (`numInstances: 1` in `render.yaml`); worker concurrency is 2.

## Data and inference

- Meteomatics historical daily aggregates: `t_mean_2m_24h:C` and `precip_24h:mm`, converted into complete monthly values. Historical access, source coverage and entitlement depend on the configured account. Missing credentials or provider failure return an explicit source-unavailable result.
- NASA Giovanni (optional, `spec.dataSource: 'giovanni'`): point time series from the GES DISC "Giovanni in the Cloud: Time Series" service (`https://api.giovanni.earthdata.nasa.gov/timeseries`, Earthdata Login bearer token). Temperature uses MERRA-2 `M2TMNXSLV_5_12_4_T2M` (K → °C) and precipitation MERRA-2 `M2TMNXFLX_5_12_4_PRECTOT` (kg m⁻² s⁻¹ × 86400 → mm/day), both monthly means from 1980, mapped to the meaning of `t_mean_2m_24h:C` and `precip_24h:mm`. Units are converted from the unit reported in the response; an unknown unit, empty response or auth failure is `source_unavailable`. Values are the nearest grid cell (recorded in the attribution). The mapping lives in `shared/giovanni-catalog.constant.ts` and `shared/giovanni.resolver.ts` and is shared with `scripts/giovanni-to-meteomatics.mjs`. An omitted `dataSource` means Meteomatics; one provider per analysis, never spliced or used as a fallback.
- Temperature annual means are weighted by calendar days. Precipitation rates multiply actual month lengths, including leap February, then sum to annual mm. **Public monthly precipitation is mm/month**, public annual precipitation is mm/year. Internal provider months remain mm/day.
- An annual observation requires 12 distinct valid months. Trend inference needs at least 10 complete years and at least 80% of requested calendar years; no imputation or interpolation. Excluded years are listed.
- OLS uses actual calendar years. A Bartlett Newey–West HAC covariance accounts for heteroskedasticity and residual autocorrelation. Bandwidth is `floor(4*(n/100)^(2/9))`, capped at `n-1`; lag distances use actual years, including gaps. The covariance uses the `n/(n-2)` correction. Two-sided p-values and 95% intervals use `jstat` Student-t with `n-2` degrees of freedom, a finite-sample approximation to HAC inference. Zero-variance series have p=1 for zero slope, p=0 for nonzero slope.
- Location comparisons use only complete common years for BOTH regressions and the same coverage denominator. Two-period comparisons retain each period's own observations. Slope and mean differences are second minus first, descriptive only; they have no invented difference p-value. Overlapping periods receive a warning.
- Anomalies use only 1991–2020, independently from the requested analysis period. All 30 complete baseline years are required; an incomplete baseline leaves anomalies null and discloses the available baseline count. Trend inference remains possible without a complete baseline.
- Numerical narratives are deterministic templates based solely on calculated statistics. A second named Genkit flow, `explainResults`, receives only calculated qualitative categories and may append a brief English explanation. It receives no numerical results or user location labels. Numerical output, empty/oversized text, model errors or a 30-second deadline retain the complete deterministic template as fallback. The first flow is named `interpretQuery`. Statistical significance does not imply causality or climate attribution. No live-weather observation enters the historical series.

## Optional Meteomatics

Historical trends and current weather use **Meteomatics** through separate provider requests. Current weather requests `t_2m:C` and `precip_1h:mm`; those values are not used in trend analysis. Missing credentials, disabled current weather or provider failure produce an explicit unavailable status. Each historical series uses a single provider and is never spliced with another source.

The chat has a separate Meteomatics REST workflow. Its catalog is a versioned snapshot of the official alphabetical parameter list and must be refreshed when Meteomatics updates that list. It covers standard point/time-series, grid, station, route, polygon and trajectory queries; specialized WMS/WFS/alerts/imagery endpoints are outside this integration. The user sees parameter selection and a request preview, source-specific availability is checked with `get_time_range`, and explicit confirmation is required before execution. Larger standard calls use POST; trajectories use Meteomatics' trajectory POST endpoint. Results remain raw provider values with request, time, source and attribution; they are not transformed into trend analysis. Account credentials, source entitlements, parameter support and temporal coverage determine whether a given call succeeds. Station data require `mix-obs` and may need an entitled account.

The chat also has a NASA Giovanni workflow with the same steps: `getGiovanniCatalog` returns the curated variables in `shared/giovanni-catalog.constant.ts`, `interpretGiovanni` (Gemini, quota `interpretQuery`) proposes one to five catalog variables, a geocoded point and a UTC date range, and `executeGiovanniQuery` (requires `confirmed: true`, quota `giovanniExecute`, Earthdata secrets) calls the Giovanni time series service once per variable. Results are raw provider values in the Meteomatics JSON envelope with the unit Giovanni reports; fill values become null. Chart trends average complete months/years and infer only above the POC coverage threshold. Whether Giovanni serves a catalog ID is decided by the service; a refusal is reported as unavailable. Results are never fed into trend analysis.

For local development, the ignored `functions/.env.local` can contain `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD`; `npm run dev` loads that file. Never upload a local credential file as a production environment file.

In production the credentials are secret environment variables of the Render services: `METEOMATICS_USERNAME`, `METEOMATICS_PASSWORD`, `EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD` and `DATABASE_URL` (`sync: false` in `render.yaml`, so their values never live in the repo). Changing one restarts the service.

Historical trend retrieval fetches daily aggregates one year per request and converts only complete months into the analysis series. An eligible historical-data subscription is required; coverage varies by account and source, and a slow analysis that outlives its lease is retried.

## Caching, configuration and checks

`serverCache` stores provider data (default TTL 24 hours), geocoding (7 days) and current weather (15 minutes). Cache keys include coordinates, requested range, parameter/provider version, or query/count as appropriate. The original retrieval timestamp is preserved on cache hits. Reads enforce expiry even without Firestore TTL cleanup. Optional Firestore TTL policies on `serverCache.expiresAt` and `quotas.expiresAt` reclaim storage; expired entries do not bypass quotas. Cache failures do not prevent analysis. Cache documents must remain server-only.

Copy configuration names from `.env.example`, with production values owned by the parent. Defaults: project `earth-trend-detective`, Vertex location `global`, configurable model `gemini-3.8-flash`. Vertex uses Application Default Credentials; no Gemini API key is needed. Set model and location together for supported regional/global models.

To exercise the server locally without production data, start `firebase emulators:start --only auth,firestore` and run it with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`; no Google credentials are needed then, but Gemini calls report unavailable.

Run `npm run build`, `npm run typecheck`, and `npm test`. Tests use the built-in Node test runner, not Vitest, and mocked external APIs. They do not contact production or deploy infrastructure. Live Vertex/provider checks and deployed Auth/App Check/Firestore IAM verification belong to the parent's environment.

Provider references: [Genkit Vertex integration](https://genkit.dev/docs/js/integrations/vertex-ai/), [Render Blueprints](https://render.com/docs/blueprint-spec), [Meteomatics API](https://www.meteomatics.com/en/api/getting-started/), [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api).
