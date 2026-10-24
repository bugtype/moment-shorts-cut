# Project editing workflows

**Inspect the supplied document, preview the requested edit, then save a separate result. MCP changes remain in memory until your client saves them.**

**Jump to:** [CLI basics](#apply-a-small-change-preview-and-save) ·
[Command catalog](../../../../INTEGRATIONS.md#명령-v1) · [Clocks](#time-coordinate-example) ·
[Recovery](#recover-without-losing-work)

| Workflow | Start here |
|---|---|
| Captions | [Inspect timing density](#inspect-caption-timing-density) · [Import](#import-srtvtt-without-constructing-cue-arrays) · [Edit one cue](#edit-one-authored-caption) · [Text correction](#correct-repeated-caption-text) · [Split](#split-one-caption-at-the-caret-boundary) · [Merge](#merge-adjacent-authored-captions) · [Timing](#shift-a-constant-subtitle-delay) · [Style](#adjust-shared-caption-styling) |
| Timeline | [Split/repeat a clip](#split-a-clip-without-rebuilding-the-timeline) |
| Composition | [Effects](#adjust-video-effects-without-changing-content) · [Existing cards](#edit-an-existing-timed-card-by-id) · [Scripted cards/stacking](#build-a-hook-tip-and-cta-with-individual-cards) · [Credit](../../../../docs/MCP.md#set-a-source-credit-independently) |
| Grouped/template edits | [One commit](#apply-related-edits-together) · [Browser template sharing](#share-one-browser-custom-template) · [Apply a supplied template](#apply-a-supplied-template-document) |

## Interface language and authored content

The browser offers `ko`, `en` and `zh-CN`; its saved choice takes priority over a
supported browser language, then Korean. If storage fails, the current-session
choice can still change. This is not a project edit or an MCP setting.

Do not translate a user's captions, project name, title, credit, speaker labels or
custom templates just because the UI language changed. Built-in display labels
are localized, while existing Korean examples remain authored content. Choose ASR
language independently. API command names, IDs, field names, enums, error codes
and paths stay unchanged. Use canonical IDs, not translated labels.

## Discover and inspect

Run commands from the repository root with Node.js 20+. No package installation is required.

```sh
node cli/moment.mjs commands
node cli/moment.mjs exec project.get --project supplied.moment.json
node cli/moment.mjs exec templates.list
```

For MCP, use `tools/list`, then `moment_project_import` with `projectId: "session"` and the supplied `document`. `moment_project_get` returns the full editing document in `structuredContent.data`. Do not pass a file path as `document` or use a file path as `projectId`.

The file envelope is `{format:"moment-project", formatVersion:1, project:{...}}`. The nested project's current `schemaVersion` is 4. Import the full envelope, not only its `project` field. Reject unsupported versions rather than replacing fields with guessed defaults. The CLI `init` command is the supported way to create a valid demo document.

## Apply a small change, preview and save

```sh
node cli/moment.mjs exec project.update --project supplied.moment.json --json '{"patch":{"name":"수정한 쇼츠"}}' --dry-run
node cli/moment.mjs exec project.update --project supplied.moment.json --json '{"patch":{"name":"수정한 쇼츠"}}' --out edited.moment.json
node cli/moment.mjs exec captions.export --project edited.moment.json --out edited.srt
node cli/moment.mjs exec captions.export --project edited.moment.json --json '{"format":"vtt"}' --out edited.vtt
node cli/moment.mjs exec captions.export --project edited.moment.json --json '{"format":"txt"}' --out edited.txt
```

These examples use POSIX quoting. For other shells or complex text, use a UTF-8 arguments file with `--args-file args.json` instead of `--json`.

| CLI result | Where to look | File effect |
|---|---|---|
| Success, exit 0 | stdout JSON | `--out` names the saved output |
| Failure, exit 1 | stderr JSON | Inspect the error; do not assume a file was created |
| `exec --dry-run` | `preview` field | Proposed document/read result only; no file write |

**Existing outputs are protected.** Do not add `--overwrite` merely to make a failed command pass.

Equivalent MCP tool arguments for a rename are:

```json
{"projectId":"session","patch":{"name":"수정한 쇼츠"}}
```

Call `moment_project_update` and check both `isError === false` and `structuredContent.ok === true` before continuing.

| Artifact | Retrieve with | Save this field |
|---|---|---|
| Edited project JSON | `moment_project_get` | `structuredContent.data` |
| SRT/VTT/TXT text | `moment_captions_export` | `structuredContent.data.text` |

For VTT, call `moment_captions_export` with `{"projectId":"session","format":"vtt"}`. Omitting `format` preserves SRT; an output filename does not select the format. Save only the returned text as UTF-8.

Do not save the JSON-RPC envelope, text-content wrapper or mutation acknowledgment as a project document.

Project-settings files must fit **10 MiB (10,485,760 UTF-8 bytes)** for saving and
restoring. Pretty JSON overhead and its final newline count. Oversized settings
output is refused before writing/downloading, not truncated; existing files remain
intact. CLI `init`, mutation `--out` and `project.get --out` enforce it; stdout and
render plans do not. `--dry-run` is an in-memory preview, not a file-size preflight,
even when `--out` is supplied. This is not a new project-state schema limit.
`project.get` can represent larger valid state, but that does not make it restorable
through built-in files or fit a whole 10 MiB MCP input frame. Preserve the original;
do not silently discard captions to force a backup under the limit.

## Apply related edits together

Use `project.batch` / `moment_project_batch` for 1–20 supported mutations that must
validate together. Pass `operations:[{command, arguments}, ...]`, with the exact
individual command inputs. MCP `projectId:"session"` belongs only to the outer call.
Inspect the live allowlist: project import, read/export commands, provider jobs
and nested batches are excluded. Later steps use earlier prepared edits, so derive
indexes and times from that evolving state, not blindly from the original.

All steps validate before one service commit; an invalid step leaves the project
unchanged. The result is `{updated, operationCount, outputDuration}`, not per-step
results; no result-reference syntax exists. All no-op operations skip commit, but
an empty patch is not necessarily a no-op under an individual command’s contract.
Save with a separate project read. This is not JSON-RPC batching, an external
storage transaction or protection from other writers. After uncertain commit or
lost response, inspect current state before retrying non-idempotent edits. See the
[CLI preview and failure example](../../../../INTEGRATIONS.md#여러-편집을-한-번에-반영).

## Split a clip without rebuilding the timeline

Inspect the current `clips` array first. `timeline.split` takes a zero-based
`clipIndex` and `sourceTime` in **original source seconds**, not edited or output
time. This complete CLI example uses the known 12-second demo:

```sh
node cli/moment.mjs init --out split-source.json
node cli/moment.mjs exec project.get --project split-source.json
node cli/moment.mjs exec timeline.split --project split-source.json --json '{"clipIndex":0,"sourceTime":6}' --out split.json
```

Equivalent MCP: `moment_timeline_split` with
`{"projectId":"session","clipIndex":0,"sourceTime":6}`. Import the intended
project first; do not apply demo coordinates blindly to another document.
The index must be an integer 0–999 and identify an existing occurrence. Source
time must be finite, 0–86,400, and leave at least 0.1 seconds on each side of that
clip. A timeline already containing 1,000 clips cannot be split further.

Repeated source clips are distinct occurrences: preserve the user's selected
index. Splitting retains order, intended duration, speed, authored captions and
title/card times without rescaling. A source caption crossing the split may
become adjacent derived output cues; do not claim SRT/VTT are byte-identical.
The result is `{updated:true, outputDuration}`, not the document. Retrieve and
save the project separately. UI splitting is one undo step; MCP has no undo tool.

To repeat rather than split, use `timeline.duplicate` / `moment_timeline_duplicate`
with `{clipIndex:0}` (and MCP `projectId:"session"`). Inspect the actual index first.
It inserts a copy of that source interval immediately after it, not a media-file
copy. Source captions repeat in the added occurrence; timeline captions keep
absolute pre-speed times and are not duplicated. Title/credit/card times scale
with output length through the existing timeline replacement rules; speed, media,
audio offset and global effects remain unchanged. Invalid indexes or 1,000 existing
clips reject atomically. Save after checking `{updated:true, outputDuration}`;
after a lost response, inspect the array before retrying to avoid an extra copy.
See the [complete CLI example](../../../../INTEGRATIONS.md#클립-구간-복제).


## Import SRT/VTT without constructing cue arrays

Use CLI `captions.import` or MCP `moment_captions_import` with required `text` and
`basis`. `text` must contain the file contents, not a path. For MCP:

```json
{"projectId":"session","basis":"source","text":"1\n00:00:01,000 --> 00:00:02,000\nHello\n"}
```

Choose `source` for original media seconds or `timeline` for edited-timeline
seconds; **both are before playback speed**. There is no output-clock option or
automatic reversal of trim/speed. Do not promise that importing exported subtitles
restores the original project. The command replaces all captions atomically, so
retain the prior project when reversibility matters.

The [CLI args-file recipe](../../../../INTEGRATIONS.md#srt-파일을-명령-인수로-감싸기)
reads UTF-8 SRT/VTT into `{text,basis}` JSON and protects existing outputs. API text
is limited to 100,000 UTF-16 code units; browser file import remains 2 MiB. The
shared parser also limits output to 10,000 cues and 2,000 code units per cue.
It clamps ends to the chosen clock duration, drops out-of-range/nonpositive cues,
strips markup and decodes known entities once. No speaker/style/keyword metadata
is imported. Empty/no-valid input fails without replacing the existing captions.
The permissive parser may skip malformed cues; it is not a full standard validator.
Success returns `{updated:true, outputDuration, importedCaptions}`; the last field
is the applied cue count. Read the project separately to save the document.

## Read a caption page

Use `captions.list` with optional `offset` (0–10,000, default 0) and `limit`
(1–50, default 20). MCP adds `projectId:"session"`. Read `data.captions[]` entries
`{captionIndex,caption}`; repeat at `data.nextOffset` until it is `null`.
The returned cue is an exact detached authored copy, not a repeated output occurrence.
Pre-speed times and missing `basis` (source) are preserved. Reads do not edit history
and cannot be batched. Pagination bounds response size, not total processing cost.

For an inspection issue, read nearby cues, review the text, then update the reported
current index. Each page reflects live state; no snapshot or stable ID is promised.
Re-read after structural edits or uncertain results. A page is not a project backup.
See [contracts and executable workflow](../../../../INTEGRATIONS.md#저장된-자막을-나눠-조회).

## Edit one authored caption

Prefer `captions.update` / `moment_captions_update` for one cue rather than sending
all captions again. Read a current `captions.list` page (MCP: `moment_captions_list`), then supply its `captionIndex`
and a `patch` containing only requested `text`, `start`, `end`, `speaker` or `keywords`.
MCP adds `projectId:"session"`. Basis and estimated-timing metadata cannot be patched;
all unspecified fields and other cues are retained. Text allows empty strings up
to 2,000 UTF-16 code units, keywords up to 500; speaker is `""`, `"0"` or `"1"`.

Explicit endpoints must fit the cue’s existing pre-speed source/timeline duration
and the 86,400-second schema cap with positive length. Content-only edits do not
clamp old out-of-duration timing. Empty text does not guarantee valid SRT/VTT.
Check `{updated:true, outputDuration, captionIndex}` and save separately; an empty
patch can still commit. The index is not a stable ID. Re-read after uncertain edits,
and account for earlier splits/merges when using this command in `project.batch`.
See the [CLI example and field table](../../../../INTEGRATIONS.md#자막-하나만-수정).

## Correct repeated caption text

Use `captions.text.replace` instead of rebuilding cue arrays when only wording changes:

```sh
node cli/moment.mjs exec captions.text.replace --project edited.moment.json --json '{"find":"하루","replacement":"하루의 기록"}' --dry-run
node cli/moment.mjs exec captions.text.replace --project edited.moment.json --json '{"find":"하루","replacement":"하루의 기록"}' --out corrected.moment.json
```

For MCP, call `moment_captions_text_replace` with `{"projectId":"session","find":"하루","replacement":"하루의 기록"}`. Both strings are required and limited to 2,000 UTF-16 code units; `find` must be nonempty. Matching is literal, case-sensitive and non-overlapping, without regex or Unicode normalization. Only caption text changes; preserve timings, basis, speaker, keywords and order.

The result is `{updated, matches, changedCaptions}`, not the document. With no match or an identical replacement, `updated` is false and no project change is committed. `matches` counts occurrences; `changedCaptions` counts actually changed cues. Read the document separately to save it.

An empty replacement can remove a substring, not a whole cue: if any changed cue becomes blank after `trim()` or exceeds 2,000 UTF-16 code units, the entire operation fails before commit. Do not bypass this by dropping cues or silently truncating text. Explicit cue deletion uses `captions.replace`; preserve all other entries. UI replace-all is one undo step; MCP has no undo tool.

In the browser, review matches with previous/next before replace-all. Navigation
counts matching **authored rows**, not occurrences, including captions outside
trimmed source ranges. It wraps, scrolls/focuses the row and selects its first
literal case-sensitive match; it does not seek playback or change project/history/
saved state. Multiple matches in one row are one navigation result, while
replace-all still counts every non-overlapping occurrence. Matches are recalculated
from current content. The query persists, but navigation position resets safely
when the query/project changes or the selected match disappears. This is a browser
review aid, not a new CLI/MCP command.

The browser mounts at most 50 editing rows per page. Search/timeline selection,
import and added-caption focus reveal the target page. Paging alone changes no
project/history/saved state or playback position. Search, replace-all and long-
caption splitting still use the full authored list; exports retain full-project
clip/speed behavior, not visible-page scope. The existing cue/byte limits remain.

## Inspect caption timing density

After an edit, call `captions.inspect` / `moment_captions_inspect` with required
`maxGraphemesPerSecond` chosen for the task and optional `limit` (`1..100`, default `20`).
MCP also needs `projectId:"session"`. This is read-only, outside `project.batch`.
It counts non-whitespace graphemes, including punctuation/literal markup, per
output second after cuts/repeats/speed. It is not a language standard, speech
alignment, render-fit or export-validity check. Do not silently apply fixes.

Read total, flagged and omitted counts, not just the top issues. Results rank by
rate descending, start ascending, then occurrence index. No full text is returned;
resolve authored indexes from the current project. Repeated derived occurrences
are not independent editable cues. Existing derived-cue/raw-byte limits apply.
See the [CLI workflow and precise metric](../../../../INTEGRATIONS.md#편집-후-자막-표시-속도-점검).

For manual review in the browser, **Check reading speed** starts with a blank required
positive threshold and reports the worst 20 occurrences plus total/flagged/omitted
counts. **Captions** focuses the authored row without seeking; **View range** pauses and
seeks the selected occurrence before focusing that row. Project or threshold
changes invalidate the report and require a new inspection. Busy/recovery guards still apply. Neither inspection nor navigation
changes the project, saves it or creates history; CLI/MCP cannot drive this modal
or the browser playhead.


## Split one caption at the caret boundary

Use `captions.split` / `moment_captions_split` with `{captionIndex, textOffset}`
(and MCP `projectId:"session"`) after reading the current authored row/text.
`textOffset` is an internal UTF-16 code-unit offset, not a grapheme count; it must
coincide with an `Intl.Segmenter` grapheme boundary. Do not cut an emoji or combined
character. Literal substrings keep spaces/newlines; whitespace-only sides reject.
Both cues retain metadata and receive `timing:"estimated"`. The inner timestamp
uses proportional grapheme counts, not audio/word alignment; outer bounds stay fixed.

A full 10,000-cue array, invalid index/boundary or missing safe segmentation support
rejects atomically. Check `{updated:true, outputDuration, createdCaptionIndex}`;
the second cue is inserted immediately after the first. Re-read after a lost
response before retrying, then save the document. Existing export rounding, blank-line,
byte and derived-cue limits still apply. Browser caret splitting is one undo step,
not the separate bulk long-caption split. See the [CLI example](../../../../INTEGRATIONS.md#자막-하나를-커서-위치에서-분할);
its caption replacement is for a new demo, not a prerequisite for editing real cues.

## Merge adjacent authored captions

Use `captions.merge` / `moment_captions_merge` with `{captionIndex:0}` (plus MCP
`projectId:"session"`) only after inspecting the current authored caption array.
It merges that row with the next, not the next visible/output occurrence. Both
must share basis (omitted means source), speaker and keywords (missing strings
compare as empty) and have ordered,
non-overlapping times. The first start/second end include any gap; the full merged
text is displayed through that gap. Text is joined literally with one ASCII space,
limited to 2,000 UTF-16 code units. Metadata is retained from the first cue, with
estimated timing retained if either cue had it. There is no word-level alignment.
Source text may repeat in intersecting clips; timeline cues keep their absolute
clock. Existing export limits, including SRT/VTT blank-line rejection, still apply.

Check `{updated:true, outputDuration, mergedCaptionIndex}` and save separately.
After a lost response, re-read before retrying: the same index can now merge a third
cue. Invalid index/timing/metadata/length rejects atomically. See the [CLI example](../../../../INTEGRATIONS.md#인접한-자막-합치기),
which intentionally replaces demo captions first; do not replace real captions
unless requested. The browser row action handles page boundaries in one undo step.

## Shift a constant subtitle delay

Read the current cue times, then use `captions.timing.shift` or MCP
`moment_captions_timing_shift` with `{"basis":"source","delta":0.25}`
(and `projectId:"session"` for MCP). Positive seconds delay, negative seconds
advance; both `source` and `timeline` use **pre-speed** time. Missing cue basis
counts as source. See the [complete CLI example](../../../../INTEGRATIONS.md#자막-시간을-앞뒤로-이동)
for a cue that can safely move within the source duration.

All cues with the chosen basis move, including off-page/search-hidden cues.
If any resulting interval is invalid or outside that clock’s duration, the whole
edit fails: no cropping, deletion or partial application. Tiny floating-point
roundoff at an endpoint is corrected. The existing 86,400-second caption endpoint
cap still applies. Metadata, order, other
project content and audio offset stay unchanged. Source shifts across trim gaps
can alter visible output occurrences; this is not automatic sync or speed correction.

Check `{updated, shiftedCaptions, outputDuration}`. Zero delta or no matching cues
means `updated:false, shiftedCaptions:0` and no commit. Save via a separate project
read. Browser UI offers basis/seconds/apply and one undo step for real changes;
standalone MCP has no undo tool.

## Adjust shared caption styling

For “larger captions,” use `captions.style.update` rather than rewriting the project:

```sh
node cli/moment.mjs exec captions.style.update --project corrected.moment.json --json '{"patch":{"captionSize":48}}' --dry-run
node cli/moment.mjs exec captions.style.update --project corrected.moment.json --json '{"patch":{"captionSize":48}}' --out styled.moment.json
```

Call MCP `moment_captions_style_update` with `{"projectId":"session","patch":{"captionSize":48}}` for the same edit. Use the [style field table](../../../../docs/MCP.md#adjust-global-caption-appearance) or live schema for position, colors, stroke, italic and animation.

Only supplied fields change. These are global caption settings, not per-cue styles; cue text, timing and metadata remain unchanged. Setting `style` alone does not trigger the UI preset’s italic/stroke defaults. Empty `patch: {}` is valid and returns `{updated:true, outputDuration}`; do not interpret it as the text-replacement command’s no-op detection.

Save the retrieved project JSON, not the acknowledgment. Styling affects the visual renderer and is absent from plain SRT/VTT. CLI/MCP do not render the changed video.

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


## Replacement operations and styles

- `moment_timeline_replace`: submit the complete desired `clips` list, preserving unrequested clips and their order. Clips may repeat or overlap source ranges. Each must have `end > start` and remain within original media duration; the list must contain 1–1,000 clips.
- `moment_captions_replace`: submit the complete desired caption array. Preserve `basis`, speaker and keyword fields unless changing them is requested. An empty array intentionally removes all captions. Each text is limited to 2,000 UTF-16 code units; do not silently truncate authored text.
- `moment_title_update`: `patch.lines` is exactly two strings. To leave the second line blank, use `""`, not an omitted array slot. This edits the base title; timed cards can hide it while active. Use `moment_overlays_update` for an existing card and `moment_overlays_add`/`moment_overlays_remove` to add or remove one. Use `overlays.move` / `moment_overlays_move` to change card stacking without replacing the document.
- `moment_credit_update` / CLI `credit.update`: use a required `patch` to change the source credit independently. `text` is at most 100 UTF-16 code units (empty allowed); `enabled`, `italic`, `color`, normalized `x`/`y`, and `size` are optional. Read `render.plan` output duration before setting `start`/`end` in **after-speed** seconds; `end:null` follows output end. Explicit timing must fit the output with positive duration; text-only updates do not adjust existing out-of-output timing. Empty/redundant patches still return `updated:true`. Credit text is visual only, not in caption exports. See the [schema and runnable CLI example](../../../../INTEGRATIONS.md#출처-크레딧-수정).
- `moment_template_apply`: discover IDs with `moment_templates_list`. Only built-in templates are exposed, not the browser's custom-template localStorage. `withContent: false` preserves authored title, credit and card content; `true` applies template example title, credit and card content.
- Project updates reset zoom/pan when the aspect ratio changes. Timeline or speed changes retime output layers through the shared command logic; do not separately rescale those fields again.

Live schemas are authoritative. Examples do not extend the supported fields: there is no arbitrary patch path or server-side file-save tool.

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

## Time-coordinate example

With source clips `[2,6]` then `[8,12]`, the pre-speed edited timeline is 8 seconds. At `speed: 2`, output duration is 4 seconds.

| Value | Supplied range | Output range |
|---|---|---|
| Source caption | `[3,5]` | `[0.5,1.5]` |
| Timeline-basis caption | `[2,4]` | `[1,2]`, independent of removed source gaps |
| Title/card | `[1,2]` | `[1,2]`, already output time |

Source captions repeat when their range occurs in several clips. SRT/VTT export handles trimming, repetition and speed; do not offset it again.

The project's `duration` describes the source, not the sum of the clips or final video length. Derive edited duration from the clips; derive output duration by dividing by speed. Do not infer whether a timeline caption is linked to an audio track from `basis` alone.

## Subtitle format boundaries

All three export formats allow at most 10,000 edited occurrences, 2 MiB repeated raw UTF-8 text and 2 MiB completed output (including escaping, timing, separators and any VTT header/BOM). CLI/MCP omit the BOM. Browser SRT downloads include it; browser VTT/TXT downloads do not. Do not silently trim authored text to meet the budget.

VTT uses a `WEBVTT` header and dot-separated milliseconds. It exports plain captions, not styles, regions or speaker metadata, and rejects NUL characters. Empty VTT returns `WEBVTT\n\n` through CLI/MCP; the browser skips empty downloads. SRT/VTT reject empty/blank-line cues and intervals that collapse after millisecond rounding; correct the requested text/timing rather than discarding cues.

For plain edited text, call `moment_captions_export` with
`{"projectId":"session","format":"txt"}` or use the CLI example above. TXT emits
one paragraph per derived cue in edited output order, so repeated/split clips can
repeat words. It is not a deduplicated or word-accurate transcript. No timestamps,
IDs, speaker labels, titles, cards or styles are included. Literal `<>&`, whitespace
and multiline text remain, with LF normalization, blank-line cue separators and
a final newline. Empty output is `""`; NUL is rejected. Unlike SRT/VTT, TXT accepts
blank-line payloads and sub-millisecond cues. It still has the derived-cue/raw-text
budgets and a 2 MiB actual UTF-8 file budget including separators. Raw-text bytes
are checked before newline normalization; a smaller final TXT does not bypass
that limit. TXT cannot be
reimported as subtitles or recover timing; retain project JSON for reversibility.

## Recover without losing work

**Correct the cause before retrying; preserve the supplied document and any live unsaved session.**

| Error | Recovery |
|---|---|
| `INVALID_ARGUMENT` | Inspect `error.path` and the live schema. Unknown fields and invalid ranges are rejected before commit. |
| `NOT_FOUND` | Verify `session`, built-in template IDs, or the exact card ID in `project.overlays`. Do not silently switch targets or recreate a missing card. |
| `BUSY` | Finish/cancel the browser job before retrying there. Standalone stdio is not that browser session. |
| `UNSUPPORTED_VERSION` | Use a compatible editor. Do not falsify the document's version number. |

**Media relinking:** `MEDIA_RELINK_REQUIRED` means browser import needs the matching originals connected first. Matching uses video name/duration and audio name, not a content hash. Keep the original media; MCP cannot relink it remotely.

**Subtitle limits:** `CAPTION_OUTPUT_LIMIT` affects derived SRT/VTT/TXT, not metadata editing or JSON export. Reduce repeated clips/cues only as requested; do not discard the source document.

| File/session failure | Recovery |
|---|---|
| CLI `FILE_EXISTS` / `FILE_ERROR` | Correct destination or permissions. Preserve the original; overwriting needs intent. |
| CLI `FILE_TOO_LARGE` / `INVALID_JSON` | Input JSON and serialized settings output must fit 10 MiB. Preserve the original on output refusal; dry-run is not a size preflight. Input allows one leading UTF-8 BOM; do not replace undecodable bytes. |
| Lost MCP response | If the process is alive, read the project before repeating a mutation. |
| MCP process exited | Import the last saved document into a new session. Reapply only verified missing edits; do not claim unsaved state persisted. |

MCP has no undo tool or durable history. Keep a prior exported document when reversible editing matters. Importing that document can restore metadata in the same live session; it cannot restore media bytes or unsaved changes lost on exit.
