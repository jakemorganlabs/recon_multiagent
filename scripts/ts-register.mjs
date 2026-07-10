/**
 * Registers the in-repo TS resolve hook so that `node --experimental-strip-types`
 * can resolve local `.ts` modules imported with `.js` specifiers.
 *
 * Usage from package.json scripts:
 *   node --experimental-strip-types --import ./scripts/ts-register.mjs <entry.ts>
 */

import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
register('./ts-resolver.mjs', pathToFileURL(join(here, 'ts-register.mjs')).href);