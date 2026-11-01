// AWS KMS secp256k1 signing, normalised to what VerseCashout accepts: 65 bytes r‖s‖v with
// low s and v in {27, 28}. KMS returns DER (r, s) with no v and does not force low s.
import { GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { keccak256, recoverAddress, toHex, type Address, type Hex } from 'viem';

export const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function readLength(der: Uint8Array, at: number): { len: number; next: number } {
  const first = der[at];
  if (first === undefined) throw new Error('der: truncated');
  if (first < 0x80) return { len: first, next: at + 1 };
  const bytes = first & 0x7f;
  if (bytes === 0 || bytes > 2) throw new Error('der: bad length');
  let len = 0;
  for (let i = 0; i < bytes; i++) {
    const b = der[at + 1 + i];
    if (b === undefined) throw new Error('der: truncated');
    len = (len << 8) | b;
  }
  return { len, next: at + 1 + bytes };
}

/** Parses a DER ECDSA signature SEQUENCE { INTEGER r, INTEGER s }. */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der[0] !== 0x30) throw new Error('der: not a sequence');
  const seq = readLength(der, 1);
  if (seq.next + seq.len !== der.length) throw new Error('der: length mismatch');
  let at = seq.next;
  const ints: bigint[] = [];
  for (let k = 0; k < 2; k++) {
    if (der[at] !== 0x02) throw new Error('der: not an integer');
    const l = readLength(der, at + 1);
    const bytes = der.slice(l.next, l.next + l.len);
    if (bytes.length !== l.len || l.len === 0 || l.len > 33) throw new Error('der: bad integer');
    ints.push(BigInt(toHex(bytes)));
    at = l.next + l.len;
  }
  if (at !== der.length) throw new Error('der: trailing bytes');
  const [r, s] = ints as [bigint, bigint];
  if (r <= 0n || r >= SECP256K1_N || s <= 0n || s >= SECP256K1_N) throw new Error('der: r or s out of range');
  return { r, s };
}

const hex32 = (n: bigint): string => n.toString(16).padStart(64, '0');

/** Low-s normalises (r, s) and finds v by trial recovery against `expected`. */
export async function toEthSignature(digest: Hex, r: bigint, s: bigint, expected: Address): Promise<Hex> {
  const lowS = s > SECP256K1_N / 2n ? SECP256K1_N - s : s;
  for (const v of [27, 28]) {
    const sig = `0x${hex32(r)}${hex32(lowS)}${v.toString(16)}` as Hex;
    const who = await recoverAddress({ hash: digest, signature: sig });
    if (who.toLowerCase() === expected.toLowerCase()) return sig;
  }
  throw new Error('kms signature does not recover to the signer address');
}

/** Ethereum address from a DER SubjectPublicKeyInfo holding an uncompressed secp256k1 point. */
export function addressFromSpki(spki: Uint8Array): Address {
  // The uncompressed point is the last 65 bytes: 0x04 ‖ X ‖ Y. Hash X ‖ Y only.
  if (spki.length < 65 || spki[spki.length - 65] !== 0x04) throw new Error('kms: not an uncompressed secp256k1 key');
  const point = spki.slice(spki.length - 64);
  return `0x${keccak256(point).slice(-40)}` as Address;
}

export async function createKmsSigner(keyId: string, region: string) {
  const client = new KMSClient({ region });
  const pub = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
  if (pub.KeySpec !== 'ECC_SECG_P256K1' || !pub.PublicKey) throw new Error('kms: key must be ECC_SECG_P256K1');
  const address = addressFromSpki(pub.PublicKey);
  return {
    address,
    async signDigest(digest: Hex): Promise<Hex> {
      const out = await client.send(
        new SignCommand({
          KeyId: keyId,
          Message: Buffer.from(digest.slice(2), 'hex'),
          MessageType: 'DIGEST',
          SigningAlgorithm: 'ECDSA_SHA_256',
        }),
      );
      if (!out.Signature) throw new Error('kms: empty signature');
      const { r, s } = parseDerSignature(out.Signature);
      return toEthSignature(digest, r, s, address);
    },
  };
}
