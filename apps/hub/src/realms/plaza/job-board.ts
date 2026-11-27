import { BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { SIGN_FONT } from '../../v2/signs';
import { RELIC_JOBS } from './relic-jobs';

export function buildJobBoard() {
  const root = new Group();
  root.name = 'bar-job-board';
  // Last open bay on the front wall, beyond the line of framed pictures.
  root.position.set(-13.45, 1.92, 0.065);
  const frame = new Mesh(new BoxGeometry(2.62, 1.76, 0.12), new MeshStandardMaterial({
    color: '#b88a4f', metalness: 0.58, roughness: 0.34,
  }));
  root.add(frame);

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 676;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  const face = new Mesh(new PlaneGeometry(2.54, 1.68), new MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.position.z = 0.062;
  root.add(face);

  function paint(owned: ReadonlySet<string>) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#30251f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffdc96';
    ctx.font = `62px ${SIGN_FONT}, sans-serif`;
    ctx.fillText('RELIC JOBS', 35, 86);
    ctx.textAlign = 'right';
    ctx.font = `30px ${SIGN_FONT}, sans-serif`;
    const collected = RELIC_JOBS.filter(({ relic }) => owned.has(relic.id)).length;
    ctx.fillText(`${collected} / ${RELIC_JOBS.length} COLLECTED`, 986, 76);
    ctx.textAlign = 'left';
    RELIC_JOBS.forEach(({ game, relic }, index) => {
      const x = 32 + index % 2 * 490;
      const y = 120 + Math.floor(index / 2) * 137;
      ctx.fillStyle = '#17110f';
      ctx.fillRect(x + 4, y + 6, 466, 116);
      ctx.fillStyle = owned.has(relic.id) ? '#cbdfbd' : '#eedcbb';
      ctx.fillRect(x, y, 466, 116);
      ctx.fillStyle = '#524335';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(game.label.toUpperCase(), x + 22, y + 49);
      ctx.fillStyle = '#261b19';
      ctx.font = `36px ${SIGN_FONT}, sans-serif`;
      ctx.fillText(relic.name, x + 22, y + 93);
      ctx.fillStyle = '#94552c';
      ctx.beginPath();
      ctx.arc(x + 233, y + 11, 6, 0, Math.PI * 2);
      ctx.fill();
      if (owned.has(relic.id)) {
        ctx.fillStyle = '#295833';
        ctx.fillText('✓', x + 420, y + 92);
      }
    });
    texture.needsUpdate = true;
  }
  return { root, paint };
}
