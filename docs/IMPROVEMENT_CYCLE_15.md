# Cycle 15: recover queued media writes after an earlier failure

Research and baseline checked on 2026-10-23 (UTC), before implementation.

## Evidence and lifecycle

A deterministic in-memory transaction fixture starts with `old.mp4`, queues a new video write, then queues an audio change using that same new video reference. The first transaction aborts with a synthetic quota error. The latest promise resolves, but persisted records contain **old video + new audio**. The queue computed the second write's changed keys before knowing whether the first write committed.

`persistMedia` assigns the latest promise to `pendingSave`. `saveProject` waits for that promise (and any newer one) before writing JSON to localStorage. Therefore a false-success latest media promise can let JSON describe the new video while IndexedDB retains the old file. `init` reads JSON and the two media records; it cannot repair this mismatch merely from the queue's status. Existing tests cover serial successful writes and retrying an observed failure, but not an already-queued partial update after failure.

- [MDN IndexedDB abort](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/abort_event) lists quota and I/O failures among abort causes.
- [MDN transaction complete](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event) identifies the commit boundary. Queuing a request is not a successful save.
- [Clipchamp media relinking](https://support.microsoft.com/en-us/clipchamp/why-do-i-need-to-locate-my-files) separates editable project continuity from the availability of cached media/original files. Moment must preserve local-first behavior and report storage failures honestly rather than add cloud storage.

## Plan

1. Track confirmed media values, not optimistic queued values. Inside each serialized queue operation, compare its requested video/audio pair against the last successful read/commit. Only mark changed values stored after transaction completion.
2. Preserve each failed caller's rejection. A later requested save may recover missing writes, including unchanged-looking video or deletion; latest failure must still reject. Keep successful audio-only changes from rewriting a large unchanged video. Retain the same database/schema/API.
3. Add isolated atomic transaction fixtures for abort/open failure, queued recovery, newer replacements, deletion, repeated identical requests and reload reads. Exercise the actual app save coordinator with injected fixture methods: JSON/status may report success only after the requested media pair commits; latest failure preserves the old JSON.
4. Run full tests and integration checks. No real browser storage, personal media or file selection is used. A new store instance over the fixture is a simulated reload, not proof of browser restart, eviction, crash durability or cross-store atomicity.

## Result and validation

The store now computes changed keys when each queued operation begins, after the previous operation settles. Its cache advances only on transaction completion. A later request therefore repairs failed video/audio writes or deletions, while the failed request still rejects. The API, database version and record keys are unchanged; successful audio-only updates still avoid rewriting the video.

- Before implementation, three new regression tests failed against the existing store (queued partial recovery, identical-request recovery and deletion recovery). All pass after the change.
- `npm test`: syntax checks, the app/DOM harness and all 44 Node tests pass. Fault fixtures cover transaction aborts, connection errors, replacement/deletion, identical requests, latest failure, retry, ordered writes and simulated reload. The app coordinator test checks media records, project JSON and visible save status together.
- `node examples/use-editor-service.mjs` passes; it reports `rendered: false` and does not encode a video.
- Direct browser restart, native quota failure, storage eviction, media playback and crash durability remain untested. The fixtures model atomic transaction commit/abort, not the full IndexedDB implementation.

## Remaining product priorities

1. **Recovery consistency:** project JSON and media are still in different storage systems. If media commits and the subsequent localStorage write fails, they can diverge; this change does not provide cross-store atomicity. Reproduce that boundary separately before selecting a backward-compatible recovery design. Missing-media startup also currently falls back to the sample, so preserving recoverable edits deserves investigation.
2. **Actual output quality:** encoded video cadence, audio synchronization and player compatibility remain the highest runtime-validation gap. Mocked tests and render plans cannot close it.
3. **End-to-end editing usability:** resume desktop/narrow-screen caption-review and trim/export checks when direct browser testing is available. Avoid further speculative UI changes without that evidence.
