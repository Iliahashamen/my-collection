/**
 * Storage layer. Three tiers, each for a different reason:
 *
 * - Item text and a small thumbnail go to Telegram CloudStorage, which is held
 *   on Telegram's servers against your own Telegram account. It syncs between
 *   phone and PC, and no server of ours ever sees it.
 * - A medium-resolution photo also goes to CloudStorage, split across numbered
 *   keys, because one value caps out at 4096 characters. This is what makes
 *   pictures appear on your other device.
 * - The full-resolution original stays in IndexedDB on the device that added
 *   it, so the device that took the photo keeps every pixel.
 */
import {
  ITEM_KEY_PREFIX,
  decodeItem,
  encodeItem,
  isItemKey,
  isPhotoKey,
  itemKey,
  joinPhoto,
  photoChunkKey,
  photoIdFromKey,
  sortChunkKeys,
  splitPhoto
} from './model.js';

const cloud = window.Telegram?.WebApp?.CloudStorage;

/** Dev fallback so the UI can be worked on in a plain browser. */
const localBackend = {
  getKeys: async () => Object.keys(localStorage).filter(key => isItemKey(key) || isPhotoKey(key)),
  getItems: async keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])),
  setItem: async (key, value) => localStorage.setItem(key, value),
  removeItem: async key => localStorage.removeItem(key)
};

const promisify = method => (...args) =>
  new Promise((resolve, reject) => {
    method(...args, (error, result) => (error ? reject(new Error(String(error))) : resolve(result)));
  });

const cloudBackend = cloud && {
  getKeys: promisify(cloud.getKeys.bind(cloud)),
  getItems: promisify(cloud.getItems.bind(cloud)),
  setItem: promisify(cloud.setItem.bind(cloud)),
  removeItem: promisify(cloud.removeItem.bind(cloud))
};

const backend = cloudBackend ?? localBackend;
export const isSynced = Boolean(cloudBackend);

export async function listItems() {
  const keys = (await backend.getKeys()).filter(isItemKey);
  if (keys.length === 0) return [];

  const raw = await backend.getItems(keys);
  const items = [];
  for (const key of keys) {
    const json = raw[key];
    if (!json) continue;
    try {
      items.push(decodeItem(key, json));
    } catch {
      // One corrupt record must not blank the whole collection.
    }
  }
  return items;
}

export async function saveItem(item) {
  await backend.setItem(itemKey(item.id), encodeItem(item));
}

export async function deleteItem(id) {
  await backend.removeItem(itemKey(id));
  await Promise.all([deletePhoto(id), deleteSyncPhoto(id)]);
}

/* ---- medium-resolution photo, synced through CloudStorage ---- */

/** Writes the chunks and returns how many there are, for the item record. */
export async function putSyncPhoto(id, dataUrl) {
  const chunks = splitPhoto(dataUrl);
  // Sequential on purpose: CloudStorage rejects a burst of parallel writes.
  for (const [index, chunk] of chunks.entries()) {
    await backend.setItem(photoChunkKey(id, index), chunk);
  }
  return chunks.length;
}

export async function getSyncPhoto(id, chunkCount) {
  if (!chunkCount) return null;
  const keys = Array.from({ length: chunkCount }, (_, index) => photoChunkKey(id, index));
  const raw = await backend.getItems(keys);
  return joinPhoto(keys.map(key => raw[key]));
}

export async function deleteSyncPhoto(id) {
  try {
    const keys = (await backend.getKeys()).filter(key => isPhotoKey(key) && photoIdFromKey(key) === id);
    for (const key of sortChunkKeys(keys)) await backend.removeItem(key);
  } catch {
    // Orphan chunks waste a little quota but must not block the delete.
  }
}

/* ---- full-resolution photos, local to this device ---- */

const DB_NAME = 'collection-photos';
const STORE = 'photos';
let dbPromise;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withStore(mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = work(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function putPhoto(id, blob) {
  return withStore('readwrite', store => store.put(blob, id));
}

export function getPhoto(id) {
  return withStore('readonly', store => store.get(id));
}

export function deletePhoto(id) {
  return withStore('readwrite', store => store.delete(id)).catch(() => undefined);
}

export { ITEM_KEY_PREFIX };
