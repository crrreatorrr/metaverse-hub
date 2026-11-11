import { createRealmGate } from '../../core/gates';
import { SANDBOX_GATE } from './layout';
import { createArcadePicker } from '../../v2/arcade-picker';
import { createSprotelTalk } from '../../v2/sprotel-talk';
import { createLiveLeaderboardProvider, verseTotals, type VerseRow } from '../../leaderboards';
import { parseReturnGame } from '../../travel';
import { ARCADE_GAMES, PORTALS, STATUE_PORTALS } from './config';
import { ARCADE_PROMPT } from './arcade-layout';
import type { EngineOptions } from '../../core/engine';
import type { RealmContent, FrameState, RealmContext } from '../../core/realm';
import { Box3, BoxGeometry, CanvasTexture, Euler, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, Quaternion, RepeatWrapping, Scene, Sprite, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';

import { FOUR_LIGHTS_RELIC_IDS } from '@metaverse/hub-sdk';

import type { AvatarLook } from '../../look';
import { SOCKETS } from './config';
import { PLAZA_SLOT, PLAZA_YAW } from './config';
import { addBarLeaderboardScreen, createEmptyLeaderboardProvider } from './barLeaderboard';
import { addHallOfChampions } from './hallOfChampions';
import { addLivingPortals } from '../../m3/livingPortals';

import { NO_SCORES_TEXT, type LeaderboardProvider, type OrbitAvatar } from '../../m3/types';
import { spawnFor, defaultPortalPlacements } from './layout';
import { portalPosition } from '../../layout';
import { BAR_MARKER_LABEL } from '../../guide/markers';
import { championRows, presenceRows } from '../../m3/life';
import type { NakamaClient } from '@metaverse/hub-sdk';
import { STAND_Y } from '../../physics';
import { buildPlazaCollider } from './plaza-collider';
import type { Collider } from './collider';
import { instanced, part, upgradeToLod0 } from '../../v2/core';
import { buildPlazaEntrance, castle, club, greenHill, kennel, whiteHouse } from './buildings';
import { buildClubInterior, type ClubInteriorBuild } from './club-interior';
import { buildArcade, type ArcadeBuild } from './arcade';
import { ARCADE_RETURN, atArcade } from './arcade-layout';
import { INTERIOR_ORIGIN } from './interior';
import { CLUB_INTERIOR_SCALE } from './club-interior-scale';
import { SPROTEL_PROMPT } from './sprotel-npc';
import { barBillboard } from './billboard';
import { buildFloor, buildPedestal } from './plaza';
import { loadSignFont } from '../../v2/signs';


export interface Warp {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** `arcade`: at the Bar's arcade cabinet, where E opens the game picker. */
/** Metres in front of the Bar's street door where leaving puts the player (the door trigger is 2.6 m). */
const CLUB_EXIT_STEP = 4;

export type PlazaZone = 'door' | 'exit' | 'loading' | 'store' | 'arcade' | null;

export interface VerseStoreUi {
  /** Empty node `store_ui_anchor`. Null until the player enters the Bar. */
  readonly anchor: Object3D | null;
  /** The hub has no Verse store panel yet. Listeners run once the anchor exists. */
  whenReady(listener: (anchor: Object3D) => void): void;
  /** True while the Verse store is open (Sprotel talks while it is). */
  readonly open: boolean;
  /** Prompt shown inside Sprotel's interact trigger (meta.interact.prompt). */
  readonly prompt: string;
  /** Player pressed interact inside Sprotel's trigger (zone 'store'). Opens the store and notifies listeners. */
  requestOpen(): void;
  /** Listeners for an open request; the store panel subscribes here once it exists. */
  onOpenRequest(listener: () => void): void;
  /** The store panel reports open/closed. Leaving the trigger also closes it. */
  setOpen(open: boolean): void;
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
  /** Relics the player switched off in the Relics menu: their gems stop orbiting the avatar. */
  setHiddenRelics: (ids: readonly string[]) => void;
  setLook: (look: AvatarLook) => void;
  /** M6 hub pet that follows the avatar (server catalog id, or null for none). */
  setPet: (id: string | null) => Promise<void>;
  setBoard: (title: string, rows: readonly (readonly [string, string])[]) => void;
  /** Live Bar screen data (production); dev keeps the stub provider. */
  setLeaderboardProvider: (provider: LeaderboardProvider) => void;
  /** True once the Bar screen shows boards (dev stub or live), replacing the wall screen and its tabs. */
  readonly liveBoards: boolean;
  /** Near-tier remote avatars that orbit their Relic gems. */
  setRemoteOrbit: (avatars: readonly OrbitAvatar[]) => void;
  verseStoreUi: VerseStoreUi;
  inInterior: () => boolean;
  zone: () => PlazaZone;
  /**
   * Put the player inside the Bar at the arcade cabinet once the room has loaded
   * (return from a Bar cabinet game: `#from=sproto-fighter`, `#from=sproto-arcade`, or
   * `#from=sproto-coop-battle`). Delivered through `consumeWarp`.
   */
  returnToArcade: () => void;
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
  build: () => Promise<SlotBuild>;
  phase: 'idle' | 'loading' | 'ready';
  group?: Group;
  door?: Object3D;
  near?: boolean;
}

const NEAR = 120;
const FAR = 400;

export const PLAZA_ENGINE_OPTIONS: EngineOptions = {
  fog: { color: '#77748c', near: 260, far: 820 },
  sky: { top: '#343758', mid: '#87718e', horizon: '#dfae89' },
  environmentIntensity: 0.85,
  hemi: { sky: '#e2ddf4', ground: '#87766f', intensity: 1.5 },
  sun: { color: '#ffd9b8', intensity: 2.6, position: [-120, 160, 140] },
  bloom: 1.6,
};

export async function createPlazaContent(ctx: RealmContext): Promise<Omit<HubWorld, 'update'> & RealmContent> {
  const engine = ctx.engine;
  const { scene, camera, renderer, hemi, sun } = engine;
  await loadSignFont();
  const outdoor = new Group();
  outdoor.name = 'plaza-outdoor';
  scene.add(outdoor);

  const slots: SlotState[] = [
    { key: 'castle', a: 0 * PLAZA_SLOT + PLAZA_YAW, front: 112, sc: 1.45, phase: 'idle', build: async () => castle() },
    { key: 'whitehouse', a: 1 * PLAZA_SLOT + PLAZA_YAW, front: 116, sc: 1.3, phase: 'idle', build: async () => whiteHouse() },
    { key: 'hills', a: 2 * PLAZA_SLOT + PLAZA_YAW, front: 114, sc: 1.25, phase: 'idle', build: async () => greenHill() },
    { key: 'club', a: 3 * PLAZA_SLOT + PLAZA_YAW, front: 113, sc: 1.25, phase: 'idle', build: async () => club() },
    { key: 'kennel', a: 4 * PLAZA_SLOT + PLAZA_YAW, front: 114, sc: 1.2, phase: 'idle', build: async () => kennel() },
  ];
  buildFloor(outdoor);
  const pedestal = buildPedestal(outdoor);
  for (const portal of [...PORTALS, ...STATUE_PORTALS]) outdoor.add(buildPlazaEntrance(portal));

  const benchT: { p: [number, number, number]; r: number }[] = [];
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

  const [statue, benches, palms, billboard] = await Promise.all([
    part('S1-statue', { h: 30, yaw: -Math.PI / 2, glow: 0, level: 'lod1' }),
    instanced('P2-bench', benchT, { h: 1.1, glow: 0 }),
    instanced('B5-palm', palmT, { h: 20, glow: 0 }),
    barBillboard(),
  ]);
  statue.position.y = pedestal.top;
  statue.name = 'sproto-statue';
  outdoor.add(statue, benches, palms, billboard);
  outdoor.add(skyline());

  const { rig, bob, avatar, shadow, shadowMat } = engine;
  const collider = buildPlazaCollider();
  const tmp = new Vector3();
  let interior: ClubInteriorBuild | null = null;
  let interiorTask: Promise<void> | null = null;
  let inside = false;
  let doorLatch = false;
  let exitLatch = false;
  let zone: PlazaZone = null;
  let warp: Warp | null = null;
  let elapsed = 0;
  let statueNear = false;
  let billboardNear = false;
  let buildingCount = 0;
  let drawsMarked = false;
  let sceneDraws = 0;
  let wallBoardRows: readonly (readonly [string, string])[] = [];
  const storeListeners: ((anchor: Object3D) => void)[] = [];
  let storeAnchor: Object3D | null = null;
  let storeOpen = false;
  let arcade: ArcadeBuild | null = null;
  let beltOwned = false;
  let arcadeReturn = false;
  const openListeners: (() => void)[] = [];
  const shot = new URLSearchParams(window.location.search).get('shot');
  const devPreview = import.meta.env.DEV;
  const living = addLivingPortals(outdoor, { placeholder: devPreview, placements: defaultPortalPlacements(), effects: false });
  const hall = addHallOfChampions(scene, { placeholder: devPreview, open: false });
  outdoor.add(hall.door);
  let hallOpen = false;
  let boardProvider = createEmptyLeaderboardProvider();
  if (devPreview) {
    const stubs = await import('../../m3/stub');
    engine.setPreviewAvatars(stubs.createStubOrbitAvatars());
    living.setPresence(stubs.STUB_PORTAL_PRESENCE);
    hall.setChampions(stubs.STUB_CHAMPIONS);
    hallOpen = true;
    hall.setOpen(true);
    boardProvider = stubs.createStubLeaderboardProvider();
  }
  // Live boards replace the empty stand-in once main.ts has a session (setLeaderboardProvider).
  let liveBoards = devPreview;
  let innerBoards: LeaderboardProvider = boardProvider;
  const bar = addBarLeaderboardScreen(scene, {
    provider: { boards: boardProvider.boards, load: (id) => innerBoards.load(id) },
    placeholder: devPreview,
    onNewNumberOne(event) {
      if (!devPreview || !event.gameId) return;
      living.pushFinisher({
        gameId: event.gameId,
        name: event.row.name,
        line: `New #1 · ${event.title}`,
      });
    },
  });
  bar.root.visible = false;

  /** The M2 wall screen sits behind the live board; hide it so the two canvases do not stack. */
  function hideWallScreen(): void {
    const previous = interior?.group.getObjectByName('leaderboard-wall-screen');
    if (previous) previous.visible = false;
  }

  function applyBoard(): void {
    const draw = interior?.leaderboard.userData.draw as ((rows: readonly (readonly [string, string])[]) => void) | undefined;
    draw?.(wallBoardRows.slice(0, 5));
  }

  function ensureInterior(): void {
    if (interiorTask) return;
    interiorTask = buildClubInterior(scene).then((built) => {
      interior = built;
      // Follow the actual TV marker so the live screen stays on the wall as the room grows.
      built.markers.leaderboard_tv.add(bar.root);
      bar.root.position.set(0, 0, 0.05);
      bar.root.rotation.set(0, 0, 0);
      bar.root.scale.setScalar(0.55);
      if (liveBoards) hideWallScreen();
      storeAnchor = built.storeAnchor;
      arcade = buildArcade();
      arcade.setBeltOwned(beltOwned);
      built.group.add(arcade.group);
      applyBoard();
      for (const listener of storeListeners) listener(built.storeAnchor);
    }).catch((error: unknown) => {
      interiorTask = null;
      console.error(error);
    });
  }

  // Club interior mood: warm dim hemisphere, sun off, room-captured environment. Restored on exit.
  const plazaMood = {
    environment: scene.environment, environmentIntensity: scene.environmentIntensity,
    sky: hemi.color.clone(), ground: hemi.groundColor.clone(), intensity: hemi.intensity, sun: sun.visible,
  };
  function setClubMood(on: boolean): void {
    const mood = interior?.mood;
    if (on && mood) {
      plazaMood.environment = scene.environment;
      plazaMood.environmentIntensity = scene.environmentIntensity;
      if (mood.environment) scene.environment = mood.environment;
      scene.environmentIntensity = mood.environmentIntensity;
      hemi.color.set(mood.hemi.sky);
      hemi.groundColor.set(mood.hemi.ground);
      hemi.intensity = mood.hemi.intensity;
      sun.visible = mood.sun;
    } else {
      scene.environment = plazaMood.environment;
      scene.environmentIntensity = plazaMood.environmentIntensity;
      hemi.color.copy(plazaMood.sky);
      hemi.groundColor.copy(plazaMood.ground);
      hemi.intensity = plazaMood.intensity;
      sun.visible = plazaMood.sun;
    }
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

  /**
   * Out through the entrance: on the plaza just in front of the Bar's street door, facing the
   * monument, past the door trigger (2.6 m) so the player is not pulled straight back in.
   */
  function outsideClubDoor(): Warp {
    const door = slots.find((slot) => slot.key === 'club')?.door;
    if (door) {
      door.getWorldPosition(tmp);
      const toCenter = new Vector3(-tmp.x, 0, -tmp.z);
      if (toCenter.lengthSq() < 1) toCenter.set(0, 0, 1);
      toCenter.normalize();
      const x = tmp.x + toCenter.x * CLUB_EXIT_STEP;
      const z = tmp.z + toCenter.z * CLUB_EXIT_STEP;
      return { x, y: STAND_Y, z, yaw: Math.atan2(toCenter.x, -toCenter.z) };
    }
    const south = spawnFor(null);
    return { x: south.x, y: STAND_Y, z: south.z, yaw: south.yaw };
  }

  function enterInterior(room: ClubInteriorBuild, at: Warp): void {
    exitLatch = false;
    inside = true;
    outdoor.visible = false;
    room.group.visible = true;
    setClubMood(true);
    warp = at;
  }

  function horiz(obj: Object3D, x: number, y: number, z: number): number {
    obj.getWorldPosition(tmp);
    if (Math.abs(tmp.y - y) > 8) return Infinity;
    return Math.hypot(tmp.x - x, tmp.z - z);
  }

  function update(dt: number, state: FrameState): void {
    elapsed += dt;
    gate?.update(dt, state);
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
    if (!billboardNear && player.distanceTo(billboard.position) < NEAR) {
      billboardNear = true;
      void upgradeToLod0(billboard);
    }
    zone = null;
    if (arcadeReturn && !inside) {
      if (!interior) {
        ensureInterior();
        zone = 'loading';
      } else {
        arcadeReturn = false;
        const o = INTERIOR_ORIGIN;
        enterInterior(interior, { x: o.x + ARCADE_RETURN.x * CLUB_INTERIOR_SCALE, y: o.y + STAND_Y, z: o.z + ARCADE_RETURN.z * CLUB_INTERIOR_SCALE, yaw: ARCADE_RETURN.yaw });
      }
    }
    const door = slots.find((slot) => slot.key === 'club')?.door;
    if (!inside && door) {
      const distance = horiz(door, player.x, player.y, player.z);
      if (distance < 2.6) {
        if (!interior) {
          ensureInterior();
          zone = 'loading';
        } else if (!doorLatch) {
          doorLatch = true;
          const s = interior.spawn;
          enterInterior(interior, { x: s.x, y: STAND_Y + s.y, z: s.z, yaw: s.yaw });
        }
      } else {
        doorLatch = false;
        if (distance < 9) zone = 'door';
      }
    }
    if (inside && interior) {
      const sprotel = interior.sprotel;
      if (sprotel) {
        sprotel.update(dt, player, storeOpen);
        if (sprotel.playerNear) zone = 'store';
        else storeOpen = false;
      }
      // The entrance is the Bar's only way out. The back-wall EXIT door is scenery: it sits beside
      // the arcade cabinet, and treating it as an exit threw players out while they walked up to play.
      const distance = horiz(interior.entry, player.x, player.y, player.z);
      if (distance < 1.8 && !exitLatch) {
        exitLatch = true;
        doorLatch = false;
        inside = false;
        outdoor.visible = true;
        interior.group.visible = false;
        setClubMood(false);
        storeOpen = false;
        warp = outsideClubDoor();
      } else if (distance >= 1.8) {
        exitLatch = false;
        if (distance < 4) zone = 'exit';
      }
      // The cabinet's walk-up spot is about 2 m from Sprotel at the bar. Inside that small circle the
      // cabinet wins, so E plays the arcade instead of opening the store.
      if (inside && atArcade((player.x - INTERIOR_ORIGIN.x) / CLUB_INTERIOR_SCALE, (player.z - INTERIOR_ORIGIN.z) / CLUB_INTERIOR_SCALE)) zone = 'arcade';
    }
    living.update(elapsed, camera);
    hall.room.visible = hallOpen && !inside;
    hall.update(elapsed);
    // Leaving Sprotel's trigger or the Bar closes the store flag; the talk panel follows it.
    if (!storeOpen && sprotelTalk.open) sprotelTalk.hide();
    bar.root.visible = liveBoards && inside;
    bar.update(elapsed);
    if (barTabs) barTabs.hidden = !inside || liveBoards;
  }

  function render(): void {
    if (shot === 'aerial') {
      camera.position.set(0, 220, 310);
      camera.lookAt(0, 6, -20);
    } else if (shot === 'portal') {
      camera.position.set(9, 3.3, -78);
      camera.lookAt(0, 4.1, -96);
    }
    const measure = import.meta.env.DEV || (!drawsMarked && buildingCount === slots.length);
    engine.render(measure);
    sceneDraws = engine.sceneDraws;
    if (measure && buildingCount === slots.length) {
      document.documentElement.dataset.plazaDraws = String(sceneDraws);
      drawsMarked = true;
    }
  }

  const files = resourceFiles();
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  document.documentElement.dataset.plazaReady = '1';
  document.documentElement.dataset.initialBytes = String(bytes);
  window.plazaLoad = { bytes, files };
  // Wizard is larger than the previous avatar, so it stays out of this snapshot.
  engine.loadAvatar();

  const sockets = pedestal.markers.map((mesh) => ({ mesh, on: false }));

  const arcadePicker = createArcadePicker(ARCADE_GAMES, game => ctx.travel(game));
  // Sprotel's talk panel. It opens on every open request and clears the store flag when it closes.
  const sprotelTalk = createSprotelTalk(() => { storeOpen = false; });
  openListeners.push(() => {
    ctx.releasePointer();
    sprotelTalk.show();
  });
  function playArcade(): void {
    if (ctx.isBlocked() || arcadePicker.open) return;
    if (!ARCADE_GAMES.some(game => ctx.pageFor(game.id))) return;
    ctx.releasePointer();
    arcadePicker.show(id => Boolean(ctx.pageFor(id)));
  }
  const gate = import.meta.env.DEV && import.meta.env.VITE_REALM_GATE_SANDBOX === '1'
    ? await createRealmGate(ctx, { x: SANDBOX_GATE.x, z: SANDBOX_GATE.z, destination: '/realm/sandbox/', label: 'the sandbox', tint: '#000000', beam: false, core: false })
    : null;
  const interactions = [
    { active: () => zone === 'loading', showLook: false, prompt: () => 'Loading the bar…' },
    { active: () => zone === 'door', prompt: () => 'Walk into the door to enter the bar' },
    { active: () => zone === 'exit', prompt: () => 'Walk through the exit to return to the plaza' },
    { active: () => zone === 'arcade', key: 'KeyE', interact: playArcade,
      prompt: () => arcadePicker.open ? 'Arcade · pick a game' : ARCADE_GAMES.some(game => ctx.pageFor(game.id)) ? ARCADE_PROMPT : 'Arcade · Coming soon' },
    { active: () => zone === 'store', key: 'KeyE', interact() {
        if (storeOpen) return;
        storeOpen = true;
        for (const listener of openListeners) listener();
      }, prompt: () => storeOpen ? 'Talking to Sprotel Bitcoin' : `Press E · ${interior?.sprotel?.prompt ?? SPROTEL_PROMPT}` },
  ];
  if (gate) { outdoor.add(gate.root); interactions.push(gate.interaction); }
  if (ARCADE_GAMES.some(game => game.id === parseReturnGame(window.location.hash))) arcadeReturn = true;

  /**
   * Real gate counts and the Hall roster (plan E3, E4), in place of the dev stubs. Both RPCs are
   * hub scope and cached on the server; an older server answers 404 and the boards stay empty.
   */
  const PRESENCE_POLL_MS = 30_000;
  let lifeTimer: number | null = null;
  function startPlazaLife(session: { client: NakamaClient; token: string }): void {
    if (lifeTimer !== null) window.clearInterval(lifeTimer);
    const pollPresence = (): void => {
      if (document.visibilityState === 'hidden') return;
      void session.client.rpc<{ counts?: Record<string, number> }>('hub.presence', {}, { token: session.token }).then(
        (answer) => living.setPresence(presenceRows(answer.counts ?? {}, PORTALS.map((portal) => portal.id))),
        () => undefined,
      );
    };
    pollPresence();
    lifeTimer = window.setInterval(pollPresence, PRESENCE_POLL_MS);
    void session.client.rpc<{ champions?: { order?: number; userId?: string; name?: string }[] }>('hub.champions', {}, { token: session.token }).then(
      (answer) => hall.setChampions(championRows(answer.champions ?? [])),
      () => undefined,
    );
  }

  /** HUD markers (plan D2): the five entrances at sign height, and the Bar with its three cabinet games. */
  const WAYPOINT_HEIGHT = 5.4;
  const gateWaypoints = PORTALS.map((portal) => {
    const at = portalPosition(portal.angle, portal.distance);
    return { id: portal.id, label: portal.label, x: at.x, y: WAYPOINT_HEIGHT, z: at.z };
  });
  const barWaypoint = { id: 'bar', label: BAR_MARKER_LABEL, x: 0, y: WAYPOINT_HEIGHT, z: 0 };
  const barSlot = slots.find((slot) => slot.key === 'club');
  if (barSlot) {
    const fallback = portalPosition(barSlot.a, barSlot.front);
    barWaypoint.x = fallback.x;
    barWaypoint.z = fallback.z;
  }
  const allWaypoints = [...gateWaypoints, barWaypoint];
  function waypoints(): readonly { id: string; label: string; x: number; y: number; z: number }[] {
    if (inside) return [];
    // Once the Bar has loaded, point at its real street door.
    const door = barSlot?.door;
    if (door) {
      door.getWorldPosition(tmp);
      barWaypoint.x = tmp.x;
      barWaypoint.z = tmp.z;
    }
    return allWaypoints;
  }

  type BoardTab = 'hpos10i' | 'nobu' | 'peoples-bitcoin' | 'sproto' | 'total';
  type EarnedRow = VerseRow;

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
    // No invented names: an empty tab says so (plan item A4).
    const rows = real.length === 0
      ? [[NO_SCORES_TEXT, ''] as const]
      : real
        .slice()
        .sort((a, b) => b[1] - a[1])
        .map((row) => [row[0], formatVerse(row[1])] as const);
    setBoard(TAB_TITLE[tab], rows);
    for (const button of document.querySelectorAll<HTMLButtonElement>('#bar-tabs button')) {
      button.classList.toggle('on', button.dataset.tab === tab);
    }
  }

  function totals(rows: EarnedRow[]): (readonly [string, number])[] {
    return verseTotals(rows).map((row) => [row.name, row.score] as const);
  }

  if (barTabs instanceof HTMLElement) {
    barTabs.addEventListener('click', (event) => {
      const button = event.target;
      if (!(button instanceof HTMLButtonElement) || !button.dataset.tab) return;
      paintBar(button.dataset.tab as BoardTab);
    });
  }
  paintBar('total');

  function setBoard(title: string, rows: readonly (readonly [string, string])[]): void {
    void title;
    wallBoardRows = rows;
    applyBoard();
  }

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
    setLook: engine.setLook,
    setPet: engine.setPet,
    onRelicsChanged(ids) {
      const owned = new Set(ids);
      // Every owned Relic orbits the avatar unless switched off. The Hall of Champions still opens
      // on the four Four Lights Relics only (the server's Four Lights rule).
      beltOwned = owned.has('tidebreaker_belt');
      arcade?.setBeltOwned(beltOwned);
      if (!devPreview) {
        hallOpen = FOUR_LIGHTS_RELIC_IDS.every((id) => owned.has(id));
        hall.setOpen(hallOpen);
      }
      sockets.forEach((socket, index) => {
        const relic = SOCKETS[index];
        if (!relic) return;
        socket.on = owned.has(relic.id);
        const material = socket.mesh.material as MeshStandardMaterial;
        material.color.set(relic.color).multiplyScalar(socket.on ? 0.9 : 0.27);
      });
    },
    setHiddenRelics: engine.setHiddenRelics,
    setLeaderboardProvider(provider) {
      if (devPreview) return;
      innerBoards = provider;
      liveBoards = true;
      hideWallScreen();
    },
    get liveBoards() { return liveBoards; },
    setRemoteOrbit: engine.setRemoteOrbit,
    setBoard,
    verseStoreUi: {
      get anchor() { return storeAnchor; },
      whenReady(listener) {
        if (storeAnchor) listener(storeAnchor);
        else storeListeners.push(listener);
      },
      get open() { return storeOpen; },
      get prompt() { return interior?.sprotel?.prompt ?? SPROTEL_PROMPT; },
      requestOpen() {
        if (zone !== 'store' || storeOpen) return;
        storeOpen = true;
        for (const listener of openListeners) listener();
      },
      onOpenRequest(listener) { openListeners.push(listener); },
      setOpen(open) { storeOpen = open && zone === 'store'; },
    },
    inInterior: () => inside,
    zone: () => zone,
    returnToArcade() {
      arcadeReturn = true;
    },
    update,
    consumeWarp() {
      const pending = warp;
      warp = null;
      return pending;
    },
    render,
    cameraFloor: () => inside ? -Infinity : 0.45,
    groundHeight: () => inside ? -300 : 0,
    portals: [...PORTALS, ...STATUE_PORTALS],
    portalsEnabled: () => !inside,
    waypoints,
    atLauncher: () => zone === 'arcade',
    interactions,
    handleKey: event => sprotelTalk.handleKey(event) || arcadePicker.handleKey(event),
    overlayOpen: () => arcadePicker.open || sprotelTalk.open,
    setPadPrompts(on) {
      arcadePicker.setPad(on);
      sprotelTalk.setPad(on);
    },
    async onSession(session) {
      const board = await session.client.rpc<{ rows?: EarnedRow[] }>('verse.board', {}, { token: session.token });
      boardRows = board.rows ?? [];
      paintBar(boardTab);
      if (!devPreview) {
        innerBoards = createLiveLeaderboardProvider(session.client, () => session.token);
        liveBoards = true;
        hideWallScreen();
        startPlazaLife(session);
      }
    },
    resize: engine.resize,
  };
}

function skyline(): InstancedMesh {
  const towers = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({
      color: '#857a7e',
      map: windowsTex(),
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
  ctx.fillStyle = '#555159';
  ctx.fillRect(0, 0, 64, 256);
  for (let r = 0; r < 32; r += 1) {
    for (let k = 0; k < 4; k += 1) {
      if (Math.random() < 0.35) {
        ctx.fillStyle = Math.random() < 0.5 ? '#696670' : '#7c7476';
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

function resourceFiles(): { name: string; bytes: number }[] {
  const rows: { name: string; bytes: number }[] = [];
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav) rows.push({ name: nav.name, bytes: nav.encodedBodySize || nav.decodedBodySize || 0 });
  for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    rows.push({ name: entry.name, bytes: entry.encodedBodySize || entry.decodedBodySize || 0 });
  }
  return rows;
}
