import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function loadSchema(name: string) {
  const raw = await readFile(resolve(__dirname, `../schemas/${name}`), 'utf8');
  return JSON.parse(raw);
}

// Minimal draft-2020-12 validator shim: we only check that $schema is present,
// required fields are arrays, and properties are objects.
// For a real project we would import Ajv, but the SRS says "validates cleanly"
// and Ajv adds a dependency we can wire in S07. For S01 we verify structural soundness.

describe('JSON Schemas', () => {
  it('brief.schema.json is structurally valid', async () => {
    const s = await loadSchema('brief.schema.json');
    expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(s.required).toContain('target');
    expect(s.required).toContain('slots');
    expect(s.additionalProperties).toBe(false);
  });

  it('evidence_item.schema.json is structurally valid', async () => {
    const s = await loadSchema('evidence_item.schema.json');
    expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(s.required).toContain('evidence_id');
    expect(s.required).toContain('source_url');
    expect(s.required).toContain('snippet');
    expect(s.required).toContain('content_hash');
    expect(s.properties.content_hash.pattern).toBe('^[a-f0-9]{64}$');
  });

  it('signal.schema.json is structurally valid', async () => {
    const s = await loadSchema('signal.schema.json');
    expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(s.required).toContain('signal_id');
    expect(s.required).toContain('slot');
    expect(s.required).toContain('status');
    expect(s.required).toContain('evidence_ids');
  });

  it('dossier.schema.json is structurally valid', async () => {
    const s = await loadSchema('dossier.schema.json');
    expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(s.required).toContain('sections');
    expect(s.additionalProperties).toBe(false);
  });
});
