# Cycle 2: captions first

Research and plan: 2026-10-22 UTC, before implementation.

## Evidence and comparison

[Clipchamp's official autocaptions workflow](https://support.microsoft.com/en-us/clipchamp/how-to-use-autocaptions-in-clipchamp) separates transcription setup from the resulting editable transcript. Once generated, the transcript and timestamps are available in the captions panel for correction and SRT download. This is a documented workflow comparison, not a hands-on Clipchamp test. Accessed 2026-10-22 UTC.

In Moment's current live Chrome UI at 1359×689, the first existing caption begins at y=801, below the viewport. Language, source, generation, import, splitting, styling and explanation text all precede the editable rows. The project already has three captions, but none can be edited without scrolling.

## Chosen change

- Put the caption heading, add/save actions and existing rows first. Give the list a bounded scrolling region so setup remains reachable with long transcripts.
- Group automatic generation and SRT import in a native disclosure. Open it for an empty project or active transcription; preserve network/model/180-second notices and cancellation access.
- Group splitting, appearance and time-base guidance in a secondary disclosure. Keep per-row time bases and estimated-timing warnings.
- Extract the caption rendering branch into a readable function without changing subtitle timing or navigation semantics. Keep keyboard focus useful after adding/deleting rows.

Visual direction: retain the current editor; use order, spacing and native disclosure rather than new helper labels or badges. No new dependencies, cloud processing or animations.

## Validation plan

Check existing and empty captions, add/delete-last, SRT import, split warnings, running/cancelled generation UI with simulated media APIs (no model download), keyboard disclosure/focus and desktop/tablet/phone layouts. Run the entire suite and integration example, inspect the diff, push one commit, and verify remote SHA and CI.

Next candidate: select a caption from the timeline and seek/focus the corresponding editable row, accounting for source versus timeline clocks, cuts, repeated clips and playback speed.

## Results

Validated 2026-10-22 UTC with Chrome 156.0.8078.47 on macOS, using only built-in sample media and synthetic caption text.

- At the same 1359×689 viewport, the first caption now starts at y=190 instead of y=801. The creation and additional-tool disclosures remain reachable beneath a bounded list. [Desktop screenshot](captions-desktop.png).
- Actual browser checks: existing captions, keyboard text editing, adding a row and focusing it, deleting rows and keeping focus, deleting the last row (creation opens and focus returns to Add), Space/Enter disclosures, no-audio generation feedback, long-caption splitting and its estimated-timing warnings. Undo restored the sample captions.
- Tablet 900×1000 and phone 390×844: no horizontal overflow; the bounded list scrolls and add/delete focus works. The phone layout retains the editor above the caption workspace.
- The regression harness covers successful SRT import and focus, plus active generation, panel switching, retained status/notices, cancellation and unchanged captions. Audio APIs are simulated; no speech model is downloaded. Real browser SRT file selection was not verified in this cycle.
- `npm test` and the integration example pass. No dependencies or caption navigation/timing semantics changed.

Safari/Firefox, mobile hardware, live speech recognition and encoding were not re-tested. The disclosure UI and live status are browser-checked or regression-tested as described above; these checks do not establish speech-recognition quality.
