import type { FrameState, RealmContext } from './realm';
import { buildPortal } from './portal';

/** Full-page crossing frees the departed realm's assets and keeps tab/account storage. */
export async function createRealmGate(ctx: RealmContext, opts: { x: number; z: number; destination: string; label: string; tint?: string; beam?: boolean; core?: boolean }) {
  const root = await buildPortal(opts.tint ?? '#a5a5a5', 5, { beam: opts.beam, core: opts.core });
  root.position.set(opts.x, 0, opts.z);
  ctx.engine.scene.add(root);
  let near = false;
  let dwell = 0;
  let leaving = false;
  return {
    root,
    interaction: {
      active: () => near,
      prompt: () => leaving ? `Entering ${opts.label}…` : `Walk through the gate to ${opts.label}`,
    },
    update(dt: number, state: FrameState) {
      const distance = Math.hypot(state.position.x - opts.x, state.position.z - opts.z);
      near = Math.abs(state.position.y) < 8 && distance < 7;
      if (leaving) return;
      if (ctx.isBlocked() || !near || distance > 2.4) { dwell = 0; return; }
      dwell += dt;
      if (dwell < 1) return;
      leaving = true;
      window.location.assign(opts.destination);
    },
  };
}
