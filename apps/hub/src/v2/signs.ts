import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { glow } from './core';

export const SIGN_FONT = 'LilitaOne';

let fontReady: Promise<void> | null = null;

/** Lilita One is the plaza sign face. The file is small enough to sit in the first load. */
export function loadSignFont(): Promise<void> {
  if (!fontReady) {
    fontReady = (async () => {
      const face = new FontFace(SIGN_FONT, `url(${import.meta.env.BASE_URL}world/fonts/LilitaOne.ttf)`);
      await face.load();
      document.fonts.add(face);
    })();
  }
  return fontReady;
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number): number {
  let size = start;
  ctx.font = `700 ${size}px ${SIGN_FONT}, Arial Black, sans-serif`;
  while (size > 16 && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `700 ${size}px ${SIGN_FONT}, Arial Black, sans-serif`;
  }
  return size;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function canvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Building name on one canvas. The mesh and material keep `name`. `notice` is a smaller third line. */
export function buildingSign(name: string, title: string, subtitle: string, tint: string, notice = ''): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = notice ? 640 : 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(8, 6, 18, 0.86)';
  roundRect(ctx, 20, 20, canvas.width - 40, canvas.height - 40, 40);
  ctx.fill();
  ctx.strokeStyle = tint;
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  fitFont(ctx, title, 920, notice ? 84 : 92);
  ctx.fillText(title, 512, notice ? 168 : (subtitle ? 190 : 256));
  if (subtitle) {
    ctx.fillStyle = tint;
    fitFont(ctx, subtitle, 920, notice ? 52 : 58);
    ctx.fillText(subtitle, 512, notice ? 300 : 320);
  }
  if (notice) {
    ctx.fillStyle = tint;
    fitFont(ctx, notice, 920, 40);
    ctx.fillText(notice, 512, 470);
  }
  const material = new MeshBasicMaterial({ map: canvasTexture(canvas), transparent: true, toneMapped: false });
  material.name = name;
  const height = notice ? 6.9 : (subtitle ? 5.5 : 1.35);
  const mesh = new Mesh(new PlaneGeometry(subtitle || notice ? 11 : 4.8, height), material);
  mesh.name = name;
  return glow(mesh);
}
