import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  Matrix4,
  Mesh,
  SkinnedMesh,
  Vector3,
  Vector4,
  type AnimationAction,
  type Object3D,
} from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { AVATAR_ASSET, AVATAR_BLEND, AVATAR_CLIPS, AVATAR_HEIGHT, SPRINT_SPEED, WALK_SPEED } from './config';
import { STAND_Y } from './physics';
import { loadGLTF } from './v2/core';

export interface AvatarRig {
  readonly group: Group;
  /** Fetch the mesh. Call after the first-load byte snapshot. */
  load(): void;
  update(dt: number, moving: boolean, sprint: boolean): void;
}

const size = new Vector3();
const point = new Vector3();
const bindVertex = new Vector4();
const skinned = new Vector4();
const weighted = new Vector4();
const bone = new Matrix4();

export function createAvatarRig(): AvatarRig {
  const group = new Group();
  group.name = 'wizard-avatar';
  let mixer: AnimationMixer | null = null;
  let actions: Record<'idle' | 'walk' | 'run', AnimationAction> | null = null;
  let gait: 'idle' | 'walk' | 'run' = 'idle';
  let started = false;

  function load(): void {
    if (started) return;
    started = true;
    const url = `${import.meta.env.BASE_URL}${AVATAR_ASSET}`;
    void loadGLTF(url)
      .then((gltf) => {
        const model = fitWizard(gltf.scene);
        group.add(model);
        mixer = new AnimationMixer(model);
        const claimed = new WeakSet<AnimationClip>();
        actions = {
          idle: playClip(mixer, gltf.animations, 'idle', claimed),
          walk: playClip(mixer, gltf.animations, 'walk', claimed),
          run: playClip(mixer, gltf.animations, 'run', claimed),
        };
        actions.idle.play();
      })
      .catch((error: unknown) => {
        console.error('[hub] wizard avatar failed to load', error);
      });
  }

  function update(dt: number, moving: boolean, sprint: boolean): void {
    if (!mixer || !actions) return;
    const next: 'idle' | 'walk' | 'run' = !moving ? 'idle' : sprint ? 'run' : 'walk';
    if (next !== gait) {
      const from = actions[gait];
      const to = actions[next];
      const fade =
        gait === 'idle' ? AVATAR_BLEND.idleToMove
        : next === 'idle' ? AVATAR_BLEND.moveToIdle
        : next === 'run' ? AVATAR_BLEND.jogToDash
        : AVATAR_BLEND.dashToJog;
      to.reset();
      // jog ↔ dash: keep the step phase (both clips put the left foot down at t = 0)
      if (gait !== 'idle' && next !== 'idle') to.time = (from.time / from.getClip().duration) * to.getClip().duration;
      to.setEffectiveWeight(1).play();
      from.crossFadeTo(to, fade, false);
      gait = next;
    }
    mixer.update(dt);
  }

  return { group, load, update };
}

/** Resolve idle / walk / run through `AVATAR_CLIPS`. Walk's source clip is `run`. */
function requiredClip(
  clips: readonly AnimationClip[],
  gait: keyof typeof AVATAR_CLIPS,
  claimed: WeakSet<AnimationClip>,
): AnimationClip {
  const source = AVATAR_CLIPS[gait].name;
  const found = clips.find((clip) => clip.name === source);
  if (!found) throw new Error(`Wizard avatar is missing the ${source} clip (${gait})`);
  if (claimed.has(found)) {
    const copy = found.clone();
    copy.name = gait;
    return copy;
  }
  claimed.add(found);
  return found;
}

function playClip(
  mixer: AnimationMixer,
  clips: readonly AnimationClip[],
  gait: keyof typeof AVATAR_CLIPS,
  claimed: WeakSet<AnimationClip>,
): AnimationAction {
  const clip = requiredClip(clips, gait, claimed);
  const action = mixer.clipAction(clip);
  // Gait clips carry their authored ground speed; scale playback to the controller speed.
  const authored = Number((clip.userData as { speed_mps?: number }).speed_mps);
  const actual = gait === 'run' ? SPRINT_SPEED : gait === 'walk' ? WALK_SPEED : 0;
  action.timeScale = authored > 0 && actual > 0 ? actual / authored : AVATAR_CLIPS[gait].timeScale;
  return action;
}

/** Height-fit the body. The baked staff stays in the mesh and is left out of the bounds. */
function fitWizard(source: Group): Object3D {
  const model = SkeletonUtils.clone(source);
  model.rotation.y = Math.PI;
  model.updateMatrixWorld(true);
  const body = bodySpan(model);
  if (body.height < 0.2 || body.height > 20) {
    throw new Error(`Wizard body height is implausible (${body.height.toFixed(3)} m)`);
  }
  model.scale.setScalar(AVATAR_HEIGHT / body.height);
  const fitted = bodySpan(model);
  model.position.y = -STAND_Y - fitted.minY;
  model.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) mesh.frustumCulled = false;
  });
  return model;
}

/** The staff is skinned to the hands and reaches above the head. */
const STAFF_BONES = new Set(['LeftHand', 'RightHand']);

/**
 * Vertical span of the skinned body. Hand-weighted vertices are the baked
 * staff, so they do not set the fit. Raw positions are a quantized bind pose
 * and only land on the body after the joints run.
 */
function bodySpan(root: Object3D): { minY: number; height: number } {
  root.updateMatrixWorld(true);
  let minY = Infinity;
  let maxY = -Infinity;
  let found = false;
  root.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    if (!position || !skinIndex || !skinWeight) return;
    mesh.skeleton.update();
    const bones = mesh.skeleton.boneMatrices;
    const names = mesh.skeleton.bones.map((entry) => entry.name);
    if (!bones) return;
    for (let i = 0; i < position.count; i += 1) {
      let strongest = 0;
      let boneIndex = 0;
      for (let k = 0; k < skinWeight.itemSize; k += 1) {
        const weight = skinWeight.getComponent(i, k);
        if (weight > strongest) {
          strongest = weight;
          boneIndex = skinIndex.getComponent(i, k);
        }
      }
      if (STAFF_BONES.has(names[boneIndex] ?? '')) continue;
      bindVertex.set(position.getX(i), position.getY(i), position.getZ(i), 1);
      bindVertex.applyMatrix4(mesh.bindMatrix);
      skinned.set(0, 0, 0, 0);
      for (let k = 0; k < skinWeight.itemSize; k += 1) {
        const weight = skinWeight.getComponent(i, k);
        if (weight === 0) continue;
        bone.fromArray(bones, skinIndex.getComponent(i, k) * 16);
        weighted.copy(bindVertex).applyMatrix4(bone);
        skinned.addScaledVector(weighted, weight);
      }
      skinned.applyMatrix4(mesh.bindMatrixInverse);
      point.set(skinned.x, skinned.y, skinned.z).applyMatrix4(mesh.matrixWorld);
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
      found = true;
    }
  });
  if (!found) {
    const box = new Box3().setFromObject(root);
    return { minY: box.min.y, height: box.getSize(size).y };
  }
  return { minY, height: maxY - minY };
}
