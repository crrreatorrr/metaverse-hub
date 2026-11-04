// Overhead chat bubbles for other players: a pool of DOM nodes, at most 12 shown
// (the newest lines win), placed every frame over the speaker's head.
import { MathUtils, Vector3, type Camera } from 'three';
import type { ParsedChat } from './chat';
import { STAND_Y } from './physics';

const MAX_BUBBLES = 12;
const RANGE = 40;

interface Bubble {
  node: HTMLDivElement;
  userId: string | null;
  left: number;
}

export interface Overheads {
  show(userId: string, parsed: ParsedChat): void;
  update(dt: number, camera: Camera, positionOf: (userId: string, out: Vector3) => Vector3 | null, viewport: { width: number; height: number }): void;
}

export function createOverheads(hud: HTMLElement): Overheads {
  const pool: Bubble[] = [];
  const at = new Vector3();
  for (let i = 0; i < MAX_BUBBLES; i += 1) {
    const node = document.createElement('div');
    node.className = 'overhead remote';
    node.hidden = true;
    node.setAttribute('aria-hidden', 'true');
    hud.append(node);
    pool.push({ node, userId: null, left: 0 });
  }

  function paint(b: Bubble, parsed: ParsedChat): void {
    b.node.replaceChildren();
    b.node.className = `overhead remote c-${parsed.color}${parsed.effect ? ` fx-${parsed.effect}` : ''}`;
    const line = document.createElement('span');
    line.className = 'overhead-line';
    if (parsed.effect === 'wave' || parsed.effect === 'wave2' || parsed.effect === 'shake') {
      [...parsed.text].forEach((char, index) => {
        const glyph = document.createElement('span');
        glyph.className = 'glyph';
        glyph.style.setProperty('--i', String(index));
        glyph.textContent = char === ' ' ? ' ' : char;
        line.append(glyph);
      });
    } else {
      line.textContent = parsed.text;
    }
    b.node.append(line);
    b.node.style.opacity = '1';
    b.node.style.visibility = 'hidden';
    b.node.hidden = false;
  }

  return {
    show(userId, parsed) {
      const b = pool.find((x) => x.userId === userId) ?? pool.find((x) => x.userId === null) ?? pool.reduce((a, c) => (c.left < a.left ? c : a));
      b.userId = userId;
      b.left = 4.5 + parsed.text.length * 0.04;
      paint(b, parsed);
    },
    update(dt, camera, positionOf, viewport) {
      for (const b of pool) {
        if (!b.userId) continue;
        b.left -= dt;
        if (b.left <= 0) {
          b.userId = null;
          b.node.hidden = true;
          continue;
        }
        if (b.left < 0.4) b.node.style.opacity = String(b.left / 0.4);
        const pos = positionOf(b.userId, at);
        if (!pos) {
          b.node.style.visibility = 'hidden';
          continue;
        }
        pos.y = pos.y - STAND_Y + 2.45;
        const distance = camera.position.distanceTo(pos);
        pos.project(camera);
        if (distance > RANGE || pos.z > 1 || Math.abs(pos.x) > 1.2 || Math.abs(pos.y) > 1.2) {
          b.node.style.visibility = 'hidden';
          continue;
        }
        b.node.style.visibility = 'visible';
        const scale = MathUtils.clamp(9 / Math.max(distance, 0.1), 0.6, 1.1);
        b.node.style.transform = `translate(${((pos.x * 0.5 + 0.5) * viewport.width).toFixed(1)}px, ${((-pos.y * 0.5 + 0.5) * viewport.height).toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      }
    },
  };
}
