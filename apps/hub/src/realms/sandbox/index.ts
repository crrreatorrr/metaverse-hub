import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import type { RealmDefinition } from '../../core/realm';
import { createRealmGate } from '../../core/gates';
import { STAND_Y } from '../../physics';
import { buildSandboxCollider } from './collider';

export const sandboxRealm: RealmDefinition = {
  id: 'sandbox',
  engine: {
    fog: { color: '#777777', near: 120, far: 400 },
    sky: { top: '#555555', mid: '#777777', horizon: '#999999' },
    environmentIntensity: 0.7,
    hemi: { sky: '#ffffff', ground: '#555555', intensity: 1.3 },
    sun: { color: '#ffffff', intensity: 2.6, position: [-120, 160, 140] },
    bloom: 1.6,
  },
  loadingText: 'Loading the sandbox…',
  welcome: 'Welcome to the sandbox. Press Enter to chat.',
  spawn: () => ({ x: 0, y: STAND_Y, z: 0, yaw: 0 }),
  async build(ctx) {
    const material = new MeshStandardMaterial({ color: '#777777', roughness: 1 });
    ctx.engine.scene.add(new Mesh(new BoxGeometry(280, 2, 280).translate(0, -1, 0), material));
    for (const sign of [-1, 1]) {
      ctx.engine.scene.add(new Mesh(new BoxGeometry(1, 8, 280).translate(sign * 139.5, 4, 0), material));
      ctx.engine.scene.add(new Mesh(new BoxGeometry(280, 8, 1).translate(0, 4, sign * 139.5), material));
    }
    const gate = await createRealmGate(ctx, { x: 0, z: -20, destination: '/hub/#realm=sandbox', label: 'the plaza' });
    return {
      collider: buildSandboxCollider(),
      cameraFloor: () => 0.45,
      interactions: [gate.interaction],
      update: gate.update,
    };
  },
};
