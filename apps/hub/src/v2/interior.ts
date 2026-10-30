import {
  CanvasTexture,
  Group,
  Object3D,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { SIGN_FONT } from './signs';

export const INTERIOR_ORIGIN = new Vector3(0, -300, 0);

const tex = (draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  draw(ctx, w, h);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  texture.userData.canvas = canvas;
  return texture;
};

export function makeLeaderboardTexture(): CanvasTexture {
  const texture = tex(() => {}, 1024, 576);
  texture.userData.draw = (rows: readonly (readonly [string, string])[]) => {
    const canvas = texture.userData.canvas as HTMLCanvasElement;
    const x = canvas.getContext('2d');
    if (!x) return;
    const w = canvas.width;
    const h = canvas.height;
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#120a2e');
    g.addColorStop(1, '#2a0b3a');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#00e5ff';
    x.lineWidth = 8;
    x.strokeRect(8, 8, w - 16, h - 16);
    x.textAlign = 'center';
    x.fillStyle = '#ffd21f';
    x.font = `56px ${SIGN_FONT}, Arial Black`;
    x.fillText('HALL OF CHAMPIONS', w / 2, 78);
    x.fillStyle = '#d7e1ff';
    x.font = `28px ${SIGN_FONT}, Arial Black`;
    x.fillText('LIFETIME VERSE EARNED', w / 2, 124);
    x.font = `36px ${SIGN_FONT}, Arial Black`;
    rows.slice(0, 5).forEach((row, i) => {
      const y = 196 + i * 70;
      x.fillStyle = i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(0,229,255,.08)';
      x.fillRect(40, y - 46, w - 80, 60);
      x.textAlign = 'left';
      x.fillStyle = ['#ffd21f', '#d7e1ff', '#ff9a4d'][i] || '#ffffff';
      x.fillText(`#${i + 1}`, 64, y);
      x.fillStyle = '#fff';
      x.fillText(row[0], 180, y);
      x.textAlign = 'right';
      x.fillStyle = '#39ff6a';
      x.fillText(row[1], w - 64, y);
    });
    texture.needsUpdate = true;
  };
  (texture.userData.draw as (rows: readonly (readonly [string, string])[]) => void)([]);
  return texture;
}

export interface InteriorBuild {
  group: Group;
  exit: Group;
  leaderboard: CanvasTexture;
  storeAnchor: Object3D;
}

