import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  TorusGeometry,
  type Camera,
} from 'three';
import { PORTAL_DISTANCE, PORTALS } from '../config';
import { portalPosition } from '../layout';
import { fitText, paintedCanvas } from './canvas';
import type { FinisherEvent, PortalPlacement, PortalPresence } from './types';

/** Glow tiers from the design: 0, 1–2, 3–5, 6+. */
export type GlowTier = 0 | 1 | 2 | 3;

export const FINISHER_INTERVAL_S = 10;
export const FINISHER_BANNER_S = 8;
export const FINISHER_FIREWORK_S = 5;

const TIER_GAIN = [0.22, 0.48, 0.75, 1] as const;
const BEAM_HEIGHT = [0, 8, 16, 42] as const;
const LABEL_NEAR = 25;
const LABEL_FAR = 40;
const SPARKS = 12;

export function glowTierForCount(count: number): GlowTier {
  const players = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (players <= 0) return 0;
  if (players <= 2) return 1;
  if (players <= 5) return 2;
  return 3;
}

export function defaultPortalPlacements(): PortalPlacement[] {
  return PORTALS.map((portal) => {
    const at = portalPosition(portal.angle, PORTAL_DISTANCE);
    return {
      gameId: portal.id,
      x: at.x,
      y: 0,
      z: at.z,
      rotationY: -portal.angle,
      color: portal.color,
      label: portal.label,
    };
  });
}

export interface LivingPortalsOptions {
  presence?: readonly PortalPresence[];
  placements?: readonly PortalPlacement[];
  /** Marks counts and top-10 rows as placeholders. Scene passes this only in dev. */
  placeholder?: boolean;
}

export interface LivingPortals {
  readonly root: Group;
  setPresence(presence: readonly PortalPresence[]): void;
  /**
   * Shows the 8s banner and 5s firework for this portal.
   * Returns false when that portal already accepted one in the last 10 seconds.
   * New #1 banners use the same gate.
   */
  pushFinisher(event: FinisherEvent): boolean;
  update(now: number, camera?: Camera): void;
  dispose(): void;
}

interface PortalState {
  placement: PortalPlacement;
  count: number;
  names: readonly string[];
  top: readonly { name: string; score: string }[];
  tier: GlowTier;
  lastFinisherAt: number;
  finisher: { name: string; line: string; started: number } | null;
  label: Mesh;
  labelPaint: ReturnType<typeof paintedCanvas>;
  banner: Mesh;
  bannerPaint: ReturnType<typeof paintedCanvas>;
  labelKey: string;
}

/**
 * Living portal placeholders. One instanced torus and one instanced cylinder
 * cover every gate. Each gate also has a canvas label and a canvas banner.
 * Firework motes are one instanced icosahedron.
 */
export function addLivingPortals(scene: Object3D, opts: LivingPortalsOptions = {}): LivingPortals {
  const placements = (opts.placements ?? defaultPortalPlacements()).slice();
  const group = new Group();
  group.name = 'm3-portals';
  scene.add(group);

  const ringGeo = new TorusGeometry(1.7, 0.07, 6, 20);
  const ringMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false, side: DoubleSide });
  const rings = new InstancedMesh(ringGeo, ringMat, Math.max(placements.length, 1));
  rings.name = 'm3-portal-rings';
  rings.frustumCulled = false;
  rings.count = placements.length;

  const beamGeo = new CylinderGeometry(0.28, 0.55, 1, 6, 1, true);
  const beamMat = new MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.55,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  });
  const beams = new InstancedMesh(beamGeo, beamMat, Math.max(placements.length, 1));
  beams.name = 'm3-portal-beams';
  beams.frustumCulled = false;
  beams.count = placements.length;

  const sparkGeo = new IcosahedronGeometry(0.12, 0);
  const sparkMat = new MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const sparks = new InstancedMesh(sparkGeo, sparkMat, Math.max(placements.length, 1) * SPARKS);
  sparks.name = 'm3-portal-fireworks';
  sparks.frustumCulled = false;
  sparks.count = placements.length * SPARKS;

  const dummy = new Object3D();
  const tint = new Color();
  const states: PortalState[] = placements.map((placement) => makePortal(placement, group));

  group.add(rings);
  group.add(beams);
  group.add(sparks);

  let clock = 0;
  let disposed = false;

  function stateFor(gameId: string): PortalState | undefined {
    return states.find((state) => state.placement.gameId === gameId);
  }

  function paintLabel(state: PortalState): void {
    const { ctx, canvas } = state.labelPaint;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 8, 24, 0.92)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = state.placement.color;
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = state.placement.color;
    ctx.font = '700 36px sans-serif';
    ctx.fillText(fitText(ctx, state.placement.label, w - 48), w / 2, 48);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 28px sans-serif';
    const inside = state.count === 1 ? '1 player inside' : `${state.count} players inside`;
    ctx.fillText(inside, w / 2, 92);
    ctx.font = '600 22px sans-serif';
    ctx.fillStyle = '#d7e1ff';
    const shown = state.names.slice(0, 3);
    const extra = Math.max(0, state.count - shown.length);
    const nameLine = shown.length === 0 ? 'empty' : extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', ');
    ctx.fillText(fitText(ctx, nameLine, w - 48), w / 2, 132);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd21f';
    ctx.font = '700 20px sans-serif';
    ctx.fillText('TOP 10', 28, 176);
    ctx.font = '600 18px sans-serif';
    const rows = state.top.slice(0, 10);
    if (rows.length === 0) {
      ctx.fillStyle = '#9aa3c7';
      ctx.fillText('No scores yet', 28, 214);
    }
    rows.forEach((row, index) => {
      const y = 214 + index * 28;
      ctx.fillStyle = index % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,229,255,0.06)';
      ctx.fillRect(24, y - 16, w - 48, 26);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(`${index + 1}`, 32, y);
      ctx.fillText(fitText(ctx, row.name, w - 220), 64, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#39ff6a';
      ctx.fillText(fitText(ctx, row.score, 140), w - 32, y);
    });
    if (opts.placeholder) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5ab4';
      ctx.font = '700 16px sans-serif';
      ctx.fillText('DEV PLACEHOLDER', w / 2, h - 22);
    }
    state.labelPaint.touch();
    state.labelKey = `${state.count}|${state.names.join('\n')}|${state.top.map((row) => `${row.name}=${row.score}`).join('\n')}`;
  }

  function paintBanner(state: PortalState): void {
    const { ctx, canvas } = state.bannerPaint;
    const w = canvas.width;
    const h = canvas.height;
    const finisher = state.finisher;
    ctx.clearRect(0, 0, w, h);
    if (!finisher) {
      state.bannerPaint.touch();
      return;
    }
    ctx.fillStyle = 'rgba(8, 6, 18, 0.94)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = state.placement.color;
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 42px sans-serif';
    ctx.fillText(fitText(ctx, finisher.name, w - 40), w / 2, 48);
    ctx.fillStyle = state.placement.color;
    ctx.font = '700 24px sans-serif';
    ctx.fillText(fitText(ctx, finisher.line, w - 40), w / 2, 92);
    state.bannerPaint.touch();
  }

  function writeInstances(now: number): void {
    let beamOn = false;
    states.forEach((state, index) => {
      const gain = TIER_GAIN[state.tier];
      const pulse = state.tier === 0 ? 1 : 1 + Math.sin(now * 2.2 + index) * 0.03;
      tint.set(state.placement.color).multiplyScalar(gain);
      rings.setColorAt(index, tint);
      dummy.position.set(state.placement.x, state.placement.y + 2.5, state.placement.z);
      dummy.rotation.set(0, state.placement.rotationY, 0);
      dummy.scale.setScalar((1 + state.tier * 0.05) * pulse);
      dummy.updateMatrix();
      rings.setMatrixAt(index, dummy.matrix);

      const height = BEAM_HEIGHT[state.tier];
      if (height > 0) beamOn = true;
      beams.setColorAt(index, tint);
      dummy.position.set(state.placement.x, state.placement.y + height / 2, state.placement.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(state.tier === 0 ? 0 : 1, height, state.tier === 0 ? 0 : 1);
      dummy.updateMatrix();
      beams.setMatrixAt(index, dummy.matrix);
    });
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
    rings.visible = states.length > 0;
    beams.visible = beamOn;
  }

  function writeSparks(now: number): void {
    let any = false;
    states.forEach((state, portalIndex) => {
      const started = state.finisher?.started ?? 0;
      const age = state.finisher ? now - started : Number.POSITIVE_INFINITY;
      const live = age >= 0 && age < FINISHER_FIREWORK_S;
      if (live) any = true;
      const rnd = mulberry(portalIndex + 1);
      for (let spark = 0; spark < SPARKS; spark += 1) {
        const index = portalIndex * SPARKS + spark;
        const angle = rnd() * Math.PI * 2;
        const speed = 1.4 + rnd() * 2.2;
        const rise = 2.4 + rnd() * 3.2;
        if (!live) {
          dummy.scale.setScalar(0);
          dummy.position.set(0, -100, 0);
          dummy.rotation.set(0, 0, 0);
        } else {
          const t = age;
          dummy.position.set(
            state.placement.x + Math.cos(angle) * speed * t,
            state.placement.y + 2.2 + rise * t - 0.55 * t * t,
            state.placement.z + Math.sin(angle) * speed * t,
          );
          dummy.scale.setScalar(Math.max(0, 1 - t / FINISHER_FIREWORK_S));
          dummy.rotation.set(0, t, 0);
        }
        dummy.updateMatrix();
        sparks.setMatrixAt(index, dummy.matrix);
        tint.set(state.placement.color);
        sparks.setColorAt(index, tint);
      }
    });
    if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;
    sparks.instanceMatrix.needsUpdate = true;
    sparks.visible = any;
  }

  function fade(mesh: Mesh, x: number, z: number, camera?: Camera): void {
    const material = mesh.material;
    if (!(material instanceof MeshBasicMaterial)) return;
    if (!camera) {
      mesh.visible = true;
      material.opacity = 1;
      return;
    }
    const distance = Math.hypot(camera.position.x - x, camera.position.z - z);
    const opacity = distance <= LABEL_NEAR ? 1 : distance >= LABEL_FAR ? 0 : 1 - (distance - LABEL_NEAR) / (LABEL_FAR - LABEL_NEAR);
    material.opacity = opacity;
    mesh.visible = opacity > 0.02;
  }

  function setPresence(presence: readonly PortalPresence[]): void {
    const byGame = new Map(presence.map((row) => [row.gameId, row]));
    for (const state of states) {
      const row = byGame.get(state.placement.gameId);
      state.count = row ? Math.max(0, Math.floor(row.count)) : 0;
      state.names = row ? row.names.slice(0, 12) : [];
      state.top = row ? row.top.slice(0, 10) : [];
      state.tier = glowTierForCount(state.count);
      const key = `${state.count}|${state.names.join('\n')}|${state.top.map((entry) => `${entry.name}=${entry.score}`).join('\n')}`;
      if (key !== state.labelKey) paintLabel(state);
    }
  }

  function pushFinisher(event: FinisherEvent): boolean {
    const state = stateFor(event.gameId);
    if (!state) return false;
    if (clock - state.lastFinisherAt < FINISHER_INTERVAL_S) return false;
    state.lastFinisherAt = clock;
    state.finisher = { name: event.name, line: event.line, started: clock };
    paintBanner(state);
    state.banner.visible = true;
    return true;
  }

  function update(now: number, camera?: Camera): void {
    if (disposed) return;
    clock = now;
    writeInstances(now);
    writeSparks(now);
    for (const state of states) {
      const age = state.finisher ? now - state.finisher.started : Number.POSITIVE_INFINITY;
      const showBanner = age >= 0 && age < FINISHER_BANNER_S;
      if (!showBanner) state.banner.visible = false;
      fade(state.label, state.placement.x, state.placement.z, camera);
      if (showBanner) fade(state.banner, state.placement.x, state.placement.z, camera);
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scene.remove(group);
    ringGeo.dispose();
    ringMat.dispose();
    beamGeo.dispose();
    beamMat.dispose();
    sparkGeo.dispose();
    sparkMat.dispose();
    for (const state of states) {
      state.label.geometry.dispose();
      const labelMat = state.label.material;
      if (labelMat instanceof MeshBasicMaterial) labelMat.dispose();
      state.labelPaint.texture.dispose();
      state.banner.geometry.dispose();
      const bannerMat = state.banner.material;
      if (bannerMat instanceof MeshBasicMaterial) bannerMat.dispose();
      state.bannerPaint.texture.dispose();
    }
  }

  setPresence(opts.presence ?? []);
  writeInstances(0);
  writeSparks(0);
  return { root: group, setPresence, pushFinisher, update, dispose };
}

function makePortal(placement: PortalPlacement, parent: Group): PortalState {
  const labelPaint = paintedCanvas(512, 512);
  const labelMat = new MeshBasicMaterial({
    map: labelPaint.texture,
    transparent: true,
    toneMapped: false,
    side: DoubleSide,
  });
  const label = new Mesh(new PlaneGeometry(3.1, 3.1), labelMat);
  label.name = `m3-portal-label-${placement.gameId}`;
  const inward = inwardPoint(placement, 4);
  label.position.set(inward.x, placement.y + 4.6, inward.z);
  label.rotation.y = placement.rotationY;

  const bannerPaint = paintedCanvas(512, 128);
  const bannerMat = new MeshBasicMaterial({
    map: bannerPaint.texture,
    transparent: true,
    toneMapped: false,
    side: DoubleSide,
  });
  const banner = new Mesh(new PlaneGeometry(3.4, 0.85), bannerMat);
  banner.name = `m3-portal-banner-${placement.gameId}`;
  banner.position.set(inward.x, placement.y + 6.7, inward.z);
  banner.rotation.y = placement.rotationY;
  banner.visible = false;

  parent.add(label);
  parent.add(banner);
  const state: PortalState = {
    placement,
    count: 0,
    names: [],
    top: [],
    tier: 0,
    lastFinisherAt: Number.NEGATIVE_INFINITY,
    finisher: null,
    label,
    labelPaint,
    banner,
    bannerPaint,
    labelKey: '',
  };
  paintInitial(state);
  return state;
}

function paintInitial(state: PortalState): void {
  state.labelKey = '\0';
}

function inwardPoint(placement: PortalPlacement, metres: number): { x: number; z: number } {
  const length = Math.hypot(placement.x, placement.z);
  if (length < 0.001) return { x: placement.x, z: placement.z + metres };
  const scale = Math.max(0, length - metres) / length;
  return { x: placement.x * scale, z: placement.z * scale };
}

function mulberry(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
