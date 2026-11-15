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
- `npm run dev` — dev server on port 5173 (uses `.env.local`, copied from `.env.example`; set `VITE_USE_FIREBASE_EMULATORS=true` to target local emulators)
- `npm run typecheck` / `npm run build` (build = `tsc --noEmit` + `vite build` into `dist/`)
- `npm test` — Vitest over `src`; single file: `npx vitest run src/analysis/resolver.test.ts`

Backend (`functions/`, Node built-in test runner, not Vitest):
- `npm --prefix functions run build` / `npm --prefix functions run typecheck`
- `npm --prefix functions test` — compiles via `tsconfig.test.json` into `.test-lib/` then runs `node --test`; single file: `npm --prefix functions exec tsc -- -p tsconfig.test.json` then `node --test functions/.test-lib/functions/test/statistics.test.js`
- `npm --prefix functions run check` — typecheck + tests

Firebase (project `earth-trend-detective`, region `us-central1`):
- Emulators (auth 9099, functions 5001, firestore 8080, hosting 5000): `firebase emulators:start`. Local Meteomatics credentials go in ignored `functions/.env.local` / `.secret.local`.
- Preview: `firebase hosting:channel:deploy preview --expires 7d --project earth-trend-detective`
- Full deploy: `firebase deploy --project earth-trend-detective` (functions predeploy runs the functions build)
- Upload Meteomatics secrets: `node scripts/configure-meteomatics.mjs <deployment-account-email>`; Earthdata (Giovanni) secrets: append `earthdata`
- Inspect Giovanni data mapped to the Meteomatics/ClimateSeries shape: `node scripts/giovanni-to-meteomatics.mjs --metric temperature --lat <lat> --lon <lon>`

## Architecture

Three TypeScript roots share one contract:

- `shared/` — `types.ts` is the public frontend/backend contract (callable request/response shapes, analysis spec and result types). `meteomatics-catalog.constant.ts` is a versioned snapshot of Meteomatics' official parameter list (refresh when Meteomatics updates it). Both `tsconfig.json` (frontend) and `functions/tsconfig.json` include `shared/`; the frontend imports these with `import type`. Change a callable's shape here first.
- `src/` — React 19 + MUI 7 + Recharts + Leaflet SPA. `services/firebase.ts` initializes anonymous Auth, App Check (reCAPTCHA Enterprise) and wraps `httpsCallable`; every backend interaction is a Firebase callable, never direct Firestore writes. `analysis/useAnalysis.ts` and `analysis/useSessions.ts` hold client state flows (submit → poll `getAnalysis` with backoff; chat sessions); `analysis/resolver.ts` and `meteomatics-query.resolver.ts` are pure transform logic. Components are thin MUI views.
- `functions/src/` — Firebase Functions v2. `index.ts` defines every callable and wires dependencies (`FirestoreCache`, `AnalysisRepository`, `SessionRepository`, `AnalysisService`, providers). Each callable follows the same pipeline: `requireOwner` → `parseInput` (Zod schemas in `validation.ts`, 20 KB cap) → `consumeQuota` (`quota.ts`, per-user + global transactional budgets) → service call. Config comes from env via `config.constant.ts`.

Separate user workflows:

1. **Historical trend analysis** — `interpretQuery` (Genkit/Gemini parses intent; geocoding via Open-Meteo in `providers/locations.ts`; Gemini never supplies coordinates or numbers) → `createAnalysis` (idempotent on `requestId`; atomically reserves quota and writes `analyses/{id}` + `analysisJobs/{id}`) → `processAnalysis` Firestore trigger (lease-fenced worker, retries) → `AnalysisService` (`analysis.ts`) fetches Meteomatics daily aggregates (`providers/meteomatics.ts`) or, when `spec.dataSource === 'giovanni'`, NASA Giovanni MERRA-2 monthly means (`providers/giovanni.ts`), builds complete monthly/annual series, runs OLS + Newey–West in `statistics.ts`, writes the result. `ai.ts` `explainResults` may append prose from qualitative categories only, with a deterministic template fallback.
2. **Meteomatics REST chat** — `getMeteomaticsCatalog` / `interpretMeteomatics` → `checkMeteomaticsAvailability` → `executeMeteomaticsQuery` (requires `confirmed: true`) via `providers/meteomatics-query.ts`. Results stay raw provider values with provenance and are never fed into trend analysis. Chat sessions persist through the session callables (`sessions.ts`).

3. **NASA Giovanni chat** — same flow as the Meteomatics chat: `getGiovanniCatalog` / `interpretGiovanni` → `executeGiovanniQuery` (requires `confirmed: true`) via `providers/giovanni-query.ts`. Results are raw Giovanni point time series in the Meteomatics JSON envelope (`parameter` = `<giovanni id>:<unit>`) so `MeteomaticsResponse`/`MeteomaticsChart` render them; chart trends come from `giovanni-chart.resolver.ts`. Sessions share the Meteomatics session storage, tagged `workflow: 'giovanni'`.
4. **NASA Earthdata chat** — same chat flow over the Balam store: `getEarthdataCatalog` / `interpretEarthdata` → `executeEarthdataQuery` (requires `confirmed: true`) via `providers/earthdata-query.ts`. A query never waits for NASA: it reads the AppEEARS zonal series that the hourly `balamIngest` preloads into PostgreSQL, and when a variable is missing or far behind the requested period it asks the ingestion to request it and reports that (`functions/src/datasources/README.md`), one series per variable and department of Honduras, in the Meteomatics JSON envelope. Named places are geocoded and matched to a department polygon server-side. An empty store or period is an explicit error, never an empty result.

Current weather (`providers/current-weather.ts`) is a third independent provider path and is never mixed into historical series.

Firestore: `analyses` is owner-read-only from clients; `analysisJobs`, `quotas`, `serverCache` are server-only (`firestore.rules`). `cache.ts` stores provider/geocoding/current-weather responses with TTLs enforced on read.

## Conventions

- Types go in `*.types.ts` (or `shared/types.ts` for the contract), constants in `*.constant.ts`, pure transforms in `*.resolver.ts`, styles in `*.styles.ts`/`*.styles.css`. Check existing ones before adding new.
- Analysis outcomes are distinct and must stay so: `queued`, `processing`, `completed`, `insufficient_data`, `source_unavailable`, `failed`. Provider failure or missing credentials must surface as `source_unavailable`, never as "no trend" and never with a substitute provider.
- Do not weaken App Check, owner checks, quotas, validation, or `MAX_INSTANCES` to make something work. Meteomatics credentials live only in Secret Manager / ignored local files — never in `VITE_*` variables.
- `functions/README.md` documents the callable contract, quota defaults, job/lease semantics, and statistical method in detail; read it before changing backend behavior.
