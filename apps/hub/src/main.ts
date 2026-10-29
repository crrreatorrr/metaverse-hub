import {
  HubSdkError,
  LOCAL_NAKAMA,
  createNakamaClient,
  getOrCreateDeviceId,
  type ProfileResult,
  type PortalEnterResult,
  type RecoveryCodeResult,
  type RecoveryRedeemResult,
} from '@metaverse/hub-sdk';
import { DoubleSide, MathUtils, Ray, Timer, Vector3 } from 'three';
import { CAMERA_ARM, PORTAL_DISTANCE, PORTALS, SOCKETS, SPRINT_SPEED, WALK_SPEED } from './config';
import { portalPosition, spawnFor } from './layout';
import { STAND_Y, createPlayerController, type MoveInput } from './physics';
import { createWorld } from './scene';
import './style.css';
import { parseReturnGame, portalContaining, portalUrl } from './travel';

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
const world = await createWorld().catch((error: unknown) => {
  hint.textContent = error instanceof Error ? error.message : 'The plaza failed to load';
  throw error;
});
hint.textContent = 'Click to look  ·  WASD move  ·  Mouse look  ·  Shift sprint  ·  Space jump';
app.prepend(world.renderer.domElement);

const player = createPlayerController(world.collider.bvh);
const initial = spawnFor(parseReturnGame(window.location.hash));
player.spawn(initial.x, STAND_Y, initial.z, initial.yaw);

const keys = new Set<string>();
let yaw = initial.yaw;
let pitch = 0.28;
let dragging = false;
let jumpQueued = false;
let armed = false;
let traveling = false;
let cycle = 0;
let fps = 60;
let warnedDraws = false;
const timer = new Timer();
timer.connect(document);
const lookTarget = new Vector3();
const desiredPos = new Vector3();
const rayDir = new Vector3();
const camPos = new Vector3();
const ray = new Ray();

const debug = import.meta.env.DEV ? createDebug() : null;

window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  if (event.repeat && event.code === 'Space') return;
  keys.add(event.code);
  if (event.code === 'Space') {
    jumpQueued = true;
    event.preventDefault();
  }
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
  dragging = true;
  canvas.setPointerCapture(event.pointerId);
  void canvas.requestPointerLock();
});
window.addEventListener('pointerup', () => {
  dragging = false;
});
window.addEventListener('pointermove', (event) => {
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
  const input = readInput();
  player.step(dt, input, { walk: WALK_SPEED, sprint: SPRINT_SPEED });
  const moving = Math.hypot(input.forward, input.strafe) > 0;
  if (moving) cycle += dt * (input.sprint ? 12 : 8);
  world.bob.position.y = moving ? Math.abs(Math.sin(cycle)) * 0.05 : 0;
  world.avatar.rotation.y = -player.facingYaw;
  world.rig.position.copy(player.position);

  const floorY = world.inInterior() ? -300 : 0;
  const lift = Math.max(0, player.position.y - STAND_Y - floorY);
  world.shadow.position.set(player.position.x, player.position.y - STAND_Y + 0.03, player.position.z);
  world.shadow.scale.setScalar(1.15 + lift * 0.25);
  world.shadowMat.opacity = Math.max(0.12, 0.5 - lift * 0.12);

  for (const socket of world.sockets) socket.mesh.rotation.y += dt * (socket.on ? 1.6 : 0.2);
  world.update(dt, moving, input.sprint);
  const warp = world.consumeWarp();
  if (warp) {
    armed = false;
    yaw = warp.yaw;
    player.spawn(warp.x, warp.y, warp.z, warp.yaw);
    world.rig.position.copy(player.position);
    world.avatar.rotation.y = -player.facingYaw;
  }
  const inBar = world.inInterior();
  if (barTabs) barTabs.hidden = !inBar;
  if (!new URLSearchParams(window.location.search).get('shot')) placeCamera();
  fadeLabels();
  updateHint();
  considerPortal();
  world.render();
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

function readInput(): MoveInput {
  const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
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

/** Third-person spring arm. Mouse yaw/pitch orbit the avatar; the BVH keeps the camera out of walls. */
function placeCamera(): void {
  const look = lookTarget.set(player.position.x, player.position.y - 0.15, player.position.z);
  const cp = Math.cos(pitch);
  desiredPos.set(
    look.x - Math.sin(yaw) * CAMERA_ARM * cp,
    look.y + Math.sin(pitch) * CAMERA_ARM,
    look.z + Math.cos(yaw) * CAMERA_ARM * cp,
  );
  rayDir.subVectors(desiredPos, look);
  const len = rayDir.length();
  let next = desiredPos;
  if (len > 0.001) {
    rayDir.multiplyScalar(1 / len);
    ray.origin.copy(look);
    ray.direction.copy(rayDir);
    const hit = world.collider.bvh.raycastFirst(ray, DoubleSide);
    if (hit && hit.distance < len && hit.distance > 0.05) {
      next = camPos.copy(look).addScaledVector(rayDir, Math.max(1.25, hit.distance - 0.28));
    }
  }
  world.camera.position.copy(next);
  if (!world.inInterior() && world.camera.position.y < 0.45) world.camera.position.y = 0.45;
  world.camera.lookAt(look);
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
  const text = zone === 'loading'
    ? 'Loading the bar…'
    : zone === 'door'
      ? `${look}Walk into the door to enter the bar`
      : zone === 'exit'
        ? `${look}Walk through the exit to return to the plaza`
        : near
          ? `${look}Walk into the ring to enter ${near.label}`
          : `${look}WASD move  ·  Mouse look  ·  Shift sprint  ·  Space jump`;
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

function considerPortal(): void {
  if (traveling || world.inInterior()) return;
  const hit = portalContaining(player.position.x, player.position.z);
  if (!hit) {
    armed = true;
    return;
  }
  if (armed) void travel(hit);
}

async function travel(portal: (typeof PORTALS)[number]): Promise<void> {
  traveling = true;
  wipe.style.background = portal.color;
  wipe.textContent = portal.place.toUpperCase();
  wipe.classList.add('on');
  try {
    const session = await boot();
    const entered = await session.client.rpc<PortalEnterResult>(
      'portal.enter',
      { game: portal.id, ranked: false },
      { token: session.token },
    );
    await new Promise((resolve) => {
      window.setTimeout(resolve, 420);
    });
    window.location.assign(portalUrl(portal.url, entered.ticket));
  } catch (error) {
    traveling = false;
    wipe.classList.remove('on');
    hint.textContent = error instanceof Error ? error.message : 'Could not open that portal';
    console.error(error);
  }
}

const relicTray = document.querySelector('#relics');
if (relicTray instanceof HTMLElement) {
  for (const socket of SOCKETS) {
    const slot = document.createElement('div');
    slot.className = 'relic-slot';
    slot.dataset.relic = socket.id;
    slot.style.setProperty('--relic', socket.color);
    const name = document.createElement('span');
    name.className = 'relic-name';
    name.textContent = socket.relic;
    const state = document.createElement('span');
    state.className = 'relic-state';
    state.textContent = 'Empty';
    slot.append(name, state);
    relicTray.append(slot);
  }
}

type BoardTab = 'hpos10i' | 'nobu' | 'pb' | 'sproto' | 'total';
interface EarnedRow { name?: string; gameId?: string; lifetime?: number }

const SAMPLE: Record<BoardTab, readonly (readonly [string, number])[]> = {
  hpos10i: [['morelight', 40], ['guest-17', 18], ['dusk-walker', 6]],
  nobu: [['cone-kid', 30], ['morelight', 12]],
  pb: [['morelight', 50], ['cone-kid', 20]],
  sproto: [['sproto', 36], ['morelight', 14]],
  total: [['morelight', 116], ['cone-kid', 50], ['sproto', 36], ['guest-17', 18], ['dusk-walker', 6]],
};
const TAB_TITLE: Record<BoardTab, string> = {
  hpos10i: 'HPOS10I',
  nobu: 'NOBU',
  pb: "PEOPLE'S BITCOIN",
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
  const node = document.querySelector('#verse');
  if (node) node.textContent = `Verse ${formatVerse(balance)}`;
}

function showRelics(ids: readonly string[]): void {
  world.setRelics(ids);
  const owned = new Set(ids);
  for (const slot of document.querySelectorAll<HTMLElement>('.relic-slot')) {
    const on = owned.has(slot.dataset.relic ?? '');
    slot.classList.toggle('owned', on);
    const state = slot.querySelector('.relic-state');
    if (state) state.textContent = on ? 'Owned' : 'Empty';
  }
}

interface HubSession {
  client: ReturnType<typeof createNakamaClient>;
  token: string;
  userId: string;
  deviceId: string;
}

let sessionPromise: Promise<HubSession> | null = null;

function boot(): Promise<HubSession> {
  if (!sessionPromise) sessionPromise = openSession();
  return sessionPromise;
}

async function openSession(): Promise<HubSession> {
  const status = document.querySelector('#link-status');
  try {
    const client = createNakamaClient({
      serverUrl: '',
      serverKey: LOCAL_NAKAMA.serverKey,
      httpKey: LOCAL_NAKAMA.httpKey,
    });
    const deviceId = getOrCreateDeviceId();
    const auth = await client.authenticateDevice(deviceId);
    const profile = await client.rpc<ProfileResult>('profile.get', {}, { token: auth.token });
    showRelics(profile.relics);
    showVerse(profile.verse ?? 0);
    const board = await client.rpc<{ rows?: EarnedRow[] }>('verse.board', {}, { token: auth.token });
    boardRows = board.rows ?? [];
    paintBar(boardTab);
    const session = { client, token: auth.token, userId: auth.userId, deviceId };
    bindAccount(session);
    if (status) status.textContent = 'Guest linked';
    return session;
  } catch (error) {
    sessionPromise = null;
    if (status) status.textContent = 'Nakama offline';
    throw error;
  }
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
  idLine.textContent = `Guest ${session.userId.slice(0, 8)}`;
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (document.pointerLockElement) document.exitPointerLock();
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
        const profile = await session.client.rpc<ProfileResult>('profile.get', {}, { token: session.token });
        showRelics(profile.relics);
        showVerse(profile.verse ?? 0);
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
