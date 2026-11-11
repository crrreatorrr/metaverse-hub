import { BackSide, CanvasTexture, CircleGeometry, Color, DirectionalLight, Fog, Group, HalfFloatType, HemisphereLight, LOD, Mesh, MeshBasicMaterial, NoToneMapping, PerspectiveCamera, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, WebGLRenderer } from 'three';
import { EffectComposer, EffectPass, RenderPass, SelectiveBloomEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { isRelicId } from '@metaverse/hub-sdk';
import { createAvatarRig, type AvatarAir } from '../avatar';
import type { AvatarLook } from '../look';
import { CAMERA_FOV } from '../config';
import { STAND_Y } from '../physics';
import { animated, initLoaders, mountGlow } from '../v2/core';
import type { PetCollision } from './pet-motion';
import { createPetFollower } from '../v2/pets';
import { addOrbitGems } from '../m3/orbitGems';
import type { OrbitAvatar } from '../m3/types';

export interface EngineOptions {
  fog: { color: string; near: number; far: number };
  sky: { top: string; mid: string; horizon: string };
  environmentIntensity: number;
  hemi: { sky: string; ground: string; intensity: number };
  sun: { color: string; intensity: number; position: [number, number, number] };
  bloom: number;
}
export type Engine = Awaited<ReturnType<typeof createEngine>>;

export async function createEngine(opts: EngineOptions, initialLook?: AvatarLook) {
  const scene = new Scene();
  scene.fog = new Fog(opts.fog.color, opts.fog.near, opts.fog.far);
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.08, 4000);
  const renderer = new WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
    stencil: false,
  });
  // Every pass is fill-bound, and 1.5 drew 2.25x the pixels of 1.0 on high-DPI screens.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = NoToneMapping;
  camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  camera.updateProjectionMatrix();

  const skyMat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color(opts.sky.top) },
      mid: { value: new Color(opts.sky.mid) },
      horizon: { value: new Color(opts.sky.horizon) },
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
    scene.environmentIntensity = opts.environmentIntensity;
    pmrem.dispose();
  } catch (error) {
    console.warn('[hub] environment map skipped', error);
  }
  const hemi = new HemisphereLight(opts.hemi.sky, opts.hemi.ground, opts.hemi.intensity);
  scene.add(hemi);
  const sun = new DirectionalLight(opts.sun.color, opts.sun.intensity);
  sun.position.set(...opts.sun.position);
  scene.add(sun);

  await initLoaders(renderer);
  // Attach actors after initial realm geometry has loaded, preserving the plaza's load order.
  let petCollision: PetCollision | undefined;
  let actor: ReturnType<typeof mountActors> | null = null;
  function mountActors() {
    const rig = new Group();
    rig.name = 'player-rig';
    const bob = new Group();
    const avatarRig = createAvatarRig();
    const avatar = avatarRig.group;
    if (initialLook) avatarRig.setLook(initialLook);
    bob.add(avatar);
    rig.add(bob);
    scene.add(rig);
    const collision: PetCollision = position => petCollision?.(position);
    collision.blocked = (bounds, transform) => petCollision?.blocked?.(bounds, transform) ?? false;
    collision.beamRange = (origin, direction, range) => petCollision?.beamRange?.(origin, direction, range) ?? range;
    const pets = createPetFollower(scene, collision);

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

    return { rig, bob, avatar, shadow, shadowMat, avatarRig, pets };
  }
  function actors() { return actor ??= mountActors(); }

  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new SelectiveBloomEffect(scene, camera, {
    intensity: opts.bloom,
    luminanceThreshold: 0.15,
    luminanceSmoothing: 0.4,
    mipmapBlur: true,
    radius: 0.7,
    // The glow is a blur, so half resolution looks the same at a quarter of the fill cost.
    resolutionScale: 0.5,
  });
  bloom.ignoreBackground = true;
  mountGlow((obj) => {
    obj.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) bloom.selection.add(mesh);
    });
  });
  composer.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));


  const gems = addOrbitGems(scene, { maxAvatars: 32 });
  let owned: string[] = [];
  let hidden = new Set<string>();
  let remoteOrbit: readonly OrbitAvatar[] = [];
  let previewOrbit: readonly OrbitAvatar[] = [];
  let elapsed = 0;
  let sceneDraws = 0;
  function syncGems(): void {
    gems.setAvatars([{ id: 'local', anchor: actors().rig, relics: owned.filter(isRelicId).filter(id => !hidden.has(id)) }, ...remoteOrbit, ...previewOrbit]);
  }
  return {
    scene, camera, renderer, hemi, sun,
    get rig() { return actors().rig; },
    get bob() { return actors().bob; },
    get avatar() { return actors().avatar; },
    get shadow() { return actors().shadow; },
    get shadowMat() { return actors().shadowMat; },
    get sceneDraws() { return sceneDraws; },
    setLook: (look: AvatarLook) => actors().avatarRig.setLook(look),
    setPetCollision(collide: PetCollision) { petCollision = collide; },
    setPet: (id: string | null) => actors().pets.setPet(id),
    loadAvatar: () => actors().avatarRig.load(),
    setRelics(ids: readonly string[]) { owned = [...ids]; syncGems(); },
    setHiddenRelics(ids: readonly string[]) { hidden = new Set(ids); syncGems(); },
    setRemoteOrbit(avatars: readonly OrbitAvatar[]) { remoteOrbit = avatars; syncGems(); },
    setPreviewAvatars(avatars: readonly OrbitAvatar[]) { previewOrbit = avatars; syncGems(); },
    update(dt: number, moving: boolean, sprint: boolean, air?: AvatarAir, speed?: number) {
      elapsed += dt;
      for (const fn of animated) fn(elapsed, dt);
      const rigMoving = actors().avatarRig.update(dt, moving, sprint, air, speed);
      const { pets, rig, avatar } = actors();
      pets.update(dt, rig.position, STAND_Y, sprint, Math.PI + avatar.rotation.y);
      gems.update(elapsed);
      return rigMoving;
    },
    render(measure = true) {
      scene.updateMatrixWorld(true);
      scene.traverse((obj) => { const lod = obj as LOD; if (lod.isLOD) lod.update(camera); });
      if (measure) {
        renderer.info.autoReset = false;
        renderer.info.reset();
        renderer.render(scene, camera);
        sceneDraws = renderer.info.render.calls;
        renderer.info.autoReset = true;
      }
      composer.render();
    },
    resize(width: number, height: number) {
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
    },
  };
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

