# Project editing workflows

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

These shell examples use POSIX quoting. For other shells or complex text, put the arguments in a UTF-8 JSON file and use `--args-file args.json` instead of `--json`. Existing output files are protected; do not add `--overwrite` merely to make a failed command pass. CLI failures use exit code 1 and stderr JSON; success uses exit code 0 and stdout JSON. A dry run's `preview` field is the proposed document (or read result); it is not a saved file.

Equivalent MCP tool arguments for a rename are:

```json
{"projectId":"session","patch":{"name":"수정한 쇼츠"}}
```

Call `moment_project_update`, check `isError === false` and `structuredContent.ok === true`, then call `moment_project_get`. Save that call's `structuredContent.data`, not the entire JSON-RPC response, text-content wrapper, or mutation acknowledgment. Save SRT from `moment_captions_export` → `structuredContent.data.text`.

## Replacement operations and styles

- `moment_timeline_replace`: submit the complete desired `clips` list, preserving unrequested clips and their order. Clips may repeat or overlap source ranges. Each must have `end > start` and remain within original media duration; the list must contain 1–1,000 clips.
- `moment_captions_replace`: submit the complete desired caption array. Preserve `basis`, speaker and keyword fields unless changing them is requested. An empty array intentionally removes all captions. Each text is limited to 2,000 UTF-16 code units; do not silently truncate authored text.
- `moment_title_update`: `patch.lines` is exactly two strings. To leave the second line blank, use `""`, not an omitted array slot. This edits the base title; timed cards can hide it while active. Editing cards requires a validated full-document import or the UI; there is no card-update MCP tool.
- `moment_template_apply`: discover IDs with `moment_templates_list`. Only built-in templates are exposed, not the browser's custom-template localStorage. `withContent: false` preserves authored title, credit and card content; `true` applies template example title, credit and card content.
- Project updates reset zoom/pan when the aspect ratio changes. Timeline or speed changes retime output layers through the shared command logic; do not separately rescale those fields again.

Live schemas are authoritative. Examples do not extend the supported fields: there is no arbitrary patch path, batch-edit tool or server-side file-save tool.

## Time-coordinate example

With source clips `[2,6]` then `[8,12]`, the pre-speed edited timeline is 8 seconds. At `speed: 2`, output duration is 4 seconds.

- A source caption `[3,5]` appears at output `[0.5,1.5]`.
- A timeline-basis caption `[2,4]` appears at output `[1,2]`, regardless of removed source gaps.
- A title/card's `[1,2]` is already output time; do not divide it again.
- Source captions repeat when their source range occurs in several clips. SRT export handles trimming, repetition and speed; do not manually offset it a second time.

The project's `duration` describes the source, not the sum of the clips or final video length. Derive edited duration from the clips; derive output duration by dividing by speed. Do not infer whether a timeline caption is linked to an audio track from `basis` alone.

## Recover without losing work

- **`INVALID_ARGUMENT`:** inspect `error.path`, discover the current schema, correct the input and retry. Validation rejects unknown fields and invalid ranges before committing.
- **`NOT_FOUND`:** for local MCP use exactly `session`; for a template lookup rediscover built-in IDs. Do not substitute a different project or template silently.
- **`BUSY`:** finish/cancel the active browser job before retrying there. The standalone stdio host is not that browser session.
- **`MEDIA_RELINK_REQUIRED`:** browser import needs the matching original video/audio connected first. Matching is by video name/duration and audio name, not a content hash. Keep the original media; MCP cannot relink it remotely.
- **`UNSUPPORTED_VERSION`:** preserve the supplied document and use a compatible version. Do not rewrite its version number to bypass validation.
- **`CAPTION_OUTPUT_LIMIT`:** derived SRT exceeds its cue or byte budget. Reduce repetition/cues only with the user's intent; keep the source document. Metadata editing and JSON export remain separate from SRT output limits.
- **CLI `FILE_EXISTS`, `FILE_ERROR`, `FILE_TOO_LARGE`, `INVALID_JSON`:** fix the destination, permissions or UTF-8 input. JSON files have a 10 MiB byte limit; input may have one UTF-8 BOM. Never convert undecodable bytes to replacement characters silently.
- **MCP disconnect or lost response:** do not claim persistence. If the process is still live, read the project to determine whether the change applied before repeating it. If it exited, start a new session and import the last saved document. Reapply only verified missing edits.

MCP has no undo tool or durable history. Keep a prior exported document when reversible editing matters. Importing that document can restore metadata in the same live session; it cannot restore media bytes or unsaved changes lost on exit.
