import { encodeAbiParameters, keccak256, type Hex } from 'viem';

/** Must equal Deploy.proofDigest: keccak256(abi.encode("VerseCashout signer proof v1", chainId, token, signer)). */
export function proofDigest(chainId: bigint, token: Hex, signer: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }],
      ['VerseCashout signer proof v1', chainId, token, signer],
    ),
  );
}
