/**
 * Migration runner
 * Reads .sql files from ./migrations, applies them in order.
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

async function migrate(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = await readdir(resolve(__dirname, '../migrations'));
  const sqlFiles = files
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const file of sqlFiles) {
    const alreadyApplied = await client.query(
      'SELECT 1 FROM migrations WHERE filename = $1',
      [file]
    );
    if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
      console.log(`  skip ${file}`);
      continue;
    }

    const sql = await readFile(resolve(__dirname, '../migrations', file), 'utf8');
    await client.query(sql);
    await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
    console.log(`  apply ${file}`);
  }

  await client.end();
  console.log('Migrations complete.');
}

migrate().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
