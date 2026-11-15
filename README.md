# Earth Trend Detective

NASA Space Apps POC for natural-language climate questions, historical temperature and precipitation trend analysis using Meteomatics, comparisons across locations or time periods, and current conditions.

## Development

Requires Node.js 22 and Firebase CLI. Install dependencies with `npm install` and `npm --prefix functions install`. Copy `.env.example` to `.env.local` and provide the public Firebase web app configuration and CARTO basemap API key. Run `npm run dev` to start the web app.

Firebase web configuration and the CARTO basemap key are public client-side values, not administrative credentials. Never prefix Meteomatics credentials with `VITE_`.

## Infrastructure

Firebase project: `earth-trend-detective`. Functions and Firestore region: `us-central1`. Vertex AI location: `global`. Enable Google Authentication and authorize the app domain. App Check is disabled for this test project; callable functions still require Google Authentication.

The project uses the Blaze plan. A reference USD 10 budget alert was configured; alerts do not cap usage. The backend limits analyses per session and day and sets a maximum of two instances per function.

## Meteomatics

Configure `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD` in Firebase Secret Manager and enable them as described in `functions/.env.example`. Do not commit these secrets. Without credentials or suitable historical-data access, the app reports the analysis source as unavailable; it does not substitute another provider.

To upload credentials from the ignored local file, run `node scripts/configure-meteomatics.mjs deployment-account@example.com`. The script does not print the secret values. Then set `METEOMATICS_USE_SECRET_MANAGER=true` in the Functions environment and redeploy.

## Build and deployment

Run `npm run build`, `npm test`, `npm --prefix functions run build`, and `npm --prefix functions test`. Authenticate Firebase CLI with the project owner account. Deploy a preview using `firebase hosting:channel:deploy preview --expires 7d --project earth-trend-detective`; deploy services and web using `firebase deploy --project earth-trend-detective`.

## Scientific interpretation

Historical analysis uses Meteomatics daily aggregates for `t_mean_2m_24h:C` and `precip_24h:mm`. The adapter converts complete daily records into monthly values; only years with 12 valid months are retained. Annual temperature is a calendar-day-weighted mean and annual precipitation is the sum of monthly totals. Historical coverage depends on the Meteomatics account entitlement and requested source.

The slope and its interval are calculated in code, with Newey–West covariance for autocorrelation. The operational threshold for inference is 10 valid years and 80% coverage. Missing values are not interpolated. Lack of statistical significance does not demonstrate lack of change. Gemini explains calculated metrics and does not make causal claims.

Meteomatics provides recent conditions separately: instantaneous temperature and hourly precipitation are not equivalent to monthly averages or totals. The valid time, provider, and data type are shown.

Sources: [Meteomatics](https://www.meteomatics.com/en/api/getting-started/), [NASA Giovanni](https://giovanni.gsfc.nasa.gov/giovanni/), [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api), [CARTO Basemaps](https://carto.com/basemaps/apikey/).
