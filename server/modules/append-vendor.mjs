// Append vendored runtime libraries to the compiled module. Nakama loads one
// file (build/index.js); each vendor file defines a global the module uses.
// Every vendor/*.js is appended in alphabetical order (Contract C3), e.g.
//   vendor/shooter-pvp-sim.js  Sproto Shooter free 1v1 (sproto-shooter
//                               build/shooter-pvp-sim.js). It does not stake or
//                               mint Tickets. Wrapped so the arena graph is built
//                               on the first Shooter match, not while Coop ticks.
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
 * Nakama 3.41 freezes the global and every object created during init, so a
 * later write to either throws. The API and pureClone live in let bindings,
 * which stay writable. The bundle's own global assignments are rewritten to
 * those bindings; the pin still hashes the untouched vendor file.
 */
function lazyPvp(source) {
  const publish = 'globalThis.SprotoShooterPvp = SprotoShooterPvp;';
  if (!source.includes(publish)) {
    throw new Error('shooter-pvp-sim.js no longer publishes SprotoShooterPvp');
  }
  const patched = source.replace(publish, '__shooterPvpApi = SprotoShooterPvp;');
  return `\nlet __shooterPvpApi = null;\nfunction __loadSprotoShooterPvp() {\nif (__shooterPvpApi) return;\n${patched}\n}\nfunction __sprotoShooterPvp() {\n__loadSprotoShooterPvp();\nreturn __shooterPvpApi;\n}\n`;
}

export function vendorChunk(name, source) {
  if (name === 'shooter-pvp-sim.js') return lazyPvp(source);
  if (name !== 'shooter-sim.js') return `\n${source}`;
  const flag = 'globalThis.__SPROTO_VERIFY_BUNDLE = true;';
  const clone = 'globalThis.structuredClone = pureClone;';
  const publish = 'globalThis.SprotoShooterSim = SprotoShooterSim;';
  if (!source.includes(flag) || !source.includes(clone) || !source.includes(publish)) {
    throw new Error('shooter-sim.js no longer has the global assignments the loader rewrites');
  }
  const patched = source
    .replace(flag, 'void 0;')
    .replace(clone, '__shooterSimClone = pureClone;')
    .replace(publish, '__shooterSimApi = SprotoShooterSim;');
  return `\nglobalThis.__SPROTO_VERIFY_BUNDLE = true;\nlet __shooterSimApi = null;\nlet __shooterSimClone = null;\nglobalThis.structuredClone = function (value) {\n  if (typeof __shooterSimClone === "function") return __shooterSimClone(value);\n  throw new TypeError("structuredClone");\n};\nfunction __loadSprotoShooterSim() {\nif (__shooterSimApi) return;\n${patched}\n}\nfunction __sprotoShooterSim() {\n__loadSprotoShooterSim();\nreturn __shooterSimApi;\n}\n`;
}

const dir = dirname(fileURLToPath(import.meta.url));
const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const names = readdirSync(join(dir, 'vendor')).filter((name) => name.endsWith('.js')).sort();
  for (const name of names) {
    appendFileSync(join(dir, 'build/index.js'), vendorChunk(name, readFileSync(join(dir, 'vendor', name), 'utf8')));
  }
}
