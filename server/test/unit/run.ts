// npm test entry for the Nakama module: builds index.js once, then runs every
// server/test/unit/*.test.ts and server/test/games/*.test.ts (globbed, so game
// agents add files without touching package.json). Each file runs in its own
// process with HUB_MODULE_JS pointing at the shared build.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModule } from './harness';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(import.meta.url);
const tsxCli = join(dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs');

const built = buildModule();
const files: string[] = [];
for (const dir of [here, resolve(here, '../games')]) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).sort()) if (name.endsWith('.test.ts')) files.push(join(dir, name));
}
let failed = 0;
for (const file of files) {
  const label = relative(root, file);
  try {
    execFileSync(process.execPath, [tsxCli, file], { stdio: 'inherit', env: { ...process.env, HUB_MODULE_JS: built } });
  } catch {
    failed += 1;
    console.error(`FAILED ${label}`);
  }
}
if (failed) {
  console.error(`${failed} server test file(s) failed`);
  process.exit(1);
}
console.log(`server module tests ok (${files.length} files)`);
