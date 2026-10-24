# Caption workflows

**Read this reference only for caption content, timing, speaker assignment, inspection or subtitle/review export.**

Use the essential boundaries in [SKILL.md](../SKILL.md). If needed, consult shared
[file/session setup](project-editing.md#discover-and-inspect),
[saving](project-editing.md#apply-a-small-change-preview-and-save),
[time coordinates](project-editing.md#time-coordinate-example),
[replacement warnings](project-editing.md#replacement-operations-and-styles) or
[recovery](project-editing.md#recover-without-losing-work); do not load unrelated references.

| Task | Section |
|---|---|
| Import SRT/VTT without constructing cue arrays | [Open](#import-srtvtt-without-constructing-cue-arrays) |
| Read a caption page | [Open](#read-a-caption-page) |
| Insert one cue or remove a range | [Open](#insert-one-cue-or-remove-a-range) |
| Edit one authored caption | [Open](#edit-one-authored-caption) |
| Correct repeated caption text | [Open](#correct-repeated-caption-text) |
| Check overlapping caption times | [Open](#check-overlapping-caption-times) |
| Inspect caption timing density | [Open](#inspect-caption-timing-density) |
| Split one caption at the caret boundary | [Open](#split-one-caption-at-the-caret-boundary) |
| Merge adjacent authored captions | [Open](#merge-adjacent-authored-captions) |
| Shift a constant subtitle delay | [Open](#shift-a-constant-subtitle-delay) |
| Adjust shared caption styling | [Open](#adjust-shared-caption-styling) |
| Assign a speaker across authored rows | [Open](#assign-a-speaker-across-authored-rows) |
| Subtitle format boundaries | [Open](#subtitle-format-boundaries) |

## Import SRT/VTT without constructing cue arrays

Use CLI `captions.import` or MCP `moment_captions_import` with required `text` and
`basis`. `text` must contain the file contents, not a path. For MCP:

```json
{"projectId":"session","basis":"source","text":"1\n00:00:01,000 --> 00:00:02,000\nHello\n"}
```

Choose `source` for original media seconds or `timeline` for edited-timeline
seconds; **both are before playback speed**. This command has no output-clock option or
automatic reversal of trim/speed. Do not promise that importing exported subtitles
restores the original project. The command replaces all captions atomically, so
retain the prior project when reversibility matters.

The browser's dedicated file dialog separately offers **Original media** (default)
or **Edited output**, then **Review file** before explicit **Replace**. Review
parses without editing and caches the reviewed data. Counts are accepted cues,
clipped accepted cues (a subset) and discarded recognized candidates only; malformed/
unrecognized content is not counted, so this is not full-file validation. File/clock
changes clear review; stale project/media/modal context requires a fresh review.
CLI/MCP and legacy programmatic import still replace immediately with the existing
acknowledgment, not this browser report. Output mode parses against current
output duration and multiplies times by the captured speed into existing timeline
cues (a parser-clipped final endpoint uses the exact captured timeline end).
The existing parser may clip ends/skip invalid or out-of-range cues; successful
replacement is one browser undo step and keeps the playhead position.
It does not infer a clock or map repeated output occurrences back to source
cues. Back up settings first: the entire caption array is replaced. Millisecond
quantization and missing speaker/style/keyword metadata prevent lossless recovery.
Set added-audio offset before output-clock import: the existing browser control
shifts **all timeline-basis cues**, including imported ones, not only audio-generated
cues. Undo the entire offset edit if accidental. Later cuts do not automatically
realign imported subtitles; speed/cuts keep existing timeline semantics.
Legacy `importSrt(file)` and
the hidden picker remain source-only; no new CLI/MCP basis or schema is introduced.


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

<a id="insert-or-remove-one-cue"></a>

## Insert one cue or remove a range

Read `captions.list` first. `captions.insert` takes `{captionIndex,caption}` at
0 through current count (inclusive for append); `captions.remove` takes an existing
`{captionIndex,count?}`; count defaults to 1 and must be an integer 1..10,000.
The contiguous range must fit the current authored array; all cues may be removed.
Overflow is rejected, not shortened; surviving out-of-timeline cues remain intact.
MCP names are `moment_captions_insert` / `moment_captions_remove`,
with `projectId:"session"`. The caption needs `start`, `end`, `text`; optional basis
is source by default or timeline, both before speed. Times must fit that duration
and the 86,400-second endpoint cap; insertion cannot exceed 10,000 cues.
Empty text is legal but may not export as subtitles. Other cues are not sorted or retimed.

Both return `{updated:true,captionIndex,totalCaptions,outputDuration}`; removal's
index is the old first removed position. Save the full project separately. These operations shift
indices and are not idempotent: re-read after uncertainty, never blindly retry.
In `project.batch`, use sequential current indices, not original positions; the
20-operation cap is unchanged. [Field limits and executable insert/remove/batch
recipes](../../../../INTEGRATIONS.md#자막-하나-추가연속-범위-삭제) cover the complete contract.

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

Optional `captionIndex`/`count` selects a contiguous authored-row range: omit both
for all, index only for the tail, count only for the prefix, both for exact range.
An explicit index must exist (0–9,999); count is 1–10,000 and must fit completely.
Bad bounds reject even before a no-match/identical-replacement no-op. With no range,
an empty cue list remains a no-op. Both source/timeline cues participate; no basis
conversion or outside-range change. Counts are scoped to the range, not the page
or output occurrences. Re-read positions after structural edits or uncertain
results; a positional retry can now target other cues. Actual newlines and `$`
remain literal. [Executable range examples](../../../../INTEGRATIONS.md#자막-문구-일괄-교정)

The result is `{updated, matches, changedCaptions}`, not the document. With no match or an identical replacement, `updated` is false and no project change is committed. `matches` counts occurrences; `changedCaptions` counts actually changed cues. Read the document separately to save it.

An empty replacement can remove a substring, not a whole cue: if any changed cue becomes blank after `trim()` or exceeds 2,000 UTF-16 code units, the entire operation fails before commit. Do not bypass this by dropping cues or silently truncating text. Explicit cue deletion uses `captions.remove`; preserve all other entries. UI replace-all is one undo step; MCP has no undo tool.

In the browser, previous/next counts **literal occurrences**, including multiple
matches within one authored row and captions outside trimmed source ranges. It
wraps across rows/pages and selects the exact substring without seeking or editing.
Matching remains case-sensitive/non-overlapping, with UTF-16 offsets and no regex
or Unicode normalization. Find is nonempty and at most 2,000 UTF-16 code units;
replacement is at most 2,000, with literal `$` characters.

**Replace match** uses the existing `captions.update` for only the selected
substring, preserving cue timing/metadata in one undo step. It highlights the
replacement without automatically advancing; Next resumes after the inserted span
and wraps only when no later match exists; Previous may revisit earlier or inserted
matches. Identical replacement is a no-op;
blank/overlong resulting cue text is rejected. A stale cue/query or uncommitted
textarea edit is refused rather than overwritten: finish the edit and reselect.
Opening/clicking controls may still trigger the field's normal blur/change commit.
Search/replacement drafts persist; reselect if project/content/query changes.
**Replace in range…** captures current Find/Replacement drafts read-only, then asks
for inclusive 1-based authored first/last rows (default: the selected match's row,
otherwise the current page's first row; both bounds start at that single row). Its live match/change counts cover that range; explicit confirmation makes
one undoable edit. No hit/identical text/cancel adds no edit. It creates no persistent
selection and does not narrow search navigation. Reopen when project/media/search
context becomes stale. Replace match and replace-all remain separate; no new API
command is added.

The browser mounts at most 50 editing rows per page. Search/timeline selection,
import and added-caption focus reveal the target page. Paging alone changes no
project/history/saved state or playback position. Search, replace-all and long-
caption splitting still use the full authored list; exports retain full-project
clip/speed behavior, not visible-page scope. The existing cue/byte limits remain.

## Check overlapping caption times

Call read-only `captions.overlaps` / `moment_captions_overlaps` with optional `limit`
(1–100, default 20; MCP also needs `projectId:"session"`). It checks positive
intersections of derived output occurrences after cuts, repetition and speed;
touching boundaries do not count. It does not predict visibility or change ownership.

Read total/flagged/omitted occurrence counts. Issues are occurrence-ordered and
contain one representative conflict per flagged occurrence, **not all pairs**.
All times are output seconds after speed; each side references the current authored
caption and optional source clip. Use `captions.list` for text, never treat a derived
occurrence as an independently editable cue, and re-run after edits. No automatic
correction/history/save or batch admission; existing occurrence/text budgets apply.
[Complete response fields and limits](../../../../docs/MCP.md#check-caption-time-overlaps)
and [executable CLI workflow](../../../../INTEGRATIONS.md#자막-시간-겹침-점검).

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


## Split long captions in bulk or a range

Use `captions.split.long` / `moment_captions_split_long` with optional `limit`
(`12|18|24`, default18) and `captionIndex`/`count`. Neither range field means all;
index-only means tail, count-only prefix, both exact authored rows. Explicit ranges
must exist even for no-op results. No basis filter or visible-occurrence selection.

Unlike caret splitting, long splitting trims boundary whitespace and prefers ASCII
spaces before grapheme boundaries. Short/unchanged cues remain exact. Metadata and
outer times/clock remain, with grapheme-weighted `timing:"estimated"` on split cues;
review against audio. Requires `Intl.Segmenter`; no normalization or word alignment.
Atomic result cap10,000 and computed-time validity apply, not new current-timeline
clamping. Existing export limits still matter. Inspect `{updated,changedCaptions,
addedCaptions,outputDuration}`; counters distinguish changed originals from net
new rows. No change means no commit. Re-read shifted indexes after uncertain results,
then save via project.get. The browser has separate whole-list and inclusive
1-based range actions; range is not a persisted selection or output occurrence.
See [bounds and runnable recipe](../../../../INTEGRATIONS.md#긴-자막을-전체-또는-범위로-분할).

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

Optional `captionIndex`/`count` first select authored rows, then filter by basis.
Omit both for all; index alone means that row through the end; count alone means
first N; both mean exactly N from the index. Explicit index must exist (integer
0..9,999), count is 1..10,000. Overflow/explicit empty-array ranges reject even for
zero delta. No clamping or clock conversion; unselected rows are unchanged.
Re-read indexes after structural edits. Matching cues in range move even if off-page
or hidden by search.
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

For speaker presentation, add `speakerLabels:["Host","Guest"]` and/or
`speakerColors:["#FFFFFF","#B5FF00"]` to the patch. Each supplied array replaces
both slots: labels are exactly two strings of at most 80 UTF-16 code units (empty
allowed), colors exactly two hex6/hex8 strings. Slots correspond to existing cue
speaker 0/1; no detection, reassignment or extra speakers. Highlight text keeps its
existing precedence; speaker-label colors still use the assigned color.

Save the retrieved project JSON, not the acknowledgment. Styling and speaker
labels/colors are absent from plain SRT/VTT/TXT. CLI/MCP do not render the changed video.

## Assign a speaker across authored rows

Read `captions.list` before `captions.speaker.assign` / `moment_captions_speaker_assign`:
all three arguments are required, e.g. `{"captionIndex":1,"count":2,"speaker":"1"}`.
The existing zero-based index plus count selects contiguous authored rows, including
both time bases—not search matches, page-only rows or repeated output occurrences.
Count is 1–10,000 and the whole range must exist; invalid input is not clamped.

Only `speaker` changes. Choose existing slots `"0"`/`"1"` or unassigned `""`; no
automatic identification or additional slots. Missing/empty already-unassigned
values are a no-op without creating a missing field; clearing an assigned cue writes
`""`. The result `{updated,changedCaptions,outputDuration}` counts actual changes.
Text, times, basis, keywords and order remain intact, and plain subtitle exports do not
gain speaker names (opt-in review TXT can include them). Set presentation separately with `captions.style.update`.

The operation supports batch and read-only preview, but neither reserves row
identity. Re-read after structural edits or uncertain outcomes; save a prior
project document for recovery because MCP has no undo tool.
[Executable recipe and bounds](../../../../INTEGRATIONS.md#자막-범위의-화자-배정)

## Subtitle format boundaries

All three export formats allow at most 10,000 edited occurrences, 2 MiB repeated raw UTF-8 text and 2 MiB completed output (including escaping, timing, separators and any VTT header/BOM). CLI/MCP omit the BOM. Browser SRT downloads include it; browser VTT/TXT downloads do not. Do not silently trim authored text to meet the budget.

VTT uses a `WEBVTT` header and dot-separated milliseconds. It exports plain captions, not styles, regions or speaker metadata, and rejects NUL characters. Empty VTT returns `WEBVTT\n\n` through CLI/MCP; the browser skips empty downloads. All SRT/VTT/TXT exports reject NUL (`U+0000`) in derived output cues; an authored cue wholly outside the cuts is not exported. Correct/remove it with the requested text edit, then retry—never silently strip it. Project JSON can still retain authored text, and failed CLI export preserves existing output files. SRT/VTT reject empty/blank-line cues and intervals that collapse after millisecond rounding; correct the requested text/timing rather than discarding cues.

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

For human timing/speaker review, use the same `captions.export` tool with
`{"format":"txt","review":true}` (plus `projectId:"session"` in MCP).
The response remains `{format:"txt",text}`. Only TXT accepts `review:true`;
omitted/false preserves existing output. Review adds ordinary string-form
**after-speed output seconds** and explicitly assigned nonempty speaker labels.
Repeated/overlapping occurrences remain separate; no labels are inferred.
Headings follow current UI locale (standalone CLI/MCP default Korean, no locale
argument), while authored names/text stay literal with LF newline normalization.

Keep the original project: this is not an import format, visibility guarantee,
audio-verified transcript or backup. No media/project names, source coordinates,
keywords, graphics text or styles are included. Exported text/used labels containing
NUL reject without stripping; unused labels do not block. Existing occurrence/raw
text limits and final 2 MiB including headings/labels apply. Empty output is `""`;
browser **Review TXT** skips empty files and otherwise downloads `.review.txt`,
UTF-8 without BOM. [CLI recipe and comparison](../../../../INTEGRATIONS.md#자막-검토용-txt)
