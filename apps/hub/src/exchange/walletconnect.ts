// WalletConnect v2 for phone wallets. Its own chunk, loaded only when a player picks
// WalletConnect or had a WalletConnect session last time. The QR code is drawn by the
// exchange machine itself (showQrModal: false), so the Reown modal UI is never loaded.
import EthereumProvider from '@walletconnect/ethereum-provider';
import type { Eip1193Provider } from './wallets';

type Wc = Awaited<ReturnType<typeof EthereumProvider.init>>;

let instance: Promise<Wc> | null = null;

function init(projectId: string, chainId: number): Promise<Wc> {
  instance ??= EthereumProvider.init({
    projectId,
    optionalChains: [chainId],
    showQrModal: false,
    methods: ['eth_sendTransaction', 'personal_sign'],
    optionalMethods: ['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'eth_getBalance', 'eth_getTransactionReceipt'],
    events: ['chainChanged', 'accountsChanged'],
    metadata: {
      name: 'Metaverse Hub',
      description: 'Bar exchange machine: Verse and HPOS10I $BITCOIN',
      url: window.location.origin,
      icons: [],
    },
  }).catch((error) => {
    instance = null;
    throw error;
  });
  return instance;
}

export async function connect(projectId: string, chainId: number, onUri: (uri: string | null) => void): Promise<Eip1193Provider> {
  const wc = await init(projectId, chainId);
  if (wc.session) return wc as unknown as Eip1193Provider;
  const show = (uri: string) => onUri(uri);
  wc.on('display_uri', show);
  try {
    await wc.connect({ optionalChains: [chainId] });
  } finally {
    wc.removeListener('display_uri', show);
  }
  return wc as unknown as Eip1193Provider;
}

/** The previous session, if the phone still has it. Never shows a QR code. */
export async function resume(projectId: string, chainId: number): Promise<Eip1193Provider | null> {
  const wc = await init(projectId, chainId);
  return wc.session ? (wc as unknown as Eip1193Provider) : null;
}

export async function disconnect(): Promise<void> {
  if (!instance) return;
  const wc = await instance;
  if (wc.session) await wc.disconnect();
}
