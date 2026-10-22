# Cycle 4: restore keyboard button activation

Research and baseline checked on 2026-10-22 (UTC), before implementation.

## Evidence and decision

- [Clipchamp keyboard shortcuts](https://support.microsoft.com/en-us/clipchamp/keyboard-shortcuts-for-clipchamp) documents Space for play/pause. [Its accessible player workflow](https://support.microsoft.com/en-us/accessibility/clipchamp/use-a-screen-reader-to-play-videos-in-microsoft-clipchamp) also uses Tab to focus Mute and Space to activate it. These are different contexts, not a reason for every Space press to control playback.
- The [W3C button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) specifies both Enter and Space activation when a button is focused.
- Actual Moment baseline in Chrome: Space on `+ 직접 추가` leaves three captions and starts playback. Space on `안전 영역` leaves it off and starts playback. The document keydown handler prevents native button activation, except for the caption timeline buttons special-cased in cycle 3.
- Reverse caption-row navigation remains useful to investigate, but repeated source occurrences need a deliberate selection model. The reproducible keyboard failure takes priority over adding another control.

## Plan

1. Replace the caption-specific Space exception with the native button boundary. Let existing click handlers and the browser handle button activation; keep Space playback on non-control surfaces. Do not alter other keyboard shortcuts or add UI labels.
2. Check all keyboard handlers and button markup. Add regression coverage for buttons while paused/playing, existing form/disclosure guards, non-control Space, arrows and undo. No caption mapping or persisted schema changes are needed.
3. Verify real Space/Enter behavior on add/delete, navigation, mute, safety guide and transport controls, plus text entry and responsive keyboard flows. Run the full suite, review the diff, push and check the exact remote commit and CI.

Scope excludes new reverse-navigation controls, new shortcut mappings, dependencies, uploads and media processing.

## Result and verification

The Space guard now recognizes every native button, replacing the caption-only exception. Existing click handlers activate once through the browser. Other shortcut branches, form/disclosure guards and caption mapping are unchanged.

- `npm test`: syntax checks, UI/event regressions and all 18 Node tests pass. Added assertions cover paused/playing control isolation, non-control Space, text cursor arrows, timeline arrows and undo from a button.
- Chrome 156.0.8078.47 on macOS, task-owned tab using the built-in sample: Space adds a fourth caption and focuses its textarea; Space deletes it again without starting playback. Space switches audio/caption panels, toggles safety guide and mute, and starts/stops playback from the play button. Space in the caption list region still controls playback. Enter add/delete and spaces typed into a caption work normally.
- Checked 1440×1000, 900×1000 and 390×844. At the two narrow sizes, keyboard add/delete retain visible focus and no horizontal document overflow. Shift+Tab from the new textarea reaches its delete button. [Desktop evidence](keyboard-controls-desktop.png) shows the safety guide toggled through Space while playback stays paused.
- No console errors observed. Diff reviewed for unrelated changes and secrets; no dependencies or extra UI labels added.

Limits: tested native keyboard behavior in Chrome, not a screen reader or other browser engine. No file upload, microphone, transcription model or encoded output was exercised.

Next research priority: preview navigation from a caption row when its source occurs more than once, without seeking unexpectedly during text entry.
