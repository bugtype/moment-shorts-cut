# Cycle 13: retain inspector trim drafts until their context changes

Research and baseline checked on 2026-10-23 (UTC), before implementation.

## Evidence and policy

Typing inspector start `1.5`, then changing zoom, restores the field to `0.0` even though the user has not clicked Apply. `renderInspector` overwrites both trim fields on every refresh. The existing Apply button reads the fields and validates the interval; neither typing nor blur is meant to trim the project.

[MDN change events](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/change_event) distinguish field editing/commit events from per-keystroke input. Moment's explicit Apply workflow is stricter: blur alone is not a project command. The existing model remains authoritative for committed clip bounds, while the native inputs hold the uncommitted strings.

[Microsoft's Clipchamp video-player trim workflow](https://support.microsoft.com/en-us/clipchamp/stream-pages/how-to-trim-videos-in-microsoft-clipchamp-s-video-player) also separates editing start/end fields from explicitly saving them with a check mark. Its [full editor workflow](https://support.microsoft.com/en-us/clipchamp/how-to-trim-videos-images-or-audio-assets) instead uses handles on a selected clip. These are different interfaces; the relevant principle here is retaining a draft for the selected target until Moment's existing Apply action, not copying a new trimming UI.

## Plan and transitions

1. Cache only the identity/index and last committed bounds of the clip displayed by the inspector. Populate trim fields when that context changes; otherwise leave their strings and native focus alone. Do not store drafts in project JSON or introduce unsaved-state UI.
2. Preserve focused or blurred drafts through zoom/volume/appearance changes and non-timeline commands. For those commands, carry the displayed clip identity across the existing cloned project replacement. Never apply drafts implicitly.
3. Reset to committed bounds after successful Apply, selected-clip changes, split/delete/reorder, Undo/Redo, timeline replacement, template/project replacement or new media/reset. Repeated clips with equal bounds remain distinct by object identity and selected index. Invalid or blocked Apply retains its draft for correction.
4. Add application regressions for each transition, unchanged history on typing/refresh, successful correction and duplicate-clip cases. Keep existing interval validation and renderer lifecycle. Run the full automated suite and integration example; direct browser/focus/IME verification remains deferred.

## Result and verification

The inspector now populates its trim inputs only when the displayed clip reference, selected index or committed bounds change. Non-timeline commands carry that reference across their project clone. Draft strings stay in the existing native fields and are never written to history/project storage until Apply succeeds.

- The original failing application regression now preserves `1.50`/`3.50` while focused or blurred across zoom, volume, project appearance, title and caption changes. Clip bounds remain unchanged until Apply.
- Tests cover reversed-interval validation, export-busy rejection, correction, same-bounds Apply, Undo/Redo, leaving and returning to a clip, equal-bounds repeated clips, reorder/delete/split, same-bounds timeline replacement, failed/successful project import, template replacement and project reset. Different clips never inherit each other's draft.
- `npm test` passes syntax checks, the expanded application/event harness and all 40 Node tests. The integration example passes with `rendered: false`. No new controls, automatic trimming, dependencies or general state-management layer were introduced.
- Exact scope: persistent **inspector** trim inputs. Settings-panel fields still follow the existing panel rebuild lifecycle; this change does not introduce a cross-panel draft store. Real browser/native focus, number-input behavior, responsive layout and IME sessions remain unverified.

Next validation candidate: existing Apply handlers coerce an empty start string with unary `+`, turning it into zero. A separate fixture reproduced a 2–8 second clip becoming 0–6 after clearing start and entering end 6. This predates the draft-preservation fix; investigate explicit empty-number validation for both Apply entry points while retaining legitimate zero values.
