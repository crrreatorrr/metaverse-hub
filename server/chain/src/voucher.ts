// EIP-712 vouchers for VerseCashout. Must match contracts/src/VerseCashout.sol exactly;
// test/voucher.test.ts checks contracts/test/vectors/voucher.json.
import { hashTypedData, parseAbi, recoverAddress, type Address, type Hex } from 'viem';
import type { DigestSigner } from './signer.ts';

export interface Voucher {
  id: bigint;
  recipient: Address;
  amount: bigint;
  expiry: bigint;
}

export const VOUCHER_TYPES = {
  Voucher: [
    { name: 'id', type: 'uint256' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const;

export const CASHOUT_ABI = parseAbi([
  'event Claimed(uint256 indexed id, address indexed recipient, uint256 amount, uint256 tokens)',
  'function claimed(uint256 id) view returns (bool)',
  'function signer() view returns (address)',
  'function token() view returns (address)',
  'function unit() view returns (uint256)',
  'function claim((uint256 id, address recipient, uint256 amount, uint256 expiry) voucher, bytes signature)',
  'function claimBatch((uint256 id, address recipient, uint256 amount, uint256 expiry)[] vouchers, bytes[] signatures)',
]);

export const ERC20_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
]);

export function voucherDigest(chainId: number, cashout: Address, voucher: Voucher): Hex {
  return hashTypedData({
    domain: { name: 'VerseCashout', version: '1', chainId, verifyingContract: cashout },
    types: VOUCHER_TYPES,
    primaryType: 'Voucher',
    message: voucher,
  });
}

/** Signs a voucher and proves the signature recovers to the signer before returning it. */
export async function signVoucher(signer: DigestSigner, chainId: number, cashout: Address, voucher: Voucher): Promise<Hex> {
  const digest = voucherDigest(chainId, cashout, voucher);
  const signature = await signer.signDigest(digest);
  if (!/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error('signature is not 65 bytes');
  const v = Number.parseInt(signature.slice(130), 16);
  const s = BigInt('0x' + signature.slice(66, 130));
  if (v !== 27 && v !== 28) throw new Error('signature v must be 27 or 28');
  if (s > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n) throw new Error('signature s is high');
  const who = await recoverAddress({ hash: digest, signature });
  if (who.toLowerCase() !== signer.address.toLowerCase()) throw new Error('signature does not recover to the signer');
  return signature;
}
