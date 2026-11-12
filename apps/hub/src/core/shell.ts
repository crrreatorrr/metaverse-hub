import { isRelicId } from '@metaverse/hub-sdk';
import { RELICS } from './relics';
import { MOVEMENT } from '../core/movement';
import {
  HubSdkError,
  createNakamaClient,
  installFeedback,
  type ChatChannel,
  getOrCreateDeviceId,
  type GameId,
  type ProfileResult,
  type PortalEnterResult,
  type RecoveryCodeResult,
  type RecoveryRedeemResult,
} from '@metaverse/hub-sdk';
import { DefaultLoadingManager, DoubleSide, MathUtils, Matrix4, Ray, Timer, Vector3, type PerspectiveCamera } from 'three';
import { resume, signOut } from '../auth';
import '@fontsource-variable/inter/wght.css';
import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/vt323/latin-400.css';
import { createChat } from '../chat';
import { connectPlaza, type Plaza, type PlazaStatus } from '../net/plaza';
import { animIndex } from '../net/protocol';
import { createRemoteWorld } from '../net/remoteWorld';
import { createRemotes } from '../remotes';
import { createSims } from '../sims/sims';
import { loadSims, saveSims } from '../sims/store';
import { createOverheads } from '../overheads';
import { AVATAR_SCALE, CAMERA_ARM, CAMERA_LOOK_DROP, CHARACTERS, SPRINT_SPEED, WALK_SPEED, characterHeight } from '../config';
import { loadLook, saveLook, type AvatarLook } from '../look';
import { MENU_TAB_ORDER, createMenu } from '../menu';
import { createPetCollision } from './pet-collision';
import { createPlanarSpeed } from './planar-speed';
import { DEFAULT_PET_ID, EQUIPPABLE_PET_IDS } from '../v2/pets';
import { gameUrl, type GameUrlContext } from '../games';
import { createExchangeKeys, exchangeErrorText, walletFromAnswer, type BalancesAnswer, type ExchangeAnswer, type WalletState } from '../wallet';
import { portalPosition } from '../layout';
import { STAND_Y, createPlayerController, type MoveInput } from '../physics';
import { gate } from '../login';
import '../style.css';
import { initialDwell, loginReturnPath, portalContaining, portalUrl, stepPortalDwell, type PortalDwell } from '../travel';

import { createEngine } from './engine';
import { createCameraFollow } from './camera-follow';
import { createCameraArm, createCameraPitch, createCameraPreview, createCameraTarget } from './camera-motion';
import { PAD, PAD_TUNING, createPadReader, loadMoveStick, padPrompt, rumble, saveMoveStick, stickClicks, type MoveStick, type PadFrame } from './gamepad';
import { createPadFocus } from './pad-focus';
import { loadInvertLook, lookVertical, saveInvertLook } from './look-settings';
import { GAME_LIST, LAST_GAME_KEY, MATURE_OK_KEY, MATURE_QUESTION, gameInfo, needsMatureConfirm, parseLastGame, relicOfGame } from '../game-list';
import { createHudGuide } from '../guide/hud';
import { ONBOARDING_SEEN_KEY, onboardingFinished, onboardingStep, type OnboardingState } from '../guide/onboarding';
import { TRIP_KEY, encodeTrip, parseTrip, tripLines, tripSummary } from '../guide/trip';
import { parseReturnGame } from '../travel';
import { canEmote, emoteForKey, emoteLine, type EmoteId } from '../emotes';
import { LAUNCH_TIMEOUT_MS, OFFLINE_STATUS_TEXT, SERVER_SILENT_TEXT, SESSION_RETRY_MS, launchErrorText, withTimeout } from './launch-errors';
import type { RealmDefinition, RealmContent } from './realm';
import { captureHtml, pageShotHold, preloadPageShot } from './page-shot';

/** loadout.set_hub reply (server/modules/src/pets.ts `ack`). */
interface HubPetAck {
  ok: boolean;
  seq: number;
  slots?: { pet: string | null };
  reason?: string;
}

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
  const padHint = (stick: MoveStick) => {
    const [walk, cam] = stick === 'left' ? ['Left', 'Right'] : ['Right', 'Left'];
    return `${walk} stick move  ·  ${cam} stick camera  ·  A jump / use  ·  B run  ·  View chat  ·  Menu menu`;
  };
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
      if (page && !traveling && !menu.open) launch(game, page);
    },
    releasePointer() { keys.clear(); releasePointer(); },
    isBlocked: () => traveling || menu.open || chat.open,
  });
  const world = Object.defineProperties(Object.create(engine), Object.getOwnPropertyDescriptors(content)) as typeof engine & RealmContent;
  const PORTALS = content.portals ?? [];
  const petCollision = createPetCollision(world.collider.bvh);
  engine.setPetCollision(petCollision);
  engine.loadAvatar();
  document.documentElement.dataset.realm = definition.id;
  document.documentElement.dataset.realmReady = '1';
  hint.textContent = `Click to look  ·  ${CONTROLS_HINT}`;
  app.prepend(world.renderer.domElement);

  const player = createPlayerController(world.collider.bvh);
  const initial = definition.spawn(window.location.hash);
  player.spawn(initial.x, initial.y, initial.z, initial.yaw);
  const planarSpeed = createPlanarSpeed(initial.x, initial.z);
  // Hub pet (M6). The Pets menu deploys one: it is saved with loadout.set_hub and comes back in
  // profile.get as pets.active, which wins once the profile loads. This browser keeps a copy for offline
  // development visits. New accounts and offline visits start with Pepe Bull. ?pet=<id> previews art in DEV.
  const PET_KEY = 'hub:pet';
  const petParam = new URLSearchParams(window.location.search).get('pet');
  let activePet: string | null = import.meta.env.DEV ? petParam ?? loadStoredPet() : DEFAULT_PET_ID;
  if (activePet) showPet(activePet);

  function loadStoredPet(): string | null {
    try {
      const stored = localStorage.getItem(PET_KEY);
      if (stored === 'none') return null;
      return stored && (EQUIPPABLE_PET_IDS as readonly string[]).includes(stored) ? stored : DEFAULT_PET_ID;
    } catch {
      return DEFAULT_PET_ID;
    }
  }

  function storePet(id: string | null): void {
    try {
      localStorage.setItem(PET_KEY, id ?? 'none');
    } catch {
      // Storage may be off (private window). The pet still follows for this visit.
    }
  }

  function showPet(id: string | null): void {
    void world.setPet(id).catch((error: unknown) => console.warn('[pets] could not load follower', error));
  }

  /** Show `id` following the avatar (null: none) here and to the plaza. */
  function applyPet(id: string | null): void {
    if (id === activePet) return;
    activePet = id;
    showPet(id);
    plaza?.profile({ character: look.character, staff: look.staff, pet: activePet });
    menu.refreshPets();
  }

  /** The pet the server has on this account (profile.get pets.active). */
  function adoptServerPet(pets: ProfileResult['pets']): void {
    if (!pets || (import.meta.env.DEV && petParam)) return;
    const id = pets.active && (EQUIPPABLE_PET_IDS as readonly string[]).includes(pets.active) ? pets.active : null;
    storePet(id);
    applyPet(id);
  }

  /** Pets menu: deploy (id) or recall (null) a pet, then save it on the account. */
  function deployPet(id: string | null): void {
    petSaves = petSaves.then(() => savePet(id));
  }

  let petSaves = Promise.resolve();
  async function savePet(id: string | null): Promise<void> {
    if (!sessionPromise) {
      if (id === null || id === DEFAULT_PET_ID) { storePet(id); applyPet(id); }
      return;
    }
    let session: HubSession;
    try {
      session = await sessionPromise;
    } catch {
      return;
    }
    const send = (seq: number) =>
      session.client.rpc<HubPetAck>('loadout.set_hub', { v: 1, pet: id, seq }, { token: session.token });
    try {
      let ack = await send(Date.now());
      // Another device saved with a later clock: go one past its seq.
      if (!ack.ok && ack.reason === 'stale_seq') ack = await send(Math.max(Date.now(), ack.seq + 1));
      if (ack.ok) { storePet(ack.slots?.pet ?? null); applyPet(ack.slots?.pet ?? null); }
      // Not owned (or still stale): show what the server has, unless another deploy came since.
      if (!ack.ok && activePet === id) {
        const kept = ack.slots?.pet ?? null;
        storePet(kept);
        applyPet(kept);
      }
    } catch (error) {
      console.warn('[pets] could not save the deployed pet', error);
    }
  }

  const keys = new Set<string>();
  /** Which stick walks (menu → Items → Controller). The other turns the camera. */
  let moveStick: MoveStick = loadMoveStick();
  /** Vertical look sense (menu → Items → Vertical look). True is the plaza's original inverted sense. */
  let invertLook = loadInvertLook();
  const pad = createPadReader(PAD_TUNING, { moveStick: () => moveStick });
  const padFocus = createPadFocus();
  /** A controller was the last device used: hints show controller prompts. */
  let usingPad = false;
  /** Clicking the walking stick toggles running until the stick comes back to rest. */
  let padRun = false;
  /** The login gate or a trip had the pad last frame: latch what is held when they let go. */
  let padBlocked = true;
  let yaw = initial.yaw;
  const cameraFollow = createCameraFollow();
  const cameraPitch = createCameraPitch();
  const cameraTarget = createCameraTarget();
  const cameraArm = createCameraArm();
  const cameraPreview = createCameraPreview();
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
  /** When the last travel error was shown; it stays up a few seconds even outside an entrance. */
  let portalErrorAt = -Infinity;
  let fps = 60;
  let warnedDraws = false;
  /** Set while the hub itself drops pointer lock, so the lock change does not open the menu. */
  let releasingLock = false;
  let menuOpenedByLockAt = -Infinity;
  let guestLabel = 'Guest';
  /** 0 = play camera, 1 = menu preview in front of the avatar. */
  let preview = 0;
  const savedView = { yaw: 0, pitch: 0 };
  const timer = new Timer();
  timer.connect(document);
  const lookTarget = new Vector3();
  const playerLookTarget = new Vector3();
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
    petCollision,
    hud: hudRoot instanceof HTMLElement ? hudRoot : document.body,
    setOrbitAvatars: (avatars) => world.setRemoteOrbit(avatars),
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  });
  let otherPetsHidden = false;
  try { otherPetsHidden = localStorage.getItem('hub:hide-other-pets') === '1'; } catch { /* Optional preference. */ }
  remotes.setPetsHidden(otherPetsHidden);
  const overheads = createOverheads(hudRoot instanceof HTMLElement ? hudRoot : document.body);

  // Onboarding and discovery (plan D1, D2, D4, D5): first-visit card, gate markers, return card, 18+ confirm.
  const guide = createHudGuide(hudRoot instanceof HTMLElement ? hudRoot : document.body, () => {
    onboarding.dismissed = true;
    paintOnboarding();
  });
  const onboarding: OnboardingState = {
    seen: readStored('local', ONBOARDING_SEEN_KEY, (value) => value === '1'),
    dismissed: false,
    relics: null,
    reachedGate: false,
  };
  function paintOnboarding(): void {
    if (!onboarding.seen && onboardingFinished(onboarding)) {
      onboarding.seen = true;
      writeStored('local', ONBOARDING_SEEN_KEY, '1');
    }
    guide.paintOnboarding(onboardingStep(onboarding));
  }
  paintOnboarding();
  const markerPoint = new Vector3();
  const markerView = new Matrix4();
  const shotMode = Boolean(new URLSearchParams(window.location.search).get('shot'));

  // Sims (Menu → Sims): characters only this screen sees. They join the RemoteWorld so
  // remotes.ts draws them; their lines go to the chat log and bubbles, never the channel.
  let simSettings = loadSims();
  const simsHere = definition.id === 'plaza';
  const sims = createSims({
    world: remoteWorld,
    speed: simSettings.speed,
    seed: Date.now() % 100_000,
    onLine(userId, name, text) {
      chat.local(`${name} (sim)`, text);
      overheads.show(userId, { color: 'cyan', effect: null, text });
    },
  });
  if (simsHere) sims.set(simSettings.list);
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
    sims: () => simSettings,
    setSims(next) {
      if (next.speed !== simSettings.speed) sims.setSpeed(next.speed);
      simSettings = { list: [...next.list], speed: next.speed };
      saveSims(simSettings);
      if (simsHere) sims.set(simSettings.list);
    },
    restartSims: () => sims.restart(),
    simAct: () => (simsHere ? sims.act() : 'only in the plaza'),
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
      plaza?.profile({ character: look.character, staff: look.staff, pet: activePet });
    },
    onOpen() {
      keys.clear();
      releasePointer();
      if (chat.open) chat.hide();
      savedView.yaw = yaw;
      savedView.pitch = pitch;
      cameraPreview.open(player.facingYaw);
    },
    onClose() {
      keys.clear();
      yaw = savedView.yaw;
      pitch = savedView.pitch;
      cameraFollow.reset();
      cameraPitch.reset();
    },
    onSpin(delta) {
      cameraPreview.spin(delta);
    },
    moveStick: () => moveStick,
    setMoveStick(next) {
      moveStick = next;
      saveMoveStick(next);
    },
    invertLook: () => invertLook,
    setInvertLook(next) {
      invertLook = next;
      saveInvertLook(next);
    },
    games: GAME_LIST,
    gameAvailable: (id) => pageFor(id) !== null,
    playGame(id) {
      const game = gameInfo(id);
      const page = pageFor(id);
      if (!game || !page || traveling) return;
      menu.hide();
      launch(game, page);
    },
    lastGame: () => readStored('local', LAST_GAME_KEY, parseLastGame),
    deployablePets: EQUIPPABLE_PET_IDS,
    otherPetsHidden: () => otherPetsHidden,
    setOtherPetsHidden(hidden) {
      otherPetsHidden = hidden;
      remotes.setPetsHidden(hidden);
      try { localStorage.setItem('hub:hide-other-pets', hidden ? '1' : '0'); } catch { /* Optional preference. */ }
    },
    activePet: () => activePet,
    setActivePet: deployPet,
    loadWallet,
    exchangeTickets,
  });

  // Wallet tab (plan B1). Both calls use the hub session; the server decides every amount.
  const exchangeKeys = createExchangeKeys(() => crypto.randomUUID());

  async function loadWallet(): Promise<WalletState | null> {
    if (!sessionPromise) return null;
    try {
      const session = await sessionPromise;
      const answer = await session.client.rpc<BalancesAnswer>('tickets.balances', {}, { token: await plazaToken(session) });
      const state = walletFromAnswer(answer);
      showVerse(state.verse);
      return state;
    } catch (error) {
      console.warn('[wallet] could not load balances', error);
      return null;
    }
  }

  async function exchangeTickets(game: GameId, tickets: number): Promise<{ ok: true; answer: ExchangeAnswer } | { ok: false; text: string }> {
    if (!sessionPromise) return { ok: false, text: SERVER_SILENT_TEXT };
    // The key is kept until the server answers, so a retry after a dropped connection replays this request.
    const key = exchangeKeys.keyFor(game, tickets);
    try {
      const session = await sessionPromise;
      const answer = await withTimeout(
        session.client.rpc<ExchangeAnswer>('verse.exchange', { game, tickets, key }, { token: await plazaToken(session) }),
        LAUNCH_TIMEOUT_MS,
      );
      exchangeKeys.settle(game, tickets);
      showVerse(answer.verse);
      return { ok: true, answer };
    } catch (error) {
      // An error body from the RPC (no HTTP status) is the server's answer: the request is finished.
      if (error instanceof HubSdkError && error.status === undefined) {
        exchangeKeys.settle(game, tickets);
        return { ok: false, text: exchangeErrorText(error.code) };
      }
      console.warn('[wallet] exchange did not finish', error);
      return { ok: false, text: SERVER_SILENT_TEXT };
    }
  }

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
    // A confirm dialog (the 18+ question) owns it: Enter or Y says yes, anything that means "no" cancels.
    if (guide.confirmOpen) {
      if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'KeyY') {
        event.preventDefault();
        guide.answer(true);
      } else if (event.code === 'Escape' || event.key === 'Escape' || event.code === 'KeyN') {
        event.preventDefault();
        guide.answer(false);
      }
      return;
    }
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
    const emote = event.repeat ? null : emoteForKey(event.code);
    if (emote && !traveling) {
      sendEmote(emote);
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
    content.setPadPrompts?.(false);
    chat.setPad(false);
  };
  window.addEventListener('keydown', dropPadPrompts, { capture: true });
  window.addEventListener('pointerdown', dropPadPrompts, { capture: true });
  window.addEventListener('blur', () => {
    keys.clear();
    dragging = false;
    cameraFollow.reset();
    cameraPitch.reset();
  });

  const canvas = world.renderer.domElement;
  canvas.addEventListener('pointerdown', (event) => {
    if (controlsBlocked()) return;
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    void canvas.requestPointerLock();
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });
  window.addEventListener('pointermove', (event) => {
    if (controlsBlocked()) return;
    if (document.pointerLockElement !== canvas && !dragging) return;
    turnCamera(event.movementX * MOVEMENT.mouseYaw, event.movementY * MOVEMENT.mousePitch);
  });

  window.addEventListener('resize', () => {
    world.resize(window.innerWidth, window.innerHeight);
  });
  world.resize(window.innerWidth, window.innerHeight);

  world.renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), 0.05);
    preview = cameraPreview.step(dt, menu.open);
    if (!menu.open) orbitCamera(dt);
    const pads = navigator.getGamepads?.() ?? [];
    const padMove = readPad(pad.poll(pads, timestamp), dt, pads);
    if (controlsBlocked()) cameraPitch.reset();
    else pitch += cameraPitch.step(dt, MOVEMENT.pitchMin - pitch, MOVEMENT.pitchMax - pitch);
    const input = readInput(padMove);
    player.step(dt, input, { walk: WALK_SPEED, sprint: SPRINT_SPEED });
    const inputAmount = Math.hypot(input.forward, input.strafe);
    const moving = inputAmount > 0;
    const requestedSpeed = Math.min(1, inputAmount) * (input.sprint ? SPRINT_SPEED : WALK_SPEED);
    const speed = planarSpeed.sample(dt, player.position.x, player.position.z, moving ? player.facingYaw : undefined, requestedSpeed);
    yaw = cameraFollow.step(dt, yaw, player.facingYaw, moving && (speed ?? 0) > 0.02);
    airTime = player.grounded ? 0 : airTime + dt;
    const air = {
      airborne: player.velocity.y > AIR_RISE || airTime > AIR_GRACE,
      vy: player.velocity.y,
      flight: { airborne: !player.grounded, dt },
    };
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

    const rigMoving = engine.update(dt, moving, input.sprint, air, speed);
    content.update(dt, { moving, sprint: input.sprint, position: player.position });
    remotes.update(dt, performance.now(), world.camera, player.position);
    overheads.update(dt, world.camera, (id, out) => remotes.positionOf(id, out), { width: window.innerWidth, height: window.innerHeight });
    plaza?.sendPose(
      player.position.x,
      player.position.y,
      player.position.z,
      bodyYaw,
      animIndex(air.airborne ? 'jump' : rigMoving ? (input.sprint ? 'run' : 'walk') : 'idle'),
    );
    const warp = content.consumeWarp?.();
    if (warp) {
      dwell = initialDwell();
      yaw = warp.yaw;
      cameraFollow.reset();
      cameraPitch.reset();
      cameraTarget.reset();
      cameraArm.reset();
      cameraPreview.reset();
      preview = 0;
      player.spawn(warp.x, warp.y, warp.z, warp.yaw);
      planarSpeed.reset(warp.x, warp.z);
      world.rig.position.copy(player.position);
      bodyYaw = player.facingYaw;
      airTime = 0;
      world.avatar.rotation.y = -bodyYaw;
    }
    if (!shotMode) placeCamera(dt);
    placeMarkers();
    placeOverhead(dt);
    fadeLabels();
    updateHint();
    considerPortal(dt);
    // The feedback screenshot is copying the page's HTML: skip this draw (page-shot.ts).
    if (!pageShotHold.held) world.render();
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

  /** Keys 1 / 2 / 3: show the emote over your own head at once and send it to the shard. */
  let lastEmoteAt = -Infinity;
  function sendEmote(id: EmoteId): void {
    const now = performance.now();
    const line = emoteLine(id);
    if (!line || !canEmote(lastEmoteAt, now)) return;
    lastEmoteAt = now;
    chat.floatOwn(line);
    plaza?.emote(id);
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
    if (target instanceof HTMLTextAreaElement) return true;
    if (target.isContentEditable) return true;
    if (target.getAttribute('role') === 'textbox') return true;
    return Boolean(target.closest('[contenteditable="true"], [role="textbox"], [data-chat], .chat-field, #chat'));
  }

  /**
   * Keyboard camera for players without a mouse: Z / C turn, R / F lower and raise the camera.
   * WASD and the arrows both move the character, so the camera stays off the movement keys.
   */
  function orbitCamera(dt: number): void {
    if (controlsBlocked()) return;
    const yawInput = (keys.has('KeyC') ? 1 : 0) - (keys.has('KeyZ') ? 1 : 0);
    const pitchInput = (keys.has('KeyF') ? 1 : 0) - (keys.has('KeyR') ? 1 : 0);
    turnCamera(yawInput * CAMERA_YAW_RATE * dt, pitchInput * CAMERA_PITCH_RATE * dt);
  }

  function controlsBlocked(): boolean {
    return gate.isOpen() || traveling || menu.open || chat.open || guide.confirmOpen || Boolean(content.overlayOpen?.()) || isTypingTarget(document.activeElement);
  }

  function turnCamera(horizontal: number, vertical: number): void {
    if (horizontal === 0 && vertical === 0) return;
    cameraFollow.manualLook(horizontal);
    cameraPitch.queue(lookVertical(vertical, invertLook));
  }

  function readInput(padMove: PadMove = NO_PAD_MOVE): MoveInput {
    if (controlsBlocked()) {
      jumpQueued = false;
      cameraFollow.reset();
      return { forward: 0, strafe: 0, sprint: false, jump: false, yaw };
    }
    const up = keys.has('ArrowUp') || keys.has('KeyW');
    const down = keys.has('ArrowDown') || keys.has('KeyS');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const digitalForward = (up ? 1 : 0) - (down ? 1 : 0) + padMove.digitalForward;
    const digitalStrafe = (right ? 1 : 0) - (left ? 1 : 0) + padMove.digitalStrafe;
    const forward = MathUtils.clamp((up ? 1 : 0) - (down ? 1 : 0) + padMove.forward, -1, 1);
    const strafe = MathUtils.clamp((right ? 1 : 0) - (left ? 1 : 0) + padMove.strafe, -1, 1);
    const jump = jumpQueued;
    jumpQueued = false;
    return {
      forward,
      strafe,
      sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || padMove.sprint,
      jump,
      yaw: cameraFollow.movementYaw(yaw, forward, strafe, { forward: digitalForward, strafe: digitalStrafe }),
    };
  }

  /**
   * One controller frame (docs/controllers.md). Overlays first: the login gate runs its own
   * loop in login.ts, the arcade picker and Sprotel's talk panel take the D-pad / walking stick /
   * A / B as arrows / Enter / Esc, and the menu moves a focus ring. In the plaza: the walking stick
   * (left by default, see `MoveStick`) moves, the other stick turns the camera, A uses the prompt in
   * front of you (arcade cabinet, Sprotel) and jumps everywhere else, X also uses the prompt,
   * B (held) or a click of the walking stick runs, a click of the camera stick puts the camera
   * behind you, Menu opens the menu and View opens chat.
   */
  function readPad(frame: PadFrame, dt: number, pads: readonly unknown[]): PadMove {
    if (!frame.connected) {
      padRun = false;
      return NO_PAD_MOVE;
    }
    if (frame.active && !usingPad) {
      usingPad = true;
      content.setPadPrompts?.(true);
      chat.setPad(true);
    }
    if (gate.isOpen() || traveling) {
      padBlocked = true;
      return NO_PAD_MOVE;
    }
    if (padBlocked) {
      // The gate can close inside this very frame (its own pad loop pressed Continue as guest), so
      // the A that did it is still down: latch it instead of letting it use the cabinet or jump.
      padBlocked = false;
      pad.latch();
      return NO_PAD_MOVE;
    }

    if (guide.confirmOpen) {
      if (frame.pressed(PAD.A)) guide.answer(true);
      else if (frame.pressed(PAD.B)) guide.answer(false);
      return NO_PAD_MOVE;
    }

    const pickerKey = frame.pressed(PAD.A) ? 'Enter' : frame.pressed(PAD.B) ? 'Escape' : frame.nav ? NAV_KEYS[frame.nav] : '';
    if (content.overlayOpen?.()) {
      if (pickerKey) {
        content.handleKey?.(new KeyboardEvent('keydown', { code: pickerKey, key: pickerKey }));
        if (pickerKey === 'Enter') rumble(pads, pad.activeIndex);
      }
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
      cameraPreview.spin(frame.look.x * PAD_TUNING.previewSpinRate * dt);
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
    // B closes the top card (help, return card, first-visit card) before it goes back to being "run".
    if (frame.pressed(PAD.B) && guide.dismissable) guide.dismiss();
    if (frame.pressed(PAD.VIEW)) {
      chat.show();
      return NO_PAD_MOVE;
    }
    // A is the confirm button: in front of the cabinet or Sprotel it uses them, elsewhere it jumps.
    // X stays a second "use" button for players who learned it.
    const usable = content.interactions?.find(item => item.active() && item.interact);
    if (frame.pressed(PAD.A) || frame.pressed(PAD.X)) {
      if (usable) {
        usable.interact?.();
        rumble(pads, pad.activeIndex, 0.35, 60);
      } else if (frame.pressed(PAD.A)) jumpQueued = true;
    }
    const clicks = stickClicks(moveStick);
    if (frame.pressed(clicks.look)) {
      cameraPitch.recenter(MOVEMENT.initialPitch - pitch);
      cameraFollow.recenter();
    }
    const moving = frame.move.x !== 0 || frame.move.y !== 0;
    if (frame.pressed(clicks.move)) padRun = !padRun;
    if (!moving) padRun = false;
    turnCamera(frame.look.x * PAD_TUNING.lookYawRate * dt, -frame.look.y * PAD_TUNING.lookPitchRate * dt);
    return {
      forward: -frame.move.y,
      strafe: frame.move.x,
      sprint: frame.held(PAD.B) || padRun,
      digitalForward: (frame.held(PAD.UP) ? 1 : 0) - (frame.held(PAD.DOWN) ? 1 : 0),
      digitalStrafe: (frame.held(PAD.RIGHT) ? 1 : 0) - (frame.held(PAD.LEFT) ? 1 : 0),
    };
  }

  const previewLook = new Vector3();
  const headPoint = new Vector3();

  function bodyHeight(): number {
    const character = CHARACTERS.find((entry) => entry.id === look.character) ?? CHARACTERS[0];
    return characterHeight(character);
  }

  /**
   * Spring arm from `look` toward yaw/pitch, pulled in when the BVH is in the
   * way. Writes into `out` and returns the unobstructed fraction of the view.
   */
  function armFrom(target: Vector3, armYaw: number, armPitch: number, arm: number, out: Vector3, dt: number): number {
    const cp = Math.cos(armPitch);
    desiredPos.set(
      target.x - Math.sin(armYaw) * arm * cp,
      target.y + Math.sin(armPitch) * arm,
      target.z + Math.cos(armYaw) * arm * cp,
    );
    // Collision starts at the actual player, so a lagging focus point cannot cut through a corner.
    rayDir.subVectors(desiredPos, playerLookTarget);
    const len = rayDir.length();
    out.copy(desiredPos);
    if (len > 0.001) {
      rayDir.multiplyScalar(1 / len);
      ray.origin.copy(playerLookTarget);
      ray.direction.copy(rayDir);
      const hit = world.collider.bvh.raycastFirst(ray, DoubleSide);
      const clearance = hit && hit.distance < len ? Math.max(0.05, hit.distance - MOVEMENT.armOffset) / len : 1;
      const fraction = cameraArm.step(dt, clearance);
      out.copy(playerLookTarget).addScaledVector(rayDir, len * fraction);
      return fraction;
    }
    return 1;
  }

  /**
   * Third-person spring arm. Mouse yaw/pitch orbit the avatar; the BVH keeps the camera out of walls.
   * With the menu open the camera swings in front of the avatar and the view shifts right of the panel.
   */
  function placeCamera(dt: number): void {
    playerLookTarget.set(player.position.x, player.position.y - CAMERA_LOOK_DROP, player.position.z);
    const target = lookTarget.copy(cameraTarget.step(dt, playerLookTarget));
    let focusFraction: number;
    if (preview > 0) {
      // Swing round the avatar on the arm (angles, not positions), so the camera never cuts through the body.
      const height = bodyHeight();
      const feet = player.position.y - STAND_Y;
      previewLook.set(player.position.x, feet + height * 0.55, player.position.z);
      target.lerp(previewLook, preview);
      focusFraction = armFrom(
        target,
        cameraPreview.yaw(yaw),
        MathUtils.lerp(pitch, 0.08, preview),
        MathUtils.lerp(CAMERA_ARM, 2.2 + height * 1.25, preview),
        camPos,
        dt,
      );
    } else {
      focusFraction = armFrom(target, yaw, pitch, CAMERA_ARM, camPos, dt);
    }
    world.camera.position.copy(camPos);
    world.camera.position.y = Math.max(world.camera.position.y, content.cameraFloor(world.camera.position));
    // Compress focus lag with the arm as well: a nearby wall must never put the focus
    // behind the camera and flip the view toward the player.
    target.lerpVectors(playerLookTarget, target, focusFraction);
    world.camera.lookAt(target);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const shift = preview > 0 ? (menu.panelWidth / 2) * preview : 0;
    if (shift > 0.5) world.camera.setViewOffset(width, height, -shift, 0, width, height);
    else if (world.camera.view?.enabled) world.camera.clearViewOffset();
  }

  /** Gate markers: a label over each entrance in view, or at the screen edge toward it. */
  function placeMarkers(): void {
    const points = content.waypoints?.() ?? [];
    const visible = points.length > 0 && !shotMode && !gate.isOpen() && !menu.open && !traveling && !guide.confirmOpen;
    if (!visible) {
      guide.updateMarkers(points, player.position, () => markerPoint, 1, { width: 1, height: 1 }, false);
      return;
    }
    const camera = world.camera as PerspectiveCamera;
    camera.updateMatrixWorld();
    markerView.copy(camera.matrixWorld).invert();
    guide.updateMarkers(
      points,
      player.position,
      (point) => markerPoint.set(point.x, point.y, point.z).applyMatrix4(markerView),
      MathUtils.degToRad(camera.fov),
      { width: window.innerWidth, height: window.innerHeight },
      true,
    );
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
    // An entrance error clears when you step out; an arcade error stays long enough to read.
    if (!inside && performance.now() - portalErrorAt > PORTAL_ERROR_MS) portalError = '';
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
                ? `${look}Walk through the entrance to play ${near.label}`
                : `${look}${usingPad ? padHint(moveStick) : CONTROLS_HINT}`;
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
    if ((hit || content.atLauncher?.()) && !onboarding.reachedGate) {
      onboarding.reachedGate = true;
      paintOnboarding();
    }
    const stepped = stepPortalDwell(dwell, hit?.id ?? null, dt);
    dwell = stepped.state;
    if (!stepped.ready || !hit) return;
    const page = pageFor(hit.id);
    if (!page) return;
    launch(hit, page);
  }

  /** Browser storage can throw on access (private windows, blocked site data): never let it stop the plaza. */
  function readStored<T>(where: 'local' | 'session', key: string, parse: (stored: string | null) => T): T {
    try {
      return parse((where === 'local' ? localStorage : sessionStorage).getItem(key));
    } catch {
      return parse(null);
    }
  }

  function writeStored(where: 'local' | 'session', key: string, value: string): void {
    try {
      (where === 'local' ? localStorage : sessionStorage).setItem(key, value);
    } catch {
      // The choice lasts for this visit only.
    }
  }

  /** True after "Enter" on the 18+ question in this visit, when storage is off. */
  let matureOk = false;

  /**
   * Every launch goes through here (rings, the cabinet, the Games tab). A game marked mature asks
   * once per browser first; declining leaves the player where they stand, and the ring's dwell
   * stays spent until they step out.
   */
  function launch(game: { id: GameId; label: string; color: string; mature?: boolean }, page: string): void {
    if (traveling || guide.confirmOpen) return;
    const mature = { mature: Boolean(game.mature) || Boolean(gameInfo(game.id)?.mature) };
    const stored = matureOk ? '1' : readStored('local', MATURE_OK_KEY, (value) => value);
    if (!needsMatureConfirm(mature, stored)) {
      void travel(game, page);
      return;
    }
    keys.clear();
    releasePointer();
    void guide.confirm(MATURE_QUESTION, `${game.label} is adult satire (18+).`, 'Enter', 'Stay here').then((yes) => {
      keys.clear();
      if (!yes) return;
      // The yes is remembered only once the launch has gone through (travel stores it): a failed
      // launch asks again next time.
      void travel(game, page, true);
    });
  }

  const ENTER_FADE_MS = 700;
  const PORTAL_ERROR_MS = 5000;

  async function travel(portal: { id: GameId; label: string; color: string }, page: string, matureConfirmed = false): Promise<void> {
    traveling = true;
    if (chat.open) chat.hide();
    releasePointer();
    wipe.style.background = portal.color;
    wipe.textContent = `Entering ${portal.label}…`;
    wipe.classList.add('on');
    const shownAt = performance.now();
    try {
      // One timer covers the session and the ticket, so a hung request cannot leave the wipe up.
      const entered = await withTimeout((async () => {
        const session = await boot();
        return session.client.rpc<PortalEnterResult>(
          'portal.enter',
          { game: portal.id, ranked: false },
          { token: session.token },
        );
      })(), LAUNCH_TIMEOUT_MS);
      // The timer may have fired and cleared the wipe while this was still resolving.
      if (!traveling) return;
      if (matureConfirmed) {
        matureOk = true;
        writeStored('local', MATURE_OK_KEY, '1');
      }
      writeStored('local', LAST_GAME_KEY, portal.id);
      // What the account had when it left, for the return card (D4).
      writeStored('session', TRIP_KEY, encodeTrip({ game: portal.id, relics: [...shownRelics], verse: shownVerse, at: Date.now() }));
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
      portalError = launchErrorText(error, portal.label);
      portalErrorAt = performance.now();
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
      'sproto-shooter': import.meta.env.VITE_GAME_URL_SPROTO_SHOOTER,
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

  let shownVerse = 0;
  function showVerse(balance: number): void {
    shownVerse = balance;
    menu.setVerse(balance);
    const node = document.querySelector('#verse');
    if (node) node.textContent = `Verse ${formatVerse(balance)}`;
  }

  let shownRelics: readonly string[] = [];
  function showRelics(ids: readonly string[]): void {
    shownRelics = ids;
    onboarding.relics = ids.length;
    paintOnboarding();
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
      adoptServerPet(profile.pets);
      const session = { client, token: auth.token, userId: auth.userId, deviceId, username };
      showTripCard(session, profile);
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
        status.textContent = OFFLINE_STATUS_TEXT;
        status.dataset.state = 'offline';
      }
      throw error;
    }
  }

  /**
   * Back from a game (`#from=<game>` and a snapshot stored when the plaza handed over the tab):
   * say what the trip earned, once.
   */
  function showTripCard(session: HubSession, profile: ProfileResult): void {
    const from = parseReturnGame(window.location.hash);
    const before = readStored('session', TRIP_KEY, (stored) => parseTrip(stored, Date.now()));
    try {
      sessionStorage.removeItem(TRIP_KEY);
    } catch {
      // Storage may be off.
    }
    if (!from || !before || before.game !== from) return;
    const summary = tripSummary(before, { relics: profile.relics, verse: profile.verse ?? 0 }, relicOfGame);
    const info = gameInfo(from);
    const relicName = (id: string) => RELICS.find((relic) => relic.id === id)?.name ?? 'a Relic';
    const show = (tickets: number | null) =>
      guide.showTrip(`Back from ${summary.label}`, tripLines(summary, relicName, tickets), info?.color ?? '#ffd21f');
    show(null);
    // The Ticket line needs the hub-scope balances RPC; older servers answer 404 and the card stays as it is.
    void session.client.rpc<BalancesAnswer>('tickets.balances', {}, { token: session.token }).then(
      (answer) => {
        const row = walletFromAnswer(answer).rows.find((entry) => entry.game === from);
        if (row && row.balance > 0) show(row.balance);
      },
      () => undefined,
    );
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
          adoptServerPet(profile.pets);
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
      plaza.profile({ character: look.character, staff: look.staff, pet: activePet });
      // Another player's emote: a line over their head. Your own echo has no remote and is skipped
      // (it was shown when the key was pressed).
      plaza.onEmote((event) => {
        const line = emoteLine(event.e);
        const who = remoteWorld.players.get(event.s);
        if (line && who) overheads.show(who.userId, line);
      });
      showPlazaStatus('online', '');
      const syncRoster = () => {
        if (!plaza) return;
        const ids = remoteWorld.selfRelics;
        if (ids && (ids.length !== shownRelics.length || ids.some((id) => !shownRelics.includes(id)))) showRelics(ids);
        showPlazaStatus(plazaState, plazaDetail);
      };
      remoteWorld.onRoster(syncRoster);
      syncRoster();
    } catch (error) {
      plaza = null;
      showPlazaStatus('offline', 'Plaza offline: only you are here');
      console.error(error);
    }
  }

  const botCount = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('bots') ?? 0) : 0;
  if (import.meta.env.DEV && botCount > 0) {
    const { startBots } = await import('../net/bots');
    startBots(remoteWorld, botCount, undefined, new URLSearchParams(location.search).has('botPets'));
  }

  /** True once a session has started the plaza socket; a retry must not start a second one. */
  let plazaStarted = false;
  let sessionRetry: number | null = null;
  let toldOffline = false;

  function firstSession(): void {
    void boot()
      .then((session) => {
        sessionLabel = session.username ? `Signed in as ${session.username}` : 'Guest linked';
        if (!botCount && !plazaStarted) {
          plazaStarted = true;
          void startPlaza(session);
        }
      })
      .catch((error: unknown) => {
        console.warn('[hub] no session yet', error);
        // Say it once; the status line keeps "Offline: playing solo" while the retries run.
        if (!toldOffline && !portalError) {
          toldOffline = true;
          portalError = SERVER_SILENT_TEXT;
          portalErrorAt = performance.now();
        }
        scheduleSessionRetry();
      });
  }

  /** After a failed first session, try again every 15 s while the tab is visible. */
  function scheduleSessionRetry(): void {
    if (sessionRetry !== null) return;
    sessionRetry = window.setTimeout(() => {
      sessionRetry = null;
      if (document.visibilityState === 'hidden') {
        document.addEventListener('visibilitychange', scheduleSessionRetry, { once: true });
        return;
      }
      firstSession();
    }, SESSION_RETRY_MS);
  }

  // Back from a game through the browser's page cache: the page resumes mid-trip, with the
  // wipe still up and `traveling` set. Clear both so the plaza is usable again.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    traveling = false;
    dwell = initialDwell();
    wipe.classList.remove('on');
  });

  firstSession();

  preloadPageShot();
  // Press N twice: feedback about the hub itself (docs/feedback.md). The plaza is shared, so it
  // keeps running behind the window; held movement keys are released instead.
  installFeedback({
    title: 'Metaverse Hub',
    version: __HUB_BUILD__,
    transport: {
      async access() {
        try {
          const session = await boot();
          if (!session.username) return { ok: false, reason: 'sign_in_required' };
          await session.client.rpc('feedback.can', {}, { token: await plazaToken(session) });
          return { ok: true, username: session.username };
        } catch (error) {
          return { ok: false, reason: error instanceof HubSdkError && error.code !== 'rpc_failed' ? error.code : 'offline' };
        }
      },
      async submit(input) {
        const session = await boot();
        const result = await session.client.rpc<{ id: string }>('feedback.submit', input, { token: await plazaToken(session) });
        return { id: result.id };
      },
    },
    enabled: () => !gate.isOpen() && !traveling,
    pause() {
      keys.clear();
      return false;
    },
    canvases: () => [canvas],
    // The HUD, login and menus are HTML: draw them over the world, or the screenshot is only the
    // plaza behind them.
    overlay: () => captureHtml(app, [canvas]),
    context: () => ({
      level: definition.id,
      mode: plazaState === 'online' ? 'online' : 'solo',
      position: { x: round2(player.position.x), y: round2(player.position.y), z: round2(player.position.z) },
      player: { moving: keys.size > 0, menuOpen: menu.open, chatOpen: chat.open },
      extra: { plaza: plazaState, plazaDetail, signedIn: sessionLabel },
    }),
    theme: {
      font: 'var(--font, "Inter Variable", system-ui, sans-serif)',
      background: 'rgba(7, 6, 15, 0.6)',
      panel: 'rgba(10, 11, 26, 0.94)',
      text: '#eef3ff',
      muted: '#a8b4ca',
      accent: '#3de1ff',
      accentText: '#07060f',
      border: 'rgba(255, 255, 255, 0.16)',
      radius: '12px',
    },
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Controller movement handed to the player controller, merged with the keyboard. */
interface PadMove { forward: number; strafe: number; sprint: boolean; digitalForward: number; digitalStrafe: number }
const NO_PAD_MOVE: PadMove = Object.freeze({ forward: 0, strafe: 0, sprint: false, digitalForward: 0, digitalStrafe: 0 });
/** D-pad steps for overlays that already speak arrow keys (the arcade picker). */
const NAV_KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;
