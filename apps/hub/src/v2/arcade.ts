import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TorusGeometry,
} from 'three';
import { animated, glow } from './core';
import { CLUB_MARKERS } from './club-interior-colliders';
import { SIGN_FONT } from './signs';
import { BELT_PLINTH } from './arcade-layout';

/** Cabinet marquee and the Tidebreaker Belt plinth inside the Bar. Layout is in arcade-layout.ts. */
const SPOT = CLUB_MARKERS.arcade_spot.pos;

export interface ArcadeBuild {
  group: Group;
  /** Lights the belt when the player owns `tidebreaker_belt`. */
  setBeltOwned(owned: boolean): void;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  draw(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.userData.canvas = canvas;
  return texture;
}

function marquee(): Mesh {
  const texture = canvasTexture(512, 128, (x) => {
    x.fillStyle = '#12051f';
    x.fillRect(0, 0, 512, 128);
    x.strokeStyle = '#ff3d6e';
    x.lineWidth = 8;
    x.strokeRect(6, 6, 500, 116);
    x.textAlign = 'center';
    x.fillStyle = '#ffd21f';
    x.font = `64px ${SIGN_FONT}, Arial Black`;
    x.fillText('SPROTO FIGHTER', 256, 78);
    x.fillStyle = '#7fe8ff';
    x.font = `22px ${SIGN_FONT}, Arial Black`;
    x.fillText('PRESS E TO PLAY', 256, 112);
  });
  const mesh = new Mesh(new PlaneGeometry(0.9, 0.225), new MeshBasicMaterial({ map: texture, toneMapped: false }));
  mesh.name = 'arcade_marquee';
  // Above the cabinet (1.82 m tall), on its front face, facing the room (-Z).
  mesh.position.set(SPOT[0], 2.02, SPOT[2] - 0.47);
  mesh.rotation.y = Math.PI;
  return glow(mesh);
}

function plaque(): Mesh {
  const texture = canvasTexture(256, 96, (x) => {
    x.fillStyle = '#1b1208';
    x.fillRect(0, 0, 256, 96);
    x.textAlign = 'center';
    x.fillStyle = '#f5c75a';
    x.font = `30px ${SIGN_FONT}, Arial Black`;
    x.fillText('TIDEBREAKER BELT', 128, 44);
    x.fillStyle = '#c9b48a';
    x.font = `18px ${SIGN_FONT}, Arial Black`;
    x.fillText('SPROTO FIGHTER · STORY WORLD 1', 128, 76);
  });
  const mesh = new Mesh(new PlaneGeometry(0.46, 0.17), new MeshBasicMaterial({ map: texture }));
  mesh.name = 'belt_plaque';
  mesh.position.set(BELT_PLINTH.x, BELT_PLINTH.height * 0.62, BELT_PLINTH.z - BELT_PLINTH.size / 2 - 0.006);
  mesh.rotation.y = Math.PI;
  return mesh;
}

/** Primitive belt: a flattened gold loop with a centre plate, standing upright on the plinth. */
function belt(gold: MeshStandardMaterial, strap: MeshStandardMaterial): Group {
  const g = new Group();
  g.name = 'tidebreaker_belt';
  const loop = new Mesh(new TorusGeometry(0.17, 0.028, 8, 28), strap);
  loop.scale.set(1, 0.55, 1);
  g.add(loop);
  const plate = new Mesh(new CylinderGeometry(0.085, 0.085, 0.022, 20), gold);
  plate.rotation.x = Math.PI / 2;
  plate.position.set(0, 0, -0.03);
  g.add(plate);
  for (const side of [-1, 1]) {
    const stud = new Mesh(new BoxGeometry(0.05, 0.06, 0.018), gold);
    stud.position.set(side * 0.125, 0, -0.022);
    g.add(stud);
  }
  return g;
}

export function buildArcade(): ArcadeBuild {
  const group = new Group();
  group.name = 'sproto-fighter-arcade';
  group.add(marquee());

  const stone = new MeshStandardMaterial({ color: '#2a2230', roughness: 0.7, metalness: 0.1 });
  const pedestal = new Mesh(new BoxGeometry(BELT_PLINTH.size, BELT_PLINTH.height, BELT_PLINTH.size), stone);
  pedestal.name = 'belt_plinth';
  pedestal.position.set(BELT_PLINTH.x, BELT_PLINTH.height / 2, BELT_PLINTH.z);
  group.add(pedestal);
  group.add(plaque());

  const gold = new MeshStandardMaterial({ color: '#d9a43a', emissive: '#ffb02e', emissiveIntensity: 0, metalness: 0.8, roughness: 0.3 });
  const strap = new MeshStandardMaterial({ color: '#2b2b33', emissive: '#66d7e8', emissiveIntensity: 0, roughness: 0.5 });
  const trophy = belt(gold, strap);
  trophy.position.set(BELT_PLINTH.x, BELT_PLINTH.height + 0.16, BELT_PLINTH.z);
  trophy.rotation.y = Math.PI;
  group.add(trophy);

  let owned = false;
  const apply = (): void => {
    gold.color.set(owned ? '#e3ad3c' : '#4a4652');
    gold.emissiveIntensity = owned ? 0.9 : 0;
    strap.color.set(owned ? '#1f5f6b' : '#2b2b33');
    strap.emissiveIntensity = owned ? 0.35 : 0;
    trophy.visible = true;
  };
  apply();
  animated.push((time) => {
    if (owned) trophy.rotation.y = Math.PI + Math.sin(time * 0.8) * 0.35;
  });

  return {
    group,
    setBeltOwned(next) {
      if (next === owned) return;
      owned = next;
      apply();
    },
  };
}
