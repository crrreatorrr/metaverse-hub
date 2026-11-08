// HUB-W-1-06: a production build with no VITE_NAKAMA_SERVER_KEY used to embed '' and ship
// `Basic Og==`, so every login failed. The build must stop instead.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV_SERVER_KEY, nakamaServerKey, nakamaServerKeyFromEnv } from '../server-key';

const build = (mode: string) => ({ command: 'build' as const, mode });

for (const key of [undefined, '', '   ']) {
  assert.throws(() => nakamaServerKey(build('production'), key), /VITE_NAKAMA_SERVER_KEY is empty/, `production_build_refuses_empty_server_key (${JSON.stringify(key)})`);
  assert.throws(() => nakamaServerKey(build('staging'), key), /VITE_NAKAMA_SERVER_KEY is empty/, 'any_non_development_build_refuses');
}

assert.equal(nakamaServerKey(build('production'), 'ci-placeholder-key'), 'ci-placeholder-key', 'production_build_embeds_the_given_key');
assert.equal(nakamaServerKey(build('production'), ' padded-key \n'), 'padded-key', 'production_build_trims_the_key');
assert.equal(nakamaServerKey(build('development'), undefined), DEV_SERVER_KEY, 'development_build_keeps_dev_key');
assert.equal(nakamaServerKey({ command: 'serve', mode: 'development' }, undefined), DEV_SERVER_KEY, 'vite_dev_keeps_dev_key');
// `vite preview` serves an existing dist and inlines nothing, so it must not throw.
assert.doesNotThrow(() => nakamaServerKey({ command: 'serve', mode: 'production' }, undefined), 'preview_does_not_need_the_key');

// Vite env files: a key in apps/hub/.env.production is honoured (loadEnv), and the shell wins over it.
const saved = process.env.VITE_NAKAMA_SERVER_KEY;
delete process.env.VITE_NAKAMA_SERVER_KEY;
const dir = mkdtempSync(join(tmpdir(), 'hub-env-'));
try {
  assert.throws(() => nakamaServerKeyFromEnv(build('production'), dir), /\.env\.production/, 'error_mentions_env_production');
  writeFileSync(join(dir, '.env.production'), 'VITE_NAKAMA_SERVER_KEY=from-env-file\n');
  assert.equal(nakamaServerKeyFromEnv(build('production'), dir), 'from-env-file', 'env_production_key_is_honoured');
  assert.throws(() => nakamaServerKeyFromEnv(build('staging'), dir), /VITE_NAKAMA_SERVER_KEY is empty/, 'another mode does not read .env.production');
  process.env.VITE_NAKAMA_SERVER_KEY = 'from-shell';
  assert.equal(nakamaServerKeyFromEnv(build('production'), dir), 'from-shell', 'shell_env_wins_over_env_file');
  delete process.env.VITE_NAKAMA_SERVER_KEY;
  writeFileSync(join(dir, '.env.production'), 'VITE_NAKAMA_SERVER_KEY=\n');
  assert.throws(() => nakamaServerKeyFromEnv(build('production'), dir), /VITE_NAKAMA_SERVER_KEY is empty/, 'empty_env_file_key_still_fails');
  assert.equal(nakamaServerKeyFromEnv({ command: 'build', mode: 'development' }, dir), DEV_SERVER_KEY);
} finally {
  rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) delete process.env.VITE_NAKAMA_SERVER_KEY;
  else process.env.VITE_NAKAMA_SERVER_KEY = saved;
}

// A dev server in a non-development mode with no key warns (logins will fail) but still starts.
const warnings: string[] = [];
assert.equal(nakamaServerKey({ command: 'serve', mode: 'staging' }, '', (m) => warnings.push(m)), '');
assert.equal(warnings.length, 1, 'dev_server_non_development_mode_warns');
assert.match(warnings[0]!, /VITE_NAKAMA_SERVER_KEY/);
nakamaServerKey({ command: 'serve', mode: 'production', isPreview: true }, '', (m) => warnings.push(m));
assert.equal(warnings.length, 1, 'preview_does_not_warn');

// The config must route the define through the env-file-aware guard, not read process.env directly.
const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
assert.match(config, /__NAKAMA_SERVER_KEY__:\s*JSON\.stringify\(\s*nakamaServerKeyFromEnv\(\s*\{\s*command,\s*mode,\s*isPreview\s*\},\s*__dirname\s*\)/, 'vite_config_uses_the_guard');
assert.doesNotMatch(config, /process\.env\.VITE_NAKAMA_SERVER_KEY/, 'vite_config_does_not_bypass_env_files');

console.log('vite config server key guard ok');
