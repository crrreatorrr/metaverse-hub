import { loadEnv, type ConfigEnv } from 'vite';

/** The compose stack's dev key. Inlined only for `vite dev` and `--mode development`. */
export const DEV_SERVER_KEY = 'defaultkey';

type KeyEnv = Pick<ConfigEnv, 'command' | 'mode'> & { isPreview?: boolean };

/**
 * The Nakama server key the plaza bundle inlines as `__NAKAMA_SERVER_KEY__`.
 *
 * Development uses the compose default. Every other build needs VITE_NAKAMA_SERVER_KEY:
 * an empty key would ship `Basic Og==` and every login would fail, so the build stops
 * instead. `vite preview` serves an existing dist and inlines nothing, so it never throws.
 * A dev server in another mode starts with a warning, since its logins would fail.
 */
export function nakamaServerKey(env: KeyEnv, value: string | undefined, warn: (message: string) => void = console.warn): string {
  if (env.mode === 'development') return DEV_SERVER_KEY;
  const key = (value ?? '').trim();
  if (key !== '') return key;
  if (env.command === 'build') {
    throw new Error(
      `VITE_NAKAMA_SERVER_KEY is empty. A "${env.mode}" build would ship an empty Nakama server key and every login would fail. ` +
        `Set it to the server key from deploy/.env (NAKAMA_SERVER_KEY) in the environment or in apps/hub/.env.${env.mode} (gitignored), ` +
        'or build with --mode development for a local bundle.',
    );
  }
  if (!env.isPreview) {
    warn(`VITE_NAKAMA_SERVER_KEY is empty in mode "${env.mode}": logins from this dev server will fail. Use --mode development for the dev key.`);
  }
  return key;
}

/**
 * nakamaServerKey with the key read the way Vite reads env: `.env`, `.env.<mode>` and
 * their `.local` variants in `envDir`, with the process environment taking precedence.
 */
export function nakamaServerKeyFromEnv(env: KeyEnv, envDir: string, warn?: (message: string) => void): string {
  return nakamaServerKey(env, loadEnv(env.mode, envDir, 'VITE_').VITE_NAKAMA_SERVER_KEY, warn);
}
