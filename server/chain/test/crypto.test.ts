import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getAddress, parseSignature, recoverAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { SECP256K1_N, addressFromSpki, parseDerSignature, toEthSignature } from '../src/kms.ts';
import { proofDigest } from '../src/proof.ts';
import { localSigner } from '../src/signer.ts';
import { signVoucher, voucherDigest } from '../src/voucher.ts';

const vectors = new URL('../../../contracts/test/vectors/', import.meta.url);
const voucherVec = JSON.parse(readFileSync(new URL('voucher.json', vectors), 'utf8'));
const proofVec = JSON.parse(readFileSync(new URL('signer-proof.json', vectors), 'utf8'));

test('voucher digest and signature match the Solidity vector', async () => {
  const signer = localSigner(voucherVec.signerKey);
  assert.equal(signer.address, getAddress(voucherVec.signer));
  const v = {
    id: BigInt(voucherVec.voucher.id),
    recipient: getAddress(voucherVec.voucher.recipient),
    amount: BigInt(voucherVec.voucher.amount),
    expiry: BigInt(voucherVec.voucher.expiry),
  };
  assert.equal(voucherDigest(voucherVec.chainId, getAddress(voucherVec.contract), v), voucherVec.digest);
  assert.equal(await signVoucher(signer, voucherVec.chainId, getAddress(voucherVec.contract), v), voucherVec.signature);
});

test('large voucher ids encode without precision loss', () => {
  const big = 2n ** 243n + 12345n;
  const v = { id: big, recipient: getAddress(voucherVec.voucher.recipient), amount: 1n, expiry: 1n };
  const w = { ...v, id: big + 1n };
  assert.notEqual(voucherDigest(1, getAddress(voucherVec.contract), v), voucherDigest(1, getAddress(voucherVec.contract), w));
});

test('signer proof digest matches Deploy.proofDigest', async () => {
  const d = proofDigest(BigInt(proofVec.chainId), proofVec.token, proofVec.signer);
  assert.equal(d, proofVec.digest);
  assert.equal(await localSigner(proofVec.signerKey).signDigest(d), proofVec.signature);
});

test('signVoucher refuses high-s, bad v and the wrong key', async () => {
  const good = localSigner(voucherVec.signerKey);
  const v = { id: 1n, recipient: getAddress(voucherVec.voucher.recipient), amount: 1n, expiry: 1n };
  const cashout = getAddress(voucherVec.contract);
  const sig = await signVoucher(good, 1, cashout, v);
  const { r, s, v: vv } = parseSignature(sig);
  const high = BigInt(s) > SECP256K1_N / 2n ? BigInt(s) : SECP256K1_N - BigInt(s);
  const flipped = (`${r}${high.toString(16).padStart(64, '0')}${(Number(vv) === 27 ? 28 : 27).toString(16)}`) as Hex;
  await assert.rejects(signVoucher({ address: good.address, signDigest: async () => flipped }, 1, cashout, v), /high/);
  await assert.rejects(signVoucher({ address: good.address, signDigest: async () => (sig.slice(0, 130) + '01') as Hex }, 1, cashout, v), /v must be/);
  const other = localSigner(('0x' + '11'.repeat(32)) as Hex);
  await assert.rejects(signVoucher({ address: good.address, signDigest: other.signDigest }, 1, cashout, v), /does not recover/);
});

function der(r: bigint, s: bigint): Uint8Array {
  const int = (n: bigint) => {
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    let bytes = Buffer.from(hex, 'hex');
    if (bytes[0]! & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
    return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
  };
  const body = Buffer.concat([int(r), int(s)]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

test('KMS DER signatures are low-s normalised with the right v', async () => {
  const key = ('0x' + '42'.repeat(32)) as Hex;
  const account = privateKeyToAccount(key);
  const digest = ('0x' + 'ab'.repeat(32)) as Hex;
  const sig = parseSignature(await account.sign({ hash: digest }));
  const r = BigInt(sig.r);
  const s = BigInt(sig.s);
  for (const variant of [s, SECP256K1_N - s]) {
    const parsed = parseDerSignature(der(r, variant));
    const eth = await toEthSignature(digest, parsed.r, parsed.s, account.address);
    assert.ok(BigInt('0x' + eth.slice(66, 130)) <= SECP256K1_N / 2n, 'low s');
    assert.equal(await recoverAddress({ hash: digest, signature: eth }), account.address);
  }
  await assert.rejects(toEthSignature(digest, r, s, getAddress('0x' + '00'.repeat(19) + '01')), /does not recover/);
  assert.throws(() => parseDerSignature(Uint8Array.from([0x30, 0x02, 0x02, 0x00])));
  assert.throws(() => parseDerSignature(Buffer.concat([der(r, s), Buffer.from([0])])), /length|trailing/);
  assert.throws(() => parseDerSignature(der(SECP256K1_N, s)), /out of range/);
});

test('KMS public key (SPKI) maps to the Ethereum address', () => {
  const account = privateKeyToAccount(('0x' + '42'.repeat(32)) as Hex);
  const spki = Buffer.concat([Buffer.from('3056301006072a8648ce3d020106052b8104000a034200', 'hex'), Buffer.from(account.publicKey.slice(2), 'hex')]);
  assert.equal(getAddress(addressFromSpki(spki)), account.address);
  assert.throws(() => addressFromSpki(spki.subarray(0, 40)));
});
