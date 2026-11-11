export interface BrowserFrames {
  clockDomain: 'browser_raf_timestamp';
  metric: 'active_recording_browser_frame_interval_ms';
  samples: number[];
  observedFrames: number;
  truncated: boolean;
  gameWindow: Record<string, unknown> | null;
  gameWindowObservedAt: number | null;
  gameWindowLookbackSeconds: 5;
  gameWindowMaximumFrames: 240;
  scopedWallMs: { active_recording: number; paused: number; active_not_recording: number; inactive: number };
}
export function installBrowserFrameObserver(options: { maxSamples: number }): void;
export function stopBrowserFrameObserver(): BrowserFrames;
