import {
  HubSdkError,
  createNakamaClient,
  getOrCreateDeviceId,
  type GameId,
  type ProfileResult,
  type PortalEnterResult,
  type RecoveryCodeResult,
  type RecoveryRedeemResult,
} from '@metaverse/hub-sdk';
import { DefaultLoadingManager, DoubleSide, MathUtils, Ray, Timer, Vector3 } from 'three';
import { signOut } from './auth';
import '@fontsource-variable/inter/wght.css';
import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/vt323/latin-400.css';
import { createChat } from './chat';
import {
  ARCADE_GAME,
  AVATAR_SCALE,
  CAMERA_ARM,
  CAMERA_LOOK_DROP,
  CHARACTERS,
  PORTAL_DISTANCE,
  ALL_RELICS,
  PORTALS,
  SPRINT_SPEED,
  WALK_SPEED,
  characterHeight,
} from './config';
import { loadLook, saveLook, type AvatarLook } from './look';
import { createMenu } from './menu';
import { gameUrl, type GameUrlContext } from './games';
import { portalPosition, spawnFor } from './layout';
import { STAND_Y, createPlayerController, type MoveInput } from './physics';
import { gate } from './login';
import { createWorld } from './scene';
import './style.css';
import { ARCADE_PROMPT } from './v2/arcade-layout';
import { initialDwell, parseReturnGame, portalContaining, portalUrl, stepPortalDwell, type PortalDwell } from './travel';

const CONTROLS_HINT = 'Arrows move  ·  WASD camera  ·  Shift run  ·  Space jump  ·  Enter chat  ·  Esc menu';
const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);
const CAMERA_YAW_RATE = 1.8;
const CAMERA_PITCH_RATE = 1.15;

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

hint.textContent = 'Loading the plaza…';
let look: AvatarLook = loadLook();
// Models and textures the plaza fetches before its first frame. The loader's own
// total grows as parts are requested one by one, so divide by this instead.
const EXPECTED_ASSETS = 21;
const SCRIPT_SHARE = 0.08;
gate.progress(SCRIPT_SHARE);
DefaultLoadingManager.onProgress = (_url, loaded, total) => {
  gate.progress(SCRIPT_SHARE + (1 - SCRIPT_SHARE) * (loaded / Math.max(total, EXPECTED_ASSETS)));
};
const world = await createWorld(look).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'The plaza failed to load';
  hint.textContent = message;
  gate.failed(`${message}. Reload to try again.`);
  throw error;
});
hint.textContent = `Click to look  ·  ${CONTROLS_HINT}`;
app.prepend(world.renderer.domElement);

const player = createPlayerController(world.collider.bvh);
const returnGame = parseReturnGame(window.location.hash);
const initial = spawnFor(returnGame);
player.spawn(initial.x, STAND_Y, initial.z, initial.yaw);
// Back from Sproto Fighter: stand at the Bar's arcade cabinet once the room loads.
if (returnGame === ARCADE_GAME.id) world.returnToArcade();
// M6 pets: profile.get / loadout.set_hub are not wired yet (docs/m6-server-prep.md), so the equipped pet
// comes from ?pet=<catalog id> for previews until the profile hook lands.
const petParam = new URLSearchParams(window.location.search).get('pet');
if (petParam) void world.setPet(petParam);

const keys = new Set<string>();
let yaw = initial.yaw;
let pitch = 0.28;
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
});
chat.system('Welcome to the plaza. Press Enter to chat.');
chat.system('Only you can see chat until multiplayer goes live.');

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
  if (event.code === 'KeyE' && !event.repeat && world.zone() === 'store') world.verseStoreUi.requestOpen();
  if (event.code === 'KeyE' && !event.repeat && world.zone() === 'arcade') playArcade();
});
window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});
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
  yaw -= event.movementX * 0.0017;
  pitch -= event.movementY * 0.0014;
  pitch = MathUtils.clamp(pitch, -0.42, 1.05);
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
  const input = readInput();
  player.step(dt, input, { walk: WALK_SPEED, sprint: SPRINT_SPEED });
  const moving = Math.hypot(input.forward, input.strafe) > 0;
  // P4: the jog / dash clips bake their own bounce, so the procedural bob stays at 0.
  world.bob.position.y = 0;
  world.avatar.rotation.y = -player.facingYaw;
  world.rig.position.copy(player.position);

  const floorY = world.inInterior() ? -300 : 0;
  const lift = Math.max(0, player.position.y - STAND_Y - floorY);
  world.shadow.position.set(player.position.x, player.position.y - STAND_Y + 0.03, player.position.z);
  world.shadow.scale.setScalar((1.15 + lift * 0.25) * AVATAR_SCALE);
  world.shadowMat.opacity = Math.max(0.12, 0.5 - lift * 0.12);

  for (const socket of world.sockets) socket.mesh.rotation.y += dt * (socket.on ? 1.6 : 0.2);
  world.update(dt, moving, input.sprint);
  const warp = world.consumeWarp();
  if (warp) {
    dwell = initialDwell();
    yaw = warp.yaw;
    player.spawn(warp.x, warp.y, warp.z, warp.yaw);
    world.rig.position.copy(player.position);
    world.avatar.rotation.y = -player.facingYaw;
  }
  const inBar = world.inInterior();
  if (barTabs) barTabs.hidden = !inBar;
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
    debug.element.textContent = `${calls} draws · ${fps.toFixed(0)} fps`;
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

/** A/D yaw and W/S pitch, matching mouse look. Arrows stay on the character. */
function orbitCamera(dt: number): void {
  const yawInput = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
  const pitchInput = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  yaw += yawInput * CAMERA_YAW_RATE * dt;
  pitch += pitchInput * CAMERA_PITCH_RATE * dt;
  pitch = MathUtils.clamp(pitch, -0.42, 1.05);
}

function readInput(): MoveInput {
  if (menu.open || chat.open) {
    jumpQueued = false;
    return { forward: 0, strafe: 0, sprint: false, jump: false, yaw };
  }
  const forward = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
  const strafe = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  const jump = jumpQueued;
  jumpQueued = false;
  return {
    forward,
    strafe,
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    jump,
    yaw,
  };
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
      out.copy(target).addScaledVector(rayDir, Math.max(1.25, hit.distance - 0.28));
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
  if (!world.inInterior() && world.camera.position.y < 0.45) world.camera.position.y = 0.45;
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
  for (const sprite of world.labels) {
    const distance = world.camera.position.distanceTo(sprite.position);
    const material = sprite.material;
    material.opacity = 1 - MathUtils.smoothstep(distance, 24, 40);
  }
}

function updateHint(): void {
  const look = document.pointerLockElement === canvas ? '' : 'Click to look  ·  ';
  const zone = world.zone();
  const near = world.inInterior() ? null : nearestPortal(player.position.x, player.position.z);
  const inside = world.inInterior() ? null : portalContaining(player.position.x, player.position.z);
  if (!inside) portalError = '';
  const closed = near && !pageFor(near.id) ? near : null;
  const entering = inside && pageFor(inside.id) && (traveling || (dwell.elapsed > 0 && !dwell.held));
  const text = portalError
    ? portalError
    : zone === 'loading'
    ? 'Loading the bar…'
    : zone === 'door'
      ? `${look}Walk into the door to enter the bar`
      : zone === 'exit'
        ? `${look}Walk through the exit to return to the plaza`
      : zone === 'arcade'
        ? pageFor(ARCADE_GAME.id) ? `${look}${ARCADE_PROMPT}` : `${look}${ARCADE_GAME.label} · Coming soon`
      : zone === 'store'
        ? world.verseStoreUi.open ? `${look}Sprotel Bitcoin · Verse store` : `${look}Press E · ${world.verseStoreUi.prompt}`
        : closed
          ? `${look}${closed.label} · Coming soon`
          : entering && inside
            ? `${look}Entering ${inside.label}…`
            : near
              ? `${look}Walk into the ring to enter ${near.label}`
              : `${look}${CONTROLS_HINT}`;
  if (hint.textContent !== text) hint.textContent = text;
}

function nearestPortal(x: number, z: number) {
  let best: (typeof PORTALS)[number] | null = null;
  let bestDistance = 18;
  for (const portal of PORTALS) {
    const at = portalPosition(portal.angle, PORTAL_DISTANCE);
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
  if (world.inInterior() || menu.open || isTypingTarget(document.activeElement)) {
    dwell = initialDwell();
    return;
  }
  const hit = portalContaining(player.position.x, player.position.z);
  const stepped = stepPortalDwell(dwell, hit?.id ?? null, dt);
  dwell = stepped.state;
  if (!stepped.ready || !hit) return;
  const page = pageFor(hit.id);
  if (!page) return;
  void travel(hit, page);
}

const ENTER_FADE_MS = 700;

/** E at the Bar's arcade cabinet. Same ticket flow as a ring. */
function playArcade(): void {
  if (traveling || menu.open) return;
  const page = pageFor(ARCADE_GAME.id);
  if (!page) return;
  void travel(ARCADE_GAME, page);
}

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
  },
};

// The Relics tab in the Esc menu lists the Relics; the HUD only shows a count that opens it.
const relicCount = document.querySelector<HTMLButtonElement>('#relic-count');
const relicPips = new Map<string, HTMLElement>();
if (relicCount) {
  const pips = relicCount.querySelector('.relic-pips');
  for (const socket of ALL_RELICS) {
    const pip = document.createElement('span');
    pip.className = 'relic-pip';
    pip.style.setProperty('--relic', socket.color);
    pips?.append(pip);
    relicPips.set(socket.id, pip);
  }
  relicCount.addEventListener('click', () => menu.show('relics'));
}

type BoardTab = 'hpos10i' | 'nobu' | 'peoples-bitcoin' | 'sproto' | 'total';
interface EarnedRow { name?: string; gameId?: string; lifetime?: number }

const SAMPLE: Record<BoardTab, readonly (readonly [string, number])[]> = {
  hpos10i: [['morelight', 40], ['guest-17', 18], ['dusk-walker', 6]],
  nobu: [['cone-kid', 30], ['morelight', 12]],
  'peoples-bitcoin': [['morelight', 50], ['cone-kid', 20]],
  sproto: [['sproto', 36], ['morelight', 14]],
  total: [['morelight', 116], ['cone-kid', 50], ['sproto', 36], ['guest-17', 18], ['dusk-walker', 6]],
};
const TAB_TITLE: Record<BoardTab, string> = {
  hpos10i: 'HPOS10I',
  nobu: 'NOBU',
  'peoples-bitcoin': "PEOPLE'S BITCOIN",
  sproto: 'SPROTO DUEL',
  total: 'TOTAL',
};
let boardRows: EarnedRow[] = [];
let boardTab: BoardTab = 'total';
const barTabs = document.querySelector<HTMLElement>('#bar-tabs');

function formatVerse(value: number): string {
  return value.toLocaleString('en-US');
}

function paintBar(tab: BoardTab = boardTab): void {
  boardTab = tab;
  const real = tab === 'total'
    ? totals(boardRows)
    : boardRows
      .filter((row) => row.gameId === tab && typeof row.lifetime === 'number' && row.name)
      .map((row) => [row.name as string, row.lifetime as number] as const);
  const sample = real.length === 0;
  const rows = (sample ? SAMPLE[tab] : real)
    .slice()
    .sort((a, b) => b[1] - a[1])
    .map((row) => [row[0], formatVerse(row[1])] as const);
  world.setBoard(TAB_TITLE[tab], rows, sample);
  for (const button of document.querySelectorAll<HTMLButtonElement>('#bar-tabs button')) {
    button.classList.toggle('on', button.dataset.tab === tab);
  }
}

function totals(rows: EarnedRow[]): (readonly [string, number])[] {
  const sums = new Map<string, number>();
  for (const row of rows) {
    if (!row.name || typeof row.lifetime !== 'number' || !row.gameId) continue;
    sums.set(row.name, (sums.get(row.name) ?? 0) + row.lifetime);
  }
  return [...sums.entries()];
}

if (barTabs instanceof HTMLElement) {
  barTabs.addEventListener('click', (event) => {
    const button = event.target;
    if (!(button instanceof HTMLButtonElement) || !button.dataset.tab) return;
    paintBar(button.dataset.tab as BoardTab);
  });
}
paintBar('total');

function showVerse(balance: number): void {
  menu.setVerse(balance);
  const node = document.querySelector('#verse');
  if (node) node.textContent = `Verse ${formatVerse(balance)}`;
}

function showRelics(ids: readonly string[]): void {
  world.setRelics(ids);
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
    const board = await client.rpc<{ rows?: EarnedRow[] }>('verse.board', {}, { token: auth.token });
    boardRows = board.rows ?? [];
    paintBar(boardTab);
    const session = { client, token: auth.token, userId: auth.userId, deviceId, username };
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
        code.hidden = true;
      } catch (error) {
        note.textContent = error instanceof HubSdkError ? error.message : 'Could not restore that code';
      }
    })();
  });
}

void boot().catch((error: unknown) => {
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
