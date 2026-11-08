// Append vendored runtime libraries to the compiled module. Nakama loads one
// file (build/index.js); each vendor file defines a global the module uses.
// Every vendor/*.js is appended in alphabetical order (Contract C3), e.g.
//   vendor/shooter-sim.js Sproto Shooter campaign verifier (sproto-shooter
//                          scripts/build-server-sim.mjs). It never mints Tickets.
//                          Wrapped so the campaign graph is built on the first
//                          Shooter RPC, not while a Coop match is ticking.
//   vendor/coop-sim.js    Sproto Coop Battle simulation and banked protocol
//                          (generated in Sproto-Coop-Battle. by
//                          scripts/build-server-sim.mjs)
//   vendor/sproto-sim.js  Sproto Fighter simulation for verifying online matches
//                          (generated in the Sproto-Fighter repo by
//                          scripts/build-sim-bundle.mjs --out <this path>)
//   vendor/pb-sim.js      People's Bitcoin world simulation (PB repo)
// Vendor bundles must do no heavy work at load: every match VM evaluates the whole file.
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Shooter's campaign bundle is large. Leave it unexecuted until a Shooter RPC.
 * Nakama seals the global after module init, so the properties the bundle
 * assigns must already exist or that later assignment throws.
 */
export function vendorChunk(name, source) {
  if (name !== 'shooter-sim.js') return `\n${source}`;
  return `\nglobalThis.__SPROTO_VERIFY_BUNDLE = false;\nif (typeof globalThis.SprotoShooterSim === "undefined") globalThis.SprotoShooterSim = undefined;\nif (typeof globalThis.structuredClone === "undefined") globalThis.structuredClone = undefined;\nfunction __loadSprotoShooterSim() {\nif (globalThis.SprotoShooterSim) return;\n${source}\n}\n`;
}

const dir = dirname(fileURLToPath(import.meta.url));
const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const names = readdirSync(join(dir, 'vendor')).filter((name) => name.endsWith('.js')).sort();
  for (const name of names) {
    appendFileSync(join(dir, 'build/index.js'), vendorChunk(name, readFileSync(join(dir, 'vendor', name), 'utf8')));
  }
}
