/// <reference types="vite/client" />

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
