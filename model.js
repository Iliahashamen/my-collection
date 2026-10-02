/**
 * Pure data logic, free of browser APIs so it can be unit tested in Node.
 *
 * Items live in Telegram CloudStorage, which allows at most 1024 keys per user
 * and 4096 characters per value. Every record therefore has to fit in one
 * value, and field names are kept to one letter to leave room for a thumbnail.
 */

export const CURRENCY = 'ILS';
export const MAX_VALUE_CHARS = 4096;
export const MAX_ITEMS = 1000;
export const ITEM_KEY_PREFIX = 'i_';

const MAX_TITLE = 120;
const MAX_NOTE = 600;

export class ValidationError extends Error {}

export function newItemId() {
  // CloudStorage keys allow A-Z a-z 0-9 _ - only, so stick to base36.
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}${random}`;
}

export function itemKey(id) {
  return `${ITEM_KEY_PREFIX}${id}`;
}

export function isItemKey(key) {
  return typeof key === 'string' && key.startsWith(ITEM_KEY_PREFIX);
}

export function idFromKey(key) {
  return key.slice(ITEM_KEY_PREFIX.length);
}

export function parseTitle(raw) {
  const title = (raw ?? '').toString().trim();
  if (!title) throw new ValidationError('A title is required.');
  if (title.length > MAX_TITLE) throw new ValidationError(`Title is too long (max ${MAX_TITLE} characters).`);
  return title;
}

export function parseNote(raw) {
  const note = (raw ?? '').toString().trim();
  if (note.length > MAX_NOTE) throw new ValidationError(`Note is too long (max ${MAX_NOTE} characters).`);
  return note;
}

export function parseValue(raw) {
  if (raw === null || raw === undefined || `${raw}`.trim() === '') return 0;
  // Accepts "1,250.50" and "1 250,50" as typed on a phone keyboard.
  const normalised = raw.toString().trim().replace(/\s/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
  const value = Number(normalised);
  if (!Number.isFinite(value)) throw new ValidationError(`"${raw}" is not a number.`);
  if (value < 0) throw new ValidationError('Value cannot be negative.');
  if (value > 1e12) throw new ValidationError('Value is unrealistically large.');
  return Math.round(value * 100) / 100;
}

function serialise(item) {
  const record = { t: item.title, v: item.value, c: item.createdAt, u: item.updatedAt };
  if (item.note) record.n = item.note;
  if (item.thumb) record.h = item.thumb;
  if (item.hasPhoto) record.p = 1;
  return record;
}

/**
 * Encodes an item into a single CloudStorage value, shedding the thumbnail if
 * that is the only way to fit. Text is never silently truncated.
 */
export function encodeItem(item) {
  let json = JSON.stringify(serialise(item));
  if (json.length <= MAX_VALUE_CHARS) return json;

  if (item.thumb) {
    json = JSON.stringify(serialise({ ...item, thumb: null }));
    if (json.length <= MAX_VALUE_CHARS) return json;
  }
  throw new ValidationError('This item is too long to save. Shorten the notes.');
}

export function decodeItem(key, json) {
  const record = JSON.parse(json);
  return {
    id: idFromKey(key),
    title: record.t ?? '(untitled)',
    note: record.n ?? '',
    value: typeof record.v === 'number' ? record.v : 0,
    thumb: record.h ?? null,
    hasPhoto: record.p === 1,
    createdAt: record.c ?? null,
    updatedAt: record.u ?? record.c ?? null
  };
}

export function totalValue(items) {
  return Math.round(items.reduce((sum, item) => sum + (item.value || 0), 0) * 100) / 100;
}

export function filterSort(items, { search = '', sort = 'created' } = {}) {
  const needle = search.trim().toLowerCase();
  const matched = needle
    ? items.filter(item => `${item.title} ${item.note}`.toLowerCase().includes(needle))
    : [...items];

  const compare = {
    value: (a, b) => b.value - a.value,
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    created: (a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`)
  };

  return matched.sort(compare[sort] ?? compare.created);
}

export function formatMoney(amount, currency = CURRENCY) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}
