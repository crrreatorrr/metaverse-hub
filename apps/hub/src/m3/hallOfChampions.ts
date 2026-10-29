import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAND_Y } from '../physics';
import { fitText, paintedCanvas } from './canvas';
import { RELIC_GEMS, type ChampionEntry } from './types';

/** Club interior sits at y = -300. The hall is a separate room below that. */
export const HALL_ROOM_ORIGIN = { x: 0, y: -600, z: 0 } as const;

/**
 * v2 pedestal is three 1.3 m tiers (top at 3.9). The arch sits on that top,
 * on the south side, so it does not occupy the statue.
 */
export const HALL_DOOR_POSE = { x: 0, y: 3.9, z: 4.2, rotationY: 0 } as const;

/** Feet on the hall floor, facing the roster wall (-Z). Hub yaw matches `avatar.rotation.y = -yaw`. */
export const HALL_SPAWN = {
  x: HALL_ROOM_ORIGIN.x,
  y: HALL_ROOM_ORIGIN.y + STAND_Y,
  z: HALL_ROOM_ORIGIN.z + 2.4,
  yaw: Math.PI,
} as const;

export interface HallOfChampionsOptions {
  champions?: readonly ChampionEntry[];
  /** Sealed until the local player owns all four Relics. */
  open?: boolean;
}

export interface HallOfChampions {
  readonly room: Group;
  readonly door: Group;
  setChampions(entries: readonly ChampionEntry[]): void;
  setOpen(open: boolean): void;
  update(now: number): void;
  dispose(): void;
}

/**
 * Hall of Champions. The room shell is one merged box mesh. Relic markers
 * above the plinths are one instanced octahedron. The roster and the door
 * plaque are canvases. The arch, seal, and open-door beam are primitives.
 */
export function addHallOfChampions(scene: Object3D, opts: HallOfChampionsOptions = {}): HallOfChampions {
  const room = new Group();
  room.name = 'm3-hall-room';
  room.position.set(HALL_ROOM_ORIGIN.x, HALL_ROOM_ORIGIN.y, HALL_ROOM_ORIGIN.z);

  const shellGeo = roomShell();
  const shellMat = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const shell = new Mesh(shellGeo, shellMat);
  shell.name = 'm3-hall-shell';
  room.add(shell);

  const rosterPaint = paintedCanvas(1024, 1024);
  const rosterMat = new MeshBasicMaterial({ map: rosterPaint.texture, toneMapped: false });
  const roster = new Mesh(new PlaneGeometry(6.2, 3.4), rosterMat);
  roster.name = 'm3-hall-roster';
  roster.position.set(0, 2.7, -4.85);
  room.add(roster);

  const gemGeo = new OctahedronGeometry(0.22, 0);
  const gemMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const gems = new InstancedMesh(gemGeo, gemMat, RELIC_GEMS.length);
  gems.name = 'm3-hall-gems';
  gems.frustumCulled = false;
  const tint = new Color();
  const dummy = new Object3D();
  RELIC_GEMS.forEach((spec, index) => {
    tint.set(spec.color);
    gems.setColorAt(index, tint);
    dummy.position.set(-4.5 + index * 3, 1.55, 0.4);
    dummy.scale.setScalar(1);
    dummy.rotation.set(0, spec.phase, 0);
    dummy.updateMatrix();
    gems.setMatrixAt(index, dummy.matrix);
  });
  if (gems.instanceColor) gems.instanceColor.needsUpdate = true;
  room.add(gems);

  const door = new Group();
  door.name = 'm3-hall-door';
  door.position.set(HALL_DOOR_POSE.x, HALL_DOOR_POSE.y, HALL_DOOR_POSE.z);
  door.rotation.y = HALL_DOOR_POSE.rotationY;

  const archGeo = new TorusGeometry(1.45, 0.08, 6, 24);
  const archMat = new MeshBasicMaterial({ color: '#6d4eb5', toneMapped: false });
  const arch = new Mesh(archGeo, archMat);
  arch.name = 'm3-hall-arch';
  arch.position.y = 1.55;
  door.add(arch);

  const sealGeo = new CircleGeometry(1.28, 20);
  const sealMat = new MeshBasicMaterial({ color: '#140a22', toneMapped: false });
  const seal = new Mesh(sealGeo, sealMat);
  seal.name = 'm3-hall-seal';
  seal.position.set(0, 1.55, 0.04);
  door.add(seal);

  const plaquePaint = paintedCanvas(512, 256);
  const plaqueMat = new MeshBasicMaterial({ map: plaquePaint.texture, toneMapped: false });
  const plaque = new Mesh(new PlaneGeometry(2.6, 0.7), plaqueMat);
  plaque.name = 'm3-hall-plaque';
  plaque.position.set(0, 3.35, 0.06);
  door.add(plaque);

  const beamGeo = new CylinderGeometry(0.18, 0.42, 8, 6, 1, true);
  const beamMat = new MeshBasicMaterial({
    color: '#ffd21f',
    transparent: true,
    opacity: 0.65,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const beam = new Mesh(beamGeo, beamMat);
  beam.name = 'm3-hall-beam';
  beam.position.y = 5.4;
  door.add(beam);

  scene.add(room);
  scene.add(door);

  let entries: ChampionEntry[] = [];
  let open = false;
  let disposed = false;

  function paintRoster(): void {
    const { ctx, canvas } = rosterPaint;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#140c28';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffd21f';
    ctx.lineWidth = 12;
    ctx.strokeRect(16, 16, w - 32, h - 32);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd21f';
    ctx.font = '700 54px sans-serif';
    ctx.fillText('HALL OF CHAMPIONS', w / 2, 78);
    ctx.fillStyle = '#d7e1ff';
    ctx.font = '600 24px sans-serif';
    ctx.fillText('Everyone who owns all 4 Relics, in the order the server wrote', w / 2, 128);
    const shown = entries.slice(0, 16);
    if (shown.length === 0) {
      ctx.fillStyle = '#9aa3c7';
      ctx.font = '600 32px sans-serif';
      ctx.fillText('No champions yet', w / 2, 280);
    }
    shown.forEach((entry, index) => {
      const y = 200 + index * 46;
      ctx.fillStyle = index % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,210,31,0.06)';
      ctx.fillRect(48, y - 24, w - 96, 42);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffd21f';
      ctx.font = '700 28px sans-serif';
      ctx.fillText(String(entry.order).padStart(2, '0'), 72, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(fitText(ctx, entry.name, w - 220), 160, y);
    });
    if (entries.length > shown.length) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#9aa3c7';
      ctx.font = '600 22px sans-serif';
      ctx.fillText(`and ${entries.length - shown.length} more`, w / 2, h - 48);
    }
    rosterPaint.touch();
  }

  function paintPlaque(): void {
    const { ctx, canvas } = plaquePaint;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = open ? '#2a2108' : '#140c24';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = open ? '#ffd21f' : '#8d6bff';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = open ? '#ffd21f' : '#d7c6ff';
    ctx.font = '700 36px sans-serif';
    ctx.fillText('HALL OF CHAMPIONS', w / 2, 70);
    ctx.font = '700 28px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(open ? 'OPEN' : 'SEALED · OWN ALL 4 RELICS', w / 2, 130);
    plaquePaint.touch();
  }

  function setChampions(next: readonly ChampionEntry[]): void {
    entries = next.slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    paintRoster();
  }

  function setOpen(next: boolean): void {
    open = next;
    room.visible = open;
    seal.visible = !open;
    beam.visible = open;
    archMat.color.set(open ? '#ffd21f' : '#6d4eb5');
    paintPlaque();
  }

  function update(now: number): void {
    if (disposed || !room.visible) return;
    RELIC_GEMS.forEach((spec, index) => {
      dummy.position.set(-4.5 + index * 3, 1.55, 0.4);
      dummy.rotation.set(now * 0.8, now * 0.6 + spec.phase, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      gems.setMatrixAt(index, dummy.matrix);
    });
    gems.instanceMatrix.needsUpdate = true;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scene.remove(room);
    scene.remove(door);
    shellGeo.dispose();
    shellMat.dispose();
    roster.geometry.dispose();
    rosterMat.dispose();
    rosterPaint.texture.dispose();
    gemGeo.dispose();
    gemMat.dispose();
    archGeo.dispose();
    archMat.dispose();
    sealGeo.dispose();
    sealMat.dispose();
    plaque.geometry.dispose();
    plaqueMat.dispose();
    plaquePaint.texture.dispose();
    beamGeo.dispose();
    beamMat.dispose();
  }

  setChampions(opts.champions ?? []);
  setOpen(opts.open ?? false);
  return { room, door, setChampions, setOpen, update, dispose };
}

function roomShell(): BufferGeometry {
  const parts = [
    paintedBox(14, 0.24, 10, 0, -0.12, 0, '#1a1030'),
    paintedBox(14, 0.2, 10, 0, 5.1, 0, '#120c22'),
    paintedBox(0.24, 5, 10, -6.88, 2.5, 0, '#241538'),
    paintedBox(0.24, 5, 10, 6.88, 2.5, 0, '#241538'),
    paintedBox(14, 5, 0.24, 0, 2.5, -4.88, '#241538'),
    paintedBox(4.2, 5, 0.24, -4.9, 2.5, 4.88, '#241538'),
    paintedBox(4.2, 5, 0.24, 4.9, 2.5, 4.88, '#241538'),
    paintedBox(5.6, 1.6, 0.24, 0, 4.2, 4.88, '#241538'),
    paintedBox(1.2, 0.7, 1.2, -4.5, 0.35, 0.4, '#3a2d55'),
    paintedBox(1.2, 0.7, 1.2, -1.5, 0.35, 0.4, '#3a2d55'),
    paintedBox(1.2, 0.7, 1.2, 1.5, 0.35, 0.4, '#3a2d55'),
    paintedBox(1.2, 0.7, 1.2, 4.5, 0.35, 0.4, '#3a2d55'),
    paintedBox(13.4, 0.08, 0.08, 0, 4.7, -4.7, '#00e5ff'),
    paintedBox(0.08, 0.08, 9.4, -6.6, 0.08, 0, '#ff3bd4'),
    paintedBox(0.08, 0.08, 9.4, 6.6, 0.08, 0, '#ff3bd4'),
  ];
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('Failed to merge the Hall of Champions shell');
  return merged;
}

function paintedBox(sx: number, sy: number, sz: number, x: number, y: number, z: number, hex: string): BufferGeometry {
  const geo = new BoxGeometry(sx, sy, sz);
  geo.translate(x, y, z);
  const position = geo.getAttribute('position');
  if (!position) throw new Error('box has no position');
  const tint = new Color(hex);
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}
