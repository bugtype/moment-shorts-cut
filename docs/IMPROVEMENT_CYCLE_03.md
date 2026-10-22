# Cycle 3: caption timeline navigation

Research and baseline checked on 2026-10-22 (UTC), before implementation.

## Evidence and comparison

- [Clipchamp autocaptions](https://support.microsoft.com/en-us/clipchamp/how-to-use-autocaptions-in-clipchamp) documents using the transcript to navigate to a timestamp, alongside editable text.
- [Descript timeline overview](https://help.descript.com/timeline/timeline-overview) connects script editing with timing and audio alignment in the timeline.
- In Moment's built-in sample, clicking the final caption opens the captions panel but leaves the playhead at zero and focus on the timeline button. The user still has to locate the matching row and preview time.
- The existing projection clips source captions against every edited clip, including repeated and reordered clips. Narration captions use the edited timeline once. Export applies playback speed. The projection currently discards the originating row, so matching by text or projected time would be ambiguous.

## Plan

1. Retain the originating caption index in a shared occurrence projection. Keep the existing export API's start/end/text shape unchanged. Rebuild row references on every edit, deletion, import and undo; do not introduce a project schema migration.
2. Activate a timeline caption to pause, seek to that occurrence's clipped start in the pre-speed edited clock, reveal the captions panel and focus its text field. Preserve blank-track behavior and the recording/export boundaries. Use native button activation for Enter and Space, with accessible names distinguishing duplicate text.
3. Test trimmed/removed spans, repeated/reordered clips, narration, speed, overlaps and duplicate text, plus deletion/undo and unchanged history. Check the built-in sample in a task-owned Chrome tab at desktop and narrow sizes. Do not add helper labels or dependencies.

Scope excludes reverse row-to-timeline navigation, overlapping-caption display changes, media upload, transcription/model downloads and encoding changes.

## Result and verification

Timeline buttons now carry their projected start and originating row index. Selecting one pauses playback, seeks to that occurrence and focuses the matching textarea. Native focus brings the row into view, including on narrow screens. The visible layout and captions remain unchanged; accessible button names include the row and output time. Export still returns only start/end/text.

- `npm test`: syntax checks, the UI/event regression harness and all 18 Node tests pass. New checks cover clipped/removed captions, repeated/reordered source clips, narration appearing once, overlaps, duplicate text, 0.5×/2× speed, export shape, deletion/undo identity, focus, unchanged project/history and recording/export guards.
- `node examples/use-editor-service.mjs`: passes; the example explicitly reports no rendered media.
- Chrome 156.0.8078.47 on macOS, task-owned local preview tab: click, Enter and Space seek and focus; playing preview pauses; a split caption's second occurrence seeks to 5 seconds while editing row 2. At 2× the final caption seeks to edited time 8/output time 4; after clip reordering it seeks to edited time 3/output time 1.5. Deletion and undo restore the correct row mapping.
- Checked 1440×1000, 900×1000 and 390×844. Focused text is visible and no horizontal document overflow occurs at the two narrow sizes. No browser console errors were observed. [Desktop evidence](caption-navigation-desktop.png).
- `git diff --check` passes. Reviewed the diff for unrelated files and secrets. No dependencies, project migration or user media are included. Master protection and rulesets were rechecked before push: unprotected, no rulesets.

Limits: repeated clips and narration were tested with synthetic automated fixtures; live-browser QA used the built-in sample. No file upload, microphone, speech model or encoded output was exercised. Existing overlap rendering still chooses the first active caption; every timeline occurrence remains keyboard reachable.

Next research direction: the reverse journey from an edited caption row to its preview, with an explicit choice when a source caption occurs in multiple clips.
