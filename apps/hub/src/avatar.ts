import {
  AdditiveBlending,
  AnimationClip,
  AnimationMixer,
  Box3,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
  Vector4,
  type AnimationAction,
  type Material,
  type Object3D,
} from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { AVATAR_CLIPS, AVATAR_HEIGHT, CHARACTERS, DEFAULT_CHARACTER, SOCKETS, characterHeight, type CharacterConfig, type CharacterId } from './config';
import type { AvatarLook } from './look';
import { STAND_Y } from './physics';
import { loadGLTF } from './v2/core';

export interface AvatarRig {
  readonly group: Group;
  /** Fetch the mesh. Call after the first-load byte snapshot. */
  load(): void;
  update(dt: number, moving: boolean, sprint: boolean): void;
  /** Tint, glow, height and Relic aura. Applies now, or when the mesh arrives. */
  setLook(look: AvatarLook): void;
}

const size = new Vector3();

function characterById(id: CharacterId): CharacterConfig {
  return CHARACTERS.find((entry) => entry.id === id) ?? CHARACTERS[0];
}
const point = new Vector3();
const bindVertex = new Vector4();
const skinned = new Vector4();
const weighted = new Vector4();
const bone = new Matrix4();

export function createAvatarRig(): AvatarRig {
  const group = new Group();
  group.name = 'player-avatar';
  let mixer: AnimationMixer | null = null;
  let actions: Record<'idle' | 'walk' | 'run', AnimationAction> | null = null;
  let gait: 'idle' | 'walk' | 'run' = 'idle';
  let started = false;
  let materials: MeshStandardMaterial[] = [];
  let look: AvatarLook | null = null;
  let auraClock = 0;
  /** Character whose mesh is on screen or loading. */
  let shown: CharacterId | null = null;
  let loadToken = 0;
  let model: Object3D | null = null;
  const body = new Group();
  body.name = 'avatar-body';
  group.add(body);
  const aura = createAura();
  group.add(aura.group);

  function load(): void {
    if (started) return;
    started = true;
    show(look?.character ?? DEFAULT_CHARACTER);
  }

  /** Swap the mesh. The old one stays until the new one is ready, so the player never vanishes. */
  function show(id: CharacterId): void {
    if (id === shown) return;
    shown = id;
    const token = ++loadToken;
    const character = characterById(id);
    const url = `${import.meta.env.BASE_URL}${character.asset}`;
    void loadGLTF(url)
      .then((gltf) => {
        if (token !== loadToken) return;
        const next = fitModel(gltf.scene, characterHeight(character));
        const nextMaterials = ownMaterials(next);
        const nextMixer = new AnimationMixer(next);
        const claimed = new WeakSet<AnimationClip>();
        const nextActions = {
          idle: playClip(nextMixer, gltf.animations, 'idle', claimed),
          walk: playClip(nextMixer, gltf.animations, 'walk', claimed),
          run: playClip(nextMixer, gltf.animations, 'run', claimed),
        };
        if (model) disposeModel(model, materials);
        model = next;
        materials = nextMaterials;
        mixer = nextMixer;
        actions = nextActions;
        body.add(next);
        if (look) paint(look);
        actions[gait].play();
      })
      .catch((error: unknown) => {
        console.error(`[hub] ${character.label} avatar failed to load`, error);
        if (token !== loadToken) return;
        if (id !== DEFAULT_CHARACTER) {
          shown = null;
          show(DEFAULT_CHARACTER);
        }
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

  function paint(next: AvatarLook): void {
    for (const material of materials) {
      material.color.set(next.tint);
      material.emissive.set(next.glow);
      material.emissiveIntensity = next.glowStrength * 0.9;
    }
  }

  function setLook(next: AvatarLook): void {
    look = next;
    if (started) show(next.character);
    // Scale about the feet: the rig origin is the capsule top, STAND_Y above the floor.
    body.scale.setScalar(next.height);
    body.position.y = -STAND_Y * (1 - next.height);
    paint(next);
    const socket = SOCKETS.find((entry) => entry.id === next.aura);
    aura.group.visible = Boolean(socket);
    if (socket) aura.setColor(socket.color);
  }

  function tick(dt: number, moving: boolean, sprint: boolean): void {
    if (aura.group.visible) {
      auraClock += dt;
      aura.ring.rotation.z += dt * 0.9;
      const pulse = 0.5 + 0.5 * Math.sin(auraClock * 2.6);
      aura.ringMat.opacity = 0.55 + pulse * 0.35;
      aura.columnMat.opacity = 0.22 + pulse * 0.16;
    }
    update(dt, moving, sprint);
  }

  return { group, load, update: tick, setLook };
}

/** Frees this copy's skeleton and cloned materials. Geometry and textures stay in the GLTF cache. */
function disposeModel(root: Object3D, materials: readonly Material[]): void {
  root.removeFromParent();
  root.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (mesh.isSkinnedMesh) mesh.skeleton.dispose();
  });
  for (const material of materials) material.dispose();
}

/** The GLTF cache shares materials. Clone them so a tint stays on this avatar. */
function ownMaterials(root: Object3D): MeshStandardMaterial[] {
  const owned: MeshStandardMaterial[] = [];
  const swap = (material: Material): Material => {
    if (!(material instanceof MeshStandardMaterial)) return material;
    const copy = material.clone();
    owned.push(copy);
    return copy;
  };
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return owned;
}

/** Spinning floor ring plus a soft column. Two draw calls, shown only with a Relic aura. */
function createAura(): {
  group: Group;
  ring: Mesh;
  ringMat: MeshBasicMaterial;
  columnMat: MeshBasicMaterial;
  setColor: (color: string) => void;
} {
  const group = new Group();
  group.name = 'relic-aura';
  group.visible = false;
  const ringMat = new MeshBasicMaterial({
    map: ringTexture(),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
  const ring = new Mesh(new RingGeometry(0.55, 1.05, 48, 1), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -STAND_Y + 0.05;
  ring.renderOrder = 2;
  const columnMat = new MeshBasicMaterial({
    map: columnTexture(),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
  const columnHeight = AVATAR_HEIGHT * 1.1;
  const column = new Mesh(new CylinderGeometry(0.62, 0.78, columnHeight, 32, 1, true), columnMat);
  column.position.y = -STAND_Y + columnHeight / 2;
  column.renderOrder = 2;
  group.add(ring, column);
  return {
    group,
    ring,
    ringMat,
    columnMat,
    setColor(color: string) {
      ringMat.color.set(color);
      columnMat.color.set(color);
    },
  };
}

function ringTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = 128;
    const fade = ctx.createRadialGradient(c, c, 60, c, c, 128);
    fade.addColorStop(0, 'rgba(255,255,255,0)');
    fade.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 256, 256);
    // Rune ticks so the spin reads.
    ctx.fillStyle = 'rgba(255,255,255,1)';
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * 100, c + Math.sin(a) * 100, i % 3 === 0 ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function columnTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const fade = ctx.createLinearGradient(0, 0, 0, 128);
    fade.addColorStop(0, 'rgba(255,255,255,0)');
    fade.addColorStop(1, 'rgba(255,255,255,0.7)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 4, 128);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Resolve idle / walk / run through `AVATAR_CLIPS`. Walk's source clip is `run`. */
function requiredClip(
  clips: readonly AnimationClip[],
  gait: keyof typeof AVATAR_CLIPS,
  claimed: WeakSet<AnimationClip>,
): AnimationClip {
  const source = AVATAR_CLIPS[gait].name;
  const found = clips.find((clip) => clip.name === source);
  if (!found) throw new Error(`Avatar is missing the ${source} clip (${gait})`);
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
  const action = mixer.clipAction(requiredClip(clips, gait, claimed));
  action.timeScale = AVATAR_CLIPS[gait].timeScale;
  return action;
}

/** Height-fit the body. Props held in the hands (staff, phone, vape) stay in the mesh and are left out of the bounds. */
function fitModel(source: Group, height: number): Object3D {
  const model = SkeletonUtils.clone(source);
  model.rotation.y = Math.PI;
  model.updateMatrixWorld(true);
  const body = bodySpan(model);
  if (body.height < 0.2 || body.height > 20) {
    throw new Error(`Avatar body height is implausible (${body.height.toFixed(3)} m)`);
  }
  model.scale.setScalar(height / body.height);
  const fitted = bodySpan(model);
  model.position.y = -STAND_Y - fitted.minY;
  model.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) mesh.frustumCulled = false;
  });
  return model;
}

/** Staffs and props are skinned to the hands and can reach above the head. */
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
