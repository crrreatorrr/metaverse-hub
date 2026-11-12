import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace,
} from 'three';
import { PEDESTAL_COLORS } from './config';

export const R = 110;

export function buildFloor(parent: Object3D): void {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.fillStyle = '#716c69';
  ctx.fillRect(0, 0, 1024, 1024);
  for (let row = 0; row < 32; row++) {
    for (let column = -1; column < 32; column++) {
      const tone = 124 + ((row * 29 + (column + 1) * 13) % 9);
      ctx.fillStyle = `rgb(${tone + 3} ${tone} ${tone - 3})`;
      ctx.fillRect(column * 32 + (row % 2) * 16, row * 32, 31, 31);
    }
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  const size = 2800;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.repeat.setScalar(size / (2 * R));
  const floor = new Mesh(new PlaneGeometry(size, size), new MeshStandardMaterial({ map, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'plaza-floor';
  parent.add(floor);
}

export function buildPedestal(parent: Object3D): { top: number; markers: Mesh[] } {
  const group = new Group();
  group.name = 'statue-pedestal';
  const stone = new MeshStandardMaterial({ color: '#686366', roughness: 0.88 });
  const tiers = [[24, 25, 1.3], [20.5, 21.5, 1.3], [17, 18, 1.3]] as const;
  let y = 0;
  for (const [rt, rb, h] of tiers) {
    const tier = new Mesh(new CylinderGeometry(rt, rb, h, 96), stone);
    tier.position.y = y + h / 2;
    group.add(tier);
    y += h;
  }
  const geometry = new BoxGeometry(2.7, 0.10, 1.5);
  const markers = PEDESTAL_COLORS.map((color, index) => {
    const angle = (index - 3.5) * 0.31;
    const marker = new Mesh(geometry, new MeshStandardMaterial({ color: new Color(color).multiplyScalar(0.27), roughness: 0.78 }));
    marker.position.set(Math.sin(angle) * 22.6, 1.36, Math.cos(angle) * 22.6);
    marker.rotation.y = angle;
    marker.name = `statue-relic-marker-${index}`;
    group.add(marker);
    return marker;
  });
  parent.add(group);
  return { top: y, markers };
}
