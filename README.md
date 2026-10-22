# VKB Forever

An independent web companion for the **Yamaha VKB-100**, with a new interface and no original application artwork, audio, layouts, or bundled song/preset content.

**App:** https://al-255.github.io/vkb-forever/

## Features

- Direct Bluetooth LE MIDI through Web Bluetooth, plus Web MIDI for OS-paired Bluetooth or USB MIDI ports.
- Firmware/readiness exchange, DH session, instrument metadata, encrypted singer availability and activation requests.
- Vocal editing: all 20 parameters in each of four banks, including both 162-byte performance skills.
- Instrument editing: 13 instruments, six parameters in each of four banks.
- Full sound transfers to current buffers or any of 20 vocal / 20 instrument memory slots; optional individual live edits after applying a current sound.
- Lyric editing in kana or dictionary romaji, with a 489-row ordered syllable dictionary, phoneme preview, phrase boundaries, key-off pronunciation, cursor selection, inclusive loops, and acknowledged uploads to current or 20 stored lyric slots.
- Browser-local drafts and libraries, save/update/rename/duplicate/delete/reorder, search, validated JSON workspace import/export, and separate received device data.
- Ten global settings, keyboard rename, and exportable MIDI/BLE diagnostics.

**Physical keyboard validation is outstanding.** Tests establish protocol vectors and simulated behavior, not successful communication with a real VKB-100. In particular, firmware acceptance of the session, singer activation, timing, and power-cycle persistence still need hardware testing. See [the validation guide](docs/hardware-validation.md).

## Run locally

Node.js 22 or newer; CI uses Node.js 24.

```sh
npm ci
npm test
npm run dev
```

Open **http://localhost:4173**. `PORT=8080 npm run dev` selects another port. The app has **no runtime npm dependencies**; Happy DOM is used only for tests. `npm run build` copies the static app into `dist/`.

The application requires HTTPS or localhost for device APIs. Opening `index.html` through `file://` is not supported. No backend, account, telemetry, or external font/CDN requests are used. Local storage is specific to the browser and origin; export a backup before clearing site data or moving browsers.

## Connect

1. Turn on the keyboard, enable Bluetooth MIDI, and close other apps using it.
2. In a supported Chrome/Edge installation, click **Connect keyboard**, select the VKB-100, and wait for **Ready**.
3. If direct Bluetooth is unavailable, pair MIDI through the operating system and choose matching input/output ports under **Keyboard & settings → Choose OS MIDI ports**. A MIDI interface exposed by the OS can also be used.
4. Edit locally, then use **Send to keyboard**. The destination dialog distinguishes the temporary current buffer from numbered slots that will be overwritten.

Web Bluetooth support varies by browser and OS. Chrome's [official platform/permission guide](https://developer.chrome.com/docs/capabilities/bluetooth) documents secure contexts, device-chooser gestures, and Linux's experimental-feature requirement. The app detects missing APIs and offers the OS MIDI route.

Sound writes have no documented acknowledgement; “sent” reports transport completion. Lyric writes wait for an ACK at the destination's address. A timeout leaves the final device state unknown. Readback never silently replaces a local draft. Current/slot reads are limited to data received in a documented instrument dump; arbitrary parameter requests are deliberately not invented.

## GitHub Pages

[The workflow](.github/workflows/pages.yml) tests and builds pull requests, and tests, builds, and deploys `main` to GitHub Pages. In repository **Settings → Pages**, the source must be **GitHub Actions** (already configured for this repository when implementation began). All app paths are relative, including the data requests, so project Pages paths work.

## Implementation

| Module | Responsibility |
| --- | --- |
| `public/js/protocol.js` | MIDI stream assembly, Yamaha frames, u7 integers, pack7, parameter codecs |
| `public/js/transport.js` | Web Bluetooth, BLE-MIDI timestamps/fragmentation, Web MIDI, serialized and paced writes, disconnect cancellation |
| `public/js/session.js` | DH arithmetic and independent DES-CBC implementation for the device's singer messages |
| `public/js/device.js` | Version/session/dump coordination, metadata registry, request matching/timeouts, lyric ACKs |
| `public/js/sound.js` | Ordered memory transfers and canonical singer identity → runtime registry mapping |
| `public/js/lyrics.js` | Ordered dictionary parser, explicit kana mappings, display/phoneme serialization and readback |
| `public/js/store.js` | Local workspace and bounded import validation |
| `public/js/app.js` | New editor UI and application workflows |

`npm test` includes independent DES known-answer/OpenSSL comparisons, documented VKB encryption vectors, all parameter boundaries, lyric bytes, BLE fragmentation, full simulated startup/availability, ACK/disconnect/timeout scenarios, and DOM integration tests covering editors, libraries, uploads, and position controls. DOM tests do not verify rendered appearance or browser device permissions.

## Reference boundary

The local `~/github/vkb_disasm` repository was used only as a low-level interoperability reference. [Provenance](docs/reference-boundary.md) records the revision, files consulted, and transformation of functional data. The original application implementation, UI, branding assets, layouts, artwork, audio, and bundled lyrics/presets are not included. All default drafts are newly created.

This project is independent of Yamaha and the voice library owners. Existing repository license: [GPL-2.0](LICENSE).
