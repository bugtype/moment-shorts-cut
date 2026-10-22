# Cycle 1: selection-aware properties

Research and plan: 2026-10-22 UTC, before implementation.

## Evidence

- [Descript properties panel](https://help.descript.com/descript-tour/properties-panel): property controls follow the selected content. This suggests grouping controls by the object being edited.
- [Descript layer and clip workflow](https://help.descript.com/visuals/working-with-layers-and-clips-overview): select a layer, then adjust it in the editor/timeline.
- [CapCut split scene workflow](https://www.capcut.com/tools/split-scene): place the playhead, split, then refine individual segments. The selected segment should lead directly to its editing controls.

These are documented workflows, not hands-on competitor tests. Pages accessed 2026-10-22 UTC.

Moment's live desktop UI displays frame settings, clip trimming, caption styles and a template promotion together. Clip selection updates values but leaves its controls below unrelated settings. At widths below 981px the existing settings panel provides the equivalent trim/frame controls.

## Chosen change

Use mutually exclusive, keyboard-operable disclosure sections in the existing inspector. Open clip properties on timeline selection or splitting, caption styles when entering captions, and frame settings when entering Screen. Keep each section manually accessible. Remove the template promotion, SHORTS badge and duplicate drag hint from the inspector. Keep all control names, validation and existing editing commands.

Visual direction: retain the restrained light editor, existing type and accent; separate property groups with spacing and thin rules. Keep the preview as the main visual anchor. Use native disclosure behavior without new animation or dependencies.

## Validation plan

Run the complete existing suite plus selection/disclosure regression checks. In a task-owned Chrome tab, verify manual disclosure by keyboard, clip split/select/trim/undo, caption style and ratio changes. Check desktop, tablet and phone sizes, including the existing narrow-screen settings fallback. Review the diff for unrelated files and secrets, push one commit to unprotected master, then verify the remote SHA and CI.

Next research candidate: bring existing caption rows above generation/import tools, then investigate caption-to-timeline navigation with cuts, repeated clips and speed changes.

## Results

Validated on 2026-10-22 UTC with Chrome 156.0.8078.47 on macOS, using only the built-in sample in a dedicated QA tab.

- Desktop 1440×1000: Enter and Space toggle the native disclosure; only one property section stays open. Space on a disclosure does not start playback. The existing global playback shortcut initially intercepted Space; the handler now leaves summary elements to the browser.
- Split at 5 seconds opens clip 2 with start 5/end 12. Trimming start to 6 and undoing restores 5; selecting clip 1 shows start 0/end 5. Caption track selection opens caption styles; Minimal applies. Screen opens frame controls; 1:1 updates the preview.
- Tablet 900×1000 and phone 390×844: the existing Screen panel still exposes trim, volume and ratio controls. Trim/apply/undo were exercised at both sizes. Document width matched viewport width at each size (no horizontal overflow).
- `npm test`: syntax checks, editor regression harness including new selection/keyboard checks, and all 16 Node tests pass. `node examples/use-editor-service.mjs` passes. No dependencies added.
- [Desktop evidence](inspector-desktop.png): clip 2 selected with its controls grouped beside the preview.

The responsive fallback remains the existing Screen panel; this cycle does not introduce a new mobile inspector. Native disclosure behavior was tested in Chrome only. Safari/Firefox, mobile hardware, microphone, speech inference and media encoding were not re-tested for this UI-only change.
