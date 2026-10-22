# Physical VKB-100 validation

The automated tests and DOM integration suite pass against protocol facts and a simulated keyboard. No real keyboard or browser UI was available in the implementation environment. Complete these checks before relying on the app during a performance.

1. Open the HTTPS Pages URL in a supported browser. Connect directly over BLE. Verify notifications start and the journal records both BLE packets and assembled MIDI messages.
2. Verify the empty change at `0F 00 04`, firmware response at `0F 00 11`, DH at `01 00 00`, then dump request at `0F 00 00`. Confirm the metadata begin/end markers, runtime singer ordering, and encrypted availability reply.
3. Save existing keyboard content elsewhere before writing test slots. Start with the current buffer and a reversible parameter change. Apply a full voice and a full instrument, then verify all four banks and live edits on the keyboard.
4. Confirm sounds produce the expected current-copy sequence (84 vocal / 28 instrument messages), and stored uploads produce 82 / 26 messages without a current-buffer preparation/bank-selection command. Check numbered slot persistence after a power cycle.
5. Upload a newly written short lyric to current. Verify kana, romaji, voiced kana, two phrases, `_` pronunciation, matching slot ACK, syllable cursor, and an inclusive loop. Repeat in one explicitly chosen scratch lyric slot and power-cycle to check persistence.
6. Test direct BLE fragmentation with a larger lyric and both 162-byte skills. Test disconnecting mid-transfer and reconnecting. The application must stop queued writes, disable live edits, and require a new session.
7. Test ACK timeout and delayed ACK behavior. ACKs carry no transaction identifier, so a sufficiently late response to the same address cannot be distinguished from a new request by the protocol alone. Inspect final keyboard state before retrying an ambiguous write.
8. Repeat the core sequence over an OS-exposed Bluetooth MIDI port and any supported USB interface. Verify browser SysEx permission and correct input/output pairing.
9. Verify individual global settings and device rename, including whether a power cycle is required. Availability/activation acceptance, battery errors, unsolicited messages, and firmware-dependent limits need device observations.
10. Check the interface at desktop and mobile sizes in a real browser, with keyboard focus navigation. Confirm local save/reload, backup import/export, unsupported browser messaging, and device chooser cancellation.

Export the connection journal alongside each result. Logs include raw traffic, which can contain lyric text and titles. They do not include the derived session key. Record firmware, browser/OS version, transport, exact action, and observed keyboard behavior. Do not treat transport completion as proof of stored sound state; sound uploads have no documented ACK.
