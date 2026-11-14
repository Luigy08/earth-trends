# Earth Trend Detective

NASA Space Apps POC for natural-language climate questions, NASA POWER temperature and precipitation analysis, comparisons across locations or time periods, and current conditions from Meteomatics.

## Development

Requires Node.js 22 and Firebase CLI. Install dependencies with `npm install` and `npm --prefix functions install`. Copy `.env.example` to `.env.local` and provide the public Firebase web app configuration, reCAPTCHA Enterprise site key, and CARTO basemap API key. Run `npm run dev` to start the web app.

Firebase web configuration and the CARTO basemap key are public client-side values, not administrative credentials. Never prefix Meteomatics credentials with `VITE_`.

## Infrastructure

Firebase project: `earth-trend-detective`. Functions and Firestore region: `us-central1`. Vertex AI location: `global`. Enable anonymous Authentication and register the app in App Check with reCAPTCHA Enterprise for each Hosting domain. Production Functions enforce App Check.

The project uses the Blaze plan. A reference USD 10 budget alert was configured; alerts do not cap usage. The backend limits analyses per session and day and sets a maximum of two instances per function.

## Meteomatics

Configure `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD` in Firebase Secret Manager and enable them as described in `functions/.env.example`. Do not commit these secrets. Without credentials, the app reports current conditions as unavailable and retains the NASA historical analysis.

To upload credentials from the ignored local file, run `node scripts/configure-meteomatics.mjs deployment-account@example.com`. The script does not print the secret values. Then set `METEOMATICS_USE_SECRET_MANAGER=true` in the Functions environment and redeploy.

## Build and deployment

Run `npm run build`, `npm test`, `npm --prefix functions run build`, and `npm --prefix functions test`. Authenticate Firebase CLI with the project owner account. Deploy a preview using `firebase hosting:channel:deploy preview --expires 7d --project earth-trend-detective`; deploy services and web using `firebase deploy --project earth-trend-detective`. App Check must also allow the exact preview domain when using backend callables there.

## Scientific interpretation

NASA POWER queries a grid cell at the city's coordinates, not a municipal average. Only years with 12 valid months are retained; annual temperature is a mean and annual precipitation is a total. Parameter names and units are checked when responses arrive; monthly precipitation rates in mm/day are converted using the actual number of days in each month.

The slope and its interval are calculated in code, with Newey–West covariance for autocorrelation. The operational threshold for inference is 10 valid years and 80% coverage. Missing values are not interpolated. Lack of statistical significance does not demonstrate lack of change. Gemini explains calculated metrics and does not make causal claims.

Meteomatics provides recent conditions separately: instantaneous temperature and hourly precipitation are not equivalent to monthly averages or totals. The valid time, provider, and data type are shown.

Sources: [NASA POWER](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/), [Giovanni](https://giovanni.gsfc.nasa.gov/giovanni/), [Meteomatics](https://www.meteomatics.com/en/api/getting-started/), [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api), [CARTO Basemaps](https://carto.com/basemaps/apikey/).
