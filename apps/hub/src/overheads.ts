// Overhead chat bubbles for other players: a pool of DOM nodes, at most 12 shown
// (the newest lines win), placed every frame over the speaker's head.
import { MathUtils, Vector3, type Camera } from 'three';
import type { ParsedChat } from './chat';
import { STAND_Y } from './physics';
import { stackBubbles, type BubbleBox } from './overhead-layout';

const MAX_BUBBLES = 12;
const RANGE = 40;

interface Bubble {
  node: HTMLDivElement;
  userId: string | null;
  left: number;
  /** Unscaled size of the painted line, measured once per line (0 = not measured yet). */
  w: number;
  h: number;
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
    pool.push({ node, userId: null, left: 0, w: 0, h: 0 });
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
    b.w = 0;
    b.h = 0;
  }

  return {
    show(userId, parsed) {
      const b = pool.find((x) => x.userId === userId) ?? pool.find((x) => x.userId === null) ?? pool.reduce((a, c) => (c.left < a.left ? c : a));
      b.userId = userId;
      b.left = 4.5 + parsed.text.length * 0.04;
      paint(b, parsed);
    },
    update(dt, camera, positionOf, viewport) {
      const shown: { b: Bubble; scale: number; box: BubbleBox }[] = [];
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
        if (!b.w) {
          b.w = b.node.offsetWidth;
          b.h = b.node.offsetHeight;
        }
        // The node scales about its bottom centre (transform-origin), which is the point placed here.
        const x = (pos.x * 0.5 + 0.5) * viewport.width;
        const y = (-pos.y * 0.5 + 0.5) * viewport.height;
        shown.push({ b, scale, box: { x, y, w: b.w * scale, h: b.h * scale } });
      }
      // Speakers standing together: stack their lines instead of drawing them over each other.
      const lift = stackBubbles(shown.map((entry) => entry.box));
      shown.forEach(({ b, scale, box }, index) => {
        b.node.style.transform = `translate(${box.x.toFixed(1)}px, ${(box.y - lift[index]!).toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      });
    },
  };
}
