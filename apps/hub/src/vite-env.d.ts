/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REALM_GATE_SANDBOX?: string;
  /** Apex hostname. Production portals use `https://play.<domain>/<slug>/`. */
  readonly VITE_PLAY_DOMAIN?: string;
  readonly VITE_GAME_URL_HPOS10I?: string;
  readonly VITE_GAME_URL_NOBU?: string;
  readonly VITE_GAME_URL_PEOPLES_BITCOIN?: string;
  readonly VITE_GAME_URL_SPROTO_DUEL?: string;
  readonly VITE_GAME_URL_SPROTO_FIGHTER?: string;
  readonly VITE_GAME_URL_SPROTO_ARCADE?: string;
  readonly VITE_GAME_URL_SPROTO_SHOOTER?: string;
  readonly VITE_GAME_URL_SPROTO_COOP_BATTLE?: string;
}

/** Inlined by vite.config.ts (server-key.ts). A non-development build fails if VITE_NAKAMA_SERVER_KEY is empty. */
declare const __NAKAMA_SERVER_KEY__: string;

/** Short commit of this hub build (vite.config.ts), or `dev`. */
declare const __HUB_BUILD__: string;

interface HubDebugState {
  drawCalls: number;
  fps: number;
  x: number;
  y: number;
  z: number;
}

interface Window {
  __hub?: HubDebugState;
  plazaLoad?: { bytes: number; files: { name: string; bytes: number }[] };
}
