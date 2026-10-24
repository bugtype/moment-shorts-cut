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
| SRT text | `moment_captions_export` | `structuredContent.data.text` |

Do not save the JSON-RPC envelope, text-content wrapper or mutation acknowledgment as a project document.

## Replacement operations and styles

- `moment_timeline_replace`: submit the complete desired `clips` list, preserving unrequested clips and their order. Clips may repeat or overlap source ranges. Each must have `end > start` and remain within original media duration; the list must contain 1–1,000 clips.
- `moment_captions_replace`: submit the complete desired caption array. Preserve `basis`, speaker and keyword fields unless changing them is requested. An empty array intentionally removes all captions. Each text is limited to 2,000 UTF-16 code units; do not silently truncate authored text.
- `moment_title_update`: `patch.lines` is exactly two strings. To leave the second line blank, use `""`, not an omitted array slot. This edits the base title; timed cards can hide it while active. Editing cards requires a validated full-document import or the UI; there is no card-update MCP tool.
- `moment_template_apply`: discover IDs with `moment_templates_list`. Only built-in templates are exposed, not the browser's custom-template localStorage. `withContent: false` preserves authored title, credit and card content; `true` applies template example title, credit and card content.
- Project updates reset zoom/pan when the aspect ratio changes. Timeline or speed changes retime output layers through the shared command logic; do not separately rescale those fields again.

Live schemas are authoritative. Examples do not extend the supported fields: there is no arbitrary patch path, batch-edit tool or server-side file-save tool.

## Time-coordinate example

With source clips `[2,6]` then `[8,12]`, the pre-speed edited timeline is 8 seconds. At `speed: 2`, output duration is 4 seconds.

| Value | Supplied range | Output range |
|---|---|---|
| Source caption | `[3,5]` | `[0.5,1.5]` |
| Timeline-basis caption | `[2,4]` | `[1,2]`, independent of removed source gaps |
| Title/card | `[1,2]` | `[1,2]`, already output time |

Source captions repeat when their range occurs in several clips. SRT export handles trimming, repetition and speed; do not offset it again.

The project's `duration` describes the source, not the sum of the clips or final video length. Derive edited duration from the clips; derive output duration by dividing by speed. Do not infer whether a timeline caption is linked to an audio track from `basis` alone.

## Recover without losing work

**Correct the cause before retrying; preserve the supplied document and any live unsaved session.**

| Error | Recovery |
|---|---|
| `INVALID_ARGUMENT` | Inspect `error.path` and the live schema. Unknown fields and invalid ranges are rejected before commit. |
| `NOT_FOUND` | Use exactly `session` for local MCP, or rediscover built-in template IDs. Do not silently switch projects/templates. |
| `BUSY` | Finish/cancel the browser job before retrying there. Standalone stdio is not that browser session. |
| `UNSUPPORTED_VERSION` | Use a compatible editor. Do not falsify the document's version number. |

**Media relinking:** `MEDIA_RELINK_REQUIRED` means browser import needs the matching originals connected first. Matching uses video name/duration and audio name, not a content hash. Keep the original media; MCP cannot relink it remotely.

**SRT limits:** `CAPTION_OUTPUT_LIMIT` affects derived SRT, not metadata editing or JSON export. Reduce repeated clips/cues only as requested; do not discard the source document.

| File/session failure | Recovery |
|---|---|
| CLI `FILE_EXISTS` / `FILE_ERROR` | Correct destination or permissions. Preserve the original; overwriting needs intent. |
| CLI `FILE_TOO_LARGE` / `INVALID_JSON` | Use valid UTF-8 JSON within 10 MiB. One leading UTF-8 BOM is allowed; do not silently replace undecodable bytes. |
| Lost MCP response | If the process is alive, read the project before repeating a mutation. |
| MCP process exited | Import the last saved document into a new session. Reapply only verified missing edits; do not claim unsaved state persisted. |

MCP has no undo tool or durable history. Keep a prior exported document when reversible editing matters. Importing that document can restore metadata in the same live session; it cannot restore media bytes or unsaved changes lost on exit.
