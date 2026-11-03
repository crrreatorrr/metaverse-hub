// Append vendored runtime libraries to the compiled module. Nakama loads one
// file (build/index.js); each vendor file defines a global the module uses.
//   vendor/sproto-sim.js  Sproto Fighter simulation for verifying online matches
//                          (generated in the Sproto-Fighter repo by
//                          scripts/build-sim-bundle.mjs --out <this path>)
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
for (const name of ['sproto-sim.js']) {
  appendFileSync(join(dir, 'build/index.js'), '\n' + readFileSync(join(dir, 'vendor', name), 'utf8'));
}
