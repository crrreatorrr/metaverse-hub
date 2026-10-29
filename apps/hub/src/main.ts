import { getOrCreateDeviceId, mintMockTicket } from '@metaverse/hub-sdk';
import { DoubleSide, MathUtils, Ray, Timer, Vector3 } from 'three';
import { CAMERA_ARM, PORTAL_DISTANCE, PORTALS, SPRINT_SPEED, WALK_SPEED } from './config';
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

const world = createWorld();
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
  world.camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  world.camera.updateProjectionMatrix();
  world.renderer.setSize(window.innerWidth, window.innerHeight);
});
world.camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
world.camera.updateProjectionMatrix();

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

  const lift = Math.max(0, player.position.y - STAND_Y);
  world.shadow.position.set(player.position.x, 0.03, player.position.z);
  world.shadow.scale.setScalar(1.15 + lift * 0.25);
  world.shadowMat.opacity = Math.max(0.12, 0.5 - lift * 0.12);

  world.neonTime.value += dt;
  placeCamera();
  fadeLabels();
  updateHint();
  considerPortal();

  world.renderer.render(world.scene, world.camera);
  if (debug) {
    const calls = world.renderer.info.render.calls;
    fps = fps * 0.9 + (dt > 0 ? 0.1 / dt : 0);
    debug.drawCalls = calls;
    debug.fps = fps;
    debug.x = player.position.x;
    debug.y = player.position.y;
    debug.z = player.position.z;
    debug.element.textContent = `${calls} draws · ${fps.toFixed(0)} fps`;
    if (calls > 100 && !warnedDraws) {
      warnedDraws = true;
      console.warn(`[hub] draw calls ${calls} exceed the 100 budget`);
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
  if (world.camera.position.y < 0.45) world.camera.position.y = 0.45;
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
  const near = nearestPortal(player.position.x, player.position.z);
  const text = near
    ? `${look}Walk into the ring to enter ${near.label}`
    : `${look}WASD move  ·  Mouse look  ·  Shift sprint  ·  Space jump`;
  if (hint.textContent !== text) hint.textContent = text;
}

function nearestPortal(x: number, z: number) {
  let best: (typeof PORTALS)[number] | null = null;
  let bestDistance = 7.2;
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
  if (traveling) return;
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
  wipe.textContent = portal.label.toUpperCase();
  wipe.classList.add('on');
  try {
    const ticket = await mintMockTicket({
      game: portal.id,
      playerId: getOrCreateDeviceId(),
      ranked: false,
    });
    await new Promise((resolve) => {
      window.setTimeout(resolve, 420);
    });
    window.location.assign(portalUrl(portal.url, ticket));
  } catch (error) {
    traveling = false;
    wipe.classList.remove('on');
    hint.textContent = 'Could not open that portal';
    console.error(error);
  }
}

function createDebug(): HubDebugState & { element: HTMLElement } {
  const element = document.querySelector('#debug');
  if (!(element instanceof HTMLElement)) throw new Error('Debug overlay is missing');
  element.hidden = false;
  const state: HubDebugState = { drawCalls: 0, fps: 0, x: 0, y: 0, z: 0 };
  window.__hub = state;
  return Object.assign(state, { element });
}
