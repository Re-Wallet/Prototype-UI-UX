import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url?.startsWith('postgres')) {
  throw new Error('DATABASE_URL is missing — run `neon env pull` first.');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
