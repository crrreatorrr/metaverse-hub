// Stands in for @reown/appkit/core (see vite.config.ts). WalletConnect only imports it when
// showQrModal is true, which the exchange machine never sets.
export function createAppKit(): never {
  throw new Error('WalletConnect QR modal is disabled; the exchange machine draws its own QR code');
}
