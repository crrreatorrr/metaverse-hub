import type { RelicId } from '@metaverse/hub-sdk';
import { Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, OctahedronGeometry } from 'three';
import { RELIC_GEMS, type OrbitAvatar } from './types';

export interface OrbitGemsOptions {
  avatars?: readonly OrbitAvatar[];
  /** Instance capacity. Draw calls stay at 1 up to this count. Default 10. */
  maxAvatars?: number;
}

export interface OrbitGems {
  readonly root: Group;
  setAvatars(avatars: readonly OrbitAvatar[]): void;
  /** `now` is seconds from the same clock as `HubWorld.update`. */
  update(now: number): void;
  dispose(): void;
}

const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/**
 * One instanced octahedron for every owned Relic on every avatar.
 * Placeholder art: `OctahedronGeometry` and a white `MeshBasicMaterial`.
 * Instance color stands in for gem_hpos, gem_pb, gem_nobu, and gem_duel.
 */
export function addOrbitGems(scene: Object3D, opts: OrbitGemsOptions = {}): OrbitGems {
  const capacity = Math.max(1, Math.floor(opts.maxAvatars ?? 10));
  const group = new Group();
  group.name = 'm3-orbit';
  const geometry = new OctahedronGeometry(0.14, 0);
  const material = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const mesh = new InstancedMesh(geometry, material, capacity * RELIC_GEMS.length);
  mesh.name = 'm3-orbit-gems';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  const dummy = new Object3D();
  const tint = new Color();

  for (let index = 0; index < mesh.count; index += 1) {
    const relic = RELIC_GEMS[index % RELIC_GEMS.length];
    tint.set(relic?.color ?? '#ffffff');
    mesh.setColorAt(index, tint);
    mesh.setMatrixAt(index, HIDDEN);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  scene.add(group);

  const tracked: { anchor: Object3D; owned: boolean[] }[] = [];
  let warned = false;
  let disposed = false;

  function ownedMask(relics: readonly RelicId[]): boolean[] {
    const mask = RELIC_GEMS.map(() => false);
    for (const id of relics) {
      const index = RELIC_GEMS.findIndex((gem) => gem.id === id);
      if (index >= 0) mask[index] = true;
    }
    return mask;
  }

  function setAvatars(avatars: readonly OrbitAvatar[]): void {
    if (!warned && avatars.length > capacity) {
      warned = true;
      console.warn(`[m3] orbit gems keep the first ${capacity} avatars`);
    }
    tracked.length = 0;
    const seen = new Set<string>();
    for (const avatar of avatars) {
      if (tracked.length >= capacity) break;
      if (seen.has(avatar.id)) continue;
      seen.add(avatar.id);
      tracked.push({ anchor: avatar.anchor, owned: ownedMask(avatar.relics) });
    }
  }

  function update(now: number): void {
    if (disposed) return;
    let any = false;
    for (let slot = 0; slot < capacity; slot += 1) {
      const avatar = tracked[slot];
      if (avatar) avatar.anchor.updateWorldMatrix(true, false);
      for (let relicIndex = 0; relicIndex < RELIC_GEMS.length; relicIndex += 1) {
        const spec = RELIC_GEMS[relicIndex];
        const index = slot * RELIC_GEMS.length + relicIndex;
        if (!avatar || !spec || !avatar.owned[relicIndex]) {
          mesh.setMatrixAt(index, HIDDEN);
          continue;
        }
        any = true;
        const angle = now * spec.speed + spec.phase;
        avatar.anchor.getWorldPosition(dummy.position);
        dummy.position.x += Math.cos(angle) * spec.radius;
        dummy.position.y += spec.height + Math.sin(now * 2 + spec.phase) * 0.05;
        dummy.position.z += Math.sin(angle) * spec.radius;
        dummy.scale.setScalar(1);
        dummy.rotation.set(now * 1.4 + spec.phase, angle, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = any;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scene.remove(group);
    geometry.dispose();
    material.dispose();
  }

  setAvatars(opts.avatars ?? []);
  return { root: group, setAvatars, update, dispose };
}
