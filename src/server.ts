/**
 * Standalone HTTP server for local development / testing.
 *
 * Wraps the handleRequest pipeline:
 *   POST /api/request → HMAC verify → idempotency → brief normalizer → response
 *
 * Run with: npx tsx src/server.ts
 * Or: node --import=tsx src/server.ts
 * Or after build: node dist/server.js
 */

import { createServer } from 'node:http';
import { handleRequest } from './handler.js';
import { closePool } from './db.js';

const PORT = Number(process.env.PORT ?? 5678);
const HMAC_SECRET = process.env.HMAC_SECRET ?? '';
const DEEPINFRA_BASE_URL = process.env.DEEPINFRA_BASE_URL ?? '';
const DEEPINFRA_API_KEY = process.env.DEEPINFRA_API_KEY ?? '';
const MODEL_NAME = process.env.MODEL_NAME ?? 'google/gemma-4-26B-A4B-it';

if (!HMAC_SECRET) {
  console.error('HMAC_SECRET is required');
  process.exit(1);
}

if (!DEEPINFRA_BASE_URL || !DEEPINFRA_API_KEY) {
  console.error('DEEPINFRA_BASE_URL and DEEPINFRA_API_KEY are required');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  // CORS headers for local testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'method_not_allowed' }));
    return;
  }

  // Collect body
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const result = await handleRequest({
        hmacSecret: HMAC_SECRET,
        method: req.method ?? 'POST',
        path: req.url ?? '/',
        body,
        authorization: req.headers.authorization ?? '',
        normalizerOpts: {
          baseUrl: DEEPINFRA_BASE_URL,
          apiKey: DEEPINFRA_API_KEY,
          model: MODEL_NAME,
          temperature: 0,
          maxTokens: 2048,
        },
      });
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'failed', reason: errorMsg }));
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await closePool();
  server.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down...');
  await closePool();
  server.close(() => process.exit(0));
});

server.listen(PORT, () => {
  console.log(`Recon S02 server listening on port ${PORT}`);
  console.log(`Model: ${MODEL_NAME}`);
  console.log(`DeepInfra: ${DEEPINFRA_BASE_URL}`);
});
