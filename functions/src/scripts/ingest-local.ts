/**
 * Runs the ingestion from this machine instead of the `balamIngest` Cloud Function: the same
 * `process()` then `plan()`, against the database and providers named in functions/.env.local.
 * Useful for the historical load, or whenever the function cannot run.
 *
 *   npm run ingest:local                                  # what the scheduled function does
 *   npm run ingest:local -- --process                     # only store what NASA has finished
 *   npm run ingest:local -- --backfill --variable ndvi    # request every missing block of one variable
 *   npm run ingest:local -- --backfill --force            # request again even if requested recently
 *   npm run ingest:local -- --watch 10                    # repeat every 10 minutes until nothing is pending
 *
 * functions/.env.local needs DATABASE_URL or DIRECT_URL, EARTHDATA_USERNAME and EARTHDATA_PASSWORD;
 * METEOMATICS_USERNAME and METEOMATICS_PASSWORD are optional (that target is skipped without them).
 */
import { loadAppeearsCatalog } from '../datasources/catalog/appeears-catalog';
import { DataSourceRegistry } from '../datasources/registry';
import { AppeearsSource } from '../datasources/sources/appeears';
import { MeteomaticsSource } from '../datasources/sources/meteomatics';
import { disconnectPrisma, getPrisma } from '../db/client';
import { PrismaBalamRepository } from '../db/prisma-balam-repository';
import { PrismaJobStore } from '../db/prisma-job-store';
import { IngestService } from '../ingest/service';
import { INGEST_TARGETS } from '../ingest/targets.constant';

const flag = (name: string) => process.argv.includes(`--${name}`);
const option = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

async function main() {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No local env file: the variables may already be in the environment.
  }
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set DIRECT_URL or DATABASE_URL in functions/.env.local.');
  if (!process.env.EARTHDATA_USERNAME || !process.env.EARTHDATA_PASSWORD) {
    throw new Error('Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD in functions/.env.local: NASA AppEEARS needs them.');
  }
  const variable = option('variable');
  if (variable && !INGEST_TARGETS.some((target) => target.variableId === variable)) {
    throw new Error(`"${variable}" is not an ingestion target. Targets: ${INGEST_TARGETS.map((target) => target.variableId).join(', ')}`);
  }
  const watchMinutes = Number(option('watch') ?? 0);
  const onlyProcess = flag('process');
  const onlyPlan = flag('plan');

  const prisma = getPrisma(url, 2);
  const repository = new PrismaBalamRepository(prisma);
  const registry = new DataSourceRegistry(new PrismaJobStore(prisma))
    .register(new MeteomaticsSource({ username: process.env.METEOMATICS_USERNAME ?? '', password: process.env.METEOMATICS_PASSWORD ?? '' }))
    .register(new AppeearsSource({ username: process.env.EARTHDATA_USERNAME, password: process.env.EARTHDATA_PASSWORD, catalog: loadAppeearsCatalog() }));
  const ingest = new IngestService(repository, registry);

  try {
    for (;;) {
      if (!onlyPlan) {
        const processed = await ingest.process();
        console.log(`Stored: ${processed.done.length} request(s), ${processed.done.reduce((sum, item) => sum + item.rows, 0)} rows · waiting on NASA: ${processed.waiting.length}`);
        for (const failure of processed.failed) console.log(`  failed ${failure.variableId}: ${failure.error.slice(0, 300)}`);
      }
      if (!onlyProcess) {
        const planned = await ingest.plan({ ...(variable ? { variableIds: [variable] } : {}), backfill: flag('backfill'), force: flag('force') });
        for (const job of planned.created) console.log(`  requested ${job.variableId} ${job.start} → ${job.end}: ${job.status}`);
        for (const skipped of planned.skipped) console.log(`  skipped ${skipped.variableId}: ${skipped.reason}`);
        if (planned.rows) console.log(`  stored at once: ${planned.rows} rows`);
      }
      const pending = (await repository.listActiveJobs()).length;
      console.log(`Requests still in progress: ${pending}`);
      if (!watchMinutes || !pending) break;
      await new Promise((resolve) => setTimeout(resolve, watchMinutes * 60_000));
    }
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
