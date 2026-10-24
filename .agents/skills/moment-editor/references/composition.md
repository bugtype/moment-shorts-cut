# Composition workflows

**Read this reference only for effects, timed cards, template interchange or graphics-text review.**

Use the essential boundaries in [SKILL.md](../SKILL.md). If needed, consult shared
[file/session setup](project-editing.md#discover-and-inspect),
[saving](project-editing.md#apply-a-small-change-preview-and-save),
[time coordinates](project-editing.md#time-coordinate-example),
[replacement warnings](project-editing.md#replacement-operations-and-styles) or
[recovery](project-editing.md#recover-without-losing-work); do not load unrelated references.

| Task | Section |
|---|---|
| Adjust video effects without changing content | [Open](#adjust-video-effects-without-changing-content) |
| Edit an existing timed card by ID | [Open](#edit-an-existing-timed-card-by-id) |
| Build a hook, tip and CTA with individual cards | [Open](#build-a-hook-tip-and-cta-with-individual-cards) |
| Share one browser custom template | [Open](#share-one-browser-custom-template) |
| Transfer a browser custom-template collection | [Open](#transfer-a-browser-custom-template-collection) |
| Capture the current composition as a portable template | [Open](#capture-the-current-composition-as-a-portable-template) |
| Apply a supplied template document | [Open](#apply-a-supplied-template-document) |
| Review saved graphics text | [Open](#review-saved-graphics-text) |

## Adjust video effects without changing content

Use `effects.update` for brightness/contrast and other existing video effects,
rather than applying a template or importing a reconstructed project:

```sh
node cli/moment.mjs exec effects.update --project edited.moment.json --json '{"patch":{"brightness":1.1,"contrast":1.05}}' --dry-run
node cli/moment.mjs exec effects.update --project edited.moment.json --json '{"patch":{"brightness":1.1,"contrast":1.05}}' --out effects-edited.moment.json
```

MCP `moment_effects_update` takes
`{"projectId":"session","patch":{"brightness":1.1,"contrast":1.05}}`.
Only supplied effects fields change. Clips, speed, captions, cards, titles, audio
and their times remain unchanged. See the [field/default tables](../../../../docs/MCP.md#adjust-video-effects-independently)
or live schema; there is no reset command, so explicitly supply only the defaults
you intend to restore. Empty patches are accepted with the standard
`{updated:true, outputDuration}` acknowledgment, not no-op detection.

Black/white boundary effects are overlays, not crossfades; their effective
duration is capped at half the clip’s output duration. Motion is a zoom multiplier
on existing framing. Neither changes the clip sequence or subtitle timing. Save
the returned project via a separate read; CLI/MCP do not encode video, and plain
SRT/VTT do not preserve these effects.

## Edit an existing timed card by ID

Read `project.get` / `moment_project_get` and select the intended entry from
`project.overlays`. CLI `overlays.update` and MCP `moment_overlays_update` require
`id` and `patch`; never use an array index or invented ID as the card ID.
The [runnable CLI example](../../../../INTEGRATIONS.md#실제-카드-id를-조회하는-cli-예제)
creates recipe cards and builds an argument file from an actual returned ID.
For MCP with the selected `card`, arguments are
`{projectId:"session", id:card.id, patch:{text:"준비부터 시작해요"}}`.

Use the [field table](../../../../docs/MCP.md#edit-an-existing-timed-card) or live
schema for wording, styling and timing. Missing IDs return `NOT_FOUND`; the tool
does not create, delete, reorder or rename IDs. Other cards and project content
remain intact. Empty patches are accepted with `{updated:true, outputDuration}`.

`start`/`end` use output seconds after speed. If either is supplied, the resulting
interval must satisfy `0 <= start < end <= outputDuration`; it has no fixed
86,400-second cap. Text-only edits do not automatically clamp stored out-of-range
card times. Active headlines can hide the base title, with the last active
headline winning; do not confuse that visibility with deletion. Size/stroke are
canvas-relative with fitting and safe bounds, not fixed output pixels.

For appearance-only reuse, select just `color`, `accent`, `background`, `size`,
`stroke`, `backgroundOpacity`, `presentation` and `animation` from the source card
and send them as the target’s `overlays.update` patch. Do not copy its full object:
position/width, role/kind/enabled, text/detail/label, times and ID must remain intact.
The browser’s copy/paste action follows this same eight-field contract, keeps a
snapshot only in editor memory (not OS clipboard/storage), and pastes changes as one
undo step. An identical style is a no-op. Editing/removing the source does not alter that snapshot. CLI/MCP cannot
access the browser’s copied snapshot; read the project and construct the patch.

## Build a hook, tip and CTA with individual cards

Use `overlays.add` / `moment_overlays_add` with a stable caller-chosen `id` and
`patch` requiring `text`, `start` and `end`. Read the current project first to check
IDs and output duration. The [scripted-card example](../../../../INTEGRATIONS.md#스크립트에-맞춰-카드-추가삭제)
creates three sequential cards without replacing the project. Times are output
seconds **after speed** and must satisfy `0 <= start < end <= outputDuration`.

Add appends existing new-card defaults plus supplied styling fields. IDs must be
nonblank and at most 2,000 UTF-16 code units; duplicates fail with `INVALID_ARGUMENT`,
not upsert. The 12-card limit includes disabled cards. Remove one using
`overlays.remove` / `moment_overlays_remove` and its exact nonempty ID; even a
legacy whitespace-only ID is matched exactly. A missing ID returns `NOT_FOUND`.

Both return `{updated:true, outputDuration, id}`. Save the project with a separate
read. If a response is lost, check the live project for your ID before retrying;
do not create a fresh ID blindly. Separate calls commit independently; use
`project.batch` when these supported edits must validate and commit together.
Other cards/order and unrelated content remain unchanged. Appended overlapping
headlines take precedence and can hide the base title; avoid accidental overlaps.

To change stacking, read the current `project.overlays` and call `overlays.move`
(or `moment_overlays_move`) with `{id, toIndex}`. `toIndex` is the zero-based final
position, `0` at the back and the last index at the front, including disabled cards.
Only card order changes: overlapping free cards draw in array order and only the
last active headline is shown. This cannot reorder cards relative to captions or
other renderer layers. Same-index moves return `updated:false` without a commit;
otherwise the acknowledgment is `{updated:true, id, toIndex, outputDuration}`.
A missing ID is `NOT_FOUND`; an invalid index is `INVALID_ARGUMENT`. After a lost
response, re-read IDs/order before retrying. See the [CLI example](../../../../INTEGRATIONS.md#카드-쌓임-순서-변경).


## Share one browser custom template

Use the gallery’s import button or an individual custom card’s export action,
not MCP `moment_project_import`. A template file is
`{format:"moment-template", formatVersion:1, template:{...}}`, not a
`moment-project` document. The browser accepts UTF-8 JSON up to 256 KiB including
an optional leading BOM and validates format, version and nested template styles.

Import adds a new unique-ID copy under `내 템플릿` to the current library (maximum
20). It does not overwrite existing templates, change favorites, apply the
template or modify the current project. Preview the imported template and choose
style-only versus example-content application deliberately. Failed reads,
validation, capacity checks or saves leave the existing library/project intact.
The latest file-selection request wins; capacity is checked again after reading.

Review title, credit, timed-card text, global keywords and speaker labels before
sharing: they travel with saved styles even though video/audio do not. This is
not a whole-library or project backup. CLI/MCP cannot list or persist that browser
library, but can apply an exported document as described below. Never use a file
path as a template ID.

The browser also renames an existing custom template from its card. Use the
current-name dialog; names are trimmed, nonblank and limited to 40 UTF-16 code
units. Identical names are a no-op without a write; duplicate names on different
IDs remain allowed. Renaming preserves the ID, favorites, settings, cards, timing
and current project, and works at the 20-template capacity. It affects gallery
search and subsequent export filenames, not an already-exported file.
Cancel, a deleted target, a blocked library recovery state or a write failure
preserves the original library. A write failure leaves the dialog open to retry.
This is browser-library management, not a new CLI/MCP rename tool.

To replace a saved custom template’s composition, use **Update from current composition** on its browser gallery card
and explicitly confirm **Update**. It captures the current project **at confirmation**,
replacing saved styling/settings, title/credit/card content and relative timing while
retaining ID, name, category, descriptive metadata and favorites. It works at the 20-entry capacity without
creating a copy. The current project, media and other projects are not changed or
reapplied. Export the old template first if it must be retained; no version history
is created. Cancellation or failed validation/storage preserves the original;
failed storage allows retry. The replacement is validated against the strict portable
template schema and 256 KiB limit before saving; a deleted target is not recreated.
This is not a CLI/MCP browser-library operation and
is distinct from applying an exported template document to a project.

## Transfer a browser custom-template collection

Use **Export my template collection** and the gallery’s existing import action to transfer all saved
custom templates in their current order. A `moment-template-collection` version-1
file contains 0–20 individual `moment-template` documents, not a project document.
The collection is limited to 6 MiB of pretty UTF-8 JSON; each entry retains its
256 KiB validation. Duplicate IDs within the collection are rejected.

Import appends fresh-ID copies under `내 템플릿`, never overwrites or applies them. The combined
library must pass its existing validation and 20-entry capacity; individually
valid entries do not guarantee a valid combined library. Failure leaves the
library/project unchanged rather than importing a subset. An empty collection
is a no-write no-op; empty-library export is disabled.

Favorites, built-in templates, UI preferences, project and media are excluded:
this is not a full library restore. Review all saved wording before sharing.
There is no collection CLI/MCP command, and `template.apply.document` still takes
one individual template document. The optional pure JavaScript helpers validate
objects only; they do not access browser storage or allocate imported IDs.
[Exact wrapper and executable helper example](../../../../INTEGRATIONS.md#사용자-템플릿-컬렉션)

## Capture the current composition as a portable template

Use read-only `template.export` / `moment_template_export` with required `id` and
`name` (MCP also needs `projectId:"session"`). ID is a nonblank string up to 200
UTF-16 code units, preserved exactly and not a built-in ID. Name is at most 40 code
units before trimming and must remain nonblank. Save result `data` as the existing
`moment-template` version-1 document, not the response envelope; maximum 256 KiB.

It captures visual style, title/credit/card content and relative output timing,
not dialogue captions, clips or media. Existing capture clips cards to the output
range, drops outside cards and orders by start; null title/credit ends remain null.
Review text, global keywords and speaker labels before sharing. No project/library
write, history or batch operation occurs. A template is not a project backup.
Use `template.apply.document` to apply it, not `project.import`.
[Runnable CLI/service recipes and complete limits](../../../../docs/MCP.md#export-the-current-composition-as-a-template)
show separate protected output paths and the required apply-arguments wrapper.

## Apply a supplied template document

Use CLI `template.apply.document` or MCP `moment_template_apply_document` for an
exported custom template. Pass the full `moment-template` envelope as `document`,
not the inner template, file path or a project document. MCP arguments are
`{projectId:"session", document, withContent:false}` when `document` holds the
parsed template. See the [runnable CLI wrapper](../../../../INTEGRATIONS.md#내보낸-템플릿을-climcp로-적용):
`--args-file` needs `{document, withContent}`, not the bare exported template file.

Default `withContent:false` preserves title lines, credit text, existing cards and
dialogue captions, but applies visual settings, title/credit timing, effects,
global keywords and speaker labels/colors. Use `true` only when template title,
credit and cards should replace authored content; dialogue captions remain.
Relative title/credit timing and normalized card timing follow existing template
semantics; do not retime them a second time.

Version, known-field, nested-style and 256 KiB pretty-JSON checks precede mutation.
Success returns `{updated:true, outputDuration}`; retrieve the project to save it.
The applied ID becomes `templateId`, with no new ID or browser-library entry.
This metadata edit neither reads files nor imports or encodes media.

## Review saved graphics text

Browser **Project files → Graphics text (.txt)** downloads
`project-name.graphics.txt`: title lines, credit and card label/text/detail in saved
card order, including disabled/out-of-range layers. It includes enabled flags,
raw output-time endpoints (null stays null), and card role/kind; at most 14 text
layers plus the report header. Headings follow UI locale, authored text/line breaks
stay untouched. UTF-8 has no BOM; exported NUL text is rejected, not stripped.

This is human review, not rendered visibility, countdown-number generation, a
transcript, import format or project backup. Captions, media names/paths, card IDs
and full styles are absent. Caption TXT is unchanged; edited review text is not
automatically applied. Preserve project JSON for restoration. There is no new
CLI/MCP command: use `project.get` for the full metadata document, or the optional
[`projectGraphicsText` JavaScript helper](../../../../INTEGRATIONS.md#그래픽-문구-검토용-txt)
for this report. Never mistake the helper's demo example for the user's project.
