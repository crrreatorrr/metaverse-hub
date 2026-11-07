#!/usr/bin/env node
// Vendor @metaverse/hub-sdk into a game repo: node scripts/vendor-sdk.mjs <game-repo> [--branch <name>]
//   1. builds packages/hub-sdk
//   2. replaces <repo>/vendor/hub-sdk/dist with dist/**/*.js and *.d.ts (no maps, sourceMappingURL stripped)
//   3. copies package.json and README.md
//   4. rewrites the header block of VENDOR.md (game-specific notes below it are kept)
//   5. prints the file manifest
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function loadEsbuild() {
  const vitePkg = require.resolve('vite/package.json');
  return require(require.resolve('esbuild', { paths: [dirname(vitePkg)] }));
}

/** sha256 of every TypeScript source under packages/hub-sdk/src, in path order. */
export function sdkSourcePin() {
  const src = join(root, 'packages/hub-sdk/src');
  const files = [];
  const walkSrc = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walkSrc(full);
      else if (name.endsWith('.ts')) files.push(full);
    }
  };
  walkSrc(src);
  return files.map((full) => ({
    path: relative(join(root, 'packages/hub-sdk'), full).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(readFileSync(full)).digest('hex'),
  }));
}

/**
 * Classic-script build for games with no bundler (Sproto Coop Battle).
 * Built from this repo's source. Do not load a copy from a CDN.
 * @param {string} dest
 */
export async function buildBrowserIife(dest) {
  const esbuild = loadEsbuild();
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [join(root, 'packages/hub-sdk/src/index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'HubSdk',
    platform: 'browser',
    target: 'es2022',
    outfile: dest,
    legalComments: 'none',
    sourcemap: false,
    minify: false,
    charset: 'utf8',
    logLevel: 'silent',
  });
  const text = readFileSync(dest, 'utf8');
  if (text.includes(root)) throw new Error('browser SDK embeds an absolute path');
  return { sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) };
}

export function sourcePinDocument() {
  const pkg = JSON.parse(readFileSync(join(root, 'packages/hub-sdk/package.json'), 'utf8'));
  return {
    packageVersion: pkg.version,
    format: 'iife',
    globalName: 'HubSdk',
    entry: 'src/index.ts',
    sources: sdkSourcePin(),
  };
}

async function vendorInto(target, branchFlag, args) {
  const repo = resolve(target);
  if (!existsSync(repo)) {
    console.error(`no such repo: ${repo}`);
    process.exit(2);
  }

  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
  const branch = branchFlag >= 0 ? args[branchFlag + 1] : git('rev-parse', '--abbrev-ref', 'HEAD');
  const sha = git('rev-parse', '--short', 'HEAD');
  const pkgDir = join(root, 'packages/hub-sdk');
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

  execFileSync('npm', ['run', 'build', '-w', '@metaverse/hub-sdk'], { cwd: root, stdio: 'inherit' });

  const outDir = join(repo, 'vendor/hub-sdk');
  const outDist = join(outDir, 'dist');
  rmSync(outDist, { recursive: true, force: true });
  mkdirSync(outDist, { recursive: true });

  const manifest = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith('.js') && !name.endsWith('.d.ts')) continue;
      const rel = relative(join(pkgDir, 'dist'), full);
      const dest = join(outDist, rel);
      mkdirSync(dirname(dest), { recursive: true });
      const text = readFileSync(full, 'utf8').replace(/^\/\/# sourceMappingURL=.*$\n?/gm, '');
      writeFileSync(dest, text);
      manifest.push(`dist/${rel}`);
    }
  }
  walk(join(pkgDir, 'dist'));
  const iifePath = join(outDir, 'hub-sdk.iife.js');
  const iife = await buildBrowserIife(iifePath);
  manifest.push('hub-sdk.iife.js');
  copyFileSync(join(pkgDir, 'package.json'), join(outDir, 'package.json'));
  copyFileSync(join(pkgDir, 'README.md'), join(outDir, 'README.md'));
  manifest.unshift('README.md', 'package.json');

  const header = [
    '# Vendored @metaverse/hub-sdk',
    '',
    '- repo: https://github.com/crrreatorrr/metaverse-hub',
    `- branch: ${branch}`,
    `- sha: ${sha}`,
    `- package: packages/hub-sdk @ ${pkg.version}`,
    '- built with: `node scripts/vendor-sdk.mjs`',
    '- browser: `hub-sdk.iife.js` (global `HubSdk`). Built from this commit. Do not import a CDN copy.',
    `- iife sha256: ${iife.sha256}`,
  ].join('\n');
  const vendorMd = join(outDir, 'VENDOR.md');
  let rest = '';
  if (existsSync(vendorMd)) {
    const old = readFileSync(vendorMd, 'utf8');
    // The header is the title plus its bullet list; everything after the first blank line that follows the bullets stays.
    const m = /^# [^\n]*\n\n(?:- [^\n]*\n)+/.exec(old);
    rest = m ? old.slice(m[0].length) : old;
  }
  rest = rest.replace(/^\n+/, '');
  writeFileSync(vendorMd, `${header}\n${rest ? `\n${rest}` : ''}`);

  console.log(`vendored @metaverse/hub-sdk ${pkg.version} (${branch} ${sha}) into ${outDir}`);
  console.log(`iife sha256 ${iife.sha256}`);
  for (const file of manifest) console.log(file);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const args = process.argv.slice(2);
  if (args.includes('--write-pin')) {
    const pinPath = join(root, 'packages/hub-sdk/sdk-pin.json');
    writeFileSync(pinPath, `${JSON.stringify(sourcePinDocument(), null, 2)}\n`);
    console.log(`wrote ${pinPath}`);
  } else {
    const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--branch');
    const branchFlag = args.indexOf('--branch');
    if (!target) {
      console.error('usage: node scripts/vendor-sdk.mjs <path-to-game-repo> [--branch <name>]');
      console.error('       node scripts/vendor-sdk.mjs --write-pin');
      process.exit(2);
    }
    vendorInto(target, branchFlag, args).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
  }
}
