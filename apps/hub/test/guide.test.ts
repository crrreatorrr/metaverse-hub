// Phase D: onboarding reducer, gate marker maths, return summary, 18+ confirm rule, game list.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAME_IDS, RELIC_BY_GAME, TICKETS_PER_VERSE, VERSE_DAILY_CAP } from '@metaverse/hub-sdk';
import { GAME_LIST, MATURE_QUESTION, gameInfo, needsMatureConfirm, parseLastGame, relicOfGame } from '../src/game-list';
import { EXPLAINER, ONBOARDING_STEPS, onboardingFinished, onboardingStep, type OnboardingState } from '../src/guide/onboarding';
import { BAR_MARKER_LABEL, MARKER_FADE_FAR, MARKER_FADE_NEAR, markerOpacity, markerText, placeMarker, spreadMarkers } from '../src/guide/markers';
import { TRIP_MAX_AGE_MS, encodeTrip, parseTrip, tripLines, tripSummary } from '../src/guide/trip';
import { ARCADE_GAMES, PORTALS, SPAWN_DISTANCE } from '../src/realms/plaza/config';
import { portalPosition } from '../src/layout';
import { initialDwell, stepPortalDwell } from '../src/travel';
import { gameUrl } from '../src/games';

// ---------- D3: the Games tab lists all eight, with the plaza's own labels and colours.
{
  assert.deepEqual([...GAME_LIST.map((game) => game.id)].sort(), [...GAME_IDS].sort());
  assert.equal(GAME_LIST.length, 8);
  for (const portal of PORTALS) {
    const info = gameInfo(portal.id);
    assert.equal(info?.label, portal.label, portal.id);
    assert.equal(info?.color, portal.color, portal.id);
    assert.equal(Boolean(info?.mature), Boolean(portal.mature), `${portal.id} mature flag`);
  }
  for (const cabinet of ARCADE_GAMES) {
    assert.equal(gameInfo(cabinet.id)?.label, cabinet.label, cabinet.id);
    assert.equal(gameInfo(cabinet.id)?.where, 'Bar cabinet');
  }
  for (const game of GAME_LIST) {
    assert.ok(game.blurb.length > 8 && game.goal.length > 8, game.id);
    assert.equal(relicOfGame(game.id), RELIC_BY_GAME[game.id], `${game.id} has a Relic`);
    assert.ok(relicOfGame(game.id));
    // Rows resolve through gameUrl: a page in dev, "Coming soon" when the page is unset.
    assert.equal(gameUrl(game.id, { dev: true, overrides: { [game.id]: '' } }), null, `${game.id} unset page is Coming soon`);
    assert.ok(gameUrl(game.id, { dev: true, overrides: { [game.id]: `/play/${game.id}/` } }));
  }
  assert.equal(GAME_LIST.filter((game) => game.mature).map((game) => game.id).join(), 'peoples-bitcoin');
  assert.equal(parseLastGame('nobu'), 'nobu');
  assert.equal(parseLastGame('vcoin'), null);
  assert.equal(parseLastGame(null), null);
  const menu = readFileSync(new URL('../src/menu.ts', import.meta.url), 'utf8');
  assert.match(menu, /MENU_TAB_ORDER: readonly MenuTab\[\] = \['games', 'items'/, 'Games is the first tab and Items is kept');
}

// ---------- D5: the 18+ question is asked once per browser, and declining does not retrigger in the ring.
{
  const pb = gameInfo('peoples-bitcoin');
  assert.equal(needsMatureConfirm(pb, null), true, 'first entry asks');
  assert.equal(needsMatureConfirm(pb, '1'), false, 'remembered yes');
  assert.equal(needsMatureConfirm(pb, '0'), true);
  assert.equal(needsMatureConfirm(gameInfo('nobu'), null), false, 'other games never ask');
  assert.equal(needsMatureConfirm(undefined, null), false);
  assert.equal(MATURE_QUESTION, '18+ satire. Enter?');
  // The dwell fires once (the plaza opens the question on `ready`). While the player stays in the
  // ring it is `held`, so declining cannot ask again until they step out and come back.
  let state = initialDwell();
  let fired = 0;
  for (let frame = 0; frame < 300; frame += 1) {
    const step = stepPortalDwell(state, 'peoples-bitcoin', 1 / 60);
    state = step.state;
    if (step.ready) fired += 1;
  }
  assert.equal(fired, 1, 'one question per visit to the ring');
  state = stepPortalDwell(state, null, 1 / 60).state;
  for (let frame = 0; frame < 120; frame += 1) {
    const step = stepPortalDwell(state, 'peoples-bitcoin', 1 / 60);
    state = step.state;
    if (step.ready) fired += 1;
  }
  assert.equal(fired, 2, 'stepping out and back in asks again');
}

// ---------- D1: onboarding reducer.
{
  const base: OnboardingState = { seen: false, dismissed: false, relics: 0, reachedGate: false };
  assert.deepEqual(onboardingStep(base), { show: true, ticks: [false, false, false], current: 0 });
  assert.deepEqual(onboardingStep({ ...base, relics: null }), { show: true, ticks: [false, false, false], current: 0 }, 'offline guest sees it too');
  assert.deepEqual(onboardingStep({ ...base, reachedGate: true }), { show: true, ticks: [true, false, false], current: 1 });
  const won = onboardingStep({ ...base, reachedGate: true, relics: 1 });
  assert.deepEqual(won.ticks, [true, true, true]);
  assert.equal(won.current, 3);
  assert.equal(won.show, false, 'after step 3 it never shows again');
  assert.equal(onboardingStep({ ...base, relics: 3 }).show, false, 'an account with Relics on a new browser skips it');
  assert.equal(onboardingStep({ ...base, dismissed: true }).show, false);
  assert.equal(onboardingStep({ ...base, seen: true }).show, false);
  assert.equal(onboardingFinished(base), false);
  assert.equal(onboardingFinished({ ...base, relics: null }), false);
  assert.equal(onboardingFinished({ ...base, dismissed: true }), true);
  assert.equal(onboardingFinished({ ...base, relics: 1 }), true);
  assert.equal(ONBOARDING_STEPS.length, 3);
  const explain = EXPLAINER.map((entry) => entry.text).join(' ');
  assert.ok(explain.includes(`${TICKETS_PER_VERSE} Tickets make 1 Verse`), 'rate comes from the SDK');
  assert.ok(explain.includes(`${VERSE_DAILY_CAP} Verse a day`), 'cap comes from the SDK');
  assert.deepEqual(EXPLAINER.map((entry) => entry.term), ['Tickets', 'Verse', 'Relics']);
}

// ---------- D2: marker maths.
{
  const viewport = { width: 1280, height: 720 };
  const margins = { top: 76, bottom: 96, side: 84 };
  const fov = (60 * Math.PI) / 180;
  // Straight ahead lands in the middle and is not an edge marker.
  const ahead = placeMarker({ x: 0, y: 0, z: -50 }, fov, viewport, margins);
  assert.deepEqual([Math.round(ahead.x), Math.round(ahead.y), ahead.edge], [640, 360, false]);
  // Up and to the right, in view.
  const upRight = placeMarker({ x: 10, y: 5, z: -50 }, fov, viewport, margins);
  assert.ok(upRight.x > 640 && upRight.y < 360 && !upRight.edge);
  // Far to the right: clamped to the right edge.
  const right = placeMarker({ x: 500, y: 0, z: -10 }, fov, viewport, margins);
  assert.deepEqual([right.x, right.edge], [1280 - 84, true]);
  // Behind: on the side it lies toward, mid height, flagged as an edge marker.
  const behindLeft = placeMarker({ x: -30, y: 4, z: 80 }, fov, viewport, margins);
  assert.deepEqual([behindLeft.x, behindLeft.edge], [84, true]);
  const behindRight = placeMarker({ x: 30, y: 4, z: 80 }, fov, viewport, margins);
  assert.equal(behindRight.x, 1280 - 84);
  // Never under the hint bar or over the top HUD row.
  for (const cam of [{ x: 0, y: -400, z: -10 }, { x: 0, y: 400, z: -10 }, { x: 3, y: -2, z: 5 }, { x: -900, y: -900, z: -1 }]) {
    const at = placeMarker(cam, fov, viewport, margins);
    assert.ok(at.y >= margins.top && at.y <= viewport.height - margins.bottom, JSON.stringify(at));
    assert.ok(at.x >= margins.side && at.x <= viewport.width - margins.side, JSON.stringify(at));
  }
  // A card in the top-right corner pushes edge labels left of it.
  const inset = placeMarker({ x: 500, y: 0, z: -10 }, fov, viewport, { ...margins, rightInset: 316 });
  assert.equal(inset.x, 1280 - 84 - 316);
  assert.equal(placeMarker({ x: 30, y: 4, z: 80 }, fov, viewport, { ...margins, rightInset: 316 }).x, 1280 - 84 - 316);
  assert.equal(placeMarker({ x: -30, y: 4, z: 80 }, fov, viewport, { ...margins, rightInset: 5000 }).x, 84, 'never left of the left margin');
  assert.equal(markerOpacity(MARKER_FADE_FAR), 1);
  assert.equal(markerOpacity(66), 1);
  assert.equal(markerOpacity(MARKER_FADE_NEAR), 0);
  assert.equal(markerOpacity(5), 0);
  assert.ok(markerOpacity(17) > 0 && markerOpacity(17) < 1);
  assert.equal(markerOpacity(Number.NaN), 0);
  assert.equal(markerText('NOBU: Saviour Dog', 66.4), 'NOBU: Saviour Dog · 66 m');
  assert.equal(BAR_MARKER_LABEL, 'Bar: Arcade · Fighter · Coop Battle');

  // Two labels on the same spot are separated; the nearer one keeps its place.
  const rows = [
    { x: 600, y: 300, width: 200, height: 24, distance: 120 },
    { x: 610, y: 302, width: 220, height: 24, distance: 96 },
    { x: 1100, y: 300, width: 150, height: 24, distance: 70 },
  ];
  const ys = spreadMarkers(rows, { top: 76, bottom: 624 });
  assert.equal(ys[1], 302, 'the nearer label stays');
  assert.ok(Math.abs(ys[0]! - ys[1]!) >= 24, 'the farther label moves clear');
  assert.equal(ys[2], 300, 'a label with room is untouched');
  // From spawn: five gates and the Bar, six labels, no two overlapping after the spread.
  const spawn = { x: 0, z: SPAWN_DISTANCE };
  const points = [...PORTALS.map((portal) => ({ ...portalPosition(portal.angle, portal.distance), label: portal.label })), { ...portalPosition(PORTALS[4]!.angle, 113), label: BAR_MARKER_LABEL }];
  assert.equal(points.length, 6);
  // Camera at the spawn looking north (toward -z), eye 3 m up: camera space is (x, y - 3, z - spawn.z).
  const placed = points.map((point) => {
    const cam = { x: point.x - spawn.x, y: 5.4 - 3, z: point.z - spawn.z };
    const at = placeMarker(cam, fov, viewport, margins);
    return { x: at.x, y: at.y, width: 9 * markerText(point.label, 100).length, height: 24, distance: Math.hypot(point.x - spawn.x, point.z - spawn.z) };
  });
  const spread = spreadMarkers(placed, { top: margins.top, bottom: viewport.height - margins.bottom });
  for (let a = 0; a < placed.length; a += 1) {
    assert.ok(spread[a]! >= margins.top && spread[a]! <= viewport.height - margins.bottom, 'inside the band above the hint bar');
    for (let b = a + 1; b < placed.length; b += 1) {
      const apart = Math.abs(placed[a]!.x - placed[b]!.x) >= (placed[a]!.width + placed[b]!.width) / 2 || Math.abs(spread[a]! - spread[b]!) >= 24;
      assert.ok(apart, `${points[a]!.label} and ${points[b]!.label} overlap`);
    }
  }
}

// ---------- D4: trip summary.
{
  const now = 1_800_000_000_000;
  const before = { game: 'nobu' as const, relics: ['hpos10i_core'], verse: 12, at: now - 60_000 };
  assert.deepEqual(parseTrip(encodeTrip(before), now), before);
  assert.equal(parseTrip(null, now), null);
  assert.equal(parseTrip('not json', now), null);
  assert.equal(parseTrip(JSON.stringify({ ...before, game: 'vcoin' }), now), null);
  assert.equal(parseTrip(JSON.stringify({ ...before, at: now - TRIP_MAX_AGE_MS - 1 }), now), null, 'a stale trip is ignored');
  assert.equal(parseTrip(JSON.stringify({ ...before, verse: 'lots' }), now), null);

  const relicName = (id: string) => (id === 'cones_tip' ? "Cone's Tip" : id);
  const won = tripSummary(before, { relics: ['hpos10i_core', 'cones_tip'], verse: 12 }, relicOfGame);
  assert.deepEqual(won.newRelics, ['cones_tip']);
  assert.equal(won.quiet, false);
  assert.equal(won.goal, null, 'the Relic is owned: no goal line');
  assert.deepEqual(tripLines(won, relicName, null), ["New Relic: Cone's Tip. It lights a socket on the statue."]);

  const earned = tripSummary(before, { relics: ['hpos10i_core'], verse: 32 }, relicOfGame);
  assert.equal(earned.verseGained, 20);
  assert.deepEqual(tripLines(earned, relicName, 205), ['+20 Verse', '205 NOBU: Saviour Dog Tickets in your wallet. Exchange them in Menu → Wallet.']);

  const quiet = tripSummary(before, { relics: ['hpos10i_core'], verse: 12 }, relicOfGame);
  assert.equal(quiet.quiet, true);
  assert.equal(quiet.goal, "Defeat Cone for Cone's Tip");
  assert.deepEqual(tripLines(quiet, relicName, null), ["Next: Defeat Cone for Cone's Tip."]);
  assert.deepEqual(tripLines(quiet, relicName, 40), ['40 NOBU: Saviour Dog Tickets in your wallet. Exchange them in Menu → Wallet.', "Next: Defeat Cone for Cone's Tip."]);

  // Verse spent while away is not shown as a negative gain; a quiet trip with the Relic owned still says something.
  const spent = tripSummary({ ...before, relics: ['cones_tip'], verse: 50 }, { relics: ['cones_tip'], verse: 10 }, relicOfGame);
  assert.equal(spent.verseGained, 0);
  assert.deepEqual(tripLines(spent, relicName, null), ['Nothing new this trip.']);
}

console.log('guide ok');
