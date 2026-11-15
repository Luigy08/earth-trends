import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

let client: PrismaClient | undefined;

/**
 * One client per function instance, created on first use so that functions which never touch
 * PostgreSQL start without a database URL. Pass the pooled URL; the pool stays small because
 * every instance holds its own connections.
 */
export function getPrisma(connectionString: string | undefined, max = 2): PrismaClient {
  if (client) return client;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
