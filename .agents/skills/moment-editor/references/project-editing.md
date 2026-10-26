# Project editing workflows

**Use this reference for file/session handoff, save/recovery, grouped edits and timeline operations. For caption or composition tasks, open only the matching domain reference unless you need these shared details.**

| Need | Read |
|---|---|
| Caption content, timing, speakers, diagnostics or exports | [Caption workflows](captions.md) |
| Effects, timed cards, templates or graphics review | [Composition workflows](composition.md) |
| Clip clocks, split, move, repeat or keep gaps | [Timeline workflows](#read-indexed-clip-clocks) |
| File/session basics and saving | [Discover](#discover-and-inspect) · [CLI edits](#apply-a-small-change-preview-and-save) · [Browser handoff](#browser-file-handoff) |
| Related edits | [Preview](#inspect-a-proposed-edit-summary) · [Batch](#apply-related-edits-together) |
| Shared constraints | [Clocks](#time-coordinate-example) · [Replacement warnings](#replacement-operations-and-styles) · [Recovery](#recover-without-losing-work) |

The short forwarding sections retain old links; the full domain guidance lives only in its reference.

## Interface language and authored content

The browser offers `ko`, `en` and `zh-CN`; its saved choice takes priority over a
supported browser language, then Korean. If storage fails, the current-session
choice can still change. This is not a project edit or an MCP setting.

Do not translate a user's captions, project name, title, credit, speaker labels or
custom templates just because the UI language changed. Built-in display labels
are localized, while existing Korean examples remain authored content. Choose ASR
language independently. API command names, IDs, field names, enums, error codes
and paths stay unchanged. Use canonical IDs, not translated labels.

## Find an existing browser tool

**Guide → Find a tool** (사용 가이드 → 도구 찾기 / 使用指南 → 查找工具)
searches ten fixed destinations with keywords in all three interface languages.
It does not search authored content or persist queries/history. Eight destinations
reveal and focus an existing control: template search, caption review, caption
find, subtitle import, subtitle export format, framing, clip move and audio-file
selection. Focusing a control does not activate it. Only output-time navigation
and Project files open their existing dialogs; no edit, download, picker,
recognition, recording or export runs automatically.

Use Tab to reach result buttons; Enter in the search input does not choose one.
Escape/Cancel returns focus to Guide. State/media/panel changes invalidate results;
existing busy/recovery guards remain. There is no new header control or shortcut.
Destination semantics are unchanged, and normal input blur can commit an existing
draft before Guide opens—do not claim the whole interaction is mutation-free.
This is browser navigation, not an MCP/API command. Code fixtures do not establish
native compact-layout or assistive-technology behavior.

## Live browser project-name drafts

The same-page API commit guard also covers the header's current project-name
input: a changed uncommitted value or active composition returns `CONFLICT`.
Finish/commit the edit, or restore the original value and end composition; then
re-read before retrying. It does not blur, commit or discard the name for the user.
Untouched single-line CR/LF-normalized display values are not mistaken for drafts.
Status refreshes retain the input/composition; true project/input replacement
resets ownership. The read/preview/no-op, caller-hook and explicit local/file/Undo
boundaries below are unchanged. Other title/card numeric drafts are not
covered, and synthetic event tests are not native IME verification.

## Live browser trim drafts

The same commit guard covers the current **Frame** panel's trim start/end inputs
(internal panel ID `settings`), including changed blank/invalid values and active
composition. Use **Apply range**, or restore both original values and finish
composition; then re-read current state and indexes before retrying. These are
source seconds, not output seconds. Untouched displays and exactly equivalent
numeric spellings are clean; no rounding tolerance or implicit Apply is used.
The existing trim binder owns only its current controls and selected occurrence.
Explicit selection/panel/local replacement does not carry old drafts forward.
The separate persistent inspector trim behavior is unchanged. Other numeric
fields are not covered; the API/file/local/Undo boundaries below still apply.

## Live browser caption drafts

Same-page `window.moment.execute` rejects a prepared project commit with `CONFLICT`
while the open caption panel has pending text/timing/speaker/keyword edits or an
active composition. This includes unrelated effect updates that rebuild the panel.
It checks at commit time, including edits entered after submission; it neither
blurs nor auto-commits/discards the draft. Ask the user to finish/commit the edit or
restore its original value and finish composition, then re-read current state and
indexes before retrying. `project.get` contains committed data, not those drafts.

Reads, previews and genuine no-project no-op results remain available. Equal-value
commands that still replace the project are commits. A blocked batch applies no
operations. This is not a guard for every input: other panels/tool drafts, direct
UI edits, Undo and explicit `importProject(file)`/file-picker replacements retain
existing behavior. `execute('project.import', ...)` does pass through this guard.
Generic services, CLI and the separate stdio MCP session are unchanged.

## Browser file handoff

The header folder icon opens **Project files**: **Save settings** downloads a
`.moment.json` metadata backup, and **Import settings** restores a document.
Help retains these actions; the ordinary Save button still writes browser storage.
No media is embedded. Reconnect matching original media before restoration.
When recovery blocks browser saving but readable settings remain, download that
backup before reloading; this does not repair storage. In valid failed-metadata
recovery, **Project files → Relink original files** accepts explicitly confirmed
originals for this tab only. Matching names/durations are compatibility checks,
not identity proof. It can enable preview/seek/video export/PNG after both probes
and actual media elements are ready, but browser saving, normal import/reset,
recording and ASR stay blocked. Relinking changes no project JSON/history/storage;
reload requires the files again. See [session-only limits](../../../../README.md#relink-originals-for-this-tab-only).
The existing 10 MiB settings-file limit still applies. MCP cannot open this dialog
or access browser storage—use the supplied document, not the user's open UI state.

## Discover and inspect

Run commands from the repository root with Node.js 20+. No package installation is required.

```sh
node cli/moment.mjs commands
node cli/moment.mjs exec project.summary --project supplied.moment.json
node cli/moment.mjs exec timeline.list --project supplied.moment.json --json '{"offset":0,"limit":20}'
node cli/moment.mjs exec project.get --project supplied.moment.json
node cli/moment.mjs exec templates.list
```

For MCP, use `tools/list`, then `moment_project_import` with `projectId: "session"` and the supplied `document`. `moment_project_get` returns the full editing document in `structuredContent.data`. Do not pass a file path as `document` or use a file path as `projectId`.

Use no-argument `project.summary` / `moment_project_summary` first when only structure
is needed: kind/ratio/speed, source/pre-speed timeline/after-speed output durations,
authored clip/caption/card counts, and `media.requiresVideo/requiresAudio`. These
flags express saved requirements, not loaded or recoverable media. No names/text
are returned; caption count is not derived output occurrences. Follow with paged
`timeline.list`/`captions.list`, then `project.get` for the actual saved document.
Each read uses current state, not a reserved snapshot. Summary `--out` is a report,
not an importable project. It is read-only, excluded from batches, and has no media
provider work or constant-time guarantee. See the [contract and runnable recipe](../../../../INTEGRATIONS.md#프로젝트-구조-먼저-확인).

For a task-specific MCP discovery list, optionally start with `--tools` and comma-
separated core command names. Keep `project.import` and `project.get` when importing
and saving user documents; neither is added implicitly. If get is omitted but
`render.plan` is selected, its `structuredContent.data.project` is the full document
to save—not the whole plan. Without either read tool there is no full-document
handoff. Selection is per-process,
not authentication/read-only isolation: selected `project.batch`/`project.preview`
still accept their full 27-command nested schemas, even for omitted direct tools.
Use actual tools/list and preserve the full document before restarting. See the
[optional startup configuration](../../../../docs/MCP.md#choose-a-smaller-tool-list-optional).

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
For generated arguments, `--args-file -` reads one JSON object from stdin until EOF:

```sh
node -e "process.stdout.write(JSON.stringify({patch:{name:'Piped edit'}}))" | node cli/moment.mjs exec project.update --project supplied.moment.json --args-file - --dry-run
```

Use a real producer pipe; a terminal with no EOF waits. The limit is 10 MiB of
actual UTF-8 bytes, with strict decoding and one leading BOM allowed. Empty input,
invalid UTF-8 or multiple JSON values return `INVALID_JSON`; excess bytes return
`FILE_TOO_LARGE`, without writing outputs. Do not combine with `--json`; `./-`
means a literal file, and `--project`/`--out` do not gain stdin/stdout semantics.
See [CLI stream rules](../../../../INTEGRATIONS.md#표준-입력으로-json-인수-전달).


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

## Inspect a proposed edit summary

Use read-only `project.preview` / `moment_project_preview` before a related edit
bundle. Pass the same `operations` as `project.batch` (1–20, current 27-command
allowlist); MCP adds outer `projectId:"session"`. It returns operationCount,
wouldCommit, sorted changedFields and before/after counts (clips/captions/cards)
plus outputDuration. `wouldCommit` is commit intent: change-and-revert operations
may return true with no changed fields. This is not a full patch or visual preview.

No commit/history/media/provider work occurs. It reserves neither project state
nor generated IDs; the later batch validates current state again. Do not blindly
retry uncertain mutations. CLI `--out` saves a report, not a project backup.
[Exact fields and executable preview→batch recipe](../../../../INTEGRATIONS.md#편집-묶음의-반영-전-요약).

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

## Read indexed clip clocks

Use read-only `timeline.list` / `moment_timeline_list` with optional `offset`
(0–1,000, default 0), `limit` (1–50, default 20); MCP adds `projectId:"session"`.
The result includes totalClips/speed and indexed clips with source, cumulative
pre-speed timeline and after-speed output start/end pairs. No duration totals or
caption/media content. Follow `nextOffset` until null; a page beyond the current end
is empty. This is not MCP cursor pagination, a snapshot or a stable clip identity.

Re-read before positional edits after any structural change or uncertain result.
Repeated source ranges are distinct indexed entries. Ordinary playback floating
precision applies, including possible tiny derived-width collapse; do not infer
sample precision or new timing rules. Paging limits response volume, not overall
processing cost. No history/storage change or batch admission. A CLI `--out` page
is not a project backup. [Fields and executable pagination](../../../../INTEGRATIONS.md#타임라인-구간과-시간-나눠-조회).

## Split a clip without rebuilding the timeline

Inspect current positions with `timeline.list` or the `clips` array first. `timeline.split` takes a zero-based
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

To reorder directly, use `timeline.move` / `moment_timeline_move` with required
`clipIndex` and `toIndex`, both current zero-based indices (0–999). `toIndex` is the
final destination. Read `project.clips` first; repeated source ranges are separate
occurrences, not stable IDs. Only order changes: source ranges, captions, audioOffset
and title/credit/card numeric times remain exact. Source-caption occurrences follow
the reordered clips; timeline captions keep their pre-speed times. The result is
`{updated:boolean,outputDuration}`; same-position is a no-commit no-op. Re-read after
uncertain results instead of replaying stale indices. Batch indices are sequential.
See [move contract and executable recipe](../../../../INTEGRATIONS.md#클립을-지정한-위치로-이동).

To repeat rather than split, use `timeline.duplicate` / `moment_timeline_duplicate`
with `{clipIndex:0}` or `{clipIndex:0,count:2}` (plus MCP `projectId:"session"`).
Inspect current positional indexes first; the second example requires two clips.
Optional `count` defaults to 1; integer 1–1,000 must fit the current array and leave
at most 1,000 clips after insertion. One ordered copy of the contiguous block is
inserted immediately after the original block, not a media-file copy. Source captions repeat in the added occurrence; timeline captions keep
absolute pre-speed times and are not duplicated. Title/credit/card times scale
once with output length through existing timeline replacement rules (layers are not copied); speed, media,
audio offset and global effects remain unchanged. Invalid indexes, count, range overflow or result-cap overflow reject atomically. Save after checking `{updated:true, outputDuration}`;
after a lost response, inspect the array before retrying to avoid an extra copy.
See the [complete CLI example](../../../../INTEGRATIONS.md#클립-구간-복제).


## Import SRT/VTT without constructing cue arrays

See [Import SRT/VTT without constructing cue arrays](captions.md#import-srtvtt-without-constructing-cue-arrays).

## Read a caption page

See [Read a caption page](captions.md#read-a-caption-page).

<a id="insert-or-remove-one-cue"></a>

## Insert one cue or remove a range

See [Insert one cue or remove a range](captions.md#insert-one-cue-or-remove-a-range).

## Edit one authored caption

See [Edit one authored caption](captions.md#edit-one-authored-caption).

## Correct repeated caption text

See [Correct repeated caption text](captions.md#correct-repeated-caption-text).

## Check overlapping caption times

See [Check overlapping caption times](captions.md#check-overlapping-caption-times).

## Inspect caption timing density

See [Inspect caption timing density](captions.md#inspect-caption-timing-density).

## Split one caption at the caret boundary

See [Split one caption at the caret boundary](captions.md#split-one-caption-at-the-caret-boundary).

## Merge adjacent authored captions

See [Merge adjacent authored captions](captions.md#merge-adjacent-authored-captions).

## Shift a constant subtitle delay

See [Shift a constant subtitle delay](captions.md#shift-a-constant-subtitle-delay).

## Adjust shared caption styling

See [Adjust shared caption styling](captions.md#adjust-shared-caption-styling).

## Adjust video effects without changing content

See [Adjust video effects without changing content](composition.md#adjust-video-effects-without-changing-content).

## Edit an existing timed card by ID

See [Edit an existing timed card by ID](composition.md#edit-an-existing-timed-card-by-id).

## Build a hook, tip and CTA with individual cards

See [Build a hook, tip and CTA with individual cards](composition.md#build-a-hook-tip-and-cta-with-individual-cards).

## Replacement operations and styles

The browser's **Keep gaps…** is a separate explicit-confirmation workflow over
source-time union/complement, using existing `timeline.replace`, not a new API.
It returns ascending source intervals, discarding current repeat/order structure.
It rejects an empty complement, any positive result gap under 0.1 seconds, or
more than 1,000 results; that minimum is specific to this action, not the core
project's positive-duration validity rule. Source cues remain, timeline cues/audio
offset stay absolute, output title/credit/cards follow existing duration retiming.
Do not imply lossless rendering or that applying complement twice restores edits.

- `moment_timeline_replace`: submit the complete desired `clips` list, preserving unrequested clips and their order. Clips may repeat or overlap source ranges. Each must have `end > start` and remain within original media duration; the list must contain 1–1,000 clips.
- `moment_captions_replace`: submit the complete desired caption array. Preserve `basis`, speaker and keyword fields unless changing them is requested. An empty array intentionally removes all captions. Each text is limited to 2,000 UTF-16 code units; do not silently truncate authored text.
- `moment_title_update`: `patch.lines` is exactly two strings. To leave the second line blank, use `""`, not an omitted array slot. This edits the base title; timed cards can hide it while active. Use `moment_overlays_update` for an existing card and `moment_overlays_add`/`moment_overlays_remove` to add or remove one. Use `overlays.move` / `moment_overlays_move` to change card stacking without replacing the document.
- `moment_credit_update` / CLI `credit.update`: use a required `patch` to change the source credit independently. `text` is at most 100 UTF-16 code units (empty allowed); `enabled`, `italic`, `color`, normalized `x`/`y`, and `size` are optional. Read `render.plan` output duration before setting `start`/`end` in **after-speed** seconds; `end:null` follows output end. Explicit timing must fit the output with positive duration; text-only updates do not adjust existing out-of-output timing. Empty/redundant patches still return `updated:true`. Credit text is visual only, not in caption exports. See the [schema and runnable CLI example](../../../../INTEGRATIONS.md#출처-크레딧-수정).
- `moment_template_apply`: discover IDs with `moment_templates_list`, then use read-only `moment_template_inspect` with `{projectId:"session",templateId,withContent:false}` to inspect canonical metadata and resulting title/credit/card content/timing without applying. Use true only to inspect example-content replacement. The report omits full styles/media/captions/clips, is not rendered visibility, and reserves no state or IDs. [Exact result and CLI workflow](../../../../INTEGRATIONS.md#기본-템플릿-적용-전-점검). Only built-in templates are exposed, not the browser's custom-template localStorage. `withContent: false` preserves authored title, credit and card content; `true` applies template example title, credit and card content.
- Project updates reset zoom/pan when the aspect ratio changes. Timeline or speed changes retime output layers through the shared command logic; do not separately rescale those fields again.

Live schemas are authoritative. Examples do not extend the supported fields: there is no arbitrary patch path or server-side file-save tool.

## Assign a speaker across authored rows

See [Assign a speaker across authored rows](captions.md#assign-a-speaker-across-authored-rows).

## Share one browser custom template

See [Share one browser custom template](composition.md#share-one-browser-custom-template).

## Transfer a browser custom-template collection

See [Transfer a browser custom-template collection](composition.md#transfer-a-browser-custom-template-collection).

## Capture the current composition as a portable template

See [Capture the current composition as a portable template](composition.md#capture-the-current-composition-as-a-portable-template).

## Apply a supplied template document

See [Apply a supplied template document](composition.md#apply-a-supplied-template-document).

## Time-coordinate example

With source clips `[2,6]` then `[8,12]`, the pre-speed edited timeline is 8 seconds. At `speed: 2`, output duration is 4 seconds.

| Value | Supplied range | Output range |
|---|---|---|
| Source caption | `[3,5]` | `[0.5,1.5]` |
| Timeline-basis caption | `[2,4]` | `[1,2]`, independent of removed source gaps |
| Title/card | `[1,2]` | `[1,2]`, already output time |

Source captions repeat when their range occurs in several clips. SRT/VTT export handles trimming, repetition and speed; do not offset it again.

The project's `duration` describes the source, not the sum of the clips or final video length. Derive edited duration from the clips; derive output duration by dividing by speed. Do not infer whether a timeline caption is linked to an audio track from `basis` alone.

## Review saved graphics text

See [Review saved graphics text](composition.md#review-saved-graphics-text).

## Subtitle format boundaries

See [Subtitle format boundaries](captions.md#subtitle-format-boundaries).

## Recover without losing work

**Correct the cause before retrying; preserve the supplied document and any live unsaved session.**

| Error | Recovery |
|---|---|
| `INVALID_ARGUMENT` | Inspect `error.path` and the live schema. Unknown fields and invalid ranges are rejected before commit. |
| `NOT_FOUND` | Verify `session`, built-in template IDs, or the exact card ID in `project.overlays`. Do not silently switch targets or recreate a missing card. |
| `CONFLICT` | For live-browser caption/name drafts, finish/commit or restore the pending input and end composition, then re-read and retry. Do not clear drafts through a replacement import. Other hosts define their own conflict policy. |
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
