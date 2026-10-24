# Project editing workflows

**Inspect the supplied document, preview the requested edit, then save a separate result. MCP changes remain in memory until your client saves them.**

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
| SRT/VTT text | `moment_captions_export` | `structuredContent.data.text` |

For VTT, call `moment_captions_export` with `{"projectId":"session","format":"vtt"}`. Omitting `format` preserves SRT; an output filename does not select the format. Save only the returned text as UTF-8.

Do not save the JSON-RPC envelope, text-content wrapper or mutation acknowledgment as a project document.

## Correct repeated caption text

Use `captions.text.replace` instead of rebuilding cue arrays when only wording changes:

```sh
node cli/moment.mjs exec captions.text.replace --project edited.moment.json --json '{"find":"하루","replacement":"하루의 기록"}' --dry-run
node cli/moment.mjs exec captions.text.replace --project edited.moment.json --json '{"find":"하루","replacement":"하루의 기록"}' --out corrected.moment.json
```

For MCP, call `moment_captions_text_replace` with `{"projectId":"session","find":"하루","replacement":"하루의 기록"}`. Both strings are required and limited to 2,000 UTF-16 code units; `find` must be nonempty. Matching is literal, case-sensitive and non-overlapping, without regex or Unicode normalization. Only caption text changes; preserve timings, basis, speaker, keywords and order.

The result is `{updated, matches, changedCaptions}`, not the document. With no match or an identical replacement, `updated` is false and no project change is committed. `matches` counts occurrences; `changedCaptions` counts actually changed cues. Read the document separately to save it.

An empty replacement can remove a substring, not a whole cue: if any changed cue becomes blank after `trim()` or exceeds 2,000 UTF-16 code units, the entire operation fails before commit. Do not bypass this by dropping cues or silently truncating text. Explicit cue deletion uses `captions.replace`; preserve all other entries. UI replace-all is one undo step; MCP has no undo tool.

## Adjust shared caption styling

For “larger captions,” use `captions.style.update` rather than rewriting the project:

```sh
node cli/moment.mjs exec captions.style.update --project corrected.moment.json --json '{"patch":{"captionSize":48}}' --dry-run
node cli/moment.mjs exec captions.style.update --project corrected.moment.json --json '{"patch":{"captionSize":48}}' --out styled.moment.json
```

Call MCP `moment_captions_style_update` with `{"projectId":"session","patch":{"captionSize":48}}` for the same edit. Use the [style field table](../../../../docs/MCP.md#adjust-global-caption-appearance) or live schema for position, colors, stroke, italic and animation.

Only supplied fields change. These are global caption settings, not per-cue styles; cue text, timing and metadata remain unchanged. Setting `style` alone does not trigger the UI preset’s italic/stroke defaults. Empty `patch: {}` is valid and returns `{updated:true, outputDuration}`; do not interpret it as the text-replacement command’s no-op detection.

Save the retrieved project JSON, not the acknowledgment. Styling affects the visual renderer and is absent from plain SRT/VTT. CLI/MCP do not render the changed video.

## Replacement operations and styles

- `moment_timeline_replace`: submit the complete desired `clips` list, preserving unrequested clips and their order. Clips may repeat or overlap source ranges. Each must have `end > start` and remain within original media duration; the list must contain 1–1,000 clips.
- `moment_captions_replace`: submit the complete desired caption array. Preserve `basis`, speaker and keyword fields unless changing them is requested. An empty array intentionally removes all captions. Each text is limited to 2,000 UTF-16 code units; do not silently truncate authored text.
- `moment_title_update`: `patch.lines` is exactly two strings. To leave the second line blank, use `""`, not an omitted array slot. This edits the base title; timed cards can hide it while active. Editing cards requires a validated full-document import or the UI; there is no card-update MCP tool.
- `moment_template_apply`: discover IDs with `moment_templates_list`. Only built-in templates are exposed, not the browser's custom-template localStorage. `withContent: false` preserves authored title, credit and card content; `true` applies template example title, credit and card content.
- Project updates reset zoom/pan when the aspect ratio changes. Timeline or speed changes retime output layers through the shared command logic; do not separately rescale those fields again.

Live schemas are authoritative. Examples do not extend the supported fields: there is no arbitrary patch path, multi-command batch tool or server-side file-save tool.

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

Both formats allow at most 10,000 edited occurrences, 2 MiB repeated raw UTF-8 text and 2 MiB completed output (including escaping, timing, separators and any VTT header/BOM). CLI/MCP omit the BOM. Browser SRT downloads include it; browser VTT downloads do not. Do not silently trim authored text to meet the budget.

VTT uses a `WEBVTT` header and dot-separated milliseconds. It exports plain captions, not styles, regions or speaker metadata, and rejects NUL characters. Empty VTT returns `WEBVTT\n\n` through CLI/MCP; the browser skips empty downloads. Both formats reject empty/blank-line cues and intervals that collapse after millisecond rounding; correct the requested text/timing rather than discarding cues.

## Recover without losing work

**Correct the cause before retrying; preserve the supplied document and any live unsaved session.**

| Error | Recovery |
|---|---|
| `INVALID_ARGUMENT` | Inspect `error.path` and the live schema. Unknown fields and invalid ranges are rejected before commit. |
| `NOT_FOUND` | Use exactly `session` for local MCP, or rediscover built-in template IDs. Do not silently switch projects/templates. |
| `BUSY` | Finish/cancel the browser job before retrying there. Standalone stdio is not that browser session. |
| `UNSUPPORTED_VERSION` | Use a compatible editor. Do not falsify the document's version number. |

**Media relinking:** `MEDIA_RELINK_REQUIRED` means browser import needs the matching originals connected first. Matching uses video name/duration and audio name, not a content hash. Keep the original media; MCP cannot relink it remotely.

**Subtitle limits:** `CAPTION_OUTPUT_LIMIT` affects derived SRT/VTT, not metadata editing or JSON export. Reduce repeated clips/cues only as requested; do not discard the source document.

| File/session failure | Recovery |
|---|---|
| CLI `FILE_EXISTS` / `FILE_ERROR` | Correct destination or permissions. Preserve the original; overwriting needs intent. |
| CLI `FILE_TOO_LARGE` / `INVALID_JSON` | Use valid UTF-8 JSON within 10 MiB. One leading UTF-8 BOM is allowed; do not silently replace undecodable bytes. |
| Lost MCP response | If the process is alive, read the project before repeating a mutation. |
| MCP process exited | Import the last saved document into a new session. Reapply only verified missing edits; do not claim unsaved state persisted. |

MCP has no undo tool or durable history. Keep a prior exported document when reversible editing matters. Importing that document can restore metadata in the same live session; it cannot restore media bytes or unsaved changes lost on exit.
