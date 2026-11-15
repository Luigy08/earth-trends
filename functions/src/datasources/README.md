# Balam data sources

Multi-source layer for Earth Trend Detective. It keeps the Meteomatics query model, adds **NASA AppEEARS** as a second source, and preloads data per zone into **PostgreSQL** so the frontend reads from our own store instead of waiting for NASA (AppEEARS tasks take minutes to hours).

It runs beside the existing callables and never feeds them: the on-demand analysis (`createAnalysis` / `processAnalysis`) and the Meteomatics chat are unchanged, and values from different providers are never spliced into one series.

```
balamIngest (daily, 00:15 America/Tegucigalpa)
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
| `EARTHDATA_USER`, `EARTHDATA_PASS` | NASA Earthdata Login, for AppEEARS |
| `METEOMATICS_USERNAME`, `METEOMATICS_PASSWORD` | The existing Meteomatics secrets, reused |

```bash
npm --prefix functions install
npm --prefix functions run migrate:deploy     # applies prisma/migrations to DIRECT_URL (or DATABASE_URL)
npm --prefix functions run seed:zones         # 18 departments of Honduras; add `-- --dry-run` to only report
npm --prefix functions run sync:appeears      # refresh data/appeears-catalog.json, then commit it
npm --prefix functions run check              # prisma generate + type-check + tests
```

`build`, `typecheck` and `test` run `prisma generate` first; the generated client lives in `src/generated/` and is not committed.

Zones come from geoBoundaries (gbOpen, HND, ADM1, simplified), licensed under the **Open Data Commons Open Database License 1.0** with OpenStreetMap as the source: show the attribution wherever the boundaries are displayed. The seed simplifies the polygons (~500 m tolerance) so the whole collection fits comfortably in one AppEEARS request.

## Ingestion

Targets are in `src/ingest/targets.constant.ts`: the 18 departments × land surface temperature (MOD11A1), NDVI (MOD13Q1), evapotranspiration (MOD16A2GF), surface soil moisture (SPL4SMGP) and air temperature (Meteomatics `t_2m`).

- `plan()` — for each target without a request in flight: `start` = last stored date + 1 day (or the target's `since`), `end` = today. It submits **one block** (5 years by default) and records an `IngestionJob`. A range requested in the last 20 hours is not requested again, and nothing is requested before the product's cadence has passed.
- `process()` — polls the requests in flight. A finished one is upserted into `Observation` (`INSERT … ON CONFLICT DO UPDATE`), the job is marked `done`, and `Trend` is recomputed for the affected zones. It never waits for AppEEARS.
- Both are idempotent, so a failed or repeated run is safe. A source failure is stored as an `error` job with the provider message; it never becomes an empty series.

Conventions worth knowing:

- `Observation.date` is the product date for AppEEARS. For Meteomatics it is the **local Honduran date on which the 24-hour window starts**: the free plan only serves the last 24 h, so each run averages the 24 hourly values ending at the current hour (run at 00:15 local, that is 01:00 → 00:00). `count` is then the number of hourly samples, and a day with fewer than 18 valid hours has a null value.
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
2. Register it in `getRegistry()` (`src/balam/balam.functions.ts`). Its `id` becomes the parameter prefix. Add its secrets in `balam.constant.ts`.
3. Add its bindings to `catalog/canonical-variables.constant.ts`, after checking the dataset metadata (units, sign convention, temporal aggregation, fill values).
4. To preload it, add a target in `ingest/targets.constant.ts`; `plan()`/`process()` need no changes.

## Migrating and deploying

Nothing here deploys by itself. With the database created and the secrets at hand:

```bash
firebase functions:secrets:set DATABASE_URL --project earth-trend-detective      # pooled URL
firebase functions:secrets:set EARTHDATA_USER --project earth-trend-detective
firebase functions:secrets:set EARTHDATA_PASS --project earth-trend-detective
npm --prefix functions run migrate:deploy                                        # with DIRECT_URL in functions/.env.local
npm --prefix functions run seed:zones
firebase deploy --only functions --project earth-trend-detective
```

The three secrets must exist before any functions deploy, because the new functions bind them.

## Still to validate with real credentials

The adapters are tested against simulated responses that follow the official documentation, and the database layer against a local PostgreSQL. A first real run should confirm:

- Point CSV columns are `{PRODUCT}_{VERSION}_{LAYER}` (e.g. `MOD11A1_061_LST_Day_1km`).
- `*-Statistics.csv` has `Dataset`, `aid`, `Date`, `Mean`, `Minimum`, `Maximum`, `Median`, `Standard Deviation`, `Count`, and `aid000N` follows the feature order of the request.
- CSV values already have the scale factor applied.
- AppEEARS accepts the 18-feature collection and 5-year blocks, and whether SPL4SMGP statistics arrive daily or 3-hourly (both are handled).
- Whether the statistics exclude the MOD16A2GF special classes (32761–32767) as well as the fill value.
- The Meteomatics plan serves 24 hourly values for 18 points in one request.
- CORS in production: the emulator allows every origin by design.
