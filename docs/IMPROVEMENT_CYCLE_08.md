# Cycle 8: focusing an input must not consume redo

Research and baseline checked on 2026-10-23 (UTC), before implementation.

## Evidence and comparison

Chrome 156 reproduction: change zoom 100% → 101%, Undo, open the title editor, then focus the first title field and move the caret with ArrowRight without typing. Redo still looks enabled, but clicking it leaves zoom at 100%. Repeating the sequence with the first title color well, Escape and unchanged `#ffffff` has the same result. Both paths call `snapshot` on focus, clearing `future` before any edit; the button UI is stale because focus does not refresh it.

- [MDN color input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/color) distinguishes live `input` updates from `change` when the picker is dismissed. Picker presentation varies by browser/platform; focus or closing without a value change is not an edit.
- [MDN input event](https://developer.mozilla.org/en-US/docs/Web/API/Element/input_event) documents value-change events for text inputs and textareas.
- [MDN compositionend](https://developer.mozilla.org/en-US/docs/Web/API/Element/compositionend_event) covers both IME completion and cancellation. A cancelled pre-edit buffer must not become a saved project change.

## Plan

1. Extend and rename the existing range history binder for native continuous inputs. Replace focus snapshots in design and effects text/color/textarea controls with a first-actual-change snapshot. Keep existing discrete validation and preview rendering.
2. Group text typing until blur; retain range gesture boundaries. Color input/change should preview and finalize one picker edit, with an unchanged selection leaving history alone. Avoid interfering with native keys, focus, selection or picker UI.
3. Do not commit transient IME composition values to project history; apply the completed value once, and leave cancelled unchanged compositions alone. Verify final-value handling, undo/redo and interleaved controls through event fixtures and real desktop/narrow text flows. Disclose any native picker/IME automation limitations instead of synthesizing browser events through hidden runtime access.

## Result and verification

The range binder is now `createInputHistory`, shared by the existing range, text, textarea and color controls. Focus no longer creates a snapshot. Text previews update during ordinary typing and commit IME text after composition ends; the native input retains its pre-edit buffer and caret throughout. Blur ends a typing group. Color input previews share one history entry, and change handles the final value before ending the group. Unchanged color controls compare their native displayed value so a browser's fallback for an authored alpha color cannot overwrite it merely on dismissal.

- Syntax checks, the full UI/event harness and all 30 Node tests pass. The editor-service example passes and reports `rendered: false`.
- Mounted title controls were exercised against the actual project history: focus/blur and unchanged color dismissal retain Redo; Redo restores zoom 101%; grouped Korean text edits undo to the original title and redo to the final title. Existing range gesture, discrete validation and export-guard regressions pass.
- Event fixtures cover unchanged color selection/cancellation, multiple preview events, a final change without a preceding input, reopening the picker, text/textarea grouping, Unicode/newlines, IME cancellation/completion and duplicate final input events. They also protect an authored `#RRGGBBAA` value when a native color input displays a fallback.
- The baseline defect was reproduced in Chrome 156 before implementation. **Post-change desktop/narrow browser QA, the native OS color picker and real IME sessions were not completed.** Event fixtures validate application handlers, not browser/platform event delivery or layout. No post-change UI pass is claimed. No private media, restricted file selection, model download, microphone or encoding was exercised.

Next priority is completing native text/color/IME verification when that surface is available. Separately, the existing inspector and screen-panel copies of zoom can display different values until the panel rerenders; inspect synchronization before adding more controls.
