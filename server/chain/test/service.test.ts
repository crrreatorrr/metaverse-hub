import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { privateKeyToAccount } from 'viem/accounts';
import { SignerGuard } from '../src/guard.ts';
import { createVerifyServer } from '../src/verify.ts';

test('verify endpoint: key, input checks and recovery', async () => {
  const server = createVerifyServer('k'.repeat(32));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const account = privateKeyToAccount(('0x' + '42'.repeat(32)) as `0x${string}`);
  const message = 'hub.test wants you to sign in with your Ethereum account';
  const signature = await account.signMessage({ message });
  const post = (key: string, body: unknown) =>
    fetch(`${url}/verify`, { method: 'POST', headers: { 'x-chain-service-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('wrong', { message, signature })).status, 401);
    assert.equal((await post('k'.repeat(31), { message, signature })).status, 401);
    assert.equal((await post('k'.repeat(32), { message, signature: '0x12' })).status, 400);
    assert.equal((await post('k'.repeat(32), { message: '', signature })).status, 400);
    const ok = await post('k'.repeat(32), { message, signature });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { address: string }).address, account.address.toLowerCase());
    const other = await post('k'.repeat(32), { message: message + '!', signature });
    assert.notEqual(((await other.json()) as { address: string }).address, account.address.toLowerCase(), 'a different message recovers someone else');
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/verify`)).status, 404);
  } finally {
    server.close();
  }
});

test('signer guard: limits, daily reset, persistence and halt', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'guard-')), 'state.json');
  let now = new Date('2026-11-01T10:00:00Z');
  const clock = () => now;
  const ttl = () => Math.floor(now.getTime() / 1000) + 86_400;
  const unconfigured = new SignerGuard(file + '.x', 0, 0, 31 * 86_400, clock);
  assert.match(unconfigured.reserve(1, ttl()) ?? '', /not configured/);

  const g = new SignerGuard(file, 100, 40, 31 * 86_400, clock);
  assert.equal(g.reserve(40, ttl()), null);
  assert.match(g.reserve(41, ttl()) ?? '', /SIGNER_MAX_VOUCHER_VERSE/);
  assert.match(g.reserve(1, Math.floor(now.getTime() / 1000) + 40 * 86_400) ?? '', /expiry/);
  assert.equal(g.reserve(40, ttl()), null);
  assert.match(g.reserve(21, ttl()) ?? '', /DAILY/);
  assert.equal(new SignerGuard(file, 100, 40, 31 * 86_400, clock).reserve(21, ttl())?.includes('DAILY'), true, 'state survives a restart');
  now = new Date('2026-11-02T00:00:01Z');
  assert.equal(g.reserve(40, ttl()), null, 'a new UTC day resets the budget');
  g.halt('unknown_claim');
  assert.match(g.reserve(1, ttl()) ?? '', /halted/);
  assert.match(new SignerGuard(file, 100, 40, 31 * 86_400, clock).reserve(1, ttl()) ?? '', /halted/, 'halt survives a restart');
});
