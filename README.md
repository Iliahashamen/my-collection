# My Collection

A private Telegram Mini App for tracking a personal collection: each item is a
photo, a title, notes, and a value, with a running total.

Open it from the Telegram bot, on a phone or a PC.

## Where the data lives

There is no server and no database. Nothing here holds a password or an API key,
which is why this repository is safe to be public.

- **Item text, value, and a small thumbnail** go to [Telegram
  CloudStorage](https://core.telegram.org/bots/webapps#cloudstorage), which
  Telegram keeps against your own Telegram account. It syncs between your
  devices automatically, and the author of this app cannot read it.
- **The full-resolution photo** is kept in IndexedDB on the device that added
  it. A CloudStorage value is capped at 4096 characters, which cannot hold a
  real photo, so full images stay local while thumbnails travel.

Because storage is tied to your Telegram account, anyone else who opens this
link sees only their own empty collection. Privacy does not depend on the link
staying secret.

## Limits worth knowing

- Up to 1000 items (Telegram allows 1024 CloudStorage keys per user).
- One item's text plus thumbnail must fit 4096 characters. If notes are long,
  the thumbnail is dropped rather than truncating what you wrote; the full photo
  is still kept on the device.
- Clearing browser storage on a device removes that device's full photos.
  Thumbnails and all text survive, since they live with Telegram.

## Files

```
index.html    markup
styles.css    styling, themed from Telegram's colours
model.js      pure data logic: validation, encoding, totals, search
store.js      CloudStorage for text, IndexedDB for photos
app.js        UI wiring
test/         Node tests for model.js
```

## Development

```powershell
node test/model.test.mjs          # data logic, no browser needed
python -m http.server 8080        # then open http://localhost:8080
```

Outside Telegram the app falls back to `localStorage`, so the interface can be
worked on in a normal browser.
