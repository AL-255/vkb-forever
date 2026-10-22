# Interoperability reference boundary

Reference: `/home/yukidama/github/vkb_disasm`, revision `6403052ad62852d2159d9e623ba608d5a3259c76` (2026-10-22).

The reference was read as a device interaction specification and, at the user's later request, for the original gray palette and singer theme color values. No original Android Java, native implementation, resource layout, artwork, sample audio, Realm database, preset record, or bundled lyric/song content was copied into this project. The interface, keyboard logo, navigation, layout, visual elements, and browser implementation were written anew.

## Consulted low-level material

- `docs/device-interaction.md`: command checklist and evidence limits.
- `docs/protocol.md`: Yamaha framing, transport identifiers, send pacing, startup, settings, sound memories, lyric transfer, DH/DES, singer commands, and rename packet.
- `docs/sound.md`: parameter order/defaults/codecs, current-copy versus stored-upload sequences, title bytes, and runtime singer indexing.
- `docs/lyrics.md`: ordered parsing, explicit character mappings, token and key-off behavior, three-string payload, loops, readback, and acknowledgement address.
- `docs/native.md`: DH formatting, DES high-bit parity transformation, time-derived padding, and synthetic encryption vectors.
- `docs/singer-commands.md`: encrypted availability/activation prefixes, response records, and result codes.
- `docs/vectors/lyrics.json`: low-level decode examples and evidence limits.
- `AGENTS.md`: reference repository handoff and device-only scope.

Only functional facts from these catalogs were transformed into browser data:

| Reference input | Application data | Retained facts |
| --- | --- | --- |
| `docs/catalog/parameters.json` | `public/data/parameters.json` | 116 identifiers, addresses, banks, bounds, defaults, widths, codec identities, parameter terminology and choice values |
| `docs/catalog/syllables.csv` | `public/data/lyrics.json` | 489 ordered text→phoneme rules, including duplicate-key precedence |
| `docs/catalog/text-mappings.csv` | `public/data/lyrics.json` | Explicit kana conversions and display bytes |
| `docs/catalog/skills.json` | `public/data/skills.json` | Four opaque 162-byte device performance-skill payloads |

The sound catalog was inspected to establish the 13 instrument choices, singer identity prefixes, and singer-to-color mapping. Its asset identifiers, vendor descriptions, artwork/audio references, and product IDs were not retained. UI global labels and boolean choices are supplied by the new application.

At the user's explicit request, color values were read from `analysis/jadx/resources/res/values/colors.xml` and used in the new stylesheet and `public/js/theme.js`:

| Theme | Accent | Background |
| --- | --- | --- |
| VY1 | `#fb6d6d` | `#fdece7` |
| Hatsune Miku | `#29c8c8` | `#dcf3ef` |
| Megpoid | `#3ecd54` | `#d8fbce` |
| IA | `#d06d6d` | `#fae7e7` |
| Yuzuki Yukari | `#9c66d6` | `#f2e4f7` |

The neutral base uses the reference's dark gray `#505050`, gray `#818181`, light gray `#f0f0f0`, and white `#fefefe`, with additional neutral shades for borders and readable secondary text. Theme colors are scoped to the vocal editor and follow the canonical singer identity stored in its draft, independently of the device's registry ordering. Exact accents and background tints are retained; text shades are darkened where needed to achieve readable contrast. No original color XML, layout, or logo asset is included.

The functional data can be regenerated with:

```sh
python3 scripts/reference-data.py ~/github/vkb_disasm
```

The application does not load the reference at runtime. All algorithms are new JavaScript implementations of the documented wire rules. Tests use synthetic, newly written lyrics and presets. Browser APIs and local storage replace Android transport and database behavior. Original app lifecycle bugs, stale timers, partial malformed parsers, and UI state quirks are not deliberately reproduced.

## External primary references

- [Chrome Web Bluetooth guide](https://developer.chrome.com/docs/capabilities/bluetooth): browser/platform requirements, secure context, gestures and GATT lifecycle.
- [Android BLE-MIDI packet encoder](https://android.googlesource.com/platform/frameworks/base/+/6a61268/media/packages/BluetoothMidiService/src/com/android/bluetoothmidiservice/BluetoothPacketEncoder.java): timestamp and SysEx continuation conventions.
- [Android BLE-MIDI packet decoder](https://android.googlesource.com/platform/frameworks/base/+/master/media/packages/BluetoothMidiService/src/com/android/bluetoothmidiservice/BluetoothPacketDecoder.java): timestamp/status distinction and continuation behavior; this app uses packet-local running status as required by the transport specification.
- [Windows MIDI BLE transport architecture](https://microsoft.github.io/MIDI/kb/ble-midi-transport-architecture/): packet boundaries and continuation framing.
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages): artifact deployment, Pages permissions, and environment configuration.

No source establishes successful device operation in this browser implementation. That boundary remains explicit until tested with a physical keyboard.
