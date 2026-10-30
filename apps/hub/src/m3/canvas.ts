import { CanvasTexture, SRGBColorSpace } from 'three';

export interface PaintedCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  touch(): void;
}

/** Runtime canvas. Nothing here is downloaded. */
export function paintedCanvas(width: number, height: number): PaintedCanvas {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return {
    canvas,
    ctx,
    texture,
    touch() {
      texture.needsUpdate = true;
    },
  };
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const value = text.length > 48 ? `${text.slice(0, 48)}…` : text;
  if (ctx.measureText(value).width <= maxWidth) return value;
  let end = value.length;
  while (end > 1 && ctx.measureText(`${value.slice(0, end)}…`).width > maxWidth) end -= 1;
  return `${value.slice(0, end)}…`;
}
