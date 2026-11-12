// `npm run test:pg`: every server/test/pg/*.test.ts against a local Postgres (see rig.ts).
// Not part of `npm test`, which must run with no services. Skips with exit 0 and a clear line
// when Postgres is not reachable, unless HUB_PG_REQUIRED=1.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModule } from '../unit/harness';
import { pgAvailable } from './rig';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxCli = join(dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs');

if (!pgAvailable()) {
  const line = 'test:pg NOT RUN: psql cannot reach Postgres (set HUB_PG_HOST / HUB_PG_PORT / HUB_PG_USER / PGPASSWORD)';
  if (process.env.HUB_PG_REQUIRED === '1') {
    console.error(line);
    process.exit(1);
  }
  console.log(line);
  process.exit(0);
}

const built = buildModule();
const files = readdirSync(here).filter((name) => name.endsWith('.test.ts')).sort();
let failed = 0;
for (const name of files) {
  try {
    execFileSync(process.execPath, [tsxCli, join(here, name)], { stdio: 'inherit', env: { ...process.env, HUB_MODULE_JS: built } });
  } catch {
    failed += 1;
    console.error(`FAILED server/test/pg/${name}`);
  }
}
if (failed) {
  console.error(`${failed} pg test file(s) failed`);
  process.exit(1);
}
console.log(`pg economy tests ok (${files.length} files)`);
