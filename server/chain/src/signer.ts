import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import type { SignerConfig } from './config.ts';
import { createKmsSigner } from './kms.ts';

/** Signs a raw 32-byte digest and returns 65 bytes r‖s‖v (low s, v = 27/28). */
export interface DigestSigner {
  address: Address;
  signDigest(digest: Hex): Promise<Hex>;
}

export function localSigner(privateKey: Hex): DigestSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    signDigest: (digest) => account.sign({ hash: digest }),
  };
}

export async function createSigner(config: SignerConfig, chainId: number): Promise<DigestSigner | null> {
  if (config.kind === 'none') return null;
  if (config.kind === 'local') {
    if (chainId === 1) throw new Error('SIGNER=local is refused on mainnet; use aws-kms');
    return localSigner(config.privateKey);
  }
  return createKmsSigner(config.keyId, config.region);
}
