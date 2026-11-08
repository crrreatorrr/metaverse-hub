import type { ConfigEnv } from 'vite';

/** The compose stack's dev key. Inlined only for `vite dev` and `--mode development`. */
export const DEV_SERVER_KEY = 'defaultkey';

/**
 * The Nakama server key the plaza bundle inlines as `__NAKAMA_SERVER_KEY__`.
 *
 * Development uses the compose default. Every other build needs VITE_NAKAMA_SERVER_KEY:
 * an empty key would ship `Basic Og==` and every login would fail, so the build stops
 * instead. `vite preview` serves an existing dist and inlines nothing, so it never throws.
 */
export function nakamaServerKey(env: Pick<ConfigEnv, 'command' | 'mode'>, value: string | undefined): string {
  if (env.mode === 'development') return DEV_SERVER_KEY;
  const key = (value ?? '').trim();
  if (key === '' && env.command === 'build') {
    throw new Error(
      `VITE_NAKAMA_SERVER_KEY is empty. A "${env.mode}" build would ship an empty Nakama server key and every login would fail. ` +
        'Set it to the server key from deploy/.env (NAKAMA_SERVER_KEY), or build with --mode development for a local bundle.',
    );
  }
  return key;
}
