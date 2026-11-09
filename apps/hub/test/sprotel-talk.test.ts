// Sprotel Bitcoin's talk panel in the Bar: greeting, topic keys and closing.
import assert from 'node:assert/strict';
import { SPROTEL_GREETINGS, SPROTEL_TOPICS, greeting, talkHelp, talkKey } from '../src/v2/sprotel-talk';

const open = { open: true, index: 0 };

// Topics: three answers, then a goodbye that closes the panel.
assert.deepEqual(SPROTEL_TOPICS.map((topic) => topic.id), ['store', 'verse', 'cabinet', 'bye']);
for (const topic of SPROTEL_TOPICS.slice(0, 3)) assert.ok(topic.answer.length > 0, topic.id);
assert.match(SPROTEL_TOPICS.find((topic) => topic.id === 'cabinet')!.answer, /Sproto Coop Battle/);
assert.match(SPROTEL_TOPICS.find((topic) => topic.id === 'store')!.answer, /isn't open yet/);

// Asking answers and keeps the panel open on that topic.
assert.deepEqual(talkKey(open, 'Digit1'), { state: { open: true, index: 0 }, line: SPROTEL_TOPICS[0]!.answer });
assert.deepEqual(talkKey(open, 'Digit3'), { state: { open: true, index: 2 }, line: SPROTEL_TOPICS[2]!.answer });
assert.deepEqual(talkKey({ open: true, index: 1 }, 'Enter'), { state: { open: true, index: 1 }, line: SPROTEL_TOPICS[1]!.answer });
assert.deepEqual(talkKey({ open: true, index: 1 }, 'KeyE').line, SPROTEL_TOPICS[1]!.answer);

// Moving changes the highlight only.
assert.deepEqual(talkKey(open, 'ArrowDown'), { state: { open: true, index: 1 } });
assert.deepEqual(talkKey(open, 'ArrowUp'), { state: { open: true, index: 3 } });

// Goodbye, Esc and Q close. A key with no meaning and a closed panel do nothing.
assert.equal(talkKey(open, 'Digit4').line, null);
assert.equal(talkKey({ open: true, index: 3 }, 'Enter').line, null);
assert.equal(talkKey(open, 'Escape').line, null);
assert.equal(talkKey(open, 'KeyQ').line, null);
assert.equal(talkKey(open, 'Digit5').line, undefined);
assert.equal(talkKey(open, 'KeyZ').line, undefined);
assert.equal(talkKey({ open: false, index: 0 }, 'Digit1').line, undefined);

// Greeting picks stay in range.
assert.equal(greeting(0), SPROTEL_GREETINGS[0]);
assert.equal(greeting(0.999), SPROTEL_GREETINGS[SPROTEL_GREETINGS.length - 1]);
assert.equal(greeting(1), SPROTEL_GREETINGS[SPROTEL_GREETINGS.length - 1]);
assert.equal(greeting(-1), SPROTEL_GREETINGS[0]);

assert.equal(talkHelp(4), '1 / 2 / 3 / 4 or ↑ ↓ · Enter to ask · Esc to leave');
assert.equal(talkHelp(0), 'Esc to leave');
assert.equal(talkHelp(4, true), '↑ ↓ choose · A to ask · B to leave');

console.log('sprotel-talk ok');
