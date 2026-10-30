/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Apex hostname. Production portals use `https://play.<domain>/<slug>/`. */
  readonly VITE_PLAY_DOMAIN?: string;
  readonly VITE_GAME_URL_HPOS10I?: string;
  readonly VITE_GAME_URL_NOBU?: string;
  readonly VITE_GAME_URL_PEOPLES_BITCOIN?: string;
  readonly VITE_GAME_URL_SPROTO_DUEL?: string;
}

/** Inlined by vite.config.ts. Empty in production unless VITE_NAKAMA_SERVER_KEY is set. */
declare const __NAKAMA_SERVER_KEY__: string;

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
