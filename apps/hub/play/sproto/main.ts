import { HubEvent, createHubSdk, installHubSdk } from '@metaverse/hub-sdk';
import './style.css';

const status = document.querySelector('#status');
const result = document.querySelector('#result');
const defeat = document.querySelector('#defeat');
const replay = document.querySelector('#replay');
const exit = document.querySelector('#exit');
const god = document.querySelector('#god');
const exchange = document.querySelector('#exchange');
const amount = document.querySelector('#amount');
const wallet = document.querySelector('#wallet');
if (
  !(status instanceof HTMLElement) ||
  !(result instanceof HTMLElement) ||
  !(defeat instanceof HTMLButtonElement) ||
  !(replay instanceof HTMLButtonElement) ||
  !(exit instanceof HTMLButtonElement) ||
  !(god instanceof HTMLInputElement) ||
  !(exchange instanceof HTMLButtonElement) ||
  !(amount instanceof HTMLInputElement) ||
  !(wallet instanceof HTMLElement)
) {
  throw new Error('Sproto mock markup is missing');
}

const TICKETS_PER_WIN = 20;
let tickets = 0;

const sdk = installHubSdk(createHubSdk({
  serverUrl: '',
  serverKey: __NAKAMA_SERVER_KEY__,
  hubUrl: '/hub/',
}));

let ready = false;
let lastKey = '';
let lastData: { boss: 'tinubu'; elapsed: number; godMode: boolean } | null = null;

const profile = await sdk.init('sproto').catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : 'Could not open the ticket';
  return null;
});

if (profile && sessionStorage.getItem('hub:sproto:session')) {
  ready = true;
  defeat.disabled = false;
  exchange.disabled = false;
  const owned = profile.relics.includes('tinubu_crown') ? "Tinubu's Crown is already yours." : 'Tinubu is waiting.';
  status.textContent = `${owned} Player ${profile.playerId.slice(0, 8)}.`;
} else if (profile) {
  status.textContent = 'Open this page from the Castle portal in the hub.';
}

defeat.addEventListener('click', () => {
  void report(true);
});
replay.addEventListener('click', () => {
  void report(false);
});
exit.addEventListener('click', () => {
  if (ready) sdk.exit('menu');
  else window.location.assign('/hub/#from=sproto');
});
exchange.addEventListener('click', () => {
  void swap();
});

function showWallet(verse?: number): void {
  if (!(wallet instanceof HTMLElement)) return;
  wallet.textContent = `Tickets ${tickets}${verse === undefined ? '' : ` · Verse ${verse}`}`;
}

async function report(fresh: boolean): Promise<void> {
  if (!ready) return;
  if (!(god instanceof HTMLInputElement) || !(replay instanceof HTMLButtonElement) || !(result instanceof HTMLElement)) return;
  const data = fresh || !lastData
    ? { boss: 'tinubu' as const, elapsed: 12, godMode: god.checked }
    : lastData;
  const key = fresh || !lastKey ? `tinubu-${crypto.randomUUID()}` : lastKey;
  lastKey = key;
  lastData = data;
  replay.disabled = false;
  try {
    const earned = await sdk.earnTickets(TICKETS_PER_WIN, 'win', `earn:${key}`);
    tickets = earned.balance;
    showWallet();
    const outcome = await sdk.reportEvent(HubEvent.SprotoBossDefeated, data, key);
    if (outcome.granted === 'tinubu_crown') {
      result.textContent = fresh
        ? 'Tinubu\'s Crown granted. God mode did not block it.'
        : 'Replay returned the stored grant. The ledger did not grow.';
    } else {
      result.textContent = 'Already earned. Sending it again did not grant a second Crown.';
    }
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : 'The report failed';
  }
}

async function swap(): Promise<void> {
  if (!ready) return;
  if (!(amount instanceof HTMLInputElement) || !(result instanceof HTMLElement)) return;
  const requested = Number(amount.value);
  try {
    const traded = await sdk.exchange(requested, `exchange-${crypto.randomUUID()}`);
    tickets = traded.ticketsLeft;
    showWallet(traded.verse);
    result.textContent = `Exchanged. Receipt ${traded.receiptId}.`;
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : 'Exchange failed';
  }
}
