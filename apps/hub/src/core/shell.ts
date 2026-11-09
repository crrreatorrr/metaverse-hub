import { isRelicId } from '@metaverse/hub-sdk';
import { RELICS } from './relics';
import { MOVEMENT } from '../core/movement';
import {
  HubSdkError,
  createNakamaClient,
  type ChatChannel,
  getOrCreateDeviceId,
  type GameId,
  type ProfileResult,
  type PortalEnterResult,
  type RecoveryCodeResult,
  type RecoveryRedeemResult,
} from '@metaverse/hub-sdk';
import { DefaultLoadingManager, DoubleSide, MathUtils, Ray, Timer, Vector3 } from 'three';
import { resume, signOut } from '../auth';
import '@fontsource-variable/inter/wght.css';
import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/vt323/latin-400.css';
import { createChat } from '../chat';
import { connectPlaza, type Plaza, type PlazaStatus } from '../net/plaza';
import { animIndex } from '../net/protocol';
import { createRemoteWorld } from '../net/remoteWorld';
import { createRemotes } from '../remotes';
import { createOverheads } from '../overheads';
import { AVATAR_SCALE, CAMERA_ARM, CAMERA_LOOK_DROP, CHARACTERS, SPRINT_SPEED, WALK_SPEED, characterHeight } from '../config';
import { loadLook, saveLook, type AvatarLook } from '../look';
import { MENU_TAB_ORDER, createMenu } from '../menu';
import { gameUrl, type GameUrlContext } from '../games';
import { portalPosition } from '../layout';
import { STAND_Y, createPlayerController, type MoveInput } from '../physics';
import { gate } from '../login';
import '../style.css';
import { initialDwell, loginReturnPath, portalContaining, portalUrl, stepPortalDwell, type PortalDwell } from '../travel';

import { createEngine } from './engine';
import { PAD, PAD_TUNING, createPadReader, padPrompt, type PadFrame } from './gamepad';
import { createPadFocus } from './pad-focus';
import type { RealmDefinition, RealmContent } from './realm';

/** Body turn rate toward the facing (1/s, exponential): a 180° flip settles in about 0.2 s. */
const TURN_RATE = 18;
/** Airborne for the jump pose: rising faster than this (m/s), or off the ground longer than AIR_GRACE (s). */
const AIR_RISE = 1;
const AIR_GRACE = 0.12;

/** `MathUtils.damp` along the short arc. */
function dampAngle(from: number, to: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * (1 - Math.exp(-lambda * dt));
}

export async function startRealm(definition: RealmDefinition): Promise<void> {
  const CONTROLS_HINT = 'WASD or arrows move  ·  Mouse look  ·  Z / C turn camera  ·  Shift run  ·  Space jump  ·  E use  ·  Enter chat  ·  Esc menu';
  const PAD_HINT = 'Left stick move  ·  Right stick camera  ·  B run  ·  A jump  ·  X interact  ·  View chat  ·  Menu menu';
  const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);
  const CAMERA_YAW_RATE = MOVEMENT.yawRate;
  const CAMERA_PITCH_RATE = MOVEMENT.pitchRate;

  const appQuery = document.querySelector('#app');
  const hintQuery = document.querySelector('#hint');
  const wipeQuery = document.querySelector('#wipe');
  const banner = document.querySelector('#banner');
  if (!(appQuery instanceof HTMLElement) || !(hintQuery instanceof HTMLElement) || !(wipeQuery instanceof HTMLElement)) {
    throw new Error('Hub markup is missing');
  }
  const app = appQuery;
  const hint = hintQuery;
  const wipe = wipeQuery;
  if (banner instanceof HTMLElement && window.matchMedia('(pointer: coarse)').matches) {
    banner.hidden = false;
  }

  hint.textContent = definition.loadingText;
  let look: AvatarLook = loadLook();
  // Models and textures the plaza fetches before its first frame. The loader's own
  // total grows as parts are requested one by one, so divide by this instead.
  const EXPECTED_ASSETS = 21;
  const SCRIPT_SHARE = 0.08;
  gate.progress(SCRIPT_SHARE);
  DefaultLoadingManager.onProgress = (_url, loaded, total) => {
    gate.progress(SCRIPT_SHARE + (1 - SCRIPT_SHARE) * (loaded / Math.max(total, EXPECTED_ASSETS)));
  };
  const engine = await createEngine(definition.engine, look);
  const content = await definition.build({
    engine,
    pageFor,
    travel(game) {
      const page = pageFor(game.id);
      if (page && !traveling && !menu.open) void travel(game, page);
    },
    releasePointer() { keys.clear(); releasePointer(); },
    isBlocked: () => traveling || menu.open || chat.open,
  });
  const world = Object.defineProperties(Object.create(engine), Object.getOwnPropertyDescriptors(content)) as typeof engine & RealmContent;
  const PORTALS = content.portals ?? [];
  engine.loadAvatar();
  document.documentElement.dataset.realm = definition.id;
  document.documentElement.dataset.realmReady = '1';
  hint.textContent = `Click to look  ·  ${CONTROLS_HINT}`;
  app.prepend(world.renderer.domElement);

  const player = createPlayerController(world.collider.bvh);
  const initial = definition.spawn(window.location.hash);
  player.spawn(initial.x, initial.y, initial.z, initial.yaw);
  // M6 pets: profile.get / loadout.set_hub are not wired yet (docs/m6-server-prep.md), so the equipped pet
  // comes from ?pet=<catalog id> for previews until the profile hook lands.
  const petParam = new URLSearchParams(window.location.search).get('pet');
  if (petParam) void world.setPet(petParam);

  const keys = new Set<string>();
  const pad = createPadReader();
  const padFocus = createPadFocus();
  /** A controller was the last device used: hints show controller prompts. */
  let usingPad = false;
  /** Left stick click toggles running until the stick comes back to rest. */
  let padRun = false;
  let yaw = initial.yaw;
  /** Yaw the body shows: eases toward the controller's facing instead of snapping. */
  let bodyYaw = initial.yaw;
  /** Seconds off the ground, so a step down a curb does not flash the jump pose. */
  let airTime = 0;
  let pitch: number = MOVEMENT.initialPitch;
  let dragging = false;
  let jumpQueued = false;
  let traveling = false;
  let dwell: PortalDwell = initialDwell();
  let portalError = '';
  let fps = 60;
  let warnedDraws = false;
  /** Set while the hub itself drops pointer lock, so the lock change does not open the menu. */
  let releasingLock = false;
  let menuOpenedByLockAt = -Infinity;
  let guestLabel = 'Guest';
  /** 0 = play camera, 1 = menu preview in front of the avatar. */
  let preview = 0;
  let previewSpin = 0;
  const savedView = { yaw: 0, pitch: 0 };
  const timer = new Timer();
  timer.connect(document);
  const lookTarget = new Vector3();
  const desiredPos = new Vector3();
  const rayDir = new Vector3();
  const camPos = new Vector3();
  const ray = new Ray();

  const debug = import.meta.env.DEV ? createDebug() : null;
  let firstFrame = true;

  const chat = createChat({
    name: displayName,
    onOpen() {
      keys.clear();
      releasePointer();
    },
    onClose() {
      keys.clear();
    },
    onRemoteLine(senderId, parsed) {
      overheads.show(senderId, parsed);
    },
  });
  chat.system(definition.welcome);

  // Other players: the shard's RemoteWorld (fed by net/plaza.ts) drawn by remotes.ts.
  const hudRoot = document.querySelector('#hud');
  const remoteWorld = createRemoteWorld();
  const remotes = createRemotes(world.scene, remoteWorld, {
    realm: definition.id,
    hud: hudRoot instanceof HTMLElement ? hudRoot : document.body,
    setOrbitAvatars: (avatars) => world.setRemoteOrbit(avatars),
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  });
  const overheads = createOverheads(hudRoot instanceof HTMLElement ? hudRoot : document.body);
  let plaza: Plaza | null = null;
  let plazaLine = '';
  let chatRoom = '';
  let chatChannel: ChatChannel | null = null;

  // Relics switched off in the Relics menu: their gems stop orbiting the avatar. Per browser.
  const HIDDEN_RELICS_KEY = 'hub:relics:hidden';
  let hiddenRelics: string[] = loadHiddenRelics();
  world.setHiddenRelics(hiddenRelics);

  function loadHiddenRelics(): string[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_RELICS_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  const menu = createMenu({
    hiddenRelics: () => hiddenRelics,
    setHiddenRelics(ids) {
      hiddenRelics = [...ids];
      world.setHiddenRelics(hiddenRelics);
      try {
        localStorage.setItem(HIDDEN_RELICS_KEY, JSON.stringify(hiddenRelics));
      } catch {
        // Storage may be off (private window). The switch still applies for this visit.
      }
    },
    look: () => look,
    setLook(next) {
      look = next;
      world.setLook(look);
      saveLook(look);
      plaza?.profile({ character: look.character, staff: look.staff, pet: petParam });
    },
    onOpen() {
      keys.clear();
      releasePointer();
      if (chat.open) chat.hide();
      savedView.yaw = yaw;
      savedView.pitch = pitch;
      previewSpin = 0;
    },
    onClose() {
      keys.clear();
      yaw = savedView.yaw;
      pitch = savedView.pitch;
    },
    onSpin(delta) {
      previewSpin += delta;
    },
  });

  function displayName(): string {
    return look.name || guestLabel;
  }

  function releasePointer(): void {
    if (!document.pointerLockElement) return;
    releasingLock = true;
    document.exitPointerLock();
  }

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) return;
    const ours = releasingLock;
    releasingLock = false;
    // Esc while the mouse is captured: the browser takes the key to free the
    // mouse and the page may never see it, so the lock loss opens the menu.
    if (ours || menu.open || chat.open || traveling || !document.hasFocus()) return;
    menuOpenedByLockAt = performance.now();
    menu.show();
  });

  window.addEventListener('keydown', (event) => {
    // The login gate owns the keyboard until it closes.
    if (gate.isOpen()) return;
    // The cabinet picker owns it while it is open.
    if (content.handleKey?.(event)) return;
    if (event.code === 'Escape' || event.key === 'Escape') {
      if (traveling || chat.open) return;
      // Some browsers deliver the Esc that released the lock as well.
      if (document.pointerLockElement === canvas) return;
      if (performance.now() - menuOpenedByLockAt < 400) return;
      event.preventDefault();
      if (menu.open) menu.hide();
      else if (!isTypingTarget(event.target)) menu.show();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (menu.open) return;
    if ((event.key === 'Enter' || event.code === 'NumpadEnter') && !event.repeat && !traveling) {
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      chat.show();
      return;
    }
    if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
    if (event.repeat && event.code === 'Space') return;
    keys.add(event.code);
    if (event.code === 'Space') jumpQueued = true;
    const interaction = content.interactions?.find(item => item.active() && item.key === event.code);
    if (interaction && !event.repeat) interaction.interact?.();
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  // The last device used decides the prompts: any key or click hands them back to the keyboard.
  const dropPadPrompts = () => {
    if (!usingPad) return;
    usingPad = false;
    padFocus.clear();
  };
  window.addEventListener('keydown', dropPadPrompts, { capture: true });
  window.addEventListener('pointerdown', dropPadPrompts, { capture: true });
  window.addEventListener('blur', () => {
    keys.clear();
    dragging = false;
  });

  const canvas = world.renderer.domElement;
  canvas.addEventListener('pointerdown', (event) => {
    if (menu.open) return;
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    void canvas.requestPointerLock();
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });
  window.addEventListener('pointermove', (event) => {
    if (menu.open) return;
    if (document.pointerLockElement !== canvas && !dragging) return;
    yaw -= event.movementX * MOVEMENT.mouseYaw;
    pitch -= event.movementY * MOVEMENT.mousePitch;
    pitch = MathUtils.clamp(pitch, MOVEMENT.pitchMin, MOVEMENT.pitchMax);
  });

  window.addEventListener('resize', () => {
    world.resize(window.innerWidth, window.innerHeight);
  });
  world.resize(window.innerWidth, window.innerHeight);

  world.renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), 0.05);
    preview = MathUtils.damp(preview, menu.open ? 1 : 0, 9, dt);
    if (!menu.open && preview < 0.002) preview = 0;
    if (!menu.open) orbitCamera(dt);
    const padMove = readPad(pad.poll(navigator.getGamepads?.() ?? [], timestamp), dt);
    const input = readInput(padMove);
    player.step(dt, input, { walk: WALK_SPEED, sprint: SPRINT_SPEED });
    const moving = Math.hypot(input.forward, input.strafe) > 0;
    airTime = player.grounded ? 0 : airTime + dt;
    const air = { airborne: player.velocity.y > AIR_RISE || airTime > AIR_GRACE, vy: player.velocity.y };
    // P4: the jog / dash clips bake their own bounce, so the procedural bob stays at 0.
    world.bob.position.y = 0;
    bodyYaw = dampAngle(bodyYaw, player.facingYaw, TURN_RATE, dt);
    world.avatar.rotation.y = -bodyYaw;
    world.rig.position.copy(player.position);

    const floorY = content.groundHeight?.(player.position) ?? 0;
    const lift = Math.max(0, player.position.y - STAND_Y - floorY);
    world.shadow.position.set(player.position.x, player.position.y - STAND_Y + 0.03, player.position.z);
    world.shadow.scale.setScalar((1.15 + lift * 0.25) * AVATAR_SCALE);
    world.shadowMat.opacity = Math.max(0.12, 0.5 - lift * 0.12);

    engine.update(dt, moving, input.sprint, air);
    content.update(dt, { moving, sprint: input.sprint, position: player.position });
    remotes.update(dt, performance.now(), world.camera, player.position);
    overheads.update(dt, world.camera, (id, out) => remotes.positionOf(id, out), { width: window.innerWidth, height: window.innerHeight });
    plaza?.sendPose(
      player.position.x,
      player.position.y,
      player.position.z,
      bodyYaw,
      animIndex(air.airborne ? 'jump' : moving ? (input.sprint ? 'run' : 'walk') : 'idle'),
    );
    const warp = content.consumeWarp?.();
    if (warp) {
      dwell = initialDwell();
      yaw = warp.yaw;
      player.spawn(warp.x, warp.y, warp.z, warp.yaw);
      world.rig.position.copy(player.position);
      bodyYaw = player.facingYaw;
      airTime = 0;
      world.avatar.rotation.y = -bodyYaw;
    }
    if (!new URLSearchParams(window.location.search).get('shot')) placeCamera();
    placeOverhead(dt);
    fadeLabels();
    updateHint();
    considerPortal(dt);
    world.render();
    if (firstFrame) {
      firstFrame = false;
      DefaultLoadingManager.onProgress = () => undefined;
      gate.ready();
    }
    if (debug) {
      const calls = world.sceneDraws;
      fps = fps * 0.9 + (dt > 0 ? 0.1 / dt : 0);
      debug.drawCalls = calls;
      debug.fps = fps;
      debug.x = player.position.x;
      debug.y = player.position.y;
      debug.z = player.position.z;
      debug.element.textContent = `${calls} draws · ${fps.toFixed(0)} fps · ${remotes.counts.near}+${remotes.counts.far} remotes`;
      if (calls > 150 && !warnedDraws) {
        warnedDraws = true;
        console.warn(`[hub] draw calls ${calls} exceed the 150 budget`);
      }
    }
  });

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
    if (target instanceof HTMLTextAreaElement) return true;
    if (target.isContentEditable) return true;
    if (target.getAttribute('role') === 'textbox') return true;
    return Boolean(target.closest('[contenteditable="true"], [role="textbox"], [data-chat], .chat-field, #chat'));
  }

  /**
   * Keyboard camera for players without a mouse: Z / C turn, R / F raise and lower the camera.
   * WASD and the arrows both move the character, so the camera stays off the movement keys.
   */
  function orbitCamera(dt: number): void {
    const yawInput = (keys.has('KeyZ') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0);
    const pitchInput = (keys.has('KeyR') ? 1 : 0) - (keys.has('KeyF') ? 1 : 0);
    yaw += yawInput * CAMERA_YAW_RATE * dt;
    pitch += pitchInput * CAMERA_PITCH_RATE * dt;
    pitch = MathUtils.clamp(pitch, MOVEMENT.pitchMin, MOVEMENT.pitchMax);
  }

  function readInput(padMove: PadMove = NO_PAD_MOVE): MoveInput {
    if (menu.open || chat.open || content.overlayOpen?.()) {
      jumpQueued = false;
      return { forward: 0, strafe: 0, sprint: false, jump: false, yaw };
    }
    const up = keys.has('ArrowUp') || keys.has('KeyW');
    const down = keys.has('ArrowDown') || keys.has('KeyS');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const forward = MathUtils.clamp((up ? 1 : 0) - (down ? 1 : 0) + padMove.forward, -1, 1);
    const strafe = MathUtils.clamp((right ? 1 : 0) - (left ? 1 : 0) + padMove.strafe, -1, 1);
    const jump = jumpQueued;
    jumpQueued = false;
    return {
      forward,
      strafe,
      sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || padMove.sprint,
      jump,
      yaw,
    };
  }

  /**
   * One controller frame (docs/controllers.md). Overlays first: the login gate runs its own
   * loop in login.ts, the arcade picker takes the D-pad / A / B as arrows / Enter / Esc, and the
   * menu moves a focus ring. In the plaza: left stick moves, right stick turns the camera,
   * A jumps, B (held) or a left stick click runs, X uses the prompt in front of you (the cabinet),
   * right stick click puts the camera behind you, Menu opens the menu and View opens chat.
   */
  function readPad(frame: PadFrame, dt: number): PadMove {
    if (!frame.connected) {
      padRun = false;
      return NO_PAD_MOVE;
    }
    if (frame.active) usingPad = true;
    if (gate.isOpen() || traveling) return NO_PAD_MOVE;

    const pickerKey = frame.pressed(PAD.A) ? 'Enter' : frame.pressed(PAD.B) ? 'Escape' : frame.nav ? NAV_KEYS[frame.nav] : '';
    if (content.overlayOpen?.()) {
      if (pickerKey) content.handleKey?.(new KeyboardEvent('keydown', { code: pickerKey, key: pickerKey }));
      return NO_PAD_MOVE;
    }

    if (menu.open) {
      const root = document.querySelector<HTMLElement>('#menu');
      if (frame.pressed(PAD.B) || frame.pressed(PAD.MENU)) {
        menu.hide();
        padFocus.clear();
        return NO_PAD_MOVE;
      }
      const step = (frame.pressed(PAD.RB) ? 1 : 0) - (frame.pressed(PAD.LB) ? 1 : 0);
      if (step) {
        const at = MENU_TAB_ORDER.indexOf(menu.tab);
        menu.show(MENU_TAB_ORDER[(at + step + MENU_TAB_ORDER.length) % MENU_TAB_ORDER.length]);
      }
      if (root && frame.nav) padFocus.move(root, frame.nav);
      if (root && frame.pressed(PAD.A)) padFocus.activate(root);
      previewSpin += frame.look.x * PAD_TUNING.previewSpinRate * dt;
      return NO_PAD_MOVE;
    }

    if (chat.open) {
      if (frame.pressed(PAD.B) || frame.pressed(PAD.VIEW)) chat.hide();
      return NO_PAD_MOVE;
    }

    if (frame.pressed(PAD.MENU)) {
      menu.show();
      return NO_PAD_MOVE;
    }
    if (frame.pressed(PAD.VIEW)) {
      chat.show();
      return NO_PAD_MOVE;
    }
    if (frame.pressed(PAD.A)) jumpQueued = true;
    if (frame.pressed(PAD.X)) {
      const interaction = content.interactions?.find(item => item.active() && item.interact);
      interaction?.interact?.();
    }
    if (frame.pressed(PAD.RS)) {
      yaw = player.facingYaw;
      pitch = MOVEMENT.initialPitch;
    }
    const moving = frame.move.x !== 0 || frame.move.y !== 0;
    if (frame.pressed(PAD.LS)) padRun = !padRun;
    if (!moving) padRun = false;
    yaw -= frame.look.x * PAD_TUNING.lookYawRate * dt;
    pitch = MathUtils.clamp(pitch + frame.look.y * PAD_TUNING.lookPitchRate * dt, MOVEMENT.pitchMin, MOVEMENT.pitchMax);
    return { forward: -frame.move.y, strafe: frame.move.x, sprint: frame.held(PAD.B) || padRun };
  }

  const previewLook = new Vector3();
  const headPoint = new Vector3();

  function bodyHeight(): number {
    const character = CHARACTERS.find((entry) => entry.id === look.character) ?? CHARACTERS[0];
    return characterHeight(character) * look.height;
  }

  /**
   * Spring arm from `look` toward yaw/pitch, pulled in when the BVH is in the
   * way. Writes into `out`.
   */
  function armFrom(target: Vector3, armYaw: number, armPitch: number, arm: number, out: Vector3): Vector3 {
    const cp = Math.cos(armPitch);
    desiredPos.set(
      target.x - Math.sin(armYaw) * arm * cp,
      target.y + Math.sin(armPitch) * arm,
      target.z + Math.cos(armYaw) * arm * cp,
    );
    rayDir.subVectors(desiredPos, target);
    const len = rayDir.length();
    out.copy(desiredPos);
    if (len > 0.001) {
      rayDir.multiplyScalar(1 / len);
      ray.origin.copy(target);
      ray.direction.copy(rayDir);
      const hit = world.collider.bvh.raycastFirst(ray, DoubleSide);
      if (hit && hit.distance < len && hit.distance > 0.05) {
        out.copy(target).addScaledVector(rayDir, Math.max(MOVEMENT.armMin, hit.distance - MOVEMENT.armOffset));
      }
    }
    return out;
  }

  /**
   * Third-person spring arm. Mouse yaw/pitch orbit the avatar; the BVH keeps the camera out of walls.
   * With the menu open the camera swings in front of the avatar and the view shifts right of the panel.
   */
  function placeCamera(): void {
    const target = lookTarget.set(player.position.x, player.position.y - CAMERA_LOOK_DROP, player.position.z);
    if (preview > 0) {
      // Swing round the avatar on the arm (angles, not positions), so the camera never cuts through the body.
      const height = bodyHeight();
      const feet = player.position.y - STAND_Y;
      previewLook.set(player.position.x, feet + height * 0.55, player.position.z);
      target.lerp(previewLook, preview);
      const front = player.facingYaw + Math.PI + previewSpin;
      const turn = Math.atan2(Math.sin(front - yaw), Math.cos(front - yaw));
      armFrom(
        target,
        yaw + turn * preview,
        MathUtils.lerp(pitch, 0.08, preview),
        MathUtils.lerp(CAMERA_ARM, 2.2 + height * 1.25, preview),
        camPos,
      );
    } else {
      armFrom(target, yaw, pitch, CAMERA_ARM, camPos);
    }
    world.camera.position.copy(camPos);
    world.camera.position.y = Math.max(world.camera.position.y, content.cameraFloor(world.camera.position));
    world.camera.lookAt(target);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const shift = preview > 0 ? (menu.panelWidth / 2) * preview : 0;
    if (shift > 0.5) world.camera.setViewOffset(width, height, -shift, 0, width, height);
    else if (world.camera.view?.enabled) world.camera.clearViewOffset();
  }

  /** Keeps the chat line over the avatar's head, shrinking a little with distance. */
  function placeOverhead(dt: number): void {
    chat.update(dt);
    headPoint.set(player.position.x, player.position.y - STAND_Y + bodyHeight() + 0.45, player.position.z);
    const distance = world.camera.position.distanceTo(headPoint);
    headPoint.project(world.camera);
    if (headPoint.z > 1 || Math.abs(headPoint.x) > 1.2 || Math.abs(headPoint.y) > 1.2) {
      chat.place(null);
      return;
    }
    chat.place({
      x: (headPoint.x * 0.5 + 0.5) * window.innerWidth,
      y: (-headPoint.y * 0.5 + 0.5) * window.innerHeight,
      scale: MathUtils.clamp(9 / Math.max(distance, 0.1), 0.7, 1.15),
    });
  }

  function fadeLabels(): void {
    for (const sprite of content.labels ?? []) {
      const distance = world.camera.position.distanceTo(sprite.position);
      const material = sprite.material;
      material.opacity = 1 - MathUtils.smoothstep(distance, 24, 40);
    }
  }

  function updateHint(): void {
    const look = usingPad || document.pointerLockElement === canvas ? '' : 'Click to look  ·  ';
    const enabled = content.portalsEnabled?.() ?? true;
    const near = enabled ? nearestPortal(player.position.x, player.position.z) : null;
    const inside = enabled ? portalContaining(PORTALS, player.position.x, player.position.z) : null;
    const interaction = content.interactions?.find(item => item.active());
    if (!inside) portalError = '';
    const closed = near && !pageFor(near.id) ? near : null;
    const entering = inside && pageFor(inside.id) && (traveling || (dwell.elapsed > 0 && !dwell.held));
    const text = portalError
      ? portalError
      : interaction
        ? `${interaction.showLook === false ? '' : look}${interaction.prompt()}`
          : closed
            ? `${look}${closed.label} · Coming soon`
            : entering && inside
              ? `${look}Entering ${inside.label}…`
              : near
                ? `${look}Walk into the ring to enter ${near.label}`
                : `${look}${usingPad ? PAD_HINT : CONTROLS_HINT}`;
    const shown = usingPad ? padPrompt(text) : text;
    if (hint.textContent !== shown) hint.textContent = shown;
  }

  function nearestPortal(x: number, z: number) {
    let best: (typeof PORTALS)[number] | null = null;
    let bestDistance = 18;
    for (const portal of PORTALS) {
      const at = portalPosition(portal.angle, portal.distance);
      const distance = Math.hypot(x - at.x, z - at.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = portal;
      }
    }
    return best;
  }

  function considerPortal(dt: number): void {
    if (traveling) return;
    if (!(content.portalsEnabled?.() ?? true) || menu.open || isTypingTarget(document.activeElement)) {
      dwell = initialDwell();
      return;
    }
    const hit = portalContaining(PORTALS, player.position.x, player.position.z);
    const stepped = stepPortalDwell(dwell, hit?.id ?? null, dt);
    dwell = stepped.state;
    if (!stepped.ready || !hit) return;
    const page = pageFor(hit.id);
    if (!page) return;
    void travel(hit, page);
  }

  const ENTER_FADE_MS = 700;

  async function travel(portal: { id: GameId; label: string; color: string }, page: string): Promise<void> {
    traveling = true;
    if (chat.open) chat.hide();
    releasePointer();
    wipe.style.background = portal.color;
    wipe.textContent = `Entering ${portal.label}…`;
    wipe.classList.add('on');
    const shownAt = performance.now();
    try {
      const session = await boot();
      const entered = await session.client.rpc<PortalEnterResult>(
        'portal.enter',
        { game: portal.id, ranked: false },
        { token: session.token },
      );
      plaza?.travel(portal.id);
      const remain = ENTER_FADE_MS - (performance.now() - shownAt);
      if (remain > 0) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, remain);
        });
      }
      window.location.assign(portalUrl(page, entered.ticket));
    } catch (error) {
      traveling = false;
      wipe.classList.remove('on');
      portalError = error instanceof Error ? error.message : 'Could not open that portal';
      hint.textContent = portalError;
      console.error(error);
    }
  }

  function pageFor(id: GameId): string | null {
    return gameUrl(id, gameUrls);
  }

  function playDomain(): string | undefined {
    const configured = import.meta.env.VITE_PLAY_DOMAIN?.trim();
    if (configured) return configured;
    if (import.meta.env.DEV) return undefined;
    const host = window.location.hostname;
    if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return undefined;
    return host;
  }

  const gameUrls: GameUrlContext = {
    dev: import.meta.env.DEV,
    playDomain: playDomain(),
    overrides: {
      hpos10i: import.meta.env.VITE_GAME_URL_HPOS10I,
      nobu: import.meta.env.VITE_GAME_URL_NOBU,
      'peoples-bitcoin': import.meta.env.VITE_GAME_URL_PEOPLES_BITCOIN,
      sproto: import.meta.env.VITE_GAME_URL_SPROTO_DUEL,
      'sproto-fighter': import.meta.env.VITE_GAME_URL_SPROTO_FIGHTER,
      'sproto-arcade': import.meta.env.VITE_GAME_URL_SPROTO_ARCADE,
    },
  };

  // The Relics tab in the Esc menu lists the Relics; the HUD only shows a count that opens it.
  const relicCount = document.querySelector<HTMLButtonElement>('#relic-count');
  const relicPips = new Map<string, HTMLElement>();
  if (relicCount) {
    const pips = relicCount.querySelector('.relic-pips');
    for (const socket of RELICS) {
      const pip = document.createElement('span');
      pip.className = 'relic-pip';
      pip.style.setProperty('--relic', socket.color);
      pips?.append(pip);
      relicPips.set(socket.id, pip);
    }
    relicCount.addEventListener('click', () => menu.show('relics'));
  }

  function formatVerse(value: number): string { return value.toLocaleString('en-US'); }

  function showVerse(balance: number): void {
    menu.setVerse(balance);
    const node = document.querySelector('#verse');
    if (node) node.textContent = `Verse ${formatVerse(balance)}`;
  }

  function showRelics(ids: readonly string[]): void {
    engine.setRelics(ids);
    content.onRelicsChanged?.(ids.filter(isRelicId));
    menu.setRelics(ids);
    const owned = new Set(ids);
    let count = 0;
    for (const [id, pip] of relicPips) {
      const on = owned.has(id);
      if (on) count += 1;
      pip.classList.toggle('owned', on);
    }
    const text = relicCount?.querySelector('.relic-count-text');
    if (text) text.textContent = `Relics ${count}/${relicPips.size}`;
    relicCount?.setAttribute('aria-label', `Relics: ${count} of ${relicPips.size}. Open the Relics menu`);
  }

  interface HubSession {
    client: ReturnType<typeof createNakamaClient>;
    token: string;
    userId: string;
    deviceId: string;
    /** Set for a username account; null for a device guest. */
    username: string | null;
  }

  let sessionPromise: Promise<HubSession> | null = null;

  function boot(): Promise<HubSession> {
    if (!sessionPromise) sessionPromise = openSession();
    return sessionPromise;
  }

  async function openSession(): Promise<HubSession> {
    const status = document.querySelector<HTMLElement>('#link-status');
    try {
      const client = createNakamaClient({
        serverUrl: '',
        serverKey: __NAKAMA_SERVER_KEY__,
      });
      const deviceId = getOrCreateDeviceId();
      const entry = await gate.entry;
      const auth = entry.kind === 'account'
        ? { token: entry.token, userId: entry.userId }
        : await client.authenticateDevice(deviceId);
      const username = entry.kind === 'account' ? entry.username : null;
      const profile = await client.rpc<ProfileResult>('profile.get', {}, { token: auth.token });
      showRelics(profile.relics);
      showVerse(profile.verse ?? 0);
      menu.setPets(profile.pets?.owned ?? null);
      const session = { client, token: auth.token, userId: auth.userId, deviceId, username };
      await content.onSession?.(session);
      bindAccount(session);
      if (status) {
        status.textContent = session.username ? `Signed in as ${session.username}` : 'Guest linked';
        status.dataset.state = 'online';
      }
      return session;
    } catch (error) {
      sessionPromise = null;
      if (status) {
        status.textContent = 'Nakama offline';
        status.dataset.state = 'offline';
      }
      throw error;
    }
  }

  function setGuest(userId: string, username: string | null = null): void {
    guestLabel = username ?? `Guest ${userId.slice(0, 4)}`;
    menu.setGuest(guestLabel);
  }

  function bindAccount(session: HubSession): void {
    const toggle = document.querySelector('#account-toggle');
    const panel = document.querySelector('#account');
    const idLine = document.querySelector('#account-id');
    const create = document.querySelector('#recovery-create');
    const restore = document.querySelector('#recovery-restore');
    const input = document.querySelector('#recovery-input');
    const code = document.querySelector('#recovery-code');
    const note = document.querySelector('#account-status');
    if (
      !(toggle instanceof HTMLButtonElement) ||
      !(panel instanceof HTMLElement) ||
      !(idLine instanceof HTMLElement) ||
      !(create instanceof HTMLButtonElement) ||
      !(restore instanceof HTMLButtonElement) ||
      !(input instanceof HTMLInputElement) ||
      !(code instanceof HTMLElement) ||
      !(note instanceof HTMLElement)
    ) {
      return;
    }
    idLine.textContent = session.username ?? `Guest ${session.userId.slice(0, 8)}`;
    setGuest(session.userId, session.username);
    toggle.disabled = false;
    toggle.removeAttribute('title');
    const toggleLabel = toggle.querySelector('span:last-child');
    if (toggleLabel && session.username) toggleLabel.textContent = session.username;
    const signOutButton = document.querySelector('#account-signout');
    if (signOutButton instanceof HTMLButtonElement) {
      signOutButton.hidden = false;
      signOutButton.textContent = session.username ? 'Sign out' : 'Sign up or log in';
      signOutButton.addEventListener('click', () => {
        signOut();
        window.location.reload();
      });
    }
    // A username account recovers with its password, so the guest recovery code is hidden.
    for (const node of panel.querySelectorAll<HTMLElement>('[data-guest-only]')) node.hidden = Boolean(session.username);
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      releasePointer();
    });
    create.addEventListener('click', () => {
      void (async () => {
        try {
          const minted = await session.client.rpc<RecoveryCodeResult>('recovery.create', {}, { token: session.token });
          code.hidden = false;
          code.textContent = minted.code;
          note.textContent = 'Save this code now. It will not be shown again.';
        } catch (error) {
          note.textContent = error instanceof HubSdkError ? error.message : 'Could not create a recovery code';
        }
      })();
    });
    restore.addEventListener('click', () => {
      void (async () => {
        try {
          const restored = await session.client.rpc<RecoveryRedeemResult>(
            'recovery.redeem',
            { code: input.value, deviceId: session.deviceId },
            { token: session.token },
          );
          session.token = restored.token;
          session.userId = restored.userId;
          idLine.textContent = `Guest ${session.userId.slice(0, 8)}`;
          setGuest(session.userId);
          const profile = await session.client.rpc<ProfileResult>('profile.get', {}, { token: session.token });
          showRelics(profile.relics);
          showVerse(profile.verse ?? 0);
          menu.setPets(profile.pets?.owned ?? null);
          note.textContent = 'This device is on the recovered guest.';
          // The plaza socket belongs to the old guest: reconnect as the restored one.
          plaza?.close();
          plaza = null;
          void startPlaza(session);
          code.hidden = true;
        } catch (error) {
          note.textContent = error instanceof HubSdkError ? error.message : 'Could not restore that code';
        }
      })();
    });
  }

  const REFRESH_MARGIN_MS = 300_000;

  function tokenExpiry(token: string): number {
    try {
      const part = token.split('.')[1] ?? '';
      const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
      return typeof json.exp === 'number' ? json.exp * 1000 : 0;
    } catch {
      return 0;
    }
  }

  /** Socket token: refreshed (account) or re-issued (guest device) within 5 minutes of expiry. */
  async function plazaToken(session: HubSession): Promise<string> {
    const exp = tokenExpiry(session.token);
    if (!exp || exp - Date.now() > REFRESH_MARGIN_MS) return session.token;
    if (session.username) {
      const fresh = await resume();
      if (fresh) session.token = fresh.token;
      else {
        window.location.assign(loginReturnPath(window.location));
        throw new HubSdkError('no_session', 'Sign in again to continue');
      }
    } else {
      session.token = (await session.client.authenticateDevice(session.deviceId)).token;
    }
    return session.token;
  }

  let plazaState: PlazaStatus = 'connecting';
  let plazaDetail = '';

  function showPlazaStatus(state: PlazaStatus, detail: string): void {
    const changed = state !== plazaState;
    plazaState = state;
    plazaDetail = detail;
    const status = document.querySelector<HTMLElement>('#link-status');
    const who = sessionLabel;
    if (state === 'online' && plaza) {
      plazaLine = `World ${plaza.shard} · ${remoteWorld.presentCount() + 1}/100`;
    } else {
      plazaLine = detail;
    }
    if (status) status.textContent = plazaLine ? `${who} · ${plazaLine}` : who;
    if (changed && (state === 'elsewhere' || state === 'offline')) chat.system(detail || 'Plaza offline');
  }

  let sessionLabel = '';

  /** Chat follows the shard: hub.<shard>, joined once per room. */
  async function joinShardChat(session: HubSession, room: string): Promise<void> {
    if (!plaza || !room || room === chatRoom) return;
    chatRoom = room;
    try {
      const previous = chatChannel;
      const channel = await plaza.realtime.joinChat({ room }, { persistence: true, hidden: false });
      chatChannel = channel;
      if (previous && previous.id !== channel.id) void previous.leave();
      await chat.attach(channel, {
        selfId: session.userId,
        resolveName(name) {
          const lower = name.toLowerCase();
          for (const p of remoteWorld.players.values()) if (p.name.toLowerCase() === lower) return p.userId;
          return null;
        },
        async report(userId, messageId, text) {
          await plaza!.realtime.rpc('chat.report', { channelId: channel.id, messageId, userId, text, reason: 'player_report' });
        },
      });
    } catch (error) {
      chatRoom = '';
      chat.system('Chat is offline; only you can see your lines.');
      console.error(error);
    }
  }

  async function startPlaza(session: HubSession): Promise<void> {
    try {
      plaza = await connectPlaza({
        realm: definition.id,
        serverUrl: '',
        world: remoteWorld,
        getToken: () => plazaToken(session),
        onStatus: showPlazaStatus,
        onShard: (info) => {
          void joinShardChat(session, info.room);
        },
      });
      void joinShardChat(session, plaza.room);
      plaza.profile({ character: look.character, staff: look.staff, pet: petParam });
      showPlazaStatus('online', '');
      remoteWorld.onRoster(() => {
        if (plaza) showPlazaStatus(plazaState, plazaDetail);
      });
    } catch (error) {
      plaza = null;
      showPlazaStatus('offline', 'Plaza offline: only you are here');
      console.error(error);
    }
  }

  const botCount = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('bots') ?? 0) : 0;
  if (import.meta.env.DEV && botCount > 0) {
    const { startBots } = await import('../net/bots');
    startBots(remoteWorld, botCount);
  }

  void boot()
    .then((session) => {
      sessionLabel = session.username ? `Signed in as ${session.username}` : 'Guest linked';
      if (!botCount) void startPlaza(session);
    })
    .catch((error: unknown) => {
      hint.textContent = error instanceof Error ? error.message : 'Nakama is not running';
    });

  function createDebug(): HubDebugState & { element: HTMLElement } {
    const element = document.querySelector('#debug');
    if (!(element instanceof HTMLElement)) throw new Error('Debug overlay is missing');
    element.hidden = false;
    const state: HubDebugState = { drawCalls: 0, fps: 0, x: 0, y: 0, z: 0 };
    window.__hub = state;
    return Object.assign(state, { element });
  }

}

/** Controller movement handed to the player controller, merged with the keyboard. */
interface PadMove { forward: number; strafe: number; sprint: boolean }
const NO_PAD_MOVE: PadMove = Object.freeze({ forward: 0, strafe: 0, sprint: false });
/** D-pad steps for overlays that already speak arrow keys (the arcade picker). */
const NAV_KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;
