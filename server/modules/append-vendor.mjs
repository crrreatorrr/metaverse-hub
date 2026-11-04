// Append vendored runtime libraries to the compiled module. Nakama loads one
// file (build/index.js); each vendor file defines a global the module uses.
// Every vendor/*.js is appended in alphabetical order (Contract C3), e.g.
//   vendor/sproto-sim.js  Sproto Fighter simulation for verifying online matches
//                          (generated in the Sproto-Fighter repo by
//                          scripts/build-sim-bundle.mjs --out <this path>)
//   vendor/pb-sim.js      People's Bitcoin world simulation (PB repo)
// Vendor bundles must do no heavy work at load: every match VM evaluates the whole file.
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const names = readdirSync(join(dir, 'vendor')).filter((name) => name.endsWith('.js')).sort();
for (const name of names) {
  appendFileSync(join(dir, 'build/index.js'), '\n' + readFileSync(join(dir, 'vendor', name), 'utf8'));
}
