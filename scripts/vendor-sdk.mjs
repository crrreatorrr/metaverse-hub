#!/usr/bin/env node
// Vendor @metaverse/hub-sdk into a game repo: node scripts/vendor-sdk.mjs <game-repo> [--branch <name>]
//   1. builds packages/hub-sdk
//   2. replaces <repo>/vendor/hub-sdk/dist with dist/**/*.js and *.d.ts (no maps, sourceMappingURL stripped)
//   3. copies package.json and README.md
//   4. rewrites the header block of VENDOR.md (game-specific notes below it are kept)
//   5. prints the file manifest
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceHashes, writeIife } from './build-sdk-iife.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--branch');
const branchFlag = args.indexOf('--branch');
if (!target) {
  console.error('usage: node scripts/vendor-sdk.mjs <path-to-game-repo> [--branch <name>]');
  process.exit(2);
}
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
const iifeHash = writeIife(join(outDist, 'hub-sdk.iife.js'));
manifest.push('dist/hub-sdk.iife.js');
copyFileSync(join(pkgDir, 'package.json'), join(outDir, 'package.json'));
copyFileSync(join(pkgDir, 'README.md'), join(outDir, 'README.md'));
copyFileSync(join(pkgDir, 'SOURCE.pin.json'), join(outDir, 'SOURCE.pin.json'));
manifest.unshift('README.md', 'package.json', 'SOURCE.pin.json');

const sourceLines = Object.entries(sourceHashes()).map(([file, hash]) => `- source ${file}: ${hash}`);
const header = [
  '# Vendored @metaverse/hub-sdk',
  '',
  '- repo: https://github.com/crrreatorrr/metaverse-hub',
  `- branch: ${branch}`,
  `- sha: ${sha}`,
  `- package: packages/hub-sdk @ ${pkg.version}`,
  '- built with: `node scripts/vendor-sdk.mjs`',
  '- iife: dist/hub-sdk.iife.js (global HubSDK; classic script, not a CDN import)',
  `- iife sha256: ${iifeHash}`,
  ...sourceLines,
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
for (const file of manifest) console.log(file);
