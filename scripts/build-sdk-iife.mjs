#!/usr/bin/env node
// Reproducible classic-script build of @metaverse/hub-sdk.
// Coop Battle has no bundler, so it loads this IIFE. Do not point it at a CDN.
//
//   node scripts/build-sdk-iife.mjs --write   # refresh packages/hub-sdk/SOURCE.pin.json
//   node scripts/build-sdk-iife.mjs --check   # rebuild and compare the pin
//   node scripts/build-sdk-iife.mjs --out <file>
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = join(repoRoot, 'packages/hub-sdk');
const pinPath = join(sdkRoot, 'SOURCE.pin.json');
const pkg = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8'));
const esbuildPkg = JSON.parse(readFileSync(join(repoRoot, 'node_modules/esbuild/package.json'), 'utf8'));

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts') || name.endsWith('.js')) out.push(full);
  }
  return out;
}

export function sourceHashes() {
  const hashes = {};
  for (const file of sourceFiles(join(sdkRoot, 'src'))) {
    const rel = relative(sdkRoot, file).replaceAll('\\', '/');
    hashes[rel] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  return hashes;
}

export function writeIife(outFile) {
  mkdirSync(dirname(outFile), { recursive: true });
  buildSync({
    entryPoints: [join(sdkRoot, 'src/index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'HubSDK',
    platform: 'browser',
    target: 'es2022',
    outfile: outFile,
    // Keep license notices of bundled third-party code (src/third_party), at the end of the file.
    legalComments: 'eof',
    charset: 'utf8',
    sourcemap: false,
    minify: false,
    banner: {
      js: `/*! @metaverse/hub-sdk ${pkg.version} IIFE global HubSDK. Built from packages/hub-sdk/src. Not a CDN import. */`,
    },
  });
  const bytes = readFileSync(outFile);
  const text = bytes.toString('utf8');
  if (!text.includes('sproto-shooter') || !text.includes('sproto-coop-battle')) {
    throw new Error('IIFE is missing a registered game id');
  }
  if (!text.includes('createHubSdk') || !text.startsWith('/*! @metaverse/hub-sdk')) {
    throw new Error('IIFE is missing the HubSDK entry');
  }
  if (/NAKAMA_HTTP_KEY\s*=\s*['"][^'"]+['"]/.test(text) || /http[_-]?key\s*[:=]\s*['"][A-Za-z0-9]{8,}['"]/i.test(text)) {
    throw new Error('IIFE contains an HTTP key');
  }
  return createHash('sha256').update(bytes).digest('hex');
}

export function pinDocument(iifeSha256) {
  return {
    package: pkg.name,
    version: pkg.version,
    entry: 'src/index.ts',
    format: 'iife',
    global: 'HubSDK',
    esbuild: esbuildPkg.version,
    sources: sourceHashes(),
    iifeSha256,
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const check = args.includes('--check');
const write = args.includes('--write');
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain && (outFlag >= 0 || check || write)) {
  const outFile = outFlag >= 0
    ? resolve(args[outFlag + 1] ?? '')
    : join(tmpdir(), `hub-sdk-iife-${process.pid}.js`);
  if (!outFile) fail('missing --out path');
  const hash = writeIife(outFile);
  const next = pinDocument(hash);
  if (write) {
    writeFileSync(pinPath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`wrote ${pinPath}`);
    console.log(`iife ${outFile}`);
    console.log(hash);
  }
  if (check) {
    const recorded = JSON.parse(readFileSync(pinPath, 'utf8'));
    const problems = [];
    if (recorded.version !== next.version) problems.push(`version ${recorded.version} != ${next.version}`);
    if (recorded.esbuild !== next.esbuild) problems.push(`esbuild ${recorded.esbuild} != ${next.esbuild}`);
    if (recorded.iifeSha256 !== next.iifeSha256) problems.push('iife sha256 does not match SOURCE.pin.json');
    const recordedSources = recorded.sources ?? {};
    const names = new Set([...Object.keys(recordedSources), ...Object.keys(next.sources)]);
    for (const name of names) {
      if (recordedSources[name] !== next.sources[name]) problems.push(`source hash drift ${name}`);
    }
    if (problems.length) fail(problems.join('\n'));
    console.log(`sdk iife pin ok ${next.version} ${hash}`);
  }
  if (outFlag >= 0 && !check && !write) console.log(hash);
}
