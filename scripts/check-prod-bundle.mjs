import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

// Wallet and Ethereum code (viem, the exchange machine panel) must load lazily when the Bar
// exchange machine opens, never with the hub entry. The entry's static graph is the entry
// script, its modulepreloads, and everything they import statically (not `import()`).
const walletMarkers = ['eth_requestAccounts', 'personal_sign', 'eth_sendTransaction', 'wallet_switchEthereumChain', 'claimBatch'];
const hubHtml = join(root, 'hub', 'index.html');
const html = readFileSync(hubHtml, 'utf8');
const pending = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="([^"]+\.js)"/g)]
  .map((match) => join(root, match[1].replace(/^\//, '')));
if (pending.length === 0) {
  console.error('Could not find the hub entry script in dist/hub/index.html');
  process.exit(1);
}
const entryGraph = new Set();
while (pending.length > 0) {
  const file = pending.pop();
  if (entryGraph.has(file)) continue;
  entryGraph.add(file);
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]*?\s*from\s*)?["'](\.\.?\/[^"']+\.js)["']/g)) {
    pending.push(resolve(dirname(file), match[1]));
  }
}
for (const file of entryGraph) {
  const text = readFileSync(file, 'utf8');
  for (const marker of walletMarkers) {
    if (text.includes(marker)) {
      console.error(`Wallet code (${marker}) is in the hub entry chunk ${file}; it must load with import() at the exchange machine`);
      process.exit(1);
    }
  }
}
const lazyWallet = files.filter((file) => file.endsWith('.js') && !entryGraph.has(file) && readFileSync(file, 'utf8').includes('eth_requestAccounts'));
if (lazyWallet.length === 0) {
  console.error('Exchange machine wallet chunk not found; the wallet bundle check is not checking anything');
  process.exit(1);
}
console.log(`hub entry graph ${entryGraph.size} files, wallet code only in lazy chunk(s): ${lazyWallet.map((file) => file.slice(root.length + 1)).join(', ')}`);

const gzipBytes = gzipSync(Buffer.from(chunks.join('\n'))).length;
console.log(`hub js ${jsBytes} bytes, gzip ${gzipBytes} bytes, files ${files.length}`);
if (gzipBytes > 800_000) {
  console.error('Hub bundle is larger than the M0 download budget');
  process.exit(1);
}
console.log('production bundle has no debug globals');
