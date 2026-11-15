import { defineConfig } from 'prisma/config';

// The Prisma CLI does not load .env files. Local values live in the ignored functions/.env.local.
try {
  process.loadEnvFile('.env.local');
} catch {
  // No local env file: `prisma generate` and `prisma validate` work without a database URL.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations need the direct connection; the runtime uses the pooled DATABASE_URL (src/db/client.ts).
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
});
