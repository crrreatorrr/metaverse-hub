import { RELIC_IDS, TICKETS_PER_VERSE, VERSE_DAILY_CAP } from '@metaverse/hub-sdk';

/**
 * First-visit card (plan item D1). Pure: the HUD paints what `onboardingStep` returns.
 * Three steps, ticked from state the plaza already has:
 *   1. Walk to a gate            (you stood in an entrance, or already hold a Relic)
 *   2. Win your first Relic there (profile.relics is not empty)
 *   3. Come back: it lights a socket on the statue (you are in the plaza holding it)
 */
export const ONBOARDING_SEEN_KEY = 'hub:seen';

export interface OnboardingState {
  /** `hub:seen` is set in this browser: the card finished or was dismissed on an earlier visit. */
  seen: boolean;
  /** Dismissed during this visit. */
  dismissed: boolean;
  /** Relics the account holds, or null while the profile has not loaded. */
  relics: number | null;
  /** The player stood inside a game entrance (or at the cabinet) during this visit. */
  reachedGate: boolean;
}

export interface OnboardingView {
  /** Paint the card. False once the account holds a Relic: the return card takes over from there. */
  show: boolean;
  /** One flag per step. */
  ticks: readonly [boolean, boolean, boolean];
  /** Index of the first unticked step, or 3 when all are done. */
  current: 0 | 1 | 2 | 3;
}

export const ONBOARDING_STEPS: readonly { title: string; note: string }[] = [
  { title: 'Walk to a gate', note: 'Follow a marker to an entrance and stand in it.' },
  { title: 'Win your first Relic there', note: 'Each game gives one Relic, once.' },
  { title: 'Come back', note: 'It lights a socket on the statue.' },
];

export function onboardingStep(state: OnboardingState): OnboardingView {
  const has = (state.relics ?? 0) > 0;
  const ticks = [state.reachedGate || has, has, has] as const;
  const current = (ticks[0] ? (ticks[1] ? 3 : 1) : 0) as 0 | 1 | 2 | 3;
  // A new guest (or an offline visit, relics unknown) sees it. An account that already holds a
  // Relic never does: step 3 is done, and the return card announces the Relic itself.
  const show = !state.seen && !state.dismissed && !has;
  return { show, ticks, current };
}

/** Write `hub:seen` now? After a dismissal, or once the account holds a Relic (step 3 is done). */
export function onboardingFinished(state: OnboardingState): boolean {
  return state.dismissed || (state.relics ?? 0) > 0;
}

/** The "?" explainer. Numbers come from the SDK so they cannot drift from the server's rules. */
export const EXPLAINER: readonly { term: string; text: string }[] = [
  { term: 'Tickets', text: `Earned inside a game and kept in that game's wallet. Exchange them in Menu → Wallet: ${TICKETS_PER_VERSE} Tickets make 1 Verse.` },
  { term: 'Verse', text: `One balance for your whole account. Each game can give up to ${VERSE_DAILY_CAP} Verse a day, so playing several games earns more.` },
  { term: 'Relics', text: `${RELIC_IDS.length} trophies, one per game, each earned once. A Relic orbits you, lights a socket on the statue and unlocks an aura.` },
];
