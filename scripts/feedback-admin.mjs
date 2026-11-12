#!/usr/bin/env node
// Read and update feedback notes from a terminal, through the same RPCs as /admin/.
//
//   HUB_URL=https://<domain> NAKAMA_SERVER_KEY=<client key> node scripts/feedback-admin.mjs list [--game sproto-shooter] [--status open]
//   ... get SHOOTER-0042 [--image out.jpg]
//   ... update SHOOTER-0042 --status fixed --resolution "Lowered boss HP" --commit abc1234
//   ... update SHOOTER-0042 --status resolved --verification "Replayed L3 on build abc1234"
//
// The login defaults to 333 / 333 (FEEDBACK_ADMIN_USER / FEEDBACK_ADMIN_PASS override it).
// NAKAMA_SERVER_KEY is the public client key the hub page already ships, not the HTTP key.
import { writeFileSync } from 'node:fs';
import { feedbackClient } from './feedback-rpc.mjs';

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i] ?? '';
  else positional.push(rest[i]);
}

async function main() {
  if (!['list', 'get', 'update'].includes(command)) {
    console.error('usage: feedback-admin.mjs list|get|update [id] [--game g] [--status s] [--resolution t] [--verification t] [--commit c] [--comment t] [--image file]');
    process.exit(2);
  }
  const { rpc } = feedbackClient();
  if (command === 'list') {
    const out = await rpc('feedback.admin.list', { game: flags.game, status: flags.status, category: flags.category, q: flags.q, limit: Number(flags.limit ?? 200) });
    if (flags.json !== undefined) return console.log(JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out.counts));
    for (const n of out.items) console.log(`${n.id}\t${n.status}\t${n.username}\t${n.level}\t${n.categories.join(',')}\t${n.note.replace(/\s+/g, ' ').slice(0, 100)}`);
  } else if (command === 'get') {
    const out = await rpc('feedback.admin.get', { id: positional[0] });
    if (flags.image && out.image) writeFileSync(flags.image, Buffer.from(out.image.split(',')[1], 'base64'));
    console.log(JSON.stringify({ ...out, image: out.image ? `(${out.image.length} chars${flags.image ? `, saved to ${flags.image}` : ''})` : null }, null, 2));
  } else {
    const body = { id: positional[0] };
    if (flags.status !== undefined) body.status = flags.status;
    if (flags.resolution !== undefined) body.resolution = flags.resolution;
    if (flags.verification !== undefined) body.verification = flags.verification;
    if (flags.commit !== undefined) body.fixedCommit = flags.commit;
    if (flags.comment !== undefined) body.comment = flags.comment;
    console.log(JSON.stringify((await rpc('feedback.admin.update', body)).item, null, 2));
  }
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
