// Native JS deliberately serializes into the actual browser without compiler
// helpers/closures. Observe only RAF and existing read-only Game telemetry.
export function installBrowserFrameObserver(options) {
  if (!Number.isInteger(options.maxSamples) || options.maxSamples < 1 || options.maxSamples > 60000) throw new Error('bounded browser frame observer required');
  if (window.__shooterBenchmarkFrames) throw new Error('browser observer already installed');
  const state = { samples: [], observedFrames: 0, truncated: false, stopped: false, raf: 0, gameWindow: null, gameWindowObservedAt: null, scopedWallMs: { active_recording: 0, paused: 0, active_not_recording: 0, inactive: 0 } };
  window.__shooterBenchmarkFrames = state;
  let previous = null, previousTime = null, previousScope = 'inactive', nextGameSample = 0;
  const frame = time => {
    if (state.stopped) return;
    const campaign = window.__game?.rewardedCampaign?.snapshot();
    const scope = campaign?.paused ? 'paused' : campaign?.active && campaign.recording ? 'active_recording' : campaign?.active ? 'active_not_recording' : 'inactive';
    if (previousTime !== null && time > previousTime) state.scopedWallMs[previousScope] += time - previousTime;
    previousTime = time; previousScope = scope;
    if (campaign?.active && campaign.recording && !campaign.paused) {
      state.observedFrames++;
      if (time >= nextGameSample) {
        state.gameWindow = window.__game?.perfCounters?.report(5, performance.now()) ?? null;
        state.gameWindowObservedAt = time; nextGameSample = time + 1000;
      }
      if (previous !== null && time > previous) {
        if (state.samples.length < options.maxSamples) state.samples.push(time - previous);
        else state.truncated = true;
      }
      previous = time;
    } else previous = null;
    state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);
}
export function stopBrowserFrameObserver() {
  const state = window.__shooterBenchmarkFrames;
  if (!state) throw new Error('browser observer not installed');
  state.stopped = true; cancelAnimationFrame(state.raf);
  return { clockDomain: 'browser_raf_timestamp', metric: 'active_recording_browser_frame_interval_ms', samples: [...state.samples], observedFrames: state.observedFrames, truncated: state.truncated,
    // A separate rolling240 Game CPU/render/GPU window, never raw whole-run p95.
    gameWindow: state.gameWindow, gameWindowObservedAt: state.gameWindowObservedAt, gameWindowLookbackSeconds: 5, gameWindowMaximumFrames: 240, scopedWallMs: { ...state.scopedWallMs } };
}
