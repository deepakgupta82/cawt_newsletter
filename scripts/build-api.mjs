import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Bundle the API into a single self-contained file for deployment.
 *
 * The app is a TypeScript monorepo consumed as source: apps/api imports the
 * @cawt/* workspace packages directly. That works locally under tsx, but a
 * hosted node_modules (App Service via Oryx) drops the workspace symlinks, so
 * "@cawt/domain" fails to resolve at runtime. Bundling inlines every workspace
 * package into one file that plain `node` runs, with no symlink or tsx needed.
 */

// The workspace source uses NodeNext ".js" specifiers that actually point at
// ".ts" files. esbuild does not rewrite those, so map them here.
const jsToTs = {
  name: 'js-to-ts',
  setup(b) {
    b.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.path.startsWith('.')) return null;
      const candidate = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
      return existsSync(candidate) ? { path: candidate } : null;
    });
  },
};

await build({
  entryPoints: ['apps/api/src/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'apps/api/dist/server.js',
  plugins: [jsToTs],
  logLevel: 'info',
  // Node's ESM loader needs a require shim for any bundled CommonJS dependency
  // that reaches for require() at runtime.
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});

console.log('API bundled to apps/api/dist/server.js');
