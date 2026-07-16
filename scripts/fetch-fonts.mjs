/**
 * Re-downloads the exact Big Shoulders Display variable woff2 that Google's
 * legacy css2 endpoint serves (the family was merged upstream into "Big
 * Shoulders" and is no longer available via next/font/google — see
 * src/app/layout.tsx). Run from the repo root:  node scripts/fetch-fonts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@500;700;800;900&display=swap';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/fonts');

const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();

// latin-subset blocks only (they carry the Spanish accented characters)
const re =
  /\/\* latin \*\/\s*@font-face\s*\{[^}]*font-weight:\s*(\d+);[^}]*url\((https:[^)]+\.woff2)\)[^}]*\}/g;
const urls = new Set();
let m;
while ((m = re.exec(css))) urls.add(m[2]);

if (urls.size !== 1) {
  console.error(
    `Expected one shared variable-font URL, got ${urls.size}. Google changed the serving ` +
      'strategy — re-verify glyph parity before replacing the committed file.\nCSS head:\n' +
      css.slice(0, 600),
  );
  process.exit(1);
}

const [url] = urls;
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'big-shoulders-display-latin-var.woff2');
fs.writeFileSync(file, buf);
console.log(`${url} (${buf.length} bytes) -> ${file}`);
