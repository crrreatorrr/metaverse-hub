// HUB-W-1-06: a production build with no VITE_NAKAMA_SERVER_KEY used to embed '' and ship
// `Basic Og==`, so every login failed. The build must stop instead.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEV_SERVER_KEY, nakamaServerKey } from '../server-key';

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

// The config must route the define through the guard, not read the env var directly.
const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
assert.match(config, /__NAKAMA_SERVER_KEY__:\s*JSON\.stringify\(\s*nakamaServerKey\(\s*\{\s*command,\s*mode\s*\},\s*process\.env\.VITE_NAKAMA_SERVER_KEY\s*\)/, 'vite_config_uses_the_guard');
assert.doesNotMatch(config, /VITE_NAKAMA_SERVER_KEY \?\? ''/, 'vite_config_has_no_empty_fallback');

console.log('vite config server key guard ok');
