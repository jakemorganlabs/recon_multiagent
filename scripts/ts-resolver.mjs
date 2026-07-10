/**
 * ESM resolve hook for running TypeScript sources directly with
 * `node --experimental-strip-types`.
 *
 * Why this exists:
 *   Node's type-stripping mode does NOT rewrite `.js` import specifiers to
 *   `.ts` files. TS's `NodeNext` module resolution requires relative imports
 *   to use the *output* extension (`.js`), which is correct for `tsc` builds
 *   but means raw `node --experimental-strip-types file.ts` cannot resolve a
 *   local `.ts` module imported as `./foo.js`. This hook intercepts relative
 *   specifiers and, for `.js`/`.mjs`/`.cjs` requests, tries the matching
 *   `.ts`/`.mts`/`.cts` source first, falling back to the original.
 *
 * Registered via scripts/ts-register.mjs; activated through the npm scripts:
 *   node --experimental-strip-types --import ./scripts/ts-register.mjs <entry>
 */

import { stat } from 'node:fs/promises';
import { dirname, resolve as resolvePath, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXTENSION_MAP = {
  '.js': ['.ts', '.js'],
  '.mjs': ['.mts', '.mjs'],
  '.cjs': ['.cts', '.cjs'],
};

/**
 * @type {import('node:module').ResolveHook}
 */
export async function resolve(specifier, context, nextResolve) {
  const isRelative =
    specifier.startsWith('./') || specifier.startsWith('../');
  const hasParent = Boolean(context.parentURL);

  if (isRelative && hasParent) {
    const ext = extname(specifier);
    const alternatives = EXTENSION_MAP[ext];
    if (alternatives) {
      // fileURLToPath decodes %-encoded path segments (e.g. %20 -> space),
      // so paths containing spaces resolve correctly on every host.
      const parentPath = fileURLToPath(context.parentURL);
      const parentDir = dirname(parentPath);
      const baseWithoutExt = specifier.slice(0, specifier.length - ext.length);
      const resolvedWithoutExt = resolvePath(parentDir, baseWithoutExt);

      for (const alt of alternatives) {
        try {
          const info = await stat(resolvedWithoutExt + alt);
          if (info.isFile()) {
            return {
              shortCircuit: true,
              url: pathToFileURL(resolvedWithoutExt + alt).href,
            };
          }
        } catch {
          // candidate doesn't exist; try next alternative
        }
      }
    }
  }

  return nextResolve(specifier, context);
}