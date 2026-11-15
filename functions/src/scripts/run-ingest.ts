/**
 * One Balam ingestion run: stores what the sources have finished, then requests the next missing blocks.
 * Meant for an hourly cron job (render.yaml). Hourly, so a request NASA has finished is stored within the hour and
 * the next block goes out right away; the 23:15 run in Honduras stores the Meteomatics daily mean for the whole
 * local day. Planning is idempotent, so a failed run is simply picked up by the next one.
 *
 *   npm run ingest      # needs DATABASE_URL and the provider credentials in the environment or functions/.env.local
 */
import { runBalamIngest } from '../balam/balam.functions';
import { disconnectPrisma } from '../db/client';

runBalamIngest()
  .then(() => disconnectPrisma())
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
