// Card-sized copies of the recipe photos (480 px, ~25 KB) for the library grid: `node scripts/make-thumbs.mjs`.
import sharp from 'sharp';
import { readdirSync, mkdirSync, existsSync, statSync } from 'node:fs';
const SRC = 'public/images', OUT = 'public/images/thumb';
mkdirSync(OUT, { recursive: true });
let n = 0;
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.jpg'))) {
  const out = `${OUT}/${f}`;
  if (existsSync(out) && statSync(out).mtimeMs > statSync(`${SRC}/${f}`).mtimeMs) continue;
  await sharp(`${SRC}/${f}`).resize(480, 480, { fit: 'cover' }).jpeg({ quality: 78, progressive: true, mozjpeg: true }).toFile(out);
  n++;
}
console.log(`${n} thumbnails written to ${OUT}`);
