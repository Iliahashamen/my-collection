// Tests the data logic that decides what is safe to store in a single Telegram
// CloudStorage value. Usage: node test/model.test.mjs
import assert from 'node:assert/strict';

import {
  MAX_VALUE_CHARS,
  ValidationError,
  decodeItem,
  encodeItem,
  filterSort,
  formatMoney,
  idFromKey,
  isItemKey,
  itemKey,
  newItemId,
  parseNote,
  parseTitle,
  parseValue,
  totalValue
} from '../model.js';

const base = {
  id: 'abc123',
  title: 'Amazing Spider-Man #300',
  note: 'CGC 9.4',
  value: 1250.5,
  thumb: null,
  hasPhoto: false,
  createdAt: '2026-10-02T20:00:00.000Z',
  updatedAt: '2026-10-02T20:00:00.000Z'
};

// --- keys -------------------------------------------------------------------
const key = itemKey(base.id);
assert.ok(isItemKey(key));
assert.equal(idFromKey(key), base.id);
assert.ok(!isItemKey('other_thing'));
// CloudStorage only permits A-Z a-z 0-9 _ - in keys.
for (let i = 0; i < 50; i += 1) {
  assert.match(itemKey(newItemId()), /^[A-Za-z0-9_-]{1,128}$/, 'generated key must be CloudStorage-safe');
}
assert.equal(new Set(Array.from({ length: 200 }, () => newItemId())).size, 200, 'ids must not collide');
console.log('ok  keys are CloudStorage-safe and unique');

// --- round trip -------------------------------------------------------------
const decoded = decodeItem(key, encodeItem(base));
assert.deepEqual(
  { ...decoded, thumb: decoded.thumb },
  { ...base, thumb: null },
  'an item survives encode/decode unchanged'
);
console.log('ok  item round-trips through storage encoding');

// --- value parsing ----------------------------------------------------------
assert.equal(parseValue('1,250.50'), 1250.5, 'comma thousands separator');
assert.equal(parseValue('1 250,50'), 1250.5, 'space separator with comma decimal');
assert.equal(parseValue('900'), 900);
assert.equal(parseValue(''), 0, 'blank means zero, not an error');
assert.equal(parseValue('12.345'), 12.35, 'rounded to agorot');
assert.throws(() => parseValue('abc'), ValidationError);
assert.throws(() => parseValue('-5'), ValidationError);
console.log('ok  value parsing accepts phone-typed numbers and rejects junk');

// --- text validation --------------------------------------------------------
assert.equal(parseTitle('  Hulk 181  '), 'Hulk 181', 'title is trimmed');
assert.throws(() => parseTitle('   '), ValidationError, 'title is required');
assert.throws(() => parseTitle('x'.repeat(121)), ValidationError);
assert.throws(() => parseNote('x'.repeat(601)), ValidationError);
console.log('ok  title and note validation');

// --- the 4096-character ceiling --------------------------------------------
const bigThumb = `data:image/jpeg;base64,${'A'.repeat(3000)}`;
const withThumb = { ...base, thumb: bigThumb, hasPhoto: true };
assert.ok(encodeItem(withThumb).length <= MAX_VALUE_CHARS, 'a normal item with a thumbnail fits');
assert.equal(decodeItem(key, encodeItem(withThumb)).thumb, bigThumb, 'thumbnail survives');

// A long note plus a thumbnail cannot both fit, so the thumbnail is dropped
// rather than losing the user's text.
const crowded = { ...base, note: 'n'.repeat(600), thumb: `data:image/jpeg;base64,${'A'.repeat(3900)}`, hasPhoto: true };
const crowdedJson = encodeItem(crowded);
assert.ok(crowdedJson.length <= MAX_VALUE_CHARS, 'result still fits the limit');
const crowdedBack = decodeItem(key, crowdedJson);
assert.equal(crowdedBack.thumb, null, 'thumbnail was shed to make room');
assert.equal(crowdedBack.note.length, 600, 'the note was kept intact');
assert.equal(crowdedBack.hasPhoto, true, 'the item still knows a photo exists on-device');
console.log('ok  oversized records shed the thumbnail, never the text');

// --- totals, sorting, search -----------------------------------------------
const items = [
  { ...base, id: 'a', title: 'Hulk 181', value: 100, createdAt: '2026-01-01T00:00:00.000Z' },
  { ...base, id: 'b', title: 'ASM 300', value: 300.25, createdAt: '2026-03-01T00:00:00.000Z' },
  { ...base, id: 'c', title: 'Topps Chrome box', value: 0, note: 'sealed', createdAt: '2026-02-01T00:00:00.000Z' }
];

assert.equal(totalValue(items), 400.25);
assert.equal(totalValue([]), 0, 'an empty collection totals zero, not NaN');
assert.deepEqual(filterSort(items, { sort: 'value' }).map(i => i.id), ['b', 'a', 'c']);
assert.deepEqual(filterSort(items, { sort: 'created' }).map(i => i.id), ['b', 'c', 'a'], 'newest first');
assert.deepEqual(filterSort(items, { sort: 'title' }).map(i => i.id), ['b', 'a', 'c']);
assert.deepEqual(filterSort(items, { search: 'hulk' }).map(i => i.id), ['a'], 'search ignores case');
assert.deepEqual(filterSort(items, { search: 'sealed' }).map(i => i.id), ['c'], 'search covers notes');
assert.deepEqual(filterSort(items, { search: 'zzz' }), []);
assert.equal(items[0].title, 'Hulk 181', 'filterSort must not reorder the caller\'s array');
console.log('ok  totals, sorting, and search');

// --- formatting -------------------------------------------------------------
assert.match(formatMoney(1250.5), /1,250\.5|1,250\.50|₪/, 'money renders with a currency');
assert.equal(typeof formatMoney(0), 'string');
console.log('ok  money formatting');

console.log('\nAll model tests passed.');
