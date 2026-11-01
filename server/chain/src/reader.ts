// The chain reads the watcher needs, behind a small interface so tests can fake the chain.
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { CASHOUT_ABI, ERC20_ABI } from './voucher.ts';

export interface FinalizedBlock {
  number: bigint;
  time: Date;
}

export interface TransferLog {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  from: Address;
  value: bigint;
}

export interface ClaimLog {
  address: Address;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  id: bigint;
  recipient: Address;
  amount: bigint;
}

export interface ChainReader {
  chainId(): Promise<number>;
  finalized(): Promise<FinalizedBlock>;
  blockTime(block: bigint): Promise<Date>;
  transfers(token: Address, to: Address, fromBlock: bigint, toBlock: bigint): Promise<TransferLog[]>;
  claims(cashouts: Address[], fromBlock: bigint, toBlock: bigint): Promise<ClaimLog[]>;
  isClaimed(cashout: Address, id: bigint, block: bigint): Promise<boolean>;
  cashoutSigner(cashout: Address): Promise<Address>;
}

export function viemReader(rpcUrl: string): ChainReader {
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 3 }) });
  const time = (t: bigint) => new Date(Number(t) * 1000);
  return {
    chainId: () => client.getChainId(),
    async finalized() {
      const b = await client.getBlock({ blockTag: 'finalized' });
      return { number: b.number, time: time(b.timestamp) };
    },
    async blockTime(block) {
      return time((await client.getBlock({ blockNumber: block })).timestamp);
    },
    async transfers(token, to, fromBlock, toBlock) {
      const logs = await client.getContractEvents({
        address: token,
        abi: ERC20_ABI,
        eventName: 'Transfer',
        args: { to },
        fromBlock,
        toBlock,
        strict: true,
      });
      return logs.map((l) => ({
        txHash: l.transactionHash,
        logIndex: l.logIndex,
        blockNumber: l.blockNumber,
        from: l.args.from,
        value: l.args.value,
      }));
    },
    async claims(cashouts, fromBlock, toBlock) {
      if (cashouts.length === 0) return [];
      const logs = await client.getContractEvents({
        address: cashouts,
        abi: CASHOUT_ABI,
        eventName: 'Claimed',
        fromBlock,
        toBlock,
        strict: true,
      });
      return logs.map((l) => ({
        address: l.address,
        txHash: l.transactionHash,
        blockNumber: l.blockNumber,
        logIndex: l.logIndex,
        id: l.args.id,
        recipient: l.args.recipient,
        amount: l.args.amount,
      }));
    },
    isClaimed: (cashout, id, block) =>
      client.readContract({ address: cashout, abi: CASHOUT_ABI, functionName: 'claimed', args: [id], blockNumber: block }),
    cashoutSigner: (cashout) => client.readContract({ address: cashout, abi: CASHOUT_ABI, functionName: 'signer' }),
  };
}
