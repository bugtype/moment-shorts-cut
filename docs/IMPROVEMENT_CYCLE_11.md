# Cycle 11: validate SRT millisecond precision

Research and baseline checked on 2026-10-23 (UTC), before implementation.

## Evidence and policy

The [Library of Congress SRT description](https://www.loc.gov/preservation/digital/formats/fdd/fdd000569.shtml) specifies hours, minutes, seconds and milliseconds in cue timestamps. The project's existing serializer rounds each timestamp to milliseconds; its importer rejects equal start/end times.

Reproduction is not limited to a tiny authored interval: a caption from 1.999 to 4 seconds, clipped by a video ending at 2 seconds and played at 4× speed, exports as `00:00:00,500 --> 00:00:00,500`. A 1 ms source caption at 4× also collapses. Both are valid project edits but cannot be represented by the current SRT rounding policy. Neighboring cues and original project times must not move to hide this limitation.

## Plan

1. Compare the actual formatted start/end timestamps in the shared SRT serializer. Reject a collapsed cue with an actionable typed error naming its output position. Keep existing rounding for representable cues; do not impose an arbitrary minimum source duration, expand cues or drop them.
2. Reuse the existing browser/service/MCP/CLI error handling from cycle 10. Verify project/history and destination files remain unchanged, and that correcting timing or speed restores export.
3. Test tiny intervals, trimming a normal speech caption to a short tail, source/narration clocks, repeated clips, rounding boundaries and successful ordinary speed/trim output. Run the full suite and integration example. No browser/CUA or external-player validation is available.
4. After this bounded export fix, reassess common editing workflows against official Clipchamp and Descript documentation before selecting further work. Prioritize frequently used controls and existing defects over additional speculative format edge cases.

## Result and verification

The serializer compares the same formatted timestamps that it writes and returns `INVALID_ARGUMENT` if they coincide. The error identifies the output cue and asks for a timing or speed adjustment. No project mutation or duration repair occurs; existing caller error handling needed no change.

- The new rejection regression failed before the fix. Tests now cover a 1 ms source cue at 4×, a normal speech cue trimmed to its last millisecond, narration and repeated/reordered clips. Representable submillisecond intervals remain accepted; adjacent cues, minute rollover and ordinary trim/speed output retain existing rounding.
- Service/MCP tests preserve exact project JSON and verify recovery after changing speed. Actual CLI file tests preserve both input JSON and existing SRT, and create no missing destination on failure. Application-handler fixtures verify the displayed error, zero downloads, unchanged state/history, speed correction and Undo.
- `npm test` passes syntax checks, the application harness and all 40 Node tests. The integration example passes with `rendered: false`. Direct browser, native picker/IME, external-player and encoded-video validation remain unperformed.

## Product priorities after the export fixes

Official workflows reviewed on 2026-10-23:

- [Clipchamp autocaptions](https://support.microsoft.com/en-us/clipchamp/how-to-use-autocaptions-in-clipchamp) puts transcript correction, timestamp navigation, preview and SRT download in one editing flow. Moment already has captions-first editing, timeline-to-row navigation and shared export; an additional transcript navigation control would need usability evidence, especially for repeated clips. Do not add it solely for feature parity.
- [Descript properties](https://help.descript.com/descript-tour/properties-panel) updates controls with the selected scene or layer. Moment's contextual inspector is closer to that pattern, but its duplicated screen controls are not consistently synchronized.

Recommended next target: synchronize existing zoom/volume controls without rebuilding a focused panel. A temporary Node application-handler probe reproduced the model and inspector at zoom 1.75/volume 0.35 while the already-open settings copies remained 1/1. The fixture's initial native values were seeded from the panel's markup because it does not parse input values from HTML; this confirms handler behavior, not visual/browser behavior. This common editing discrepancy is a stronger next priority than more speculative SRT cases. Test both directions and external commands/Undo while preserving native focus and gesture grouping before implementation. Native text/color/IME QA remains a separate deferred gap; no new controls, cloud transcription or broad redesign is proposed.
