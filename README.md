# Earth Trend Detective

NASA Space Apps POC for natural-language climate questions, historical temperature and precipitation trend analysis using Meteomatics, comparisons across locations or time periods, and current conditions.

## Development

Requires Node.js 22 and Firebase CLI. Install dependencies with `npm install` and `npm --prefix functions install`. Copy `.env.example` to `.env.local` and provide the public Firebase web app configuration and CARTO basemap API key. Run `npm run dev` to start the web app and `npm --prefix functions run dev` to start the backend on port 8787 (`VITE_API_BASE_URL`).

Firebase web configuration and the CARTO basemap key are public client-side values, not administrative credentials. Never prefix Meteomatics credentials with `VITE_`.

## Infrastructure

Firebase project: `earth-trend-detective` (Hosting, Google Authentication, Firestore in `us-central1`). Vertex AI location: `global`. The backend is a single Node service on Render (`render.yaml`) that the web app calls at `VITE_API_BASE_URL`; there are no Cloud Functions. Enable Google Authentication and authorize the app domain. App Check is disabled for this test project; every endpoint still requires Google Authentication.

The project uses the Blaze plan. A reference USD 10 budget alert was configured; alerts do not cap usage. The backend limits analyses per session and day and runs as a single instance.

## Meteomatics

Configure `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD` as secret environment variables of the Render services (`functions/.env.example` lists every name). Do not commit these secrets. Without credentials or suitable historical-data access, the app reports the analysis source as unavailable; it does not substitute another provider.

## Build and deployment

Run `npm run build`, `npm test`, `npm --prefix functions run build`, and `npm --prefix functions test`. Authenticate Firebase CLI with the project owner account. Deploy a preview using `firebase hosting:channel:deploy preview --expires 7d --project earth-trend-detective`; deploy the web app, Firestore rules and indexes using `firebase deploy --project earth-trend-detective`. The backend deploys from `render.yaml` on Render; build the web app with `VITE_API_BASE_URL` set to that service's URL, and list every web origin (including a preview channel) in the service's `CORS_ORIGINS`.

## Scientific interpretation

Historical analysis uses Meteomatics daily aggregates for `t_mean_2m_24h:C` and `precip_24h:mm`. The adapter converts complete daily records into monthly values; only years with 12 valid months are retained. Annual temperature is a calendar-day-weighted mean and annual precipitation is the sum of monthly totals. Historical coverage depends on the Meteomatics account entitlement and requested source.

The slope and its interval are calculated in code, with Newey–West covariance for autocorrelation. The operational threshold for inference is 10 valid years and 80% coverage. Missing values are not interpolated. Lack of statistical significance does not demonstrate lack of change. Gemini explains calculated metrics and does not make causal claims.

Meteomatics provides recent conditions separately: instantaneous temperature and hourly precipitation are not equivalent to monthly averages or totals. The valid time, provider, and data type are shown.

Sources: [Meteomatics](https://www.meteomatics.com/en/api/getting-started/), [NASA Giovanni](https://giovanni.gsfc.nasa.gov/giovanni/), [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api), [CARTO Basemaps](https://carto.com/basemaps/apikey/).
