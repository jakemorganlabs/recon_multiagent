import { describe, it, expect } from 'vitest';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('Database migrations', () => {
  it('connects and has the expected tables', async () => {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();

    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tables = result.rows.map((r) => r.table_name);
    for (const name of ['run', 'brief', 'evidence', 'signal', 'tool_call', 'dossier', 'audit', 'dead_letter', 'migrations']) {
      expect(tables).toContain(name);
    }

    await client.end();
  });
});
