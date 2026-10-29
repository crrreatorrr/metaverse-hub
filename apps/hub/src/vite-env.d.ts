/// <reference types="vite/client" />

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
