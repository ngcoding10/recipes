// Prints, as a JSON array, the names of the food ingredients this site scores 0 (any cancer
// link), from src/data/additives.ts. The backend tells the AI to avoid these when someone ticks
// "Avoid ingredients this site scores 0", and keeps its own copy of the list. After the data
// changes, regenerate that copy (see docs/BACKEND.md):
//
//   npm run --silent export:zero-list > ../backend-combination/functions/data/pantry-zero-list.json
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'zero-'));
try {
  execFileSync('npx', ['esbuild', 'src/data/additives.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${tmp}/additives.mjs`, '--log-level=error'], { cwd: ROOT });
  const { ADDITIVES } = await import(pathToFileURL(join(tmp, 'additives.mjs')).href);
  const names = ADDITIVES.filter((a) => {
    const d = a.domain ?? 'any';
    const list = Array.isArray(d) ? d : [d];
    return a.score === 0 && (list.includes('any') || list.includes('food'));
  }).map((a) => a.name);
  console.log(JSON.stringify(names));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
