# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Required context

- Follow [`AGENTS.md`](AGENTS.md) for every request, and load [`.agents/skills/earth-system-trend-detective/SKILL.md`](.agents/skills/earth-system-trend-detective/SKILL.md) before working. The skill holds the NASA Space Apps challenge brief, the agreed POC scope, and the scientific invariants (thresholds, units, outcomes) that code changes must preserve.
- Do not add or run tests unless the user asks; use a build/type-check when it helps verify a change.
- The product UI, generated text, errors, and CSV headings are English. The user may write in Spanish; reply in the language of their message.
- Deployment changes the public site: only deploy when the current request authorizes it.

## Commands

Node 22 and the Firebase CLI are required. Install with `npm install` and `npm --prefix functions install`.

Frontend (repo root, Vite + Vitest):
- `npm run dev` — dev server on port 5173 (uses `.env.local`, copied from `.env.example`; `VITE_API_BASE_URL` points at the backend; set `VITE_USE_FIREBASE_EMULATORS=true` to sign in against the local Auth emulator)
- `npm run typecheck` / `npm run build` (build = `tsc --noEmit` + `vite build` into `dist/`)
- `npm test` — Vitest over `src`; single file: `npx vitest run src/analysis/resolver.test.ts`

Backend (`functions/`, an Express server deployed on Render; Node built-in test runner, not Vitest):
- `npm --prefix functions run dev` — builds and starts the server on port 8787 with the ignored `functions/.env.local`; `npm --prefix functions start` runs the built server; `npm --prefix functions run ingest` runs one Balam ingestion
- `npm --prefix functions run build` / `npm --prefix functions run typecheck`
- `npm --prefix functions test` — compiles via `tsconfig.test.json` into `.test-lib/` then runs `node --test`; single file: `npm --prefix functions exec tsc -- -p tsconfig.test.json` then `node --test functions/.test-lib/functions/test/statistics.test.js`
- `npm --prefix functions run check` — typecheck + tests

Firebase (project `earth-trend-detective`: Hosting, Auth and Firestore only — there are no Cloud Functions):
- Emulators (auth 9099, firestore 8080, hosting 5000): `firebase emulators:start`. Run the server against them with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`. Local provider credentials go in ignored `functions/.env.local`.
- Preview: `firebase hosting:channel:deploy preview --expires 7d --project earth-trend-detective`
- Web deploy (Hosting, Firestore rules and indexes): `firebase deploy --project earth-trend-detective`, built with `VITE_API_BASE_URL` set to the Render service URL
- Backend deploy: Render applies `render.yaml` (web service `earth-trends-api` and hourly cron job `earth-trends-ingest`). Provider credentials and `DATABASE_URL` are secret environment variables there; the Google service account key is a Render secret file
- Inspect Giovanni data mapped to the Meteomatics/ClimateSeries shape: `node scripts/giovanni-to-meteomatics.mjs --metric temperature --lat <lat> --lon <lon>`

## Architecture

Three TypeScript roots share one contract:

- `shared/` — `types.ts` is the public frontend/backend contract (callable request/response shapes, analysis spec and result types). `meteomatics-catalog.constant.ts` is a versioned snapshot of Meteomatics' official parameter list (refresh when Meteomatics updates it). Both `tsconfig.json` (frontend) and `functions/tsconfig.json` include `shared/`; the frontend imports these with `import type`. Change a callable's shape here first.
- `src/` — React 19 + MUI 7 + Recharts + Leaflet SPA. `services/firebase.ts` initializes Firebase Auth (Google sign-in) and wraps `fetch`: every backend interaction is `POST <VITE_API_BASE_URL>/api/<name>` with the user's ID token, never direct Firestore writes. Failures surface as `FirebaseError` with `functions/<code>`. `analysis/useAnalysis.ts` and `analysis/useSessions.ts` hold client state flows (submit → poll `getAnalysis` with backoff; chat sessions); `analysis/resolver.ts` and `meteomatics-query.resolver.ts` are pure transform logic. Components are thin MUI views.
- `functions/src/` — Express server on Node 22 (`server.ts` is the entry point; it serves every `onCall` export of `index.ts` as `POST /api/<name>`, mounts the Balam API under `/balam` and starts the analysis worker). `auth.ts` verifies the ID token and optional App Check; `http.ts` holds `HttpsError`. `index.ts` defines every callable and wires dependencies (`FirestoreCache`, `AnalysisRepository`, `SessionRepository`, `AnalysisService`, providers). Each callable follows the same pipeline: `requireOwner` → `parseInput` (Zod schemas in `validation.ts`, 20 KB cap) → `consumeQuota` (`quota.ts`, per-user + global transactional budgets) → service call. Config comes from env via `config.constant.ts`.

Separate user workflows:

1. **Historical trend analysis** — `interpretQuery` (Genkit/Gemini parses intent; geocoding via Open-Meteo in `providers/locations.ts`; Gemini never supplies coordinates or numbers) → `createAnalysis` (idempotent on `requestId`; atomically reserves quota and writes `analyses/{id}` + `analysisJobs/{id}`) → `processAnalysis`, run by the in-process `AnalysisWorker` (`analysis-worker.ts`: started on creation, plus a periodic sweep of queued jobs and expired leases; lease-fenced, retries) → `AnalysisService` (`analysis.ts`) fetches Meteomatics daily aggregates (`providers/meteomatics.ts`) or, when `spec.dataSource === 'giovanni'`, NASA Giovanni MERRA-2 monthly means (`providers/giovanni.ts`), builds complete monthly/annual series, runs OLS + Newey–West in `statistics.ts`, writes the result. `ai.ts` `explainResults` may append prose from qualitative categories only, with a deterministic template fallback.
2. **Meteomatics REST chat** — `getMeteomaticsCatalog` / `interpretMeteomatics` → `checkMeteomaticsAvailability` → `executeMeteomaticsQuery` (requires `confirmed: true`) via `providers/meteomatics-query.ts`. Results stay raw provider values with provenance and are never fed into trend analysis. Chat sessions persist through the session callables (`sessions.ts`).

3. **NASA Giovanni chat** — same flow as the Meteomatics chat: `getGiovanniCatalog` / `interpretGiovanni` → `executeGiovanniQuery` (requires `confirmed: true`) via `providers/giovanni-query.ts`. Results are raw Giovanni point time series in the Meteomatics JSON envelope (`parameter` = `<giovanni id>:<unit>`) so `MeteomaticsResponse`/`MeteomaticsChart` render them; chart trends come from `giovanni-chart.resolver.ts`. Sessions share the Meteomatics session storage, tagged `workflow: 'giovanni'`.
4. **NASA Earthdata chat** — same chat flow over the Balam store: `getEarthdataCatalog` / `interpretEarthdata` → `executeEarthdataQuery` (requires `confirmed: true`) via `providers/earthdata-query.ts`. A query never waits for NASA: it reads the AppEEARS zonal series that the hourly `balamIngest` cron job (`scripts/run-ingest.ts`) preloads into PostgreSQL, and when a variable is missing or far behind the requested period it asks the ingestion to request it and reports that (`functions/src/datasources/README.md`), one series per variable and department of Honduras, in the Meteomatics JSON envelope. Named places are geocoded and matched to a department polygon server-side. An empty store or period is an explicit error, never an empty result.

Current weather (`providers/current-weather.ts`) is a third independent provider path and is never mixed into historical series.

Firestore: `analyses` is owner-read-only from clients; `analysisJobs`, `quotas`, `serverCache` are server-only (`firestore.rules`). `cache.ts` stores provider/geocoding/current-weather responses with TTLs enforced on read.

## Conventions

- Types go in `*.types.ts` (or `shared/types.ts` for the contract), constants in `*.constant.ts`, pure transforms in `*.resolver.ts`, styles in `*.styles.ts`/`*.styles.css`. Check existing ones before adding new.
- Analysis outcomes are distinct and must stay so: `queued`, `processing`, `completed`, `insufficient_data`, `source_unavailable`, `failed`. Provider failure or missing credentials must surface as `source_unavailable`, never as "no trend" and never with a substitute provider.
- Do not weaken App Check, owner checks, quotas, validation, or the single-instance setting in `render.yaml` to make something work. Provider credentials live only in the backend's secret environment variables / ignored local files — never in `VITE_*` variables.
- `functions/README.md` documents the callable contract, quota defaults, job/lease semantics, and statistical method in detail; read it before changing backend behavior.
