# Earth Trend Detective backend

TypeScript / Node 22, Firebase Functions v2, Firestore queue, Genkit with Vertex AI. Deployment belongs to the parent project; no deployment is performed by this package.

## Contract

`../shared/types.ts` is the public frontend contract. `npm run build` emits `lib/functions/src/index.js` and `lib/shared/types.js` / `.d.ts`; Firebase packages the complete runtime inside `functions/`. The frontend imports source types with `import type`.

All callables require Firebase Authentication. `ENFORCE_APP_CHECK` defaults **true in production** and false only in the Functions emulator. Invalid boolean values fail function discovery rather than silently disabling enforcement. Set `ENFORCE_APP_CHECK=true` in the production project environment and register App Check on clients before requests.

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

`createAnalysis` atomically reserves quota and creates `analyses/{id}` and `analysisJobs/{id}`. `processAnalysis` listens with `onDocumentCreated`, enabled event retries, a 540-second timeout and a 600-second lease. Transactional lease tokens fence duplicate/stale workers. A busy duplicate throws so delivery is retried rather than losing work. Expired leases are reclaimable. Unexpected processing errors release the lease and retry up to three processing attempts. Scientific source/quality failures are terminal reportable outcomes rather than internal exceptions.

Analysis states: `queued`, `processing`, `completed`, `insufficient_data`, `source_unavailable`, `failed`. `result.outcome` is `sufficient_data`, `insufficient_data` or `source_unavailable`. Scientific outcomes contain available descriptive data, quality warnings and `trend: null` when inference is invalid. `failed` is reserved for exhausted unexpected failures. The client may poll `getAnalysis` until any terminal state; use backoff to respect read quotas.

The parent must deploy Firestore rules denying all client access to `analysisJobs`, `quotas` and `serverCache`, and all writes to `analyses`. Owner-only analysis reads may be allowed; callable reads also check owner identity and return not-found for other users. Admin code uses the runtime identity, never trusts an owner ID in request input. The default Gen2 compute runtime identity needs Firestore access, Vertex AI User and access to the optional secrets. No service account credentials belong in the repo.

Per-user transactional quotas default to **10 new analyses per UTC hour**; interpretation 20, search 100 and reads 1000 per UTC day. Global UTC daily budgets are independent: **100 new analyses**, 200 interpretations and 2000 searches. Search and interpretation never spend the analysis budget; reads are excluded from global budgets. Cache hits still consume their respective endpoint budget. Idempotent creation retries consume no quota. Configure the `QUOTA_*` environment settings before deployment. Input validation caps callable JSON at 20 KB before Zod walks arrays. `MAX_INSTANCES` defaults to 2 per function; worker concurrency is 2.

## Data and inference

- Meteomatics historical daily aggregates: `t_mean_2m_24h:C` and `precip_24h:mm`, converted into complete monthly values. Historical access, source coverage and entitlement depend on the configured account. Missing credentials or provider failure return an explicit source-unavailable result.
- Temperature annual means are weighted by calendar days. Precipitation rates multiply actual month lengths, including leap February, then sum to annual mm. **Public monthly precipitation is mm/month**, public annual precipitation is mm/year. Internal provider months remain mm/day.
- An annual observation requires 12 distinct valid months. Trend inference needs at least 10 complete years and at least 80% of requested calendar years; no imputation or interpolation. Excluded years are listed.
- OLS uses actual calendar years. A Bartlett Newey–West HAC covariance accounts for heteroskedasticity and residual autocorrelation. Bandwidth is `floor(4*(n/100)^(2/9))`, capped at `n-1`; lag distances use actual years, including gaps. The covariance uses the `n/(n-2)` correction. Two-sided p-values and 95% intervals use `jstat` Student-t with `n-2` degrees of freedom, a finite-sample approximation to HAC inference. Zero-variance series have p=1 for zero slope, p=0 for nonzero slope.
- Location comparisons use only complete common years for BOTH regressions and the same coverage denominator. Two-period comparisons retain each period's own observations. Slope and mean differences are second minus first, descriptive only; they have no invented difference p-value. Overlapping periods receive a warning.
- Anomalies use only 1991–2020, independently from the requested analysis period. All 30 complete baseline years are required; an incomplete baseline leaves anomalies null and discloses the available baseline count. Trend inference remains possible without a complete baseline.
- Numerical narratives are deterministic templates based solely on calculated statistics. A second named Genkit flow, `explainResults`, receives only calculated qualitative categories and may append a brief English explanation. It receives no numerical results or user location labels. Numerical output, empty/oversized text, model errors or a 30-second deadline retain the complete deterministic template as fallback. The first flow is named `interpretQuery`. Statistical significance does not imply causality or climate attribution. No live-weather observation enters the historical series.

## Optional Meteomatics

Historical trends and current weather use **Meteomatics** through separate provider requests. Current weather requests `t_2m:C` and `precip_1h:mm`; those values are not used in trend analysis. Missing credentials, disabled current weather or provider failure produce an explicit unavailable status. Each historical series uses a single provider and is never spliced with another source.

The chat has a separate Meteomatics REST workflow. Its catalog is a versioned snapshot of the official alphabetical parameter list and must be refreshed when Meteomatics updates that list. It covers standard point/time-series, grid, station, route, polygon and trajectory queries; specialized WMS/WFS/alerts/imagery endpoints are outside this integration. The user sees parameter selection and a request preview, source-specific availability is checked with `get_time_range`, and explicit confirmation is required before execution. Larger standard calls use POST; trajectories use Meteomatics' trajectory POST endpoint. Results remain raw provider values with request, time, source and attribution; they are not transformed into trend analysis. Account credentials, source entitlements, parameter support and temporal coverage determine whether a given call succeeds. Station data require `mix-obs` and may need an entitled account.

For local development, the ignored `functions/.env.local` can contain `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD`; the emulator defaults to `METEOMATICS_USE_SECRET_MANAGER=false`. Never upload a local credential file as a production environment file.

For production, create Secret Manager secrets using Firebase CLI `functions:secrets:set METEOMATICS_USERNAME` and `functions:secrets:set METEOMATICS_PASSWORD`. Secret Manager is the production default. `processAnalysis`, `checkMeteomaticsAvailability` and `executeMeteomaticsQuery` bind these secrets. Updating secret versions requires redeploying the bound functions. Emulator Secret Manager overrides belong in ignored `.secret.local`.

Historical trend retrieval fetches daily aggregates one year per request and converts only complete months into the analysis series. An eligible historical-data subscription is required; coverage varies by account and source, and slow requests can approach the worker time limit.

## Caching, configuration and checks

`serverCache` stores provider data (default TTL 24 hours), geocoding (7 days) and current weather (15 minutes). Cache keys include coordinates, requested range, parameter/provider version, or query/count as appropriate. The original retrieval timestamp is preserved on cache hits. Reads enforce expiry even without Firestore TTL cleanup. Optional Firestore TTL policies on `serverCache.expiresAt` and `quotas.expiresAt` reclaim storage; expired entries do not bypass quotas. Cache failures do not prevent analysis. Cache documents must remain server-only.

Copy configuration names from `.env.example`, with production values owned by the parent. Defaults: project `earth-trend-detective`, function region `us-central1`, Vertex location `global`, configurable model `gemini-3.8-flash`. Vertex uses Application Default Credentials; no Gemini API key is needed. Set model and location together for supported regional/global models.

Run `npm run build`, `npm run typecheck`, and `npm test`. Tests use the built-in Node test runner, not Vitest, and mocked external APIs. They do not contact production or deploy infrastructure. Live Vertex/provider checks and deployed Auth/App Check/Firestore IAM verification belong to the parent's environment.

Provider references: [Genkit Vertex integration](https://genkit.dev/docs/js/integrations/vertex-ai/), [Firebase Firestore event semantics](https://firebase.google.com/docs/functions/firestore-events), [Meteomatics API](https://www.meteomatics.com/en/api/getting-started/), [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api).
