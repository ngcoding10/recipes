// Bundles the functions (plus the prompts, schemas and ingredient list shared with the website
// in ../src) into lib/index.js. Packages from node_modules stay external.
import { build } from 'esbuild';
const test = process.argv.includes('--test');
await build({
  entryPoints: test ? ['src/handlers.test.ts'] : ['src/index.ts'],
  outfile: test ? 'lib-test/handlers.test.mjs' : 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: test ? 'esm' : 'cjs',
  packages: 'external',
  logLevel: 'warning',
});
console.log(test ? 'built lib-test/' : 'built lib/index.js');
