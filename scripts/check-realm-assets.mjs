import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REALM_ASSET_LIMIT = 50_000_000;

/** Source references must stay within a realm's own world/realms/<id>/ folder. */
export function checkRealmSource(realm, source) {
  if (realm === 'plaza' && /world\/realms\//.test(source)) return ['plaza references realm world art'];
  const issues = [];
  for (const match of source.matchAll(/(?:world\/|\$\{WORLD_ROOT\})realms\/([a-zA-Z0-9_-]+)\//g)) {
    if (match[1] !== realm) issues.push(`${realm} references ${match[1]} world art`);
  }
  return issues;
}

function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Realm assets/sources may not use symlinks: ${path}`);
    return entry.isDirectory() ? files(path) : [path];
  });
}

export function checkRealmAssets(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const sourceRoot = join(root, 'apps/hub/src/realms');
  const realms = readdirSync(sourceRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const problems = [];
  for (const realm of realms) {
    const pages = realm === 'plaza' ? 'apps/hub/hub' : `apps/hub/realm/${realm}`;
    for (const file of [...files(join(sourceRoot, realm)), ...files(join(root, pages))]) {
      if (!/\.(?:[cm]?[jt]sx?|css|html|json)$/.test(file)) continue;
      for (const issue of checkRealmSource(realm, readFileSync(file, 'utf8'))) problems.push(`${file}: ${issue}`);
    }
    const bytes = files(join(root, 'apps/hub/public/world/realms', realm)).reduce((sum, file) => sum + statSync(file).size, 0);
    console.log(`[realm-assets] world/realms/${realm}/: ${bytes} bytes / ${REALM_ASSET_LIMIT}`);
    if (bytes > REALM_ASSET_LIMIT) problems.push(`${realm} world art exceeds ${REALM_ASSET_LIMIT} bytes (${bytes})`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) checkRealmAssets();
