// Bar arcade cabinet: picker keys, cabinet choices, URLs and the return spawn.
import assert from 'node:assert/strict';
import { canonicalGameId } from '@metaverse/hub-sdk';
import { SOCKETS } from '../src/realms/plaza/config';
import { ARCADE_GAMES } from '../src/realms/plaza/config';
import { GAME_URLS, gameUrl } from '../src/games';
import { parseReturnGame } from '../src/travel';
import { PICKER_CLOSED, pickerKey } from '../src/v2/arcade-picker';

// Picker keys.
{
  const open = { open: true, index: 0 };
  assert.deepEqual(pickerKey(PICKER_CLOSED, 'Digit1', 2).action, { type: 'none' });
  assert.deepEqual(pickerKey(open, 'Digit2', 2).action, { type: 'choose', index: 1 });
  assert.deepEqual(pickerKey(open, 'Digit3', 2).action, { type: 'none' });
  assert.equal(pickerKey(open, 'ArrowDown', 2).state.index, 1);
  assert.equal(pickerKey(open, 'ArrowUp', 2).state.index, 1);
  assert.deepEqual(pickerKey({ open: true, index: 1 }, 'Enter', 2).action, { type: 'choose', index: 1 });
  assert.deepEqual(pickerKey(open, 'KeyE', 2).action, { type: 'choose', index: 0 });
  const closed = pickerKey(open, 'Escape', 2);
  assert.deepEqual(closed.action, { type: 'close' });
  assert.equal(closed.state.open, false);
  assert.deepEqual(pickerKey(open, 'KeyZ', 2), { state: open, action: { type: 'none' } });
}

// Cabinet choices: Sproto Arcade first, then Sproto Fighter, both real game ids with a URL entry.
{
  assert.deepEqual(
    ARCADE_GAMES.map((game) => game.id),
    ['sproto-arcade', 'sproto-fighter'],
  );
  for (const game of ARCADE_GAMES) {
    assert.equal(canonicalGameId(game.id), game.id);
    assert.ok(GAME_URLS.some((entry) => entry.id === game.id));
    assert.equal(parseReturnGame(`#from=${game.id}`), game.id);
  }
  assert.equal(gameUrl('sproto-arcade', { dev: true }), '/play/sproto-arcade/');
  assert.equal(gameUrl('sproto-arcade', { dev: false, playDomain: 'example.com' }), 'https://play.example.com/sproto-arcade/');
  assert.equal(gameUrl('sproto-arcade', { dev: false, overrides: { 'sproto-arcade': 'http://127.0.0.1:8765/legacy.html' } }), 'http://127.0.0.1:8765/legacy.html');
}

// The Breakwater Coin has a monument socket.
{
  const coin = SOCKETS.find((socket) => socket.id === 'breakwater_coin');
  assert.ok(coin);
  assert.equal(new Set(SOCKETS.map((socket) => socket.id)).size, SOCKETS.length);
}

console.log('arcade cabinet ok');
