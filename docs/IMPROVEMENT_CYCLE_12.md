# Cycle 12: synchronize existing zoom and volume controls

Research and baseline checked on 2026-10-23 (UTC), before implementation.

## Evidence and comparison

With the screen/settings panel open, changing inspector zoom to 1.75 and volume to 0.35 updates the model and inspector but leaves the settings copies at 1/1. The cycle 11 Node application-handler probe reproduced this discrepancy; this cycle adds a failing regression before changing production code.

- [MDN input value](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/value) documents updating an existing input through its value property.
- [MDN input events](https://developer.mozilla.org/en-US/docs/Web/API/Element/input_event) states that assigning a value programmatically does not fire an input event. Mirroring model values therefore does not require synthetic events or additional history entries.
- [Descript properties panel](https://help.descript.com/descript-tour/properties-panel) updates controls for the selected scene or layer. Moment already has contextual controls; keeping their existing copies consistent is more useful here than adding another indicator or state layer.

The live inspector and settings handlers both mutate `state`, then call `renderInspector`. `changed`, Undo/Redo, resets and command commits also use that renderer. Settings markup initializes from `state` when opened. `commitCommandProject` and Undo already rebuild panels for whole-state changes; this fix need not replace those broader lifecycle semantics. The discrepancy occurs during live updates that correctly avoid rebuilding the focused panel.

## Plan

1. In the existing inspector renderer, synchronize only the present settings zoom/volume inputs from `state`, assigning a value only when different. Do not rebuild nodes, bind handlers again, dispatch events, take snapshots or touch pending trim fields.
2. Exercise both directions, grouped keyboard/pointer input, no-op updates, focus/node identity, pending settings edits, selected clip/playhead, Undo/Redo, programmatic updates, resets/import fixtures and absent panels. Keep the existing model and history binder.
3. Run full automated tests and the integration example. Use the established DOM/event fixtures, explicitly distinguishing handler verification from real browser focus/gesture/IME behavior. No browser/CUA, file-selection retry, new dependency or permission request.

## Result and verification

The inspector renderer now updates the two optional settings range inputs from the existing project state only when their values differ. It does not replace nodes or alter event/history bindings. This fixes live inspector-to-settings divergence; the existing settings-to-inspector path continues to work.

- The new application regression failed before the production change with inspector/model zoom 1.75 and settings zoom 1. It passes after the fix in both zoom and volume directions.
- Fixtures verify keyboard and pointer grouping, unchanged handler/node focus references and panel markup during live updates, pending **settings-panel** trim values, selected clip/playhead, no redundant mirror assignments, no-op Redo preservation, Undo/Redo, commands, position reset, project import/reset and missing settings inputs.
- Whole-state commands/import/Undo retain their existing panel rebuild behavior. The tests verify resulting values there; they do not claim focused DOM nodes survive an intentional whole-panel rebuild. Initial native input values are seeded in the lightweight fixture, and reopened panel markup is checked independently.
- `npm test` passes syntax checks, the expanded application/event harness and all 40 Node tests. The integration example passes with `rendered: false`. No browser focus, native pointer capture, responsive layout or real IME session was tested; those runtime checks remain deferred.

Next concrete candidate: the existing inspector renderer also overwrites its own uncommitted trim fields during unrelated zoom/volume refreshes. A separate handler probe reproduced typed start `1.5` becoming `0.0` after changing zoom while the model clip start remained 0. This predates the mirror fix and is separate from the settings-panel draft fields protected here. Investigate a small draft-preservation policy tied to selected clip/model changes rather than a broad state-management rewrite.
