import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../apps/hub/dist', import.meta.url));
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(js|css|html)$/.test(name)) files.push(path);
  }
}

walk(root);
const banned = [/__hub\b/, /__nobu\b/, /__duel\b/];
let jsBytes = 0;
const chunks = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.js')) {
    jsBytes += Buffer.byteLength(text);
    chunks.push(text);
  }
  for (const pattern of banned) {
    if (pattern.test(text)) {
      console.error(`Debug global ${pattern} found in ${file}`);
      process.exit(1);
    }
  }
}

const gzipBytes = gzipSync(Buffer.from(chunks.join('\n'))).length;
console.log(`hub js ${jsBytes} bytes, gzip ${gzipBytes} bytes, files ${files.length}`);
if (gzipBytes > 800_000) {
  console.error('Hub bundle is larger than the M0 download budget');
  process.exit(1);
}
console.log('production bundle has no debug globals');
