// Generate a card image for every recipe that lacks one, using the free
// Pollinations image API, then write `image:` into the recipe's frontmatter.
//
//   node scripts/gen-images.mjs            # only recipes without an image
//   node scripts/gen-images.mjs --force    # regenerate everything
//   node scripts/gen-images.mjs --only r0045-korean-popcorn-chicken,r0090-...   # specific slugs
//   POLLINATIONS_TOKEN=... node scripts/gen-images.mjs   # Flux model via gen.pollinations.ai, no logo
//   (key from https://enter.pollinations.ai/keys; in a Claude cloud session the proxy injects it,
//    so any placeholder value such as POLLINATIONS_TOKEN=proxy-injected works)
//
// Images are generated SQUARE (the free model distorts dishes at wide ratios) and
// land in public/images/<slug>.jpg at 800x800; the site crops them to fit.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname;
const RECIPES = join(ROOT, 'recipes');
const OUT = join(ROOT, 'public', 'images');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const TOKEN = process.env.POLLINATIONS_TOKEN || '';
const STYLE = 'Appetizing professional food photography, 45-degree angle, soft natural daylight, served on simple ceramic tableware on a light neutral linen surface, sharp focus, realistic, no text, no watermark, no people, no hands';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fm = (src, key) => {
  const m = src.match(new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, 'm'));
  return m ? m[1].replace(/\\"/g, '"') : '';
};

const files = readdirSync(RECIPES).filter((f) => f.endsWith('.md')).sort();
let done = 0, skipped = 0, failed = [];
for (const f of files) {
  const slug = basename(f, '.md');
  const path = join(RECIPES, f);
  let src = readFileSync(path, 'utf8');
  const out = join(OUT, `${slug}.jpg`);
  if (ONLY.length && !ONLY.includes(slug)) { skipped++; continue; }
  if (!FORCE && !ONLY.length && existsSync(out) && /^image:/m.test(src)) { skipped++; continue; }

  const title = fm(src, 'title');
  const desc = fm(src, 'description');
  const seed = [...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 100000, 7);
  const params = new URLSearchParams({ width: '1024', height: '1024', seed: String(seed), nologo: 'true', ...(TOKEN ? { model: 'flux' } : {}) });
  // With a key: the current API (Flux). Without: the legacy anonymous endpoint (weaker model, logo strip).
  const urlFor = (prompt) => TOKEN
    ? `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${params}`
    : `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;

  let buf = null;
  for (let attempt = 1; attempt <= 6 && !buf; attempt++) {
    // Long descriptions occasionally trip the API's prompt filter (403); fall back to the title alone.
    const prompt = attempt <= 2 ? `${title}. ${desc ? desc + '. ' : ''}${STYLE}` : `${title}. ${STYLE}`;
    const url = urlFor(prompt);
    try {
      const res = await fetch(url, { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}, signal: AbortSignal.timeout(180000) });
      if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) buf = Buffer.from(await res.arrayBuffer());
      else { process.stdout.write(`  ${slug}: HTTP ${res.status}, retry ${attempt}\n`); await sleep(8000 * attempt); }
    } catch (e) { process.stdout.write(`  ${slug}: ${e.message}, retry ${attempt}\n`); await sleep(8000 * attempt); }
  }
  if (!buf) { failed.push(slug); continue; }

  // Crop the bottom strip (free tier stamps a small logo there), then fit the card ratio.
  const meta = await sharp(buf).metadata();
  const keepH = Math.round(meta.height * (TOKEN ? 1 : 0.93));
  await sharp(buf)
    .extract({ left: 0, top: 0, width: meta.width, height: keepH })
    .resize(800, 800, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(out);

  if (!/^image:/m.test(src)) {
    src = src.replace(/\n---\s*$/m, `\nimage: "/images/${slug}.jpg"\n---`);
    writeFileSync(path, src);
  }
  done++;
  process.stdout.write(`✓ ${slug} (${done}/${files.length - skipped})\n`);
  await sleep(1500); // be polite to the free tier
}
console.log(`\ndone: ${done} generated, ${skipped} skipped, ${failed.length} failed${failed.length ? ': ' + failed.join(', ') : ''}`);
