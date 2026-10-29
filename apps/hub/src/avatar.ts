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
import { AVATAR_ASSET, AVATAR_HEIGHT, SPRINT_SPEED, WALK_SPEED } from './config';
import { STAND_Y } from './physics';
import { loadGLTF } from './v2/core';

/**
 * Clip names inside wizard_player.glb. The file has no walk cycle;
 * walk reuses `run` at the walk/run speed ratio.
 */
export const AVATAR_CLIP = {
  idle: 'idle',
  walk: 'run',
  run: 'run',
} as const;

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
        const idle = requiredClip(gltf.animations, AVATAR_CLIP.idle);
        const run = requiredClip(gltf.animations, AVATAR_CLIP.run);
        const walk = run.clone();
        walk.name = 'walk';
        actions = {
          idle: mixer.clipAction(idle),
          walk: mixer.clipAction(walk),
          run: mixer.clipAction(run),
        };
        actions.walk.timeScale = WALK_SPEED / SPRINT_SPEED;
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
      actions[gait].fadeOut(0.18);
      gait = next;
      actions[gait].reset().fadeIn(0.18).play();
    }
    mixer.update(dt);
  }

  return { group, load, update };
}

function requiredClip(clips: readonly AnimationClip[], name: string): AnimationClip {
  const found = clips.find((clip) => clip.name === name);
  if (!found) throw new Error(`Wizard avatar is missing the ${name} clip`);
  return found;
}

/** Height-fit the shipped mesh, staff included, and plant the bounds on the ground. */
function fitWizard(source: Group): Object3D {
  const model = SkeletonUtils.clone(source);
  model.rotation.y = Math.PI;
  model.updateMatrixWorld(true);
  const height = skinnedBounds(model).getSize(size).y;
  if (height < 0.2 || height > 20) {
    throw new Error(`Wizard avatar bounds are implausible (${height.toFixed(3)} m)`);
  }
  model.scale.setScalar(AVATAR_HEIGHT / height);
  const fitted = skinnedBounds(model);
  model.position.y = -STAND_Y - fitted.min.y;
  model.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) mesh.frustumCulled = false;
  });
  return model;
}

/**
 * Bind-pose bounds after skinning. The wizard's raw positions are a tiny
 * quantized bind pose; the staff and body only show up once the joints run.
 */
function skinnedBounds(root: Object3D): Box3 {
  root.updateMatrixWorld(true);
  const box = new Box3();
  let skinnedMesh = false;
  root.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    skinnedMesh = true;
    const position = mesh.geometry.getAttribute('position');
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    if (!position || !skinIndex || !skinWeight) return;
    mesh.skeleton.update();
    const bones = mesh.skeleton.boneMatrices;
    if (!bones) return;
    for (let i = 0; i < position.count; i += 1) {
      bindVertex.set(position.getX(i), position.getY(i), position.getZ(i), 1);
      bindVertex.applyMatrix4(mesh.bindMatrix);
      skinned.set(0, 0, 0, 0);
      const influences = skinWeight.itemSize;
      for (let k = 0; k < influences; k += 1) {
        const weight = skinWeight.getComponent(i, k);
        if (weight === 0) continue;
        bone.fromArray(bones, skinIndex.getComponent(i, k) * 16);
        weighted.copy(bindVertex).applyMatrix4(bone);
        skinned.addScaledVector(weighted, weight);
      }
      skinned.applyMatrix4(mesh.bindMatrixInverse);
      point.set(skinned.x, skinned.y, skinned.z).applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(point);
    }
  });
  if (!skinnedMesh) box.setFromObject(root);
  return box;
}
