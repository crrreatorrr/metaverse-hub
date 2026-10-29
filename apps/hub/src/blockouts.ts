import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Matrix4,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PORTAL_DISTANCE, PORTALS, type PortalConfig } from './config';
import { portalPosition, type BoxSpec } from './layout';

/**
 * Placeholder shells around the four portals. The ring stays on the plaza
 * side of every building, and nothing solid sits inside the trigger.
 * Final models replace these primitives later.
 *
 * Local axes: `right` is tangential, `outward` points away from the plaza.
 * A box is symmetric, so yaw -angle lines its width up with `right` and its
 * depth up with the radial axis.
 */

interface Piece {
  shape: 'box' | 'cyl' | 'cone' | 'sphere' | 'torus';
  right: number;
  outward: number;
  y: number;
  a: number;
  b: number;
  c: number;
  color: string;
  /** Boxes and cylinders can block the player. Decorations stay walk-through. */
  solid: boolean;
}

export interface CylinderSolid {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

function basis(angle: number): { x: number; z: number; rx: number; rz: number; ox: number; oz: number; rotY: number } {
  const at = portalPosition(angle, PORTAL_DISTANCE);
  return {
    x: at.x,
    z: at.z,
    rx: Math.cos(angle),
    rz: Math.sin(angle),
    ox: Math.sin(angle),
    oz: -Math.cos(angle),
    rotY: -angle,
  };
}

function piecesFor(portal: PortalConfig): Piece[] {
  if (portal.id === 'hpos10i') return greenHill();
  if (portal.id === 'nobu') return kennel();
  if (portal.id === 'pb') return whiteHouse();
  return castle();
}

function greenHill(): Piece[] {
  return [
    { shape: 'box', right: -0.45, outward: 1.55, y: 0.05, a: 0.7, b: 0.08, c: 0.7, color: '#f2f2f4', solid: false },
    { shape: 'box', right: 0.45, outward: 1.55, y: 0.05, a: 0.7, b: 0.08, c: 0.7, color: '#2b2f3a', solid: false },
    { shape: 'box', right: -0.45, outward: 2.35, y: 0.05, a: 0.7, b: 0.08, c: 0.7, color: '#2b2f3a', solid: false },
    { shape: 'box', right: 0.45, outward: 2.35, y: 0.05, a: 0.7, b: 0.08, c: 0.7, color: '#f2f2f4', solid: false },
    { shape: 'sphere', right: -2.85, outward: 1.7, y: 0.85, a: 1.25, b: 0.72, c: 1.15, color: '#3cba4c', solid: true },
    { shape: 'sphere', right: 2.7, outward: 2.15, y: 0.62, a: 1.05, b: 0.66, c: 1.0, color: '#2f9a3e', solid: true },
    { shape: 'sphere', right: 0.2, outward: 3.7, y: 1.15, a: 1.7, b: 0.78, c: 1.35, color: '#46c85a', solid: true },
    { shape: 'torus', right: 0, outward: 2.25, y: 1.85, a: 1.05, b: 0.16, c: 0, color: '#ffd23a', solid: false },
    { shape: 'cyl', right: -3.2, outward: 3.35, y: 1.15, a: 0.12, b: 2.3, c: 0, color: '#8a5a32', solid: false },
    { shape: 'sphere', right: -3.2, outward: 3.35, y: 2.45, a: 0.55, b: 0.45, c: 0.55, color: '#1f8f45', solid: false },
    { shape: 'box', right: 0, outward: 4.35, y: 1.15, a: 6.2, b: 2.3, c: 0.55, color: '#c4a15a', solid: true },
  ];
}

function kennel(): Piece[] {
  return [
    { shape: 'box', right: -1.85, outward: 1.85, y: 1.15, a: 0.45, b: 2.3, c: 2.5, color: '#c4844a', solid: true },
    { shape: 'box', right: 1.85, outward: 1.85, y: 1.15, a: 0.45, b: 2.3, c: 2.5, color: '#c4844a', solid: true },
    { shape: 'box', right: 0, outward: 3.2, y: 1.15, a: 4.15, b: 2.3, c: 0.45, color: '#b8743c', solid: true },
    { shape: 'cone', right: 0, outward: 1.9, y: 2.85, a: 2.35, b: 1.15, c: 4, color: '#8d3434', solid: false },
    { shape: 'cyl', right: 2.85, outward: 0.55, y: 0.22, a: 0.16, b: 0.44, c: 0, color: '#f4efe4', solid: false },
    { shape: 'sphere', right: 2.55, outward: 0.55, y: 0.28, a: 0.22, b: 0.22, c: 0.22, color: '#f7f3ea', solid: false },
    { shape: 'sphere', right: 3.15, outward: 0.55, y: 0.28, a: 0.22, b: 0.22, c: 0.22, color: '#f7f3ea', solid: false },
    { shape: 'cyl', right: -2.7, outward: 0.45, y: 0.16, a: 0.34, b: 0.22, c: 0, color: '#d8d2c8', solid: false },
  ];
}

function whiteHouse(): Piece[] {
  const columns: Piece[] = [-2.15, -1.45, 1.45, 2.15].map((right) => ({
    shape: 'cyl' as const,
    right,
    outward: 1.05,
    y: 1.45,
    a: 0.16,
    b: 2.9,
    c: 0,
    color: '#f7f4ee',
    solid: true,
  }));
  return [
    ...columns,
    { shape: 'box', right: -2.85, outward: 2.15, y: 1.55, a: 0.55, b: 3.1, c: 2.3, color: '#f4f1ea', solid: true },
    { shape: 'box', right: 2.85, outward: 2.15, y: 1.55, a: 0.55, b: 3.1, c: 2.3, color: '#f4f1ea', solid: true },
    { shape: 'box', right: 0, outward: 3.4, y: 1.55, a: 6.25, b: 3.1, c: 0.5, color: '#ebe6dc', solid: true },
    { shape: 'box', right: -1.15, outward: 3.08, y: 1.7, a: 0.7, b: 1.15, c: 0.08, color: '#8eb4d6', solid: false },
    { shape: 'box', right: 1.15, outward: 3.08, y: 1.7, a: 0.7, b: 1.15, c: 0.08, color: '#8eb4d6', solid: false },
    { shape: 'cone', right: 0, outward: 2.15, y: 3.55, a: 3.35, b: 1.05, c: 4, color: '#4d5e78', solid: false },
    { shape: 'cyl', right: 2.2, outward: 2.3, y: 4.15, a: 0.05, b: 1.3, c: 0, color: '#d9d3c7', solid: false },
    { shape: 'box', right: 2.45, outward: 2.3, y: 4.55, a: 0.42, b: 0.26, c: 0.06, color: '#f5b942', solid: false },
  ];
}

function castle(): Piece[] {
  const crenels: Piece[] = [];
  for (const right of [-2.85, -2.05, 2.05, 2.85]) {
    crenels.push({
      shape: 'box',
      right,
      outward: 1.7,
      y: 4.45,
      a: 0.38,
      b: 0.42,
      c: 0.38,
      color: '#8b90a3',
      solid: false,
    });
  }
  return [
    { shape: 'box', right: -2.45, outward: 1.75, y: 2.05, a: 1.2, b: 4.1, c: 1.2, color: '#6e7388', solid: true },
    { shape: 'box', right: 2.45, outward: 1.75, y: 2.05, a: 1.2, b: 4.1, c: 1.2, color: '#6e7388', solid: true },
    { shape: 'box', right: 0, outward: 2.7, y: 1.7, a: 3.7, b: 3.4, c: 0.5, color: '#5c6278', solid: true },
    { shape: 'cone', right: -2.45, outward: 1.75, y: 4.55, a: 0.85, b: 1.15, c: 5, color: '#5a2a6a', solid: false },
    { shape: 'cone', right: 2.45, outward: 1.75, y: 4.55, a: 0.85, b: 1.15, c: 5, color: '#5a2a6a', solid: false },
    { shape: 'box', right: 0, outward: 2.32, y: 2.35, a: 1.5, b: 0.9, c: 0.08, color: '#3a3148', solid: false },
    ...crenels,
  ];
}

function worldOf(angle: number, piece: Piece): { x: number; y: number; z: number; rotY: number } {
  const frame = basis(angle);
  return {
    x: frame.x + frame.rx * piece.right + frame.ox * piece.outward,
    y: piece.y,
    z: frame.z + frame.rz * piece.right + frame.oz * piece.outward,
    rotY: frame.rotY,
  };
}

function geometryFor(piece: Piece): BufferGeometry {
  if (piece.shape === 'box') return new BoxGeometry(piece.a, piece.b, piece.c);
  if (piece.shape === 'cyl') return new CylinderGeometry(piece.a, piece.a, piece.b, 6);
  if (piece.shape === 'cone') return new ConeGeometry(piece.a, piece.b, piece.c);
  if (piece.shape === 'torus') return new TorusGeometry(piece.a, piece.b, 5, 14);
  return new SphereGeometry(1, 6, 5);
}

function paint(piece: Piece, matrix: Matrix4): BufferGeometry {
  const source = geometryFor(piece);
  const geo = source.index ? source.toNonIndexed() : source;
  geo.applyMatrix4(matrix);
  geo.computeVertexNormals();
  for (const name of ['uv', 'uv1', 'uv2', 'tangent', 'color']) {
    if (geo.getAttribute(name)) geo.deleteAttribute(name);
  }
  const count = geo.getAttribute('position').count;
  const tint = new Color(piece.color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

function matrixFor(angle: number, piece: Piece): Matrix4 {
  const at = worldOf(angle, piece);
  const obj = new Object3D();
  obj.position.set(at.x, at.y, at.z);
  obj.rotation.set(0, at.rotY, 0);
  if (piece.shape === 'sphere') obj.scale.set(piece.a, piece.b, piece.c);
  obj.updateMatrix();
  return obj.matrix.clone();
}

export function createBlockoutGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const portal of PORTALS) {
    for (const piece of piecesFor(portal)) parts.push(paint(piece, matrixFor(portal.angle, piece)));
  }
  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error('Failed to merge portal blockouts');
  return geometry;
}

/** Solid boxes. Spheres use a footprint box so the hills stop the player. */
export function buildingBoxColliders(): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  for (const portal of PORTALS) {
    for (const piece of piecesFor(portal)) {
      if (!piece.solid || piece.shape === 'cyl') continue;
      const at = worldOf(portal.angle, piece);
      const sx = piece.shape === 'sphere' ? piece.a * 2 : piece.a;
      const sy = piece.shape === 'sphere' ? piece.b * 2 : piece.b;
      const sz = piece.shape === 'sphere' ? piece.c * 2 : piece.c;
      boxes.push({ x: at.x, y: at.y, z: at.z, sx, sy, sz, rotY: at.rotY });
    }
  }
  return boxes;
}

/** Northeast of the monument, in the gap between Green Hill and the Kennel. No portal. */
export const BAR_ANGLE = Math.PI / 4;
export const BAR_DISTANCE = 10.5;

interface BarFrame {
  x: number;
  z: number;
  rx: number;
  rz: number;
  ox: number;
  oz: number;
  rotY: number;
}

export function barFrame(): BarFrame {
  const at = portalPosition(BAR_ANGLE, BAR_DISTANCE);
  return {
    x: at.x,
    z: at.z,
    rx: Math.cos(BAR_ANGLE),
    rz: Math.sin(BAR_ANGLE),
    ox: Math.sin(BAR_ANGLE),
    oz: -Math.cos(BAR_ANGLE),
    rotY: -BAR_ANGLE,
  };
}

function barWorld(right: number, outward: number, y: number): { x: number; y: number; z: number; rotY: number } {
  const frame = barFrame();
  return {
    x: frame.x + frame.rx * right + frame.ox * outward,
    y,
    z: frame.z + frame.rz * right + frame.oz * outward,
    rotY: frame.rotY,
  };
}

function barPieces(): Piece[] {
  return [
    { shape: 'box', right: 0, outward: 0, y: 0.03, a: 6.2, b: 0.04, c: 5.2, color: '#4a2c1c', solid: false },
    { shape: 'box', right: -3.15, outward: 0, y: 1.6, a: 0.4, b: 3.2, c: 5.5, color: '#6b3a22', solid: true },
    { shape: 'box', right: 3.15, outward: 0, y: 1.6, a: 0.4, b: 3.2, c: 5.5, color: '#6b3a22', solid: true },
    { shape: 'box', right: 0, outward: 2.6, y: 1.6, a: 6.7, b: 3.2, c: 0.4, color: '#5a301c', solid: true },
    { shape: 'box', right: -2.2, outward: -2.6, y: 1.6, a: 2.3, b: 3.2, c: 0.4, color: '#6b3a22', solid: true },
    { shape: 'box', right: 2.2, outward: -2.6, y: 1.6, a: 2.3, b: 3.2, c: 0.4, color: '#6b3a22', solid: true },
    { shape: 'box', right: 0, outward: -2.6, y: 3.05, a: 2.1, b: 0.35, c: 0.4, color: '#3a2418', solid: true },
    { shape: 'box', right: 0, outward: 0, y: 3.3, a: 6.8, b: 0.18, c: 5.8, color: '#2a1810', solid: false },
    { shape: 'box', right: 0, outward: 0.2, y: 0.55, a: 2.4, b: 1.05, c: 0.8, color: '#8a4b28', solid: true },
    { shape: 'box', right: 0, outward: 2.28, y: 1.9, a: 3.5, b: 2.05, c: 0.08, color: '#120e18', solid: false },
    { shape: 'cyl', right: -1.5, outward: -0.6, y: 0.35, a: 0.18, b: 0.7, c: 0, color: '#1c140f', solid: false },
    { shape: 'cyl', right: 1.5, outward: -0.6, y: 0.35, a: 0.18, b: 0.7, c: 0, color: '#1c140f', solid: false },
  ];
}

export function barContains(x: number, z: number): boolean {
  const frame = barFrame();
  const dx = x - frame.x;
  const dz = z - frame.z;
  const right = dx * frame.rx + dz * frame.rz;
  const outward = dx * frame.ox + dz * frame.oz;
  return Math.abs(right) < 2.85 && outward > -2.25 && outward < 2.3;
}

export function barScreenPose(): { x: number; y: number; z: number; rotY: number } {
  return barWorld(0, 2.2, 1.9);
}

export function createBarGeometry(): BufferGeometry {
  const parts = barPieces().map((piece) => {
    const at = barWorld(piece.right, piece.outward, piece.y);
    const obj = new Object3D();
    obj.position.set(at.x, at.y, at.z);
    obj.rotation.set(0, at.rotY, 0);
    obj.updateMatrix();
    return paint(piece, obj.matrix.clone());
  });
  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error('Failed to merge the bar');
  return geometry;
}

export function barBoxColliders(): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  for (const piece of barPieces()) {
    if (!piece.solid || piece.shape !== 'box') continue;
    const at = barWorld(piece.right, piece.outward, piece.y);
    boxes.push({ x: at.x, y: at.y, z: at.z, sx: piece.a, sy: piece.b, sz: piece.c, rotY: at.rotY });
  }
  return boxes;
}

export function buildingCylinderColliders(): CylinderSolid[] {
  const solids: CylinderSolid[] = [];
  for (const portal of PORTALS) {
    for (const piece of piecesFor(portal)) {
      if (!piece.solid || piece.shape !== 'cyl') continue;
      const at = worldOf(portal.angle, piece);
      solids.push({ x: at.x, y: at.y, z: at.z, radius: piece.a, height: piece.b });
    }
  }
  return solids;
}
