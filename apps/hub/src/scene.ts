import {
  BackSide,
  Box3,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Euler,
  Fog,
  Group,
  HalfFloatType,
  HemisphereLight,
  InstancedMesh,
  LOD,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer, EffectPass, RenderPass, SelectiveBloomEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { createAvatarRig } from './avatar';
import { CAMERA_FOV, PLAZA_SLOT, PLAZA_YAW, SOCKETS } from './config';
import { STAND_Y } from './physics';
import { buildPlazaCollider } from './plaza-collider';
import type { Collider } from './collider';
import { animated, glow, initLoaders, instanced, mountGlow, neonMat, part, upgradeToLod0 } from './v2/core';
import { castle, club, greenHill, kennel, whiteHouse } from './v2/buildings';
import { buildInterior, type InteriorBuild } from './v2/interior';
import { buildFloor, buildPedestal, buildPortal } from './v2/plaza';
import { loadSignFont } from './v2/signs';

export interface Warp {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export type PlazaZone = 'door' | 'exit' | 'loading' | null;

export interface VerseStoreUi {
  /** Empty node `store_ui_anchor`. Null until the player enters the Bar. */
  readonly anchor: Object3D | null;
  /** The hub has no Verse store panel yet. Listeners run once the anchor exists. */
  whenReady(listener: (anchor: Object3D) => void): void;
}

export interface HubWorld {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  collider: Collider;
  rig: Group;
  bob: Group;
  avatar: Group;
  shadow: Mesh;
  shadowMat: MeshBasicMaterial;
  labels: Sprite[];
  sockets: { mesh: Mesh; on: boolean }[];
  sceneDraws: number;
  setRelics: (ids: readonly string[]) => void;
  setBoard: (title: string, rows: readonly (readonly [string, string])[], sample: boolean) => void;
  verseStoreUi: VerseStoreUi;
  inInterior: () => boolean;
  zone: () => PlazaZone;
  update: (dt: number, moving: boolean, sprint: boolean) => void;
  consumeWarp: () => Warp | null;
  render: () => void;
  resize: (width: number, height: number) => void;
}

interface SlotBuild {
  group: Group;
  door?: Object3D;
}

interface SlotState {
  key: string;
  a: number;
  front: number;
  sc: number;
  tint: string;
  build: () => Promise<SlotBuild>;
  phase: 'idle' | 'loading' | 'ready';
  group?: Group;
  door?: Object3D;
  near?: boolean;
}

const NEAR = 120;
const FAR = 400;

export async function createWorld(): Promise<HubWorld> {
  const scene = new Scene();
  scene.fog = new Fog('#5a1f62', 260, 820);
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.08, 4000);
  const renderer = new WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = NoToneMapping;
  camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  camera.updateProjectionMatrix();

  const skyMat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color('#1c0b45') },
      mid: { value: new Color('#a3268f') },
      horizon: { value: new Color('#ff9a4a') },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 top, mid, horizon; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.1 ? mix(mid, top, smoothstep(0.1, 0.6, h)) : mix(horizon, mid, smoothstep(-0.03, 0.1, h)); gl_FragColor = vec4(c,1.); }`,
  });
  const sky = new Mesh(new SphereGeometry(1500, 32, 16), skyMat);
  sky.name = 'sky';
  scene.add(sky);
  try {
    const pmrem = new PMREMGenerator(renderer);
    const envScene = new Scene();
    envScene.add(sky.clone());
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.7;
    pmrem.dispose();
  } catch (error) {
    console.warn('[hub] environment map skipped', error);
  }
  scene.add(new HemisphereLight('#c9b6ff', '#3a1a40', 1.3));
  const sun = new DirectionalLight('#ffd9b8', 2.6);
  sun.position.set(-120, 160, 140);
  scene.add(sun);

  await initLoaders(renderer);
  await loadSignFont();
  const outdoor = new Group();
  outdoor.name = 'plaza-outdoor';
  scene.add(outdoor);

  const slots: SlotState[] = [
    { key: 'castle', a: 0 * PLAZA_SLOT + PLAZA_YAW, front: 112, sc: 1.45, tint: '#7b5cff', phase: 'idle', build: async () => castle() },
    { key: 'whitehouse', a: 1 * PLAZA_SLOT + PLAZA_YAW, front: 116, sc: 1.3, tint: '#ffc233', phase: 'idle', build: async () => whiteHouse() },
    { key: 'hills', a: 2 * PLAZA_SLOT + PLAZA_YAW, front: 114, sc: 1.25, tint: '#39ff6a', phase: 'idle', build: async () => greenHill() },
    { key: 'club', a: 3 * PLAZA_SLOT + PLAZA_YAW, front: 113, sc: 1.25, tint: '#ff3bd4', phase: 'idle', build: async () => club() },
    { key: 'kennel', a: 4 * PLAZA_SLOT + PLAZA_YAW, front: 114, sc: 1.2, tint: '#ff8a1f', phase: 'idle', build: async () => kennel() },
  ];
  buildFloor(outdoor, slots.map((slot) => ({ a: slot.a, tint: slot.tint, paws: slot.key === 'kennel' })));
  const pedestal = buildPedestal(outdoor);

  const lampT: { p: [number, number, number]; r: number }[] = [];
  const benchT: { p: [number, number, number]; r: number }[] = [];
  for (let k = 0; k < 40; k += 1) {
    const a = (k / 40) * Math.PI * 2;
    if (slots.some((slot) => Math.abs(Math.atan2(Math.sin(a - slot.a), Math.cos(a - slot.a))) < 0.07)) continue;
    lampT.push({ p: [Math.sin(a) * 104, 0, -Math.cos(a) * 104], r: -a });
  }
  for (const slot of slots) {
    const ux = Math.sin(slot.a);
    const uz = -Math.cos(slot.a);
    const nx = -uz;
    const nz = ux;
    for (let r = 36; r < 92; r += 14) {
      for (const w of [-9, 9]) lampT.push({ p: [ux * r + nx * w, 0, uz * r + nz * w], r: -slot.a });
    }
  }
  for (const slot of slots) {
    const a = slot.a + Math.PI / 5;
    for (const r of [52, 80]) {
      for (const da of [-0.08, 0.08]) {
        benchT.push({ p: [Math.sin(a + da) * r, 0, -Math.cos(a + da) * r], r: -(a + da) + Math.PI });
      }
    }
  }
  const palmT: { p: [number, number, number]; r: number; s: number }[] = [];
  for (let k = 0; k < 18; k += 1) {
    const a = (k < 9 ? (slots[2]?.a ?? 0) + 0.3 : (slots[3]?.a ?? 0) + 0.42) + (k % 9) * 0.04;
    palmT.push({
      p: [Math.sin(a) * (122 + (k % 3) * 9), 0, -Math.cos(a) * (122 + (k % 3) * 9)],
      r: k,
      s: 0.8 + (k % 4) * 0.12,
    });
  }

  const [statue, portals, lamps, benches, palms] = await Promise.all([
    part('S1-statue', { h: 30, yaw: -Math.PI / 2, glow: 0.2, level: 'lod1' }),
    Promise.all(slots.map((slot) => buildPortal(slot.tint, 8))),
    instanced('P1-lamp', lampT, { h: 7.5, glow: 0.3 }),
    instanced('P2-bench', benchT, { h: 1.1, glow: 0.15 }),
    instanced('B5-palm', palmT, { h: 20 }),
  ]);
  statue.position.y = pedestal.top;
  statue.name = 'sproto-statue';
  outdoor.add(statue);
  portals.forEach((portal, index) => {
    const slot = slots[index];
    if (!slot) return;
    const ux = Math.sin(slot.a);
    const uz = -Math.cos(slot.a);
    portal.position.set(ux * 96, 0, uz * 96);
    portal.rotation.y = Math.atan2(-ux, -uz);
    outdoor.add(portal);
  });
  outdoor.add(lamps);
  outdoor.add(benches);
  outdoor.add(palms);
  const lampGlow = new InstancedMesh(new SphereGeometry(0.45, 10, 8), neonMat('#7fe9ff', 5), lampT.length);
  lampGlow.name = 'lamp-glow';
  lampT.forEach((lamp, i) => lampGlow.setMatrixAt(i, new Matrix4().makeTranslation(lamp.p[0], 7.1, lamp.p[2])));
  lampGlow.computeBoundingSphere();
  outdoor.add(glow(lampGlow));
  outdoor.add(skyline());

  const rig = new Group();
  rig.name = 'player-rig';
  const bob = new Group();
  const avatarRig = createAvatarRig();
  const avatar = avatarRig.group;
  bob.add(avatar);
  rig.add(bob);
  scene.add(rig);

  const shadowMat = new MeshBasicMaterial({
    map: radialShadow(),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new Mesh(new CircleGeometry(0.7, 16), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  shadow.renderOrder = 1;
  scene.add(shadow);

  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new SelectiveBloomEffect(scene, camera, {
    intensity: 1.6,
    luminanceThreshold: 0.15,
    luminanceSmoothing: 0.4,
    mipmapBlur: true,
    radius: 0.7,
  });
  bloom.ignoreBackground = true;
  mountGlow((obj) => {
    obj.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) bloom.selection.add(mesh);
    });
  });
  composer.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));

  const collider = buildPlazaCollider();
  const tmp = new Vector3();
  let interior: InteriorBuild | null = null;
  let interiorTask: Promise<void> | null = null;
  let inside = false;
  let doorLatch = false;
  let exitLatch = false;
  let zone: PlazaZone = null;
  let warp: Warp | null = null;
  let elapsed = 0;
  let statueNear = false;
  let buildingCount = 0;
  let drawsMarked = false;
  let sceneDraws = 0;
  let boardRows: readonly (readonly [string, string])[] = [];
  const storeListeners: ((anchor: Object3D) => void)[] = [];
  let storeAnchor: Object3D | null = null;
  const shot = new URLSearchParams(window.location.search).get('shot');

  function applyBoard(): void {
    const draw = interior?.leaderboard.userData.draw as ((rows: readonly (readonly [string, string])[]) => void) | undefined;
    draw?.(boardRows.slice(0, 5));
  }

  function ensureInterior(): void {
    if (interiorTask) return;
    interiorTask = buildInterior(scene).then((built) => {
      interior = built;
      storeAnchor = built.storeAnchor;
      applyBoard();
      for (const listener of storeListeners) listener(built.storeAnchor);
    }).catch((error: unknown) => {
      interiorTask = null;
      console.error(error);
    });
  }

  function placeBuilding(group: Group, slot: SlotState): void {
    group.scale.setScalar(slot.sc);
    group.updateMatrixWorld(true);
    const bounds = new Box3();
    group.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh || (mesh as InstancedMesh).isInstancedMesh || !mesh.geometry) return;
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      if (!box) return;
      bounds.union(box.clone().applyMatrix4(mesh.matrixWorld));
    });
    const reach = Number.isFinite(bounds.max.z) ? Math.min(bounds.max.z, 60) : 0;
    const radius = slot.front + reach;
    const ux = Math.sin(slot.a);
    const uz = -Math.cos(slot.a);
    group.position.set(ux * radius, 0, uz * radius);
    group.rotation.y = Math.atan2(-ux, -uz);
  }

  function kick(slot: SlotState): void {
    if (slot.phase !== 'idle') return;
    slot.phase = 'loading';
    slot.build().then((built) => {
      placeBuilding(built.group, slot);
      outdoor.add(built.group);
      slot.group = built.group;
      slot.door = built.door;
      slot.phase = 'ready';
      buildingCount += 1;
      document.documentElement.dataset.buildings = String(buildingCount);
    }).catch((error: unknown) => {
      slot.phase = 'idle';
      console.error(error);
    });
  }

  function horiz(obj: Object3D, x: number, y: number, z: number): number {
    obj.getWorldPosition(tmp);
    if (Math.abs(tmp.y - y) > 8) return Infinity;
    return Math.hypot(tmp.x - x, tmp.z - z);
  }

  function update(dt: number, moving: boolean, sprint: boolean): void {
    elapsed += dt;
    for (const fn of animated) fn(elapsed, dt);
    avatarRig.update(dt, moving, sprint);
    const player = rig.position;
    for (const slot of slots) {
      const guess = slot.group?.position ?? tmp.set(Math.sin(slot.a) * 160, 0, -Math.cos(slot.a) * 160);
      const distance = player.distanceTo(guess);
      if (slot.phase === 'idle' && distance < FAR) kick(slot);
      if (slot.phase === 'ready' && slot.group && !slot.near && distance < NEAR) {
        slot.near = true;
        void upgradeToLod0(slot.group);
      }
    }
    if (!statueNear && player.length() < 48) {
      statueNear = true;
      void upgradeToLod0(statue);
    }
    zone = null;
    const door = slots.find((slot) => slot.key === 'club')?.door;
    if (!inside && door) {
      const distance = horiz(door, player.x, player.y, player.z);
      if (distance < 2.6) {
        if (!interior) {
          ensureInterior();
          zone = 'loading';
        } else if (!doorLatch) {
          doorLatch = true;
          exitLatch = false;
          inside = true;
          outdoor.visible = false;
          interior.group.visible = true;
          warp = { x: -6, y: STAND_Y - 300, z: 4.2, yaw: 0 };
        }
      } else {
        doorLatch = false;
        if (distance < 9) zone = 'door';
      }
    }
    if (inside && interior) {
      const distance = horiz(interior.exit, player.x, player.y, player.z);
      if (distance < 1.8 && !exitLatch) {
        exitLatch = true;
        doorLatch = false;
        inside = false;
        outdoor.visible = true;
        interior.group.visible = false;
        interior.exit.getWorldPosition(tmp);
        const flat = tmp.clone();
        flat.y = 0;
        if (flat.lengthSq() < 1) flat.set(0, 0, 1);
        flat.normalize();
        const x = tmp.x - flat.x * 6;
        const z = tmp.z - flat.z * 6;
        warp = { x, y: STAND_Y, z, yaw: Math.atan2(-x, z) };
      } else if (distance >= 1.8) {
        exitLatch = false;
        if (distance < 4) zone = 'exit';
      }
    }
  }

  function render(): void {
    if (shot === 'aerial') {
      camera.position.set(0, 220, 310);
      camera.lookAt(0, 6, -20);
    } else if (shot === 'portal') {
      camera.position.set(9, 3.3, -78);
      camera.lookAt(0, 4.1, -96);
    }
    scene.updateMatrixWorld(true);
    scene.traverse((obj) => {
      const lod = obj as LOD;
      if (lod.isLOD) lod.update(camera);
    });
    const measure = import.meta.env.DEV || (!drawsMarked && buildingCount === slots.length);
    if (measure) {
      renderer.info.autoReset = false;
      renderer.info.reset();
      renderer.render(scene, camera);
      sceneDraws = renderer.info.render.calls;
      if (buildingCount === slots.length) {
        document.documentElement.dataset.plazaDraws = String(sceneDraws);
        drawsMarked = true;
      }
      renderer.info.autoReset = true;
    }
    composer.render();
  }

  const files = resourceFiles();
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  document.documentElement.dataset.plazaReady = '1';
  document.documentElement.dataset.initialBytes = String(bytes);
  window.plazaLoad = { bytes, files };
  // Wizard is larger than the previous avatar, so it stays out of this snapshot.
  avatarRig.load();

  const sockets = pedestal.rings.map((mesh) => ({ mesh, on: false }));
  return {
    scene,
    camera,
    renderer,
    collider,
    rig,
    bob,
    avatar,
    shadow,
    shadowMat,
    labels: [],
    sockets,
    get sceneDraws() { return sceneDraws; },
    setRelics(ids) {
      const owned = new Set(ids);
      pedestal.rings.forEach((ring, index) => {
        const on = owned.has(SOCKETS[index]?.id ?? '');
        const material = ring.material as MeshStandardMaterial;
        material.emissiveIntensity = on ? 8 : 5;
        ring.scale.setScalar(on ? 1.25 : 1);
        const socket = sockets[index];
        if (socket) socket.on = on;
      });
    },
    setBoard(title, rows, sample) {
      void title;
      void sample;
      boardRows = rows;
      applyBoard();
    },
    verseStoreUi: {
      get anchor() { return storeAnchor; },
      whenReady(listener) {
        if (storeAnchor) listener(storeAnchor);
        else storeListeners.push(listener);
      },
    },
    inInterior: () => inside,
    zone: () => zone,
    update,
    consumeWarp() {
      const pending = warp;
      warp = null;
      return pending;
    },
    render,
    resize(width, height) {
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
    },
  };
}

function skyline(): InstancedMesh {
  const towers = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({
      color: '#140c26',
      map: windowsTex(),
      emissive: '#ffffff',
      emissiveMap: windowsTex(),
      emissiveIntensity: 0.9,
      roughness: 0.6,
    }),
    90,
  );
  for (let k = 0; k < 90; k += 1) {
    const a = (k / 90) * Math.PI * 2 + 0.03;
    const r = 480 + ((k * 37) % 120);
    const h = 25 + ((k * 53) % 70);
    towers.setMatrixAt(k, new Matrix4().compose(
      new Vector3(Math.sin(a) * r, h / 2, -Math.cos(a) * r),
      new Quaternion().setFromEuler(new Euler(0, -a, 0)),
      new Vector3(14 + (k % 5) * 4, h, 14),
    ));
  }
  towers.name = 'skyline';
  return towers;
}

function windowsTex(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 64, 256);
  for (let r = 0; r < 32; r += 1) {
    for (let k = 0; k < 4; k += 1) {
      if (Math.random() < 0.35) {
        ctx.fillStyle = Math.random() < 0.5 ? '#7a5cff' : '#ff6ad5';
        ctx.fillRect(4 + k * 15, 4 + r * 8, 9, 4);
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

function radialShadow(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function resourceFiles(): { name: string; bytes: number }[] {
  const rows: { name: string; bytes: number }[] = [];
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav) rows.push({ name: nav.name, bytes: nav.encodedBodySize || nav.decodedBodySize || 0 });
  for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    rows.push({ name: entry.name, bytes: entry.encodedBodySize || entry.decodedBodySize || 0 });
  }
  return rows;
}
