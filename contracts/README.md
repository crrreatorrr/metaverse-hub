# VerseCashout

The claim contract for Verse → HPOS10I `$BITCOIN` cash-out. Design: [docs/crypto-exchange-design.md](../docs/crypto-exchange-design.md).

- **1 Verse = 1 whole `$BITCOIN`.** A voucher's `amount` is whole Verse. The contract pays `amount × 10^decimals` base units, where `decimals` is read from the token at deploy.
- **Ownerless and immutable.** There is no admin, no pause, no signer rotation, and no way to withdraw the float. The only state-changing calls are `claim` and `claimBatch`. A new signer means a new deployment.
- **Vouchers** are EIP-712 typed data, `Voucher(uint256 id,address recipient,uint256 amount,uint256 expiry)`, in domain `VerseCashout` / `1` / chain id / contract address. Only the `recipient` can submit one. Each `id` pays once. A voucher is valid while `block.timestamp <= expiry`.
- **The float** is refilled with plain ERC-20 transfers to the contract address. Whatever is in the contract is the most that can be lost.
- **Exact payment.** Each claim checks that the recipient's balance rose by exactly `amount × unit`, and reverts otherwise. A token that silently fails, charges a fee, or rebases can therefore never mark a voucher claimed without paying it. `claim` and `claimBatch` are `nonReentrant`.
- **Event:** `Claimed(uint256 indexed id, address indexed recipient, uint256 amount, uint256 tokens)`, where `amount` is whole Verse and `tokens` is base units.

## Layout

| Path | What |
| --- | --- |
| `src/VerseCashout.sol` | The contract |
| `test/VerseCashout.t.sol` | Unit and fuzz tests, token-behaviour and reentrancy tests |
| `test/VerseCashout.invariant.t.sol` | Invariant campaign: conservation, pay-once, no forgery |
| `test/Vector.t.sol`, `test/vectors/voucher.json` | Shared EIP-712 vector. `server/chain/test/voucher.test.ts` checks the same file |
| `test/exploits/` | Proofs of concept and pinned behaviour from the independent exploit review passes |
| `script/Deploy.s.sol` | Deploy with argument checks |
| `script/DeployTestToken.s.sol` | Sepolia only: `TestBitcoin` (tBITCOIN), an 8-decimal, fixed-supply, fee-free stand-in for the real token |
| `test/fork/MainnetBitcoin.t.sol` | The cashout and the deploy canary against the real `$BITCOIN` on a mainnet fork. Skipped unless `MAINNET_RPC_URL` is set |

`lib/forge-std` and `lib/openzeppelin-contracts` are git submodules pinned to `v1.17.0` and `v5.7.0`. After cloning, run `git submodule update --init --recursive`.

## Run the tests

With Foundry installed:

```bash
cd contracts && forge test
```

If `forge` cannot download `solc`, point it at any 0.8.28 compiler with `FOUNDRY_SOLC=/path/to/solc FOUNDRY_OFFLINE=true`.

### Mainnet fork tests (real `$BITCOIN`)

```bash
MAINNET_RPC_URL=... forge test --match-path test/fork/MainnetBitcoin.t.sol -vv
```

Without `MAINNET_RPC_URL` (as in CI) these tests are skipped. They fork the latest block (set `FORK_BLOCK` to pin one) and check, against the real token:

- the code hash is the reviewed one; there is no EIP-1967 proxy; `owner()` is zero (renounced), so `addBots` and `removeLimits` can never be called again;
- the token's 15% buy / 70% sell taxes, which also apply to plain wallet transfers while `_buyCount <= _reduceBuyTaxAt`, are permanently off: `_buyCount` (storage slot 14) is far past both thresholds (20), which can no longer change;
- transfers to an EOA and to the cashout arrive in full; a short balance reverts;
- `claim`, `claimBatch`, a short float reverting without marking the voucher and paying after a refill, gas for a 64-voucher batch (about 2.0M), and `Deploy.canary` itself.

Last run on 2026-11-01 at mainnet block ~26,321,000: 10 of 10 passed.

## Deploy checklist

The constructor arguments can never be changed after deploy, and the contract can never give its float back. Check every line before broadcasting.

1. **Token.** `CASHOUT_TOKEN` is `0x72e4f9F808C49A2a61dE9C5896298920Dc4EEEa9` on mainnet. Confirm on Etherscan, against the project's official channels, that it:
   - is that address;
   - is **not** an upgradeable proxy and has no admin who could change it (`unit` is fixed at deploy);
   - takes **no** fee on transfer (every claim checks the full amount arrived and reverts otherwise);
   - reverts on a short balance.
2. **Decimals.** `CASHOUT_EXPECT_DECIMALS` is the token's `decimals()` as shown on Etherscan. The script refuses to deploy if they differ.
3. **Signer.**
   - `CASHOUT_SIGNER` is the Ethereum address of the voucher signer's KMS key. Derive it from the KMS public key with `npm run signer-address` in `server/chain`.
   - Mainnet and Sepolia use **different** KMS keys. The mainnet run needs `CASHOUT_SEPOLIA_SIGNER` and refuses to deploy if it equals the mainnet signer.
4. **Proof that the key exists.** Run `npm run signer-proof -- <chainId> <token>` in `server/chain` and put the output in `CASHOUT_SIGNER_PROOF`. The script recovers the signer from it and refuses to deploy otherwise. This rules out precompiles, the cashout's own address, and keys that do not exist. The script also refuses the deploying account as signer.
5. **`CASHOUT_CHAIN_ID`** must be `1` or `11155111`. The script asks the RPC itself (`eth_chainId`) and refuses if that differs from forge's chain id, so a stale `--chain` or `FOUNDRY_CHAIN_ID` cannot deploy to mainnet under Sepolia rules.
6. **Canary in simulation.** `CASHOUT_TOKEN_HOLDER` is an address holding at least one whole token, for example the Safe. Before broadcasting anything, the script deploys a throwaway cashout in simulation, funds it with one token from that holder, claims a 1-Verse voucher, and refuses unless exactly one token left the contract and exactly one arrived. This tests the real token's transfer behaviour at the current block. Nothing from this step is broadcast.
7. **Sepolia first.** Run once against Sepolia with a test token and run the full end-to-end flow. Then deploy to mainnet:

   ```bash
   forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --verify
   ```

   **Gas.** Forge sets each transaction's gas limit from its own EVM, not from the node. Since Sepolia's fork of 2026-10-06, contract creation there costs about 6.8 times what Foundry 1.5/1.6 models: `VerseCashout` uses 6.2M gas on Sepolia against 0.92M locally. A plain `--broadcast` therefore runs out of gas on Sepolia. Add `--skip-simulation` so forge uses the node's `eth_estimateGas`. All the script's checks and the canary still run first in the local simulation. On mainnet the node and forge agree today (916,045 gas). Check this again before broadcasting, and add `--skip-simulation` if mainnet has activated the same fork.

8. **Verify.** Verify the source on Etherscan. Read back `token()`, `signer()` and `unit()` and compare them with steps 1–3.
9. **Canary claim.** Send exactly **1 whole token** to the contract. Issue a 1-Verse voucher to a team wallet through the real signer service, and claim it on mainnet. Only after that claim succeeds, and the watcher records it, send the first real float.
10. **Refill in whole tokens only.** Anything below one whole token can never leave the contract.

## Mainnet dry run (no broadcast)

Run on 2026-11-01 against `MAINNET_RPC_URL`, without `--broadcast`, so nothing was sent. The signer was a throwaway local key with a matching `CASHOUT_SIGNER_PROOF`. Mainnet requires a KMS key, and none exists yet. `CASHOUT_TOKEN_HOLDER` was the Uniswap V2 pair `0x2cC846fFf0b08FB3bFfaD71f53a60B4b6E6d6482`.

- All checks and the canary claim passed on the real token. `unit` = `100000000`, and the estimated deploy cost is 1.18M gas, about 0.0001 ETH at 0.09 gwei.
- The script refused each of these, as it should: the Sepolia signer reused as the mainnet signer, `CASHOUT_EXPECT_DECIMALS=18`, and a token holder with no tokens.

For the real run, change only the signer (the KMS key's address and its proof), `CASHOUT_TOKEN_HOLDER` (the Safe), and the sender (the deploying account).

## Sepolia deployment

| What | Address | Tx |
| --- | --- | --- |
| `TestBitcoin` (tBITCOIN, 8 decimals, supply 1e9) | `0x6FC7448C65B150ea5E44D38DE4c5C06C3a971f89` | `0xada882156031c6ffb60db26840ed641c4eb084729db58411382b16cddb110cc4` |
| `VerseCashout` | `0x2438f28692b0e21255a659219FD2FD24559B5c97` | `0x87bbc4760fafc8244e76226c65599fca1aa0a39fb01f275bf8912356960469ca` (block 12042477) |
| Voucher signer (local key, Sepolia only) | `0xab135f4Ff32cA27c3a839E21f6c9bb95d57835Cb` | |
| Deployer, token holder, test deposit address | `0xE8DE8e50AaA28bCaa45C78DE12F19bCB31C7f942` | |

Read back after deploy: `token()`, `signer()` and `unit()` = `100000000` match the arguments. Two earlier token deploy attempts ran out of gas (see **Gas** above); neither left a contract.

**End to end.** `npm run e2e:sepolia` in `server/chain` passed against this deployment on 2026-11-01. Transactions from that run: deposits [`0xa933c5a4…`](https://sepolia.etherscan.io/tx/0xa933c5a4156c25f709c3b405f9c7558a40109f709049bcfb7b2c33628c17ad4d) and [`0x856bccce…`](https://sepolia.etherscan.io/tx/0x856bccce4e7aa723756a4ca2c85714d22f052081657bef84edf4a0190a80fd74), and claim [`0xd2613609…`](https://sepolia.etherscan.io/tx/0xd26136091e009861c9b8405f77565110e67bcbad1358b53b91b32878c96c1a07). See the design doc's implementation status for what the run covers.

**Source verification is still to do.** The configured `ETHERSCAN_API_KEY` works for chain id 1 but Etherscan rejects it for chain id 11155111 ("Invalid API Key"). Sourcify and Blockscout were not reachable from the build environment. With a key that Etherscan accepts for Sepolia:

```bash
forge verify-contract 0x6FC7448C65B150ea5E44D38DE4c5C06C3a971f89 script/DeployTestToken.s.sol:TestBitcoin \
  --chain sepolia --constructor-args $(cast abi-encode "c(address)" 0xE8DE8e50AaA28bCaa45C78DE12F19bCB31C7f942)
forge verify-contract 0x2438f28692b0e21255a659219FD2FD24559B5c97 src/VerseCashout.sol:VerseCashout \
  --chain sepolia --constructor-args $(cast abi-encode "c(address,address)" 0x6FC7448C65B150ea5E44D38DE4c5C06C3a971f89 0xab135f4Ff32cA27c3a839E21f6c9bb95d57835Cb)
```
