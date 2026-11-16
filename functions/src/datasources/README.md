# Balam data sources

Multi-source layer for Earth Trend Detective. It keeps the Meteomatics query model, adds **NASA AppEEARS** as a second source, and preloads data per zone into **PostgreSQL** so the frontend reads from our own store instead of waiting for NASA (AppEEARS tasks take minutes to hours).

It runs beside the existing callables and never feeds them: the on-demand analysis (`createAnalysis` / `processAnalysis`) and the Meteomatics chat are unchanged, and values from different providers are never spliced into one series.

```
balamIngest (hourly, at :15)
  process()  poll requests in flight → Observation rows → Trend per zone
  plan()     submit the next missing range of every target
                    │
   DataSourceRegistry ── MeteomaticsSource (synchronous)
                    └── AppeearsSource    (asynchronous: task → bundle → CSV)
                    │
              PostgreSQL (Prisma): Zone, Observation, Trend, IngestionJob, QueryJob
                    │
balamApi (HTTP)  /variables /zones /series /trends /query
```

## Query model

```
/{time}/{parameters}/{location}/json

/2024-01-01T00:00:00Z--2024-12-31T00:00:00Z:P1D/t_2m:C,appeears/MOD11A1.061/LST_Day_1km:C/14.0723,-87.1921/json
                                                └ Meteomatics ┘└────────── AppEEARS ──────────┘
```

- A **parameter** is `source/name:unit`. Without a prefix it goes to Meteomatics.
- The **response** has the Meteomatics JSON shape (`data[].parameter`, `coordinates[].dates[].{date,value}`), plus optional `stats`.
- **Zones** (`Location` of kind `zones`) have no path syntax; they are built in code from the `Zone` table.
  - AppEEARS: one `area` task with one feature per zone, in order. In `*-Statistics.csv`, `aid000N` is taken as feature N (1-based).
  - Meteomatics: the zone centroids as a point list (`lat,lon+lat,lon`).
  - Both answer one series per zone, with `id` = zone id and `lat`/`lon` = centroid.

## Files

```
functions/
  prisma/schema.prisma, prisma/migrations/   Database schema and SQL migrations
  prisma.config.ts                            Prisma CLI config (reads .env.local; DIRECT_URL for migrations)
  data/appeears-catalog.json                  Committed catalog snapshot (units, fill values); `npm run sync:appeears`
  src/datasources/
    datasources.types.ts                      Unified model (query, response, job, catalog, zones)
    param-string.ts                           Parser/formatter of the Meteomatics-style syntax
    units.ts                                  Unit normalization and conversions (K→C, kg/m²/8day→mm/day…)
    registry.ts                               Source registry: split by source, poll, merge
    sources/meteomatics.ts, sources/appeears.ts
    catalog/                                  Canonical variables, AppEEARS catalog normalizer and loader
  src/db/                                     Prisma client (lazy singleton), PrismaJobStore, PrismaBalamRepository
  src/ingest/                                 targets, plan()/process() service, trends — no Firebase imports
  src/balam/                                  HTTP router, validation, secrets/config, function handlers
  src/scripts/                                sync-appeears-catalog, seed-zones
```

The new exports in `src/index.ts` are `balamIngest`, `balamApi` and `balamBackfill`.

## Setup

Local values go in the ignored `functions/.env.local` (see `.env.example`); production uses Secret Manager.

| Name | Used for |
|---|---|
| `DATABASE_URL` | **Pooled** PostgreSQL URL, used at runtime (with Prisma Postgres: the `pooled.db.prisma.io` host, not `prisma+postgres://accelerate…`) |
| `DIRECT_URL` | Direct URL, only for `prisma migrate` and `seed:zones`; never deployed |
| `EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD` | NASA Earthdata Login, shared with the Giovanni source. AppEEARS needs the username and password; `EARTHDATA_TOKEN` alone is not enough |
| `METEOMATICS_USERNAME`, `METEOMATICS_PASSWORD` | The existing Meteomatics secrets, reused |

```bash
npm --prefix functions install
npm --prefix functions run migrate:deploy     # applies prisma/migrations to DIRECT_URL (or DATABASE_URL)
npm --prefix functions run seed:zones         # 18 departments of Honduras; add `-- --dry-run` to only report
npm --prefix functions run sync:appeears      # refresh data/appeears-catalog.json, then commit it
npm --prefix functions run check              # prisma generate + type-check + tests
```

`build`, `typecheck` and `test` run `prisma generate` first; the generated client lives in `src/generated/` and is not committed.

Zones come from geoBoundaries (gbOpen, HND, ADM1, simplified), licensed under the **Open Data Commons Open Database License 1.0** with OpenStreetMap as the source: show the attribution wherever the boundaries are displayed. The seed stores the published simplified polygons as they are (about 240 KB for the 18 departments) and refuses any polygon with self-intersections: AppEEARS rejects a whole request when one feature is invalid, and simplifying further is what introduces them.

## Ingestion

Targets are in `src/ingest/targets.constant.ts`: the 18 departments × land surface temperature (MOD11A1), NDVI (MOD13Q1), evapotranspiration (MOD16A2GF), surface soil moisture (SPL4SMGP) and air temperature (Meteomatics `t_2m`).

- `plan()` — for each target without a request in flight: `start` = last stored date + 1 day (or the target's `since`), `end` = today. It submits **one block** (5 years by default; half a year for daily land surface temperature, because AppEEARS caps the number of files in an area request) and records an `IngestionJob`. A range requested in the last 20 hours is not requested again (one hour when the source rejected it), and nothing is requested before the product's cadence has passed. Lookups are scoped to the target's zones, so places stored on demand never affect the scheduled targets.
- `process()` — polls the requests in flight. A finished one is upserted into `Observation` (`INSERT … ON CONFLICT DO UPDATE`), the job is marked `done`, and `Trend` is recomputed for the affected zones. It never waits for AppEEARS.
- Both are idempotent, so a failed or repeated run is safe. A source failure is stored as an `error` job with the provider message; it never becomes an empty series.

Conventions worth knowing:

- `balamIngest` runs every hour (`BALAM_INGEST_SCHEDULE`), so a block NASA has finished is stored within the hour and the next one is requested right away; a range requested in the last 20 hours is still never requested twice.
- `Observation.date` is the product date for AppEEARS. For Meteomatics it is the **local Honduran date on which the 24-hour window starts**: the free plan only serves the last 24 h, so a run averages the 24 hourly values ending at the current hour. The 23:15 local run therefore stores the whole local day (00:00 → 23:00), and later runs skip a date that is already stored. `count` is then the number of hourly samples, and a day with fewer than 18 valid hours has a null value.
- Sources that answer several samples per day are averaged into one daily row (`median`/`std` stay null). A single sample per day keeps the area statistics from AppEEARS (`min`, `max`, `median`, `std`, pixel `count`).
- Missing values are stored as null and are never imputed.

### Trends (`src/ingest/trends.ts`)

Monthly means → annual means (calendar-day-weighted, only for years with 12 valid months) → OLS slope, Theil–Sen slope and Mann–Kendall (tie-corrected variance, continuity-corrected Z, two-sided p) on the annual means, all per decade. Slopes and test statistics are **null** unless there are at least 10 complete years covering 80 % of the observed period — the same operational thresholds as the on-demand analysis. Null means "cannot support inference", not "no trend". The thresholds are options of `computeTrend`.

## HTTP API (`balamApi`)

| Route | Notes |
|---|---|
| `GET /variables` | Canonical variables, their bindings, and what is preloaded with its stored coverage |
| `GET /zones` | Zones without geometry; `?geometry=1` adds it |
| `GET /series?variable=&zone=&from=&to=&source=` | Reads `Observation`. `zone` takes up to 20 comma-separated ids. One `data[]` entry per source |
| `GET /trends?variable=&zone=&source=` | Reads `Trend`; `zone` is optional. Adds `inferenceSupported` and `significant` (α = 0.05) |
| `POST /query` `{ "path": "/…" }` | On-demand query through the registry, for points that are not preloaded. `200` when finished, `202` otherwise |
| `GET /query/:id` | Status and result of an on-demand query |

The read routes are public and limited by CORS to the Hosting domains (`BALAM_CORS_ORIGINS` overrides the list). CORS is not access control, so `/query` also requires a Firebase ID token (`Authorization: Bearer …`, non-anonymous), App Check when `ENFORCE_APP_CHECK=true`, and consumes the existing `meteomaticsExecute` quota. A query is only visible to the user who submitted it. Errors are `{ "error": { "code", "message", "fields"? } }`.

## NASA Earthdata chat (frontend)

The "NASA Earthdata" query mode in the web app answers for **Honduras and Central America** (Honduras, Guatemala, El Salvador, Nicaragua, Costa Rica, Panama and Belize) through three callables, following the Giovanni chat pattern (owner check → validation → quota → service):

| Callable | Notes |
|---|---|
| `getEarthdataCatalog` | The AppEEARS variables and the places already stored (areas and points) |
| `interpretEarthdata` | Gemini maps the question to catalog variables, places and dates. Named places are geocoded on the server (Open-Meteo) and, when they are in the region, registered as point zones; a place outside it becomes a question and is never registered; explicit coordinates are accepted; a stored area is used only when the user names it |
| `executeEarthdataQuery` | Reads `Observation` (source `appeears`) and answers in the Meteomatics envelope, one entry per variable and place labeled `<variable> · <place> (<pixel or area mean>):<unit>` |

Two kinds of place share the `Zone` table:

- **Point** (`level: 'POINT'`, id like `PT-N14082-W087207`, coordinates rounded to ~110 m): any city, landmark or coordinate in the region. It is requested from AppEEARS as a point sample, in one request for the whole series, and answers with the product pixel at that location.
- **Area** (`level: 'ADM1'`): the seeded administrative polygons (today the 18 departments of Honduras), requested as area statistics in yearly blocks by the scheduled ingestion. Whole countries or regions that are not seeded cannot be averaged; the assistant offers places inside them instead.

The region is defined once, in `EARTHDATA_REGION` (`shared/earthdata-catalog.constant.ts`), and enforced by `inEarthdataRegion` when a place is interpreted, registered, listed and queried: the country must be one of the seven and the coordinates inside the bounds. Bare coordinates carry no country, so they are checked against the bounds alone and a point just across a border can pass.

A query never waits for NASA. When a series is not stored, or ends more than 60 days before the requested end, `executeEarthdataQuery` asks the ingestion for it (`planPlaces` for a point, `plan({ backfill: true })` for areas; both idempotent) and says what it did: the request fails with an explicit message when nothing is stored, or returns the stored part with `notices` when a series is incomplete. Requests for points that NASA has already finished are stored at the start of the next query for that place, so submitting again shows the data; area blocks are stored by the hourly `balamIngest`. Any signed-in user can start these requests; a series already in progress is never requested twice, and a request the source rejected can be retried after one hour.

Limits are in `shared/earthdata-catalog.constant.ts` (3 variables, 4 places, 60,000 values per request). Chart statistics come from `earthdata-chart.resolver.ts`: a month is the mean of its valid observations, years need 12 valid months, and the trend is OLS with Newey–West under the usual 10-year / 80 % thresholds. The Meteomatics-sourced air temperature is not offered here, because this mode is labeled as NASA data.

## Running the ingestion locally

`npm run ingest:local` runs the same `process()` then `plan()` as `balamIngest`, from this machine, against the database and providers named in `functions/.env.local` (`DIRECT_URL` or `DATABASE_URL`, `EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD`). Use it for the historical load or whenever the function cannot run:

```bash
npm --prefix functions run ingest:local -- --backfill --variable ndvi    # request every missing block of one variable
npm --prefix functions run ingest:local -- --process                     # only store what NASA has finished
npm --prefix functions run ingest:local -- --watch 10                    # repeat every 10 minutes until nothing is pending
```

`--force` requests a range again even if it was requested recently. The local run and the Cloud Function can coexist: both are idempotent.

## Running the historical backfill

`balamBackfill` is a callable that requires the custom claim `admin: true`. It runs `plan()` in backfill mode: **every** missing block is requested at once, and the daily `balamIngest` then stores them as they finish.

```ts
// Grant the claim once, with the Admin SDK and application-default credentials:
await getAuth().setCustomUserClaims(uid, { admin: true });

// Then, signed in as that user (the token must be refreshed after the claim is set):
await httpsCallable(functions, 'balamBackfill')({ variableId: 'ndvi' });                    // one target
await httpsCallable(functions, 'balamBackfill')({});                                         // all targets
await httpsCallable(functions, 'balamBackfill')({ variableId: 'ndvi', from: '2010-01-01', to: '2012-12-31', force: true }); // refill a gap
```

Prefer one variable at a time: all targets together mean about 30 AppEEARS area tasks. Without a backfill the daily run still advances one block per target per day. If a block ends in `error`, later blocks may already be stored, so `plan()` will not go back by itself: re-request that range with `from`/`to` and `force`.

## Adding a source

1. Implement `DataSource` (`submit` + `refresh`) in `sources/`, returning `ParameterSeries[]`. Handle the `zones` location (one series per zone, `id` = zone id) and report missing credentials or provider errors as an `error` job.
2. Register it in `getRegistry()` (`src/balam/balam.functions.ts`). Its `id` becomes the parameter prefix. Add its secrets in `balam.constant.ts`, reusing existing ones when the provider account is the same.
3. Add its bindings to `catalog/canonical-variables.constant.ts`, after checking the dataset metadata (units, sign convention, temporal aggregation, fill values).
4. To preload it, add a target in `ingest/targets.constant.ts`; `plan()`/`process()` need no changes.

## Migrating and deploying

Nothing here deploys by itself. With the database created and the secrets at hand:

```bash
firebase functions:secrets:set DATABASE_URL --project earth-trend-detective      # pooled URL
npm --prefix functions run migrate:deploy                                        # with DIRECT_URL in functions/.env.local
npm --prefix functions run seed:zones
firebase deploy --only functions --project earth-trend-detective
```

`DATABASE_URL` must exist before any functions deploy, because the new functions bind it; the Earthdata and Meteomatics secrets are the ones the project already has.

## Still to validate with real credentials

The adapters are tested against simulated responses that follow the official documentation, and the database layer against a local PostgreSQL. A first real run should confirm:

- Point CSV columns are `{PRODUCT}_{VERSION}_{LAYER}` (e.g. `MOD11A1_061_LST_Day_1km`).
- `*-Statistics.csv` has `Dataset`, `aid`, `Date`, `Mean`, `Minimum`, `Maximum`, `Median`, `Standard Deviation`, `Count`, and `aid000N` follows the feature order of the request.
- CSV values already have the scale factor applied.
- AppEEARS accepts the 18-feature collection and 5-year blocks, and whether SPL4SMGP statistics arrive daily or 3-hourly (both are handled).
- Whether the statistics exclude the MOD16A2GF special classes (32761–32767) as well as the fill value.
- The Meteomatics plan serves 24 hourly values for 18 points in one request.
- CORS in production: the emulator allows every origin by design.
