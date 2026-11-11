// Bar wall pages (plan items A4, B1, B4, E5): every page in the cycle can hold real rows from a
// normal hub-entered session, Classic pages hide while empty, and no sample names are painted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BAR_BOARD_IDS,
  BAR_DEAD_BOARD_IDS,
  BAR_OPTIONAL_BOARD_IDS,
  BOARD_META,
  HUB_BOARD_IDS,
  NO_SCORES_TEXT,
  barLoopLength,
  gameForBoard,
  nextBarPage,
  serverBoard,
  type HubBoardId,
} from '../src/m3/types';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const leaderboard = read('../../../server/modules/src/leaderboard.ts');
const rpcs = read('../../../server/modules/src/rpcs.ts');

/** Games whose unranked posts the server answers with `unranked` (SUBMIT_SQL). The plaza always enters unranked. */
function unrankedRefused(): string[] {
  const match = /\(SELECT game_id FROM sess\) IN \(([^)]*)\) THEN 'unranked'/.exec(leaderboard);
  assert.ok(match, 'SUBMIT_SQL lists the games that need a ranked session');
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

/** Boards only the server writes: a hub-entered session fills them without a ranked flag. */
function serverBoards(): string[] {
  const match = /var SERVER_BOARDS[^=]*= \{([^}]*)\}/.exec(leaderboard);
  assert.ok(match, 'SERVER_BOARDS is declared');
  return [...match[1]!.matchAll(/([a-z_0-9]+): true/g)].map((m) => m[1]!);
}

const refused = unrankedRefused();
const serverWritten = [...serverBoards(), 'shooter_story_clear_ms_v1', 'coop_stage_clear_ms_v1'];

for (const id of BAR_BOARD_IDS) {
  assert.ok((HUB_BOARD_IDS as readonly string[]).includes(id), `${id} is a known board`);
  assert.ok(BOARD_META[id], `${id} has a title`);
  const server = serverBoard(id);
  if (server) {
    assert.ok(leaderboard.includes(`${server.board}:`), `${id}: the server knows ${server.board}`);
    const game = gameForBoard(id);
    const clientPosted = !serverWritten.includes(server.board);
    if (clientPosted) assert.equal(refused.includes(game ?? ''), false, `${id}: unranked posts from ${String(game)} are refused, so the page could never fill`);
  }
}

// A page for HPOS10I's lifetime Verse needs an exchange path for HPOS10I Tickets.
if (BAR_BOARD_IDS.includes('verse_by_game_hpos10i')) {
  assert.ok(rpcs.includes('exchange_tickets_hub'), 'hub-scope exchange exists before the HPOS10I Verse page returns');
}
for (const id of BAR_DEAD_BOARD_IDS) assert.equal(BAR_BOARD_IDS.includes(id), false, `${id} stays out of the cycle`);

// Classic NOBU pages cycle only when they have rows.
{
  const none = () => false;
  const only = (wanted: HubBoardId) => (id: HubBoardId) => id === wanted;
  for (const id of BAR_OPTIONAL_BOARD_IDS) assert.ok(BAR_BOARD_IDS.includes(id), `${id} is in the list`);
  const shown = new Set<HubBoardId>();
  let at = 0;
  for (let step = 0; step < BAR_BOARD_IDS.length * 2; step += 1) {
    shown.add(BAR_BOARD_IDS[at]!);
    at = nextBarPage(BAR_BOARD_IDS, at, none);
  }
  for (const id of BAR_OPTIONAL_BOARD_IDS) assert.equal(shown.has(id), false, `${id} hidden while empty`);
  assert.equal(shown.size, barLoopLength(BAR_BOARD_IDS, none));
  assert.equal(barLoopLength(BAR_BOARD_IDS, none), BAR_BOARD_IDS.length - BAR_OPTIONAL_BOARD_IDS.length);
  assert.equal(barLoopLength(BAR_BOARD_IDS, only('nobu_trial_time:2')), barLoopLength(BAR_BOARD_IDS, none) + 1);
  const before = BAR_BOARD_IDS.indexOf('nobu_trial_time:1');
  assert.equal(BAR_BOARD_IDS[nextBarPage(BAR_BOARD_IDS, before - 1, only('nobu_trial_time:2'))], 'nobu_trial_time:2');
  assert.equal(nextBarPage(['nobu_trial_time:1'], 0, none), 0, 'nothing to show keeps the index');
}

// No invented player names in the plaza content; an empty board says so.
{
  const content = read('../src/realms/plaza/content.ts');
  assert.doesNotMatch(content, /\bSAMPLE\b/, 'sample rows are gone');
  for (const name of ['morelight', 'cone-kid', 'dusk-walker', 'guest-17']) {
    assert.equal(content.includes(name), false, `${name} is not painted by content.ts`);
  }
  assert.ok(content.includes('NO_SCORES_TEXT'));
  assert.equal(NO_SCORES_TEXT, 'No scores yet. Be the first.');
  // The stub with sample people is imported only behind the dev flag.
  assert.match(content, /if \(devPreview\) \{\s*const stubs = await import\('\.\.\/\.\.\/m3\/stub'\)/);
}

console.log(`boards ok (${barLoopLength(BAR_BOARD_IDS, () => false)} pages, ${BAR_OPTIONAL_BOARD_IDS.length} optional)`);
