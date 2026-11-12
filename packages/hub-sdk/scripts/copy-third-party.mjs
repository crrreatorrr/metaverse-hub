// tsc does not emit plain .js sources: copy the vendored third-party modules into dist as they are.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src/third_party');
const to = join(root, 'dist/third_party');
mkdirSync(to, { recursive: true });
for (const name of readdirSync(from)) {
  if (name.endsWith('.js') || name.endsWith('.d.ts')) copyFileSync(join(from, name), join(to, name));
}
