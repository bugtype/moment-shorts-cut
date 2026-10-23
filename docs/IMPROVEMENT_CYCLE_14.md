# Cycle 14: distinguish empty trim inputs from zero

Research and baseline checked on 2026-10-23 (UTC), before implementation.

## Evidence and plan

Both inspector and settings Apply handlers use unary `+` on number-input strings. Clearing the start field therefore turns it into zero: a 2–8 second clip becomes 0–6 when the empty start and end 6 are applied. The shared `trim` function already rejects nonfinite numbers, reversed/out-of-bounds intervals and durations below 0.1 seconds; the handlers bypass that protection by supplying a valid-looking zero.

- [MDN valueAsNumber](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/valueAsNumber) returns a number or `NaN` when conversion is impossible, including a deleted numeric value.
- [MDN number inputs](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/number) distinguishes empty and invalid native input states from numeric values. Native input validity alone does not replace the application's interval checks.

1. Read `valueAsNumber` in both existing Apply handlers. Reuse `trim` validation/error handling without a parser helper, fallback zero, new UI or changed timing policy.
2. Reproduce the old failure, then cover empty/whitespace/invalid/nonfinite states on either side, legitimate zero, decimals, bounds and minimum duration. Verify failed drafts, project/history and Redo survive; successful correction is undoable. Preserve the typed command API's existing rejection of strings/nonfinite values.
3. Run full automated checks and integration examples. The DOM fixture models numeric getter results only for these fields; it does not validate real browser sanitization, locale entry, IME or native UI. Direct browser/CUA remains unperformed.
4. Reassess product-level priorities after this fix instead of continuing indefinitely through adjacent numeric edge cases.

## Result and verification

Only the two Apply handlers changed in production: they now pass native numeric values to the existing validator. Empty/invalid values reach it as nonfinite values instead of zero. No parsing framework, new validation UI or change to interval bounds/minimum duration was introduced.

- The pre-fix regression demonstrated a blank start changing the clip and consuming Redo. Both Apply paths now preserve the full project, Undo/Redo and draft strings on failure.
- Fixtures cover empty and whitespace strings, invalid text, native `NaN`, nonfinite/overflow values, negative/out-of-bounds/reversed/too-short intervals, valid zero, decimal endpoints, minimum 0.1-second duration, correction and Undo. Typed command callers still reject strings and nonfinite numeric arguments.
- `npm test` passes syntax checks, the expanded application/event harness and all 40 Node tests. The integration example passes with `rendered: false`.
- Native numeric parsing is provided by the browser; the test getter is deliberately limited and does not establish locale/IME/sanitization behavior across browsers. Direct browser/CUA, real IME and responsive interaction verification remain unperformed.

## Ranked product-level reassessment

This ranking is a recommendation based on current code/docs and official workflows, not evidence of new defects.

1. **Trust the finished video.** Video export is the product's main deliverable. The repository's earlier browser QA reports about 21.7 fps for one nominal 30 fps MP4 sample, and recent changes lack fresh runtime verification. [Clipchamp's export workflow](https://support.microsoft.com/en-us/clipchamp/exporting-and-saving-a-video-in-clipchamp) centers on obtaining the finished file. Highest-value evidence is a repeatable synthetic edit→export→decode/playback check, including caption timing and audio sync at useful durations. That runtime work remains deferred; do not infer codec quality from mock tests or start an encoder rewrite without measurements.
2. **Recover an editing session reliably.** [Clipchamp autosave](https://support.microsoft.com/en-us/clipchamp/saving-a-video-while-working-on-it), [media relinking](https://support.microsoft.com/en-us/clipchamp/why-do-i-need-to-locate-my-files) and [Descript version history](https://help.descript.com/working-in-projects/version-history) make continuity a first-class workflow. Moment has local state/media storage, JSON backup and relink checks; no cloud feature is required. The strongest next permitted code investigation is the complete state/media save→reload→relink lifecycle under interrupted/failed writes and stale queued changes. Existing storage retry tests are a starting point, not proof of every cross-store recovery case. Reproduce before fixing; do not assume data loss from architecture alone.
3. **Complete common editing tasks with confidence.** [Clipchamp transcript editing](https://support.microsoft.com/en-us/clipchamp/how-to-use-autocaptions-in-clipchamp) connects text correction, timestamps, preview and export. Moment now has useful caption navigation and corrected control behavior. Evaluate a whole keyboard/narrow-screen caption-review-and-trim task when runtime validation is available, then remove specific friction through layout and existing controls. Do not add navigation buttons, labels or more templates merely for parity.

Pause the automatic search for tiny adjacent numeric/SRT cases. Prefer the bounded storage-lifecycle investigation while browser work remains deferred, with product runtime verification retained as the highest-impact outstanding evidence gap.
