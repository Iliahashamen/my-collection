import { ValidationError, filterSort, formatMoney, newItemId, parseNote, parseTitle, parseValue, totalValue } from './model.js';
import { deleteItem, getPhoto, isSynced, listItems, putPhoto, saveItem } from './store.js';

const tg = window.Telegram?.WebApp;

const state = {
  items: [],
  editing: null,
  pendingPhoto: null,
  pendingThumb: null,
  removePhoto: false
};

const el = id => document.getElementById(id);
const ui = {
  gate: el('gate'),
  gateMessage: el('gate-message'),
  app: el('app'),
  totalValue: el('total-value'),
  itemCount: el('item-count'),
  search: el('search'),
  sort: el('sort'),
  items: el('items'),
  empty: el('empty'),
  listError: el('list-error'),
  add: el('add'),
  editor: el('editor'),
  editorForm: el('editor-form'),
  editorTitle: el('editor-title'),
  editorError: el('editor-error'),
  photoInput: el('photo-input'),
  photoPreview: el('photo-preview'),
  photoPlaceholder: el('photo-placeholder'),
  photoNote: el('photo-note'),
  removePhoto: el('remove-photo'),
  fieldTitle: el('field-title'),
  fieldValue: el('field-value'),
  fieldNote: el('field-note'),
  save: el('save'),
  cancel: el('cancel'),
  delete: el('delete')
};

/* Shrinks a photo until its data URL fits one CloudStorage value, so a
   recognisable thumbnail reaches your other devices. */
async function makeThumbnail(file, maxChars = 3200) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  for (const [side, quality] of [[128, 0.6], [112, 0.55], [96, 0.5], [80, 0.45], [64, 0.4]]) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= maxChars) {
      bitmap.close?.();
      return dataUrl;
    }
  }

  bitmap.close?.();
  return null;
}

/** Keeps the on-device copy reasonable without throwing away detail. */
async function downscaleForDevice(file, maxSide = 1600, quality = 0.85) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

function placeholderPhoto() {
  const node = document.createElement('div');
  node.className = 'card-photo placeholder';
  node.textContent = 'NO IMAGE ON FILE';
  return node;
}

function render() {
  const visible = filterSort(state.items, { search: ui.search.value, sort: ui.sort.value });

  ui.itemCount.textContent = String(state.items.length);
  ui.totalValue.textContent = formatMoney(totalValue(state.items));
  ui.empty.hidden = state.items.length > 0;
  ui.items.textContent = '';

  for (const item of visible) {
    const card = document.createElement('article');
    card.className = 'card';
    card.addEventListener('click', () => openEditor(item));

    if (item.thumb) {
      const img = document.createElement('img');
      img.className = 'card-photo';
      img.alt = item.title;
      img.src = item.thumb;
      card.append(img);
    } else {
      card.append(placeholderPhoto());
    }

    const body = document.createElement('div');
    body.className = 'card-body';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = item.title;

    const value = document.createElement('div');
    value.className = 'card-value';
    value.textContent = formatMoney(item.value);

    body.append(title, value);
    card.append(body);
    ui.items.append(card);
  }
}

async function refresh() {
  ui.listError.hidden = true;
  try {
    state.items = await listItems();
    render();
  } catch (failure) {
    ui.listError.textContent = `Could not load your collection: ${failure.message}`;
    ui.listError.hidden = false;
  }
}

function setPhotoPreview(src) {
  if (src) {
    ui.photoPreview.src = src;
    ui.photoPreview.hidden = false;
    ui.photoPlaceholder.hidden = true;
  } else {
    ui.photoPreview.removeAttribute('src');
    ui.photoPreview.hidden = true;
    ui.photoPlaceholder.hidden = false;
  }
}

async function openEditor(item) {
  state.editing = item ?? null;
  state.pendingPhoto = null;
  state.pendingThumb = null;
  state.removePhoto = false;

  ui.editorTitle.textContent = item ? 'Amend asset record' : 'New asset record';
  ui.fieldTitle.value = item?.title ?? '';
  ui.fieldValue.value = item ? String(item.value) : '';
  ui.fieldNote.value = item?.note ?? '';
  ui.delete.hidden = !item;
  ui.removePhoto.hidden = !(item?.thumb || item?.hasPhoto);
  ui.editorError.hidden = true;
  ui.photoNote.hidden = true;
  ui.photoInput.value = '';

  setPhotoPreview(item?.thumb ?? null);
  ui.editor.hidden = false;
  tg?.BackButton?.show();

  if (!item?.hasPhoto) return;

  // Prefer the full image, which only exists on the device that added it.
  const blob = await getPhoto(item.id).catch(() => null);
  if (blob) {
    setPhotoPreview(URL.createObjectURL(blob));
  } else {
    ui.photoNote.textContent = 'Full photo is on the device where you added it. The thumbnail syncs everywhere.';
    ui.photoNote.hidden = false;
  }
}

function closeEditor() {
  ui.editor.hidden = true;
  state.editing = null;
  state.pendingPhoto = null;
  state.pendingThumb = null;
  tg?.BackButton?.hide();
}

async function submitEditor(event) {
  event.preventDefault();
  ui.editorError.hidden = true;
  ui.save.disabled = true;

  try {
    const now = new Date().toISOString();
    const editing = state.editing;

    const item = {
      id: editing?.id ?? newItemId(),
      title: parseTitle(ui.fieldTitle.value),
      note: parseNote(ui.fieldNote.value),
      value: parseValue(ui.fieldValue.value),
      thumb: editing?.thumb ?? null,
      hasPhoto: editing?.hasPhoto ?? false,
      createdAt: editing?.createdAt ?? now,
      updatedAt: now
    };

    if (state.pendingPhoto) {
      item.thumb = state.pendingThumb;
      item.hasPhoto = true;
    } else if (state.removePhoto) {
      item.thumb = null;
      item.hasPhoto = false;
    }

    await saveItem(item);
    if (state.pendingPhoto) await putPhoto(item.id, state.pendingPhoto);

    tg?.HapticFeedback?.notificationOccurred('success');
    closeEditor();
    await refresh();
  } catch (failure) {
    ui.editorError.textContent = failure instanceof ValidationError ? failure.message : `Could not save: ${failure.message}`;
    ui.editorError.hidden = false;
    tg?.HapticFeedback?.notificationOccurred('error');
  } finally {
    ui.save.disabled = false;
  }
}

function confirmDelete() {
  return new Promise(resolve => {
    if (tg?.showConfirm) tg.showConfirm('Delete this item permanently?', resolve);
    else resolve(window.confirm('Delete this item permanently?'));
  });
}

async function removeItem() {
  const editing = state.editing;
  if (!editing || !(await confirmDelete())) return;

  ui.delete.disabled = true;
  try {
    await deleteItem(editing.id);
    closeEditor();
    await refresh();
  } catch (failure) {
    ui.editorError.textContent = `Could not delete: ${failure.message}`;
    ui.editorError.hidden = false;
  } finally {
    ui.delete.disabled = false;
  }
}

ui.add.addEventListener('click', () => openEditor(null));
ui.cancel.addEventListener('click', closeEditor);
ui.editorForm.addEventListener('submit', submitEditor);
ui.delete.addEventListener('click', removeItem);

ui.photoInput.addEventListener('change', async () => {
  const file = ui.photoInput.files?.[0];
  if (!file) return;

  ui.save.disabled = true;
  ui.photoNote.textContent = 'Preparing photo...';
  ui.photoNote.hidden = false;
  try {
    state.pendingThumb = await makeThumbnail(file);
    state.pendingPhoto = await downscaleForDevice(file);
    state.removePhoto = false;
    ui.removePhoto.hidden = false;
    setPhotoPreview(URL.createObjectURL(state.pendingPhoto));
    ui.photoNote.hidden = Boolean(state.pendingThumb);
    if (!state.pendingThumb) ui.photoNote.textContent = 'This photo will stay on this device only.';
  } finally {
    ui.save.disabled = false;
  }
});

ui.removePhoto.addEventListener('click', () => {
  state.pendingPhoto = null;
  state.pendingThumb = null;
  state.removePhoto = true;
  ui.photoInput.value = '';
  ui.removePhoto.hidden = true;
  ui.photoNote.hidden = true;
  setPhotoPreview(null);
});

let searchTimer;
ui.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 200);
});
ui.sort.addEventListener('change', render);
tg?.BackButton?.onClick(closeEditor);

function start() {
  for (const node of document.querySelectorAll('.currency-label')) node.textContent = '₪';

  if (tg) {
    tg.ready();
    tg.expand();
  }

  const standalone = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!isSynced && !standalone) {
    ui.gateMessage.textContent = 'Open this from the Telegram bot so your collection can sync across your devices.';
    ui.gate.hidden = false;
    return;
  }

  ui.app.hidden = false;
  refresh();
}

start();
