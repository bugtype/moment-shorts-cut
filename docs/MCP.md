# Local MCP and AI skill

Moment provides a dependency-free **stdio MCP server for project metadata** and a
repository skill for agents. **Save the edited document before disconnecting: the
session is temporary.** It does not install a service, connect to your open browser,
upload media or encode video.

| Goal | Start here |
|---|---|
| Check the local connection | [Connect a client](#connect-a-client) |
| Edit and keep a project | [Import, edit, inspect, save](#import-edit-inspect-save) |
| Find fields and choose the correct clock | [Tool catalog](#tool-catalog) · [Time coordinates](#time-coordinates) |
| Use files, recipes or recover safely | [CLI workflow](../INTEGRATIONS.md#실제-cli-사용) · [Editing recipes](#editing-recipes) · [Responses and recovery](#responses-and-recovery) |

## Connect a client

Use Node.js 20+ and an MCP client supporting protocol **2025-11-25** and stdio.
Copy the entry from [mcp-client.json](../examples/mcp-client.json) into that client's
MCP configuration, replacing the absolute script path. The example uses the common
`mcpServers` shape; use your client's configuration format. If Node is not on the
client's PATH, use its absolute executable path. No working-directory setting,
package installation, API key or HTTP port is needed.

```sh
node /absolute/path/to/moment-shorts-cut/cli/mcp.mjs
```

The client, not a terminal command typed into the editor, launches and owns this
process. Starting it alone waits for stdin; it does not print a menu or open a
browser. The server reserves stdout for newline-delimited JSON-RPC responses.
Diagnostics go to stderr. Closing stdin ends the process and its project session.

For a runnable client without an external SDK or client application:

```sh
node examples/use-mcp-client.mjs
```

This example launches real subprocesses, discovers tools, imports and edits a demo
document, checks an invalid edit leaves it unchanged, extracts SRT/JSON and a render
plan, then reimports the document in a fresh session. It uses no user files and
writes no project files. Its JSON summary is a protocol smoke test, not a video.

## Lifecycle and session identity

The client sends `initialize`, checks the returned `protocolVersion`, then sends
`notifications/initialized` before listing or calling tools. The server returns
its supported version, `2025-11-25`, even if the proposed version differs; a client
that cannot support that version should disconnect, not continue with another
wire format. `ping` is supported. Initialize only once per process.

All thirty-three tools require **`projectId: "session"`**. Each process owns one independent
in-memory project, initially the demo. This value is neither a path nor a credential.
Other project IDs return a tool error. A second client process does not share state.

The implementation separates [stdio transport](../cli/mcp.mjs) from
[session dispatch](../cli/mcp-session.mjs). Requests are serialized, output honors
backpressure, and each transport session has its own project and lifecycle state.
The reusable [adapter](../dist/integration/mcp-adapter.mjs) supplies tool mapping;
it is not itself a transport or an authentication server.

## Import, edit, inspect, save

1. Use the browser header’s folder icon, **Project files → Save settings**, and supply that `.moment.json` document
   to your AI client. Do not send raw video as a tool argument.
2. Call `moment_project_import` with `{ "projectId": "session", "document": ... }`.
   `document` is the complete `{format:"moment-project", formatVersion:1, project:{...}}`
   envelope, not a filename or only its nested project.
3. Read `tools/list` for current schemas and apply the requested edits. Inspect
   `isError` and `structuredContent.ok` after every call.
4. Call `moment_project_get`, review the edited document, and save its
   **`structuredContent.data`** through the client's authorized file workflow.
   Keep the original file unless replacement was requested.
5. Choose **Project files → Import settings** in the browser. Connect matching original
   video/audio first where required. Matching uses names and video duration, not
   a content hash; retain the actual original media.

Browser storage failure has a separate [session-only original-file relink](../README.md#relink-originals-for-this-tab-only)
for valid readable settings. It does not resume browser saving or ordinary imports,
repair storage, or add an MCP tool. CLI/MCP cannot supply files to the open editor's
media elements; keep exported settings and actual originals separately.

Example request after importing a document:

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"moment_project_update","arguments":{"projectId":"session","patch":{"name":"수정한 쇼츠","ratio":"9:16"}}}}
```

A successful mutation returns an acknowledgment such as
`{updated:true, outputDuration:12}` or `{imported:true}`, **not the edited document**.

| Needed result | Tool | Field to save |
|---|---|---|
| Project JSON | `moment_project_get` | `structuredContent.data` |
| SRT/VTT/TXT text | `moment_captions_export` | `structuredContent.data.text` |

Do not save the JSON-RPC envelope as either artifact.

**Changes disappear when the process exits.** The server neither reads nor writes
project files, autosaves, synchronizes browser IndexedDB, nor exposes an undo tool.
If saving fails, keep the process alive where possible and retry saving the retrieved
document. For file-oriented work with protected outputs and `--dry-run`, use the
[CLI](../INTEGRATIONS.md#실제-cli-사용).

## Tool catalog

Every row below also requires `projectId`. Discover the actual `inputSchema` and
`outputSchema` with `tools/list`; this overview is not an alternate validator.
The output schema distinguishes success and error envelopes and each command's
result shape. Nested project state and some template settings/card shapes remain
generic in these schemas. Shared project and portable-template validators enforce
the deeper version, known-field, required-field, type and range rules at runtime.
Schema discovery alone does not establish portable-document validity or bypass
that validation.

### Read and export

| Tool | Editing input | Successful `structuredContent.data` |
|---|---|---|
| `moment_project_get` | none | Full portable project document |
| `moment_template_export` | `id`, `name` | Portable `{format:"moment-template", formatVersion:1, template}` document |
| `moment_templates_list` | none | Built-in template summaries: `id`, `name`, `category`, `description` |
| `moment_captions_export` | optional `format: "srt"`, `"vtt"` or `"txt"` | `{format, text}` with the selected format |
| `moment_captions_list` | optional `offset`, `limit` | Authored cue page with current array indexes |
| `moment_captions_inspect` | `maxGraphemesPerSecond`, optional `limit` | Read-only output-occurrence rate report |
| `moment_render_plan` | optional `quality`, `format` | Plan, project snapshot, output settings, required media and `rendered:false` |

Omitting `format` preserves the existing SRT output. To request plain WebVTT, call
`moment_captions_export` with these arguments after importing your document:

```json
{"projectId":"session","format":"vtt"}
```

Save `structuredContent.data.text` as UTF-8 `.vtt`; the server does not save files.

For edited caption text without timing, call the same tool with:

```json
{"projectId":"session","format":"txt"}
```

Save `structuredContent.data.text` as UTF-8 `.txt`. TXT emits one paragraph per
derived cue in clip/repetition/source-or-timeline/speed-adjusted output order.
Repeated or split clips can repeat words: this is not a deduplicated or word-accurate
transcript. Timestamps, IDs, speaker labels, titles, cards and styling are omitted.
Literal `<>&`, whitespace and multiline text are preserved, CR/CRLF become LF,
cues are separated by a blank line, and nonempty output ends in a newline.
Blank-line payloads and sub-millisecond intervals are allowed; NUL is rejected.
Empty output is `""`. TXT is not accepted by subtitle import and cannot restore
cue timing. The same 10,000-derived-cue/raw-text budget applies; complete UTF-8
output including separators must fit 2 MiB. The raw-text budget is checked before
newline normalization, so a smaller normalized TXT can still fail that guard.
The service emits no BOM.

### Project and template changes

| Tool | Editing input | Successful `structuredContent.data` |
|---|---|---|
| `moment_project_update` | `patch` | Update acknowledgment and output duration |
| `moment_project_batch` | `operations` | `{updated, operationCount, outputDuration}` |
| `moment_project_import` | `document` | `{imported:true}` |
| `moment_template_apply` | `templateId`, optional `withContent` | Update acknowledgment and output duration |
| `moment_template_apply_document` | `document`, optional `withContent` | `{updated:true, outputDuration}` |

### Timeline and text changes

| Tool | Editing input | Successful `structuredContent.data` |
|---|---|---|
| `moment_timeline_replace` | `clips: [{start,end}]` | Update acknowledgment and output duration |
| `moment_timeline_split` | `clipIndex`, `sourceTime` | `{updated:true, outputDuration}` |
| `moment_timeline_move` | `clipIndex`, `toIndex` | `{updated:boolean, outputDuration}` |
| `moment_timeline_duplicate` | `clipIndex` | `{updated:true, outputDuration}` |
| `moment_title_update` | `patch` | Update acknowledgment and output duration |
| `moment_credit_update` | `patch` | `{updated:true, outputDuration}` |
| `moment_effects_update` | `patch` | `{updated:true, outputDuration}` |

### Timed card operations

| Tool | Editing input | Successful `structuredContent.data` |
|---|---|---|
| `moment_overlays_update` | `id`, `patch` | `{updated:true, outputDuration}` |
| `moment_overlays_add` | `id`, `patch` requiring `text`, `start`, `end` | `{updated:true, outputDuration, id}` |
| `moment_overlays_remove` | `id` | `{updated:true, outputDuration, id}` |
| `moment_overlays_move` | `id`, `toIndex` | `{updated, outputDuration, id, toIndex}` |

### Caption changes

| Tool | Editing input | Successful `structuredContent.data` |
|---|---|---|
| `moment_captions_replace` | `captions` | Update acknowledgment and output duration |
| `moment_captions_insert` | `captionIndex`, `caption` | `{updated:true, captionIndex, totalCaptions, outputDuration}` |
| `moment_captions_remove` | `captionIndex` | Same acknowledgment; index is the removed position |
| `moment_captions_update` | `captionIndex`, `patch` | `{updated:true, outputDuration, captionIndex}` |
| `moment_captions_merge` | `captionIndex` | `{updated:true, outputDuration, mergedCaptionIndex}` |
| `moment_captions_split` | `captionIndex`, `textOffset` | `{updated:true, outputDuration, createdCaptionIndex}` |
| `moment_captions_import` | `text`, `basis` | `{updated:true, outputDuration, importedCaptions}` |
| `moment_captions_text_replace` | `find`, `replacement` | `{updated:boolean, matches:number, changedCaptions:number}` |
| `moment_captions_style_update` | `patch` | `{updated:true, outputDuration}` |
| `moment_captions_timing_shift` | `basis`, `delta` | `{updated:boolean, shiftedCaptions:number, outputDuration}` |

`moment_timeline_replace`, `moment_captions_replace` and `moment_captions_import` replace the **entire array**. Preserve unrequested clips/captions
rather than sending only the changed entry. `withContent:true` applies example title, credit
and card content; use `false` when retaining authored content. `templates_list`
returns built-ins, not custom templates stored in a browser. `title_update` edits
the base title, not timed cards; `patch.lines` contains exactly two strings.

Project updates accept name, ratio, fit, zoom, pan, speed and volumes according to
the discovered schema. Runtime string limits count UTF-16 code units, so non-BMP
characters such as many emoji use two units; schema checks alone are not the
entire domain validation. Unknown fields are rejected. Changing ratio resets zoom/pan.
Timeline and speed changes retime output layers through the shared command logic.
There is no arbitrary patch path, file-save tool, media-upload tool,
transcription tool or video-rendering tool on this host.

## Shared editing contracts

### Time coordinates

| Value | Time basis |
|---|---|
| Clips and source captions | Original media seconds |
| Captions with `basis:"timeline"` | Edited timeline seconds **before speed** |
| Title, credit and timed cards | Output seconds **after speed** |
| Exported SRT/VTT | Final output seconds, with clip order/repetition and speed applied |

For clips `[2,6]` and `[8,12]` at speed 2, edited duration is 8 seconds and output is
4 seconds. A source caption `[3,5]` appears at output `[0.5,1.5]`. A timeline caption
`[2,4]` appears at output `[1,2]`. Do not rescale exported SRT/VTT or an output-layer range
again. See the skill's [editing reference](../.agents/skills/moment-editor/references/project-editing.md)
for replacement and recovery workflows.

## Responses and recovery

Tool calls return `content` containing a JSON text block, the same result in
`structuredContent`, and `isError`. The structured result is one of:

```js
{ok:true, apiVersion:1, command:"project.get", data: {/* command result */}}
{ok:false, apiVersion:1, command:"project.update",
 error:{code:"INVALID_ARGUMENT", message:"...", path:"arguments.patch.speed"}}
```

`error.path` is optional. Use error codes and the current schema rather than parsing
translated error messages. Transport success alone does not mean an edit succeeded.
Tool annotations are discovery hints, not authorization; validate inputs and inspect
results regardless of those hints.

### Protocol failures

| Failure | Meaning and safe next step |
|---|---|
| JSON-RPC `-32700` | Malformed JSON or UTF-8; fix the frame. No tool ran. |
| JSON-RPC `-32600` | Invalid request or tools before initialization; fix the request/lifecycle. |
| JSON-RPC `-32601` | Unsupported method; use advertised methods. |
| JSON-RPC `-32602` | Invalid initialization/params, unknown tool or unsupported pagination; rediscover names and schemas. |

JSON-RPC **`-32603`** means an unexpected dispatch failure. Inspect the current
project before repeating a mutation.

### Editing failures

| Failure | Meaning and safe next step |
|---|---|
| Tool `INVALID_ARGUMENT` | Input validation failed; correct the field indicated by `path`. |
| Tool `NOT_FOUND` | Check `session`, rediscover built-in template IDs, or read `project.overlays` for the exact existing card ID. Do not recreate a missing card or silently target another one. |
| Tool `UNSUPPORTED_VERSION` | Preserve the document and use a compatible editor; do not falsify its version. |
| Tool `CAPTION_OUTPUT_LIMIT` | Derived SRT/VTT/TXT exceeds its cue/byte budget; keep the project and reduce output only as requested. |

Tool **`INTERNAL_ERROR`** does not establish atomic failure in every custom host.
Inspect the session before retrying.

**Process exited or response lost:** unsaved state may be gone. If the process is
alive, read before replaying the edit. Otherwise import the last saved document
into a new session.

The shared service validates a copied project before committing. The local host's
commit replaces its in-memory project; reusable custom hosts must supply their own
storage atomicity and authorization. There is no automatic retry or rollback of
an already completed sequence of tool calls.

Built-in project-settings files are limited to **10 MiB (10,485,760 UTF-8 bytes)**
on save as well as restore. Oversized serialized settings are rejected before a
browser download or CLI project-file write, without truncation or overwriting an
existing file. This is not a new project-state schema cap: the metadata API can
represent a larger valid project, but the built-in file workflow cannot round-trip it.
The CLI applies this to `init`, mutation `--out` and `project.get --out`, not
stdout or `render.plan`. `--dry-run` previews in memory and is not a settings-file
size preflight, even if `--out` is also present.
Do not confuse this with subtitle budgets or the 256 KiB portable-template limit.

Input frames exceeding **10 MiB** terminate the process; this includes the whole
JSON-RPC frame, not only the nested project. A CLI document close to its own 10 MiB
limit may therefore be too large to wrap in an MCP import request. There is no
chunked import. Malformed frames receive parse errors and do not become tool calls.
Notifications never execute tools; cancellation notifications do not cancel work.
The host handles short metadata requests serially, not background media tasks.

SRT, VTT and TXT export are each limited to 10,000 resulting cues, 2 MiB of repeated raw
caption UTF-8 text and 2 MiB of the complete file, including escaping, timing,
separators and the VTT header where present. The service emits none of these formats with
a BOM. A source project can still be valid for JSON export when subtitle output
exceeds these limits.

VTT is plain UTF-8 WebVTT with a `WEBVTT` header and dot-separated milliseconds.
It uses the same clip/speed mapping and text escaping as SRT, not rich styles,
regions or speaker metadata. NUL characters are rejected for VTT. Empty VTT
export returns valid `WEBVTT\n\n`; the browser instead skips empty downloads.
SRT/VTT reject blank cues/paragraphs and intervals that collapse when rounded to
milliseconds rather than silently dropping or retiming them; TXT permits them.

## Boundaries and extension points

Supported methods are initialize, ping, tools/list and tools/call plus the initialized
notification. No HTTP, resources, prompts, pagination, subscriptions, background
tasks or server-side authentication are advertised. Do not expose this process as
an unauthenticated network service.

The adapter retains internal `resultType:"complete"` metadata; the stdio host omits
it from its negotiated 2025-11-25 wire results. Using the adapter alone does not
implement a later MCP protocol. For a custom host, see
[INTEGRATIONS.md](../INTEGRATIONS.md#mcp-어댑터와-호스트-확장): resolve an authorized
service per request, provide transport/lifecycle handling, and keep storage and
media-provider permissions at the host boundary.

Media bytes are never loaded by this host. `render.plan` is not encoding. The
optional service job-provider interface is not configured or exposed as MCP tools.
An external AI client may send project text to its model provider; check that
client's privacy settings before supplying private captions.

## Editing recipes

Choose the task, then keep its timing, replacement and retry warnings alongside
the example. Discover exact input fields in the [tool catalog](#tool-catalog).

| Task | Recipes |
|---|---|
| Captions | [Inspect timing density](#inspect-caption-timing-density) · [Import](#import-subtitle-text-with-an-explicit-clock) · [Split](#split-one-caption-at-a-text-boundary) · [Merge](#merge-two-adjacent-authored-captions) · [Insert/remove](#insert-or-remove-one-authored-caption) · [Edit one cue](#edit-one-authored-caption) · [Correct text](#correct-caption-text-without-replacing-cues) · [Shift timing](#shift-caption-timing-without-replacing-text) · [Style](#adjust-global-caption-appearance) |
| Timeline | [Split a clip](#split-one-clip-occurrence) · [Repeat a clip](#repeat-one-clip-occurrence) · [Move a clip](#move-one-clip-to-a-final-position) |
| Composition | [Credit](#set-a-source-credit-independently) · [Effects](#adjust-video-effects-independently) · [Edit a card](#edit-an-existing-timed-card) · [Add/remove cards](#create-scripted-cards-without-importing-a-whole-project) · [Stacking](#change-card-stacking) |
| Grouped/template edits | [One commit](#apply-related-edits-in-one-commit) · [Export a composition](#export-the-current-composition-as-a-template) · [Apply a template file](#apply-an-exported-custom-template) |

### Apply related edits in one commit

Call `moment_project_batch` with 1–20 `operations`. Each operation requires a core
`command` name and its `arguments`, validated against that individual command’s
schema. Put `projectId` only on the outer tool call, not inside each operation:

```json
{
  "projectId":"session",
  "operations":[
    {"command":"project.update","arguments":{"patch":{"speed":2}}},
    {"command":"credit.update","arguments":{"patch":{"text":"Source: Example","start":4,"end":6}}}
  ]
}
```

This example assumes the initial 12-second demo: speed 2 produces six output
seconds, so the next edit sets the final two seconds of credit. Later steps see
the copied state produced by earlier steps, including changed indexes and timing.
Any step’s validation failure prevents **all** edits from being committed.
Known errors keep their original code and identify the zero-based operation in
`error.path`, for example `arguments.operations[1].arguments.patch`.

| Contract | Behavior |
|---|---|
| Allowed commands | Explicit editing-command allowlist in the discovered schema; project updates, template application, timeline/text/effects/card/caption edits |
| Excluded | `project.import`, read/export commands, `jobs.*`, nested `project.batch` |
| Result | `{updated, operationCount, outputDuration}`; count is the number submitted, not changed steps |
| Step results | Not returned; no variables or references to earlier results. Read the resulting project separately |
| All no-ops | No commit and `updated:false`; empty/redundant patches can still count as mutations under their individual contracts |

This is one `tools/call`, **not a JSON-RPC request array**; protocol batch arrays
remain unsupported. Normal JSON/frame limits apply to the whole request, not to
each operation separately. A generic nested `arguments` object does not bypass
individual command validation. Browser same-page use creates one undo step;
there is no new batch UI or MCP undo tool.

The service prepares a copy and calls its commit port at most once. Custom hosts
still owe atomic storage and conflict checks; this is not a cross-writer or external
storage transaction. An uncertain commit or lost response requires a fresh
`moment_project_get` before retrying, especially when the batch contains duplication
or splitting. See the [CLI dry-run and failure example](../INTEGRATIONS.md#여러-편집을-한-번에-반영).

### Export the current composition as a template

Call `moment_template_export` to capture the current session’s composition without
editing the project or writing the browser library:

```json
{"projectId":"session","id":"custom-my-style","name":"My style"}
```

Save **`structuredContent.data`** as a separate `.moment-template.json` file, not
the MCP envelope. The existing `moment_template_apply_document` can apply it later.

| Contract | Behavior |
|---|---|
| `id` | Required nonblank string, at most 200 UTF-16 code units; preserved exactly, cannot collide with a built-in template ID |
| `name` | Required nonblank string, at most 40 UTF-16 code units before trimming; trimmed, never silently truncated |
| Result | Existing `moment-template` format version 1; maximum 256 KiB of pretty-printed UTF-8 JSON |
| Captured | Visual settings, title/credit text, timed cards, global keywords and speaker labels/colors |
| Excluded | Dialogue captions, clip list, source video/audio; not a full project or library backup |
| Failure | Invalid input or portable-document validation returns `INVALID_ARGUMENT`; no partial project/library change |

Timing follows existing custom-template capture rules: title/credit times become
relative to output duration (null ends stay null); cards intersecting the output
range are clipped, outside cards are omitted, remaining cards are sorted by start
and normalized. This is not a byte-for-byte archive of the card array. Review saved
text before sharing. The tool neither persists a browser template nor adds history;
it is read-only and excluded from `project.batch`.

Run this from the repository root; existing output files are protected by default:

```sh
node cli/moment.mjs init --out template-source.json
node cli/moment.mjs exec template.export --project template-source.json --json '{"id":"custom-my-style","name":"My style"}' --out my-style.moment-template.json
node --input-type=module <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const document=JSON.parse(readFileSync('my-style.moment-template.json','utf8'));
writeFileSync('apply-my-style.json',JSON.stringify({document,withContent:false}),{flag:'wx'});
JS
node cli/moment.mjs exec template.apply.document --project template-source.json --args-file apply-my-style.json --out styled-project.json
```

The export’s `--out` contains the returned template document, not a project.
Apply arguments wrap it as `{document,withContent}`; do not pass the bare template
file as an arguments file. `withContent:false` preserves authored text/cards as
explained below.

A dependency-free service call, with no file writes or media access:

```sh
node --input-type=module <<'JS'
import {createDemoProject} from './dist/core/project.mjs';
import {createEditorService} from './dist/integration/editor-service.mjs';
const project=createDemoProject();
const service=createEditorService({getProject:()=>project,
  commitProject:()=>{throw new Error('Read-only export must not commit');}});
const result=await service.execute('template.export',{id:'custom-my-style',name:'My style'});
if(!result.ok) throw new Error(result.error.message);
console.log(JSON.stringify(result.data));
JS
```

### Apply an exported custom template

Use `moment_template_apply_document` with a parsed portable template, not a file
path or browser-library ID. The required `document` is the full
`{format:"moment-template", formatVersion:1, template:{...}}` envelope. Optional
`withContent` defaults to `false`. For a client that already holds `document`:

```js
const argumentsForTool = {projectId: "session", document, withContent: false};
// Send argumentsForTool to moment_template_apply_document via tools/call.
```

| Application mode | Preserved | Applied |
|---|---|---|
| `withContent:false` | Title lines, credit text, existing cards, dialogue captions | Visual settings, title/credit timing, effects, global keywords, speaker labels/colors |
| `withContent:true` | Dialogue captions | The same settings plus template title, credit and cards |

The shared validator checks version, known fields, nested styles and a 256 KiB
pretty-printed document limit before applying to a project copy. Invalid documents
leave the project unchanged. Relative title/credit times scale when the template
sets `relativeTiming:true`; applying content scales stored normalized card times
to the current output duration. These are existing custom-template semantics,
not permission to rescale all project times yourself.

The template ID becomes the project’s `templateId`; the command does not allocate
a fresh library ID, import media or persist a browser-library entry.
`moment_templates_list` still returns only built-ins. Save the resulting project
with `moment_project_get`, not the acknowledgment. For protected file-oriented
work, see the [CLI wrapper example](../INTEGRATIONS.md#내보낸-템플릿을-climcp로-적용).

### Split one clip occurrence

Read `moment_project_get` first and inspect `project.clips` within its returned
portable document. `moment_timeline_split` addresses an occurrence by array index,
not by media identity. These arguments split the initial 12-second demo at 6 seconds:

```json
{"projectId":"session","clipIndex":0,"sourceTime":6}
```

| Input/constraint | Meaning |
|---|---|
| `clipIndex` | Required integer 0–999; zero-based position in the current clip array |
| `sourceTime` | Required finite number 0–86,400; original source seconds, before trim/speed |
| Boundaries | Must leave at least 0.1 seconds on each side within that clip |
| Capacity | Rejects when the array already contains 1,000 clips; no partial change |

Repeated source ranges still have distinct indexes. Only the selected occurrence
is split, retaining order, intended total duration and speed. The caption array
and title/card times remain unchanged; no retiming is applied. Source captions
crossing the new boundary may produce adjacent output cues, so SRT/VTT bytes need
not remain identical. Do not confuse output/playhead seconds with `sourceTime`.

Use the returned standard acknowledgment to check success, then retrieve the
project to save it. The browser's existing split action uses the same command and
is one undo step; standalone MCP still has no undo tool.

### Move one clip to a final position

Read `moment_project_get` and inspect the current `project.clips` array, then call
`moment_timeline_move`. For a project with at least three clips:

```json
{"projectId":"session","clipIndex":0,"toIndex":2}
```

| Contract | Meaning |
|---|---|
| `clipIndex`, `toIndex` | Required zero-based integers 0–999, each within the current array |
| Destination | Final index after moving, not a before-removal insertion slot |
| Result | `{updated:boolean,outputDuration}`; same position returns `updated:false` without committing |
| Invalid index | `INVALID_ARGUMENT`, with `arguments.clipIndex` or `arguments.toIndex`; no partial change |
| Preserved | Source intervals, authored caption array/metadata, audio offset and exact title/credit/card time values |

Only array order changes. Repeated identical source intervals are distinct indexed
occurrences, not stable IDs. Source captions follow the reordered source occurrences;
timeline captions keep their existing pre-speed times. No clip duration is added
or removed, and output layers are not proportionally retimed. This differs from adding/removing
clip duration. Read again before retrying an uncertain result—indices may now refer
to other clips. In `project.batch`, each operation uses the preceding step’s current
indices; the maximum remains 20 operations. Save using `moment_project_get` afterward.
[Executable CLI sequence](../INTEGRATIONS.md#클립을-지정한-위치로-이동) demonstrates setup and saving.

### Repeat one clip occurrence

Read `moment_project_get` and inspect the current `project.clips` before calling
`moment_timeline_duplicate`:

```json
{"projectId":"session","clipIndex":0}
```

The required `clipIndex` is an integer `0..999` selecting an existing occurrence.
Its source interval is inserted **immediately after it**, not copied to a new media
file. The initial 12-second demo becomes 24 seconds. An absent index or an already
1,000-clip array returns `INVALID_ARGUMENT` without mutation.

| Project content | Effect of duplication |
|---|---|
| Source-clock captions | Appear again in the new occurrence; authored cue array is not copied |
| Timeline-clock captions | Stay at absolute pre-speed times; not duplicated or shifted after insertion |
| Title, credit and timed cards | Timing scales proportionally with output duration; null ends stay null, using existing timeline replacement rules |
| Speed, media, audio offset, global effects | Unchanged; no new per-clip effect state |

The result is `{updated:true, outputDuration}`; retrieve the document separately
to save it. A lost response requires re-reading the clip array before retrying:
a second successful call inserts another occurrence. Browser duplication selects
the inserted clip, seeks its start and is one undo step; MCP does not control the
browser selection/playhead or provide undo.

### Import subtitle text with an explicit clock

`moment_captions_import` parses supplied SRT/VTT text and replaces the complete
caption array in one validated mutation. Save the existing project first if you
need a reversible copy. A minimal call’s arguments are:

```json
{"projectId":"session","basis":"source","text":"1\n00:00:01,000 --> 00:00:02,000\nHello\n"}
```

| Required input | Meaning |
|---|---|
| `text` | Subtitle contents, not a path; at most 100,000 UTF-16 code units |
| `basis:"source"` | Original media seconds **before speed**; bounded by source duration |
| `basis:"timeline"` | Edited timeline seconds **before speed**; bounded by the sum of clip durations |

There is **no output-clock import** or automatic inverse speed/trim mapping. An
exported edited SRT/VTT is not a reversible project backup; choose the intended
clock explicitly rather than importing final-output times as source times.

The existing plain subtitle parser clamps cue ends to the chosen duration and
drops out-of-range or nonpositive intervals. It removes markup and decodes known
character references once; speaker/style/keyword metadata are not imported.
Empty input or no valid cues returns an error without replacing current captions.
This permissive parser may skip malformed cues; it is not a full SRT/WebVTT
conformance validator. Success includes `importedCaptions`, the applied cue count,
alongside `updated:true` and `outputDuration`.

| Limit | Scope |
|---|---|
| 100,000 UTF-16 code units | API text string, including CLI/MCP, due to shared JSON validation |
| 2 MiB UTF-8 | Existing parser/browser-file byte budget; browser limit is unchanged |
| 10,000 cues / 2,000 UTF-16 code units per cue | Shared parser output limits |

The tool does not read files or upload media. Use the [CLI args-file recipe](../INTEGRATIONS.md#srt-파일을-명령-인수로-감싸기)
for local files, or pass already-read text through your client. Save the edited
document using `moment_project_get`; the acknowledgment is not the project.

### Read authored captions in pages

Use `moment_captions_list` to retrieve literal cue text near an inspection result
without requesting the entire project. This is ordinary tool input, **not MCP
cursor pagination**:

```json
{"projectId":"session","offset":0,"limit":20}
```

| Field | Contract |
|---|---|
| Input `offset` | Integer 0–10,000; default 0 |
| Input `limit` | Integer 1–50; default 20 |
| Result `totalCaptions`, `offset`, `limit` | Current authored count and effective request values |
| Result `captions[]` | `{captionIndex, caption}`: zero-based current array index and detached, exact authored cue |
| Result `nextOffset` | `offset + captions.length` when more remain; otherwise `null` |

Repeat using `nextOffset` and stop at `null`. An allowed offset beyond the current
count returns `captions:[]`, `nextOffset:null`. See the [executable CLI review and
pagination recipe](../INTEGRATIONS.md#저장된-자막을-나눠-조회).

The page preserves authored order, Unicode and metadata, including an absent
`basis` (which means source). Cue times are **before speed**, not derived output
occurrences. A repeated source cue is still one authored entry. The response is a
copy, not an editable reference. This limits response volume, not runtime to O(page).

After `moment_captions_inspect`, request a page around an issue's `captionIndex`,
review its literal text, then use `moment_captions_update` with that current index.
Retrieve `moment_project_get` separately to save edits. Pages are not project
backup documents. Each request reads live state: no snapshot, stable revision or
cross-writer guarantee. Re-read after structural edits or uncertain mutations;
do not keep an index across a split, merge or replacement without checking it.
This read-only tool changes no history and is not allowed inside `project.batch`.

### Inspect caption timing density

Call `moment_captions_inspect` after editing, with a threshold you choose:

```json
{"projectId":"session","maxGraphemesPerSecond":5,"limit":10}
```

The threshold is a required finite positive number. The example `5` is not a
recommended reading-speed standard. Optional `limit` is an integer `1..100`,
default `20`. The read-only tool neither edits the project nor creates history;
it is excluded from `project.batch`, so call it separately after the batch.

The metric counts `Intl.Segmenter` graphemes except clusters made entirely of
whitespace, divided by each derived cue’s **output seconds after speed**. Punctuation
and literal markup count; whitespace-only text has zero count and is not flagged.
Cuts and repeats can yield multiple occurrences of the same authored cue, each
with its full text. This is not language/Netflix compliance, speech alignment,
rendered text fitting or an SRT/VTT export-validity check.

| Response field | Meaning |
|---|---|
| `metric`, `maxGraphemesPerSecond` | `"non-whitespace-graphemes-per-second"` and the requested threshold |
| `totalOccurrences`, `flaggedOccurrences`, `omittedOccurrences` | All derived cues, cues strictly exceeding the unrounded threshold, flagged cues not included because of `limit` |
| `issues[].occurrenceIndex`, `captionIndex`, optional `clipIndex` | Zero-based output-start-order occurrence, authored cue, source clip; timeline cues omit `clipIndex` |
| `issues[].start`, `end`, `graphemeCount`, `graphemesPerSecond` | After-speed output times, counted graphemes and unrounded rate |

Issues are ordered by rate descending, start ascending, then occurrence index ascending. No full caption text is returned. Resolve the
reported authored caption index using `moment_captions_list` or `project.captions`; a derived occurrence
is not an independently editable cue. Check omitted issues before concluding that
all dense passages have been reviewed.

Existing 10,000-derived-cue and 2 MiB repeated raw UTF-8 text limits apply. Invalid
nonpositive/nonfinite output duration or nonfinite rate is rejected, rather than
reported as a misleading number. These failures and unavailable safe grapheme segmentation return `INVALID_ARGUMENT`;
derived cue/byte overflows return `CAPTION_OUTPUT_LIMIT`.
Save/edit the project only if requested; inspection is not automatic correction.

### Split one caption at a text boundary

Read the current `project.captions` and its literal text, then call
`moment_captions_split`. For a cue containing `Hello world`, these arguments keep
`Hello ` (including its trailing space) and `world` as separate cues:

```json
{"projectId":"session","captionIndex":0,"textOffset":6}
```

| Required input/constraint | Meaning |
|---|---|
| `captionIndex` | Existing authored row index, integer `0..9999`, not a visible output occurrence |
| `textOffset` | Internal UTF-16 code-unit offset, integer `1..1999`; not a grapheme ordinal |
| Boundary | Must lie between complete graphemes according to `Intl.Segmenter`; no splitting emoji/combining sequences |
| Text/capacity | Literal substrings, no trimming; neither side may be whitespace-only. At most 10,000 resulting authored cues |

Metadata is retained on both cues, with `timing:"estimated"`. Original outer
start/end are retained; the inner time is proportional to grapheme counts on each
side, including preserved spaces. This is not word/speech alignment. Missing
`Intl.Segmenter`, invalid boundaries/indexes, blank sides or capacity violations
return `INVALID_ARGUMENT` without mutation; no unsafe segmentation fallback is used.
There is no arbitrary minimum duration, but computed split times must remain
strictly between the original endpoints despite numeric precision.

The result is `{updated:true, outputDuration, createdCaptionIndex}`, where the
new second cue is immediately after the original. Source-clock text can recur in
intersecting clips; timeline-clock cues retain pre-speed timing. Existing export
limits still apply: very short intervals can collapse on SRT/VTT millisecond
rounding, and literal blank lines or byte/derived-cue limits can still reject export.
After a lost response, re-read before retrying because the original row may already
be split. Save via a separate project read. The browser uses a collapsed textarea
caret and **Split** action, focuses the new row and offers one undo step; bulk long-caption splitting
remains separate. See the [runnable CLI example](../INTEGRATIONS.md#자막-하나를-커서-위치에서-분할).

### Merge two adjacent authored captions

Read `moment_project_get` and inspect `project.captions`, then call
`moment_captions_merge` with the first row’s current index:

```json
{"projectId":"session","captionIndex":0}
```

`captionIndex` is a required integer `0..9998`; both it and the next authored row
must exist. It is not a page index or a derived output occurrence. The cues must
have matching clock, speaker and keywords, with chronological, non-overlapping
times (`next.start >= first.end`). Omitted basis means `source`; missing speaker
or keyword strings compare as empty strings, not null. Invalid indexes, incompatible metadata,
overlap/reversed order or overlong text return `INVALID_ARGUMENT` atomically.

The result spans the first start to the second end, joins literal texts with one
ASCII space, and preserves the first cue’s metadata; if either timing is estimated,
the result has `timing:"estimated"`. Text must fit 2,000 UTF-16 code units.
Any gap between the cues now displays the merged text too. This is not word-level
alignment. Source captions can repeat their whole merged text in intersecting
edited clips; timeline captions retain their absolute pre-speed clock.
Existing SRT/VTT blank-line rules and export byte/derived-cue limits still apply:
literal boundary newlines are not cleaned up, so merge success does not guarantee
that every export format succeeds.

The acknowledgment is `{updated:true, outputDuration, mergedCaptionIndex}`.
Read the document to save it. After a lost response, inspect the array before
retrying: merging again at the same index can consume another row. Browser
**Merge with next caption** works across page boundaries and is one undo step;
standalone MCP has no undo tool. See the [complete CLI example](../INTEGRATIONS.md#인접한-자막-합치기).

### Insert or remove one authored caption

Read `moment_captions_list` before editing. These tools change one authored array
entry, not a derived output occurrence, without resubmitting all cues:

```json
{"projectId":"session","captionIndex":1,"caption":{"start":1,"end":2,"text":"New cue","basis":"source"}}
```

Use those arguments with `moment_captions_insert`. To remove that inserted cue,
call `moment_captions_remove` with `{"projectId":"session","captionIndex":1}`.

| Input/constraint | Contract |
|---|---|
| Insert index | Integer 0 through current count inclusive; count means append |
| Remove index | Integer identifying an existing cue; removing the last cue may leave none |
| Required caption fields | `start`, `end`, `text` |
| Optional caption fields | `basis`: `source`/`timeline`; `speaker`: `""`/`"0"`/`"1"`; `keywords`: up to 500 UTF-16 code units; `timing`: `estimated` |
| Text | Up to 2,000 UTF-16 code units; empty is legal, not a guarantee of valid subtitle export |
| Time | `0 <= start < end`, within the selected pre-speed duration and the existing 86,400-second endpoint ceiling |
| Capacity | Insert rejects when 10,000 cues already exist |
| Invalid input | Bad position, capacity overflow, cue schema or clock violation returns `INVALID_ARGUMENT`; no partial edit |
| Result | `{updated:true, captionIndex, totalCaptions, outputDuration}`; removal returns the old deleted position |

Omitted `basis` means source. Timeline basis uses edited seconds **before speed**.
There is no sorting, retiming or alteration of other cue metadata. Both commands
are non-idempotent: indices shift after insertion/removal. On an uncertain result,
read again instead of blindly retrying; the next removal could delete a different cue.

Both are supported in `project.batch`, using each preceding step's current array.
For example, remove index 0, then insert at index 0 to replace the first entry.
All steps validate before one commit; 24 editing command names are allowed, but
there are still at most 20 operations per batch. See the [executable CLI sequence
and batch recipe](../INTEGRATIONS.md#자막-하나를-추가하거나-삭제).
Mutation acknowledgments are not saved documents: retrieve `moment_project_get`
and save separately. CLI mutations require `--out` or `--dry-run`; their output
is a full project document, unlike a `captions.list` page.

### Edit one authored caption

Read the current `project.captions`, then use `moment_captions_update` to patch one
row without resending the whole array:

```json
{"projectId":"session","captionIndex":0,"patch":{"text":"Start at your own pace","speaker":"0","keywords":"pace"}}
```

The required `captionIndex` is an existing zero-based array position (`0..9999`),
not a stable ID or derived output occurrence. Required `patch` accepts only:

| Field | Contract |
|---|---|
| `text` | At most 2,000 UTF-16 code units; empty allowed |
| `speaker` | `""`, `"0"` or `"1"`; empty clears the assignment |
| `keywords` | String up to 500 UTF-16 code units; empty allowed |
| `start`, `end` | Finite `0..86400` seconds in the existing cue’s **pre-speed** clock |

Unspecified fields, `basis`, `timing`, array order, other cues and project settings
remain unchanged. Patching `basis` or `timing` is rejected. If either endpoint is
supplied, the resulting positive interval must fit the existing source duration
or pre-speed edited duration. Content-only edits preserve valid existing timing
outside the current duration. Empty text may still fail SRT/VTT export validation.

Invalid indexes/fields/timing return `INVALID_ARGUMENT` without mutation. The
result is `{updated:true, outputDuration, captionIndex}`, including empty/redundant
patches under the existing update contract; read the project separately to save it.
This command is allowed in `project.batch`. After earlier splits/merges, use the
resulting index, not the old position. Neither the index nor a batch promises
protection from another writer changing the project; inspect uncertain state first.

### Correct caption text without replacing cues

Call `moment_captions_text_replace` after importing the intended document:

```json
{"projectId":"session","find":"하루","replacement":"하루의 기록"}
```

| Input/result | Meaning |
|---|---|
| `find`, `replacement` | Required strings, each at most 2,000 UTF-16 code units; `find` cannot be empty |
| Matching | Literal, case-sensitive, non-overlapping; no regex or Unicode normalization |
| `matches` | Total matched occurrences, not cue count |
| `changedCaptions` | Cues whose text actually changed; timing, basis, speaker, keywords and order are preserved |

No match or an identical replacement returns `updated:false` without committing
a project change. An empty replacement is allowed only when every changed cue
remains nonempty after `trim()`. A changed cue that becomes blank or exceeds
2,000 UTF-16 code units rejects the entire operation before commit. To remove a
cue, explicitly use `moment_captions_replace`; this tool never deletes cues.
Title, credit and timed-card text are not searched.

Read `moment_project_get` to save the resulting document. MCP has no undo tool;
retain a prior export when reversibility matters. The browser groups an applied
replace-all into one undo step, but is a separate session.

### Shift caption timing without replacing text

Call `moment_captions_timing_shift` after checking the current cue bounds:

```json
{"projectId":"session","basis":"source","delta":0.25}
```

| Required input | Meaning |
|---|---|
| `basis:"source"` | Original media clock; includes existing cues with omitted basis |
| `basis:"timeline"` | Edited-timeline clock, bounded by the sum of clip durations |
| `delta` | Finite signed seconds **before speed**; positive delays, negative advances |

Every cue in that basis is shifted, not only visible rows or search matches.
The whole edit fails if any resulting interval is out of bounds or nonpositive;
the existing 86,400-second caption endpoint cap also applies. Cues are not cropped
or dropped to fit; tiny floating-point roundoff at an endpoint is corrected.
Text, speaker/keyword metadata, basis, order,
other project fields and audio offset remain unchanged. Source-clock shifts
across trim boundaries may change which occurrences appear in output. This is
a constant timing offset, not automatic speech alignment or speed correction.

The result is `{updated, shiftedCaptions, outputDuration}`; `shiftedCaptions` counts
cues whose times actually changed. A zero delta or no
matching cues returns `updated:false, shiftedCaptions:0` without a commit. Read
`moment_project_get` to save the project. Browser UI applies a real change as one
undo step; MCP has no undo tool. The [complete CLI example](../INTEGRATIONS.md#자막-시간을-앞뒤로-이동)
uses an imported cue with room to move; the default demo spans the full duration
and cannot necessarily be shifted without hitting a boundary.

### Adjust global caption appearance

Use `moment_captions_style_update` for requests such as “make captions larger,”
without reconstructing and importing the full project. For example:

```json
{"projectId":"session","patch":{"captionSize":48,"captionY":0.72,"captionColor":"#FFFFFF"}}
```

| Optional `patch` field | Accepted values |
|---|---|
| `style` | `impact`, `accent`, `highlight`, `minimal` |
| `captionSize` | 10–120, relative to a 540-wide canvas |
| `captionX`, `captionY` | Each 0–1 of canvas width/height |
| `captionColor`, `captionAccent` | `#RRGGBB` or `#RRGGBBAA` |
| `captionStroke` | 0–20, relative to a 540-wide canvas |
| `captionItalic` | Boolean |
| `captionAnimation` | `none`, `fade`, `slide`, `pop` |

`patch` is required; all fields inside it are optional. Only supplied fields change.
An empty patch is accepted and returns the standard `{updated:true, outputDuration}`
acknowledgment, not the no-change contract of `moment_captions_text_replace`.
Setting `style` alone does **not** apply the UI preset’s italic/stroke defaults;
supply those fields explicitly when intended.

Size and stroke scale with canvas width; text fitting can shrink the requested
size further. Color precedence also matters: `highlight` uses dark text on an
accent-colored box without stroke; otherwise assigned speaker colors win, then
`accent` style uses `captionAccent`, and other styles use `captionColor`. Changing
`captionColor` does not override speaker colors or the highlight treatment.

These existing global settings apply across caption cues in the visual renderer.
Text, timing and speaker metadata are untouched. Plain SRT/VTT do not carry these
styles, and this command does not encode video. Retrieve `moment_project_get`
to save the updated project; `moment_render_plan` remains only a plan.

### Set a source credit independently

`moment_credit_update` partially updates `design.credit`, not the base title,
captions or timed cards. Its visual text is not included in SRT/VTT/TXT exports.

| Optional field inside required `patch` | Contract |
|---|---|
| `text` | At most 100 UTF-16 code units; empty string allowed |
| `enabled`, `italic` | Booleans; `enabled:false` hides the credit |
| `color` | Six- or eight-digit hex color, including `#` |
| `x`, `y` | Normalized canvas coordinates, `0..1` |
| `size` | `10..120`; renderer scales and may shrink to fit, not fixed pixels |
| `start`, `end` | Final output seconds **after speed**; `end:null` follows the output end |

Read `moment_render_plan` and its `data.output.duration` first. For a 12-second
output, show a credit in the final two seconds with:

```json
{"projectId":"session","patch":{"text":"Source: Example","enabled":true,"start":10,"end":12}}
```

If either timing field is supplied, the resulting start must satisfy
`0 <= start < outputDuration`; end must be `null` or satisfy
`start < end <= outputDuration`. There is no separate 86,400-second cap.
Content-only updates preserve existing valid timing even if outside the current
output. Invalid fields/timing return `INVALID_ARGUMENT` without partial changes.
The acknowledgment is `{updated:true, outputDuration}`, even for empty/redundant
patches, consistent with other partial design updates; this is not a no-op signal.
Retrieve `moment_project_get` afterward to save the edited document.

### Adjust video effects independently

Use `moment_effects_update` with a partial `patch`, for example:

```json
{"projectId":"session","patch":{"brightness":1.1,"contrast":1.05}}
```

| Color/frame field | Allowed value (default) |
|---|---|
| `brightness` | 0.7–1.3 (1) |
| `contrast` | 0.7–1.5 (1) |
| `saturation` | 0–1.6 (1) |
| `vignette` | 0–0.6 (0) |

| Motion/boundary field | Allowed value (default) |
|---|---|
| `motion` | `none`, `in`, `out` (`none`) |
| `strength` | 0–0.4 (0.12) |
| `transition` | `none`, `fadeBlack`, `flash` (`none`) |
| `transitionDuration` | 0.05–0.7 output seconds (0.2) |

| Progress field | Allowed value (default) |
|---|---|
| `progress` | Boolean (`false`) |
| `progressPosition` | `top`, `bottom` (`bottom`) |
| `progressColor` | `#RRGGBB` or `#RRGGBBAA` (`#b5ff00`) |

`patch` is required, but its fields are optional. An empty patch returns the
standard `{updated:true, outputDuration}` acknowledgment. Only supplied effects
fields change; clips, speed, captions, cards, titles, audio and timing stay intact.
There is no reset tool: send the intended fields with their explicit defaults.

Transitions are black/white overlays at each clip’s start and end, **not overlapping
clips or crossfades**. Their duration is capped at half that clip’s output duration.
Motion zoom scales from 1 to `1 + strength` for `in` and reverses for `out`,
multiplying the existing framing zoom. These are the existing renderer’s effects,
not new rendering capabilities. Saving a project requires `moment_project_get`;
plain SRT/VTT do not carry effects, and `moment_render_plan` does not encode video.

### Edit an existing timed card

Read `moment_project_get`, select the intended entry in the returned
`project.overlays`, then call `moment_overlays_update`. Do not invent an ID:

```js
const card = document.project.overlays[0]; // Select the intended existing card.
if (!card) throw new Error("No existing card to edit");
const argumentsForTool = {projectId:"session", id:card.id, patch:{text:"준비부터 시작해요"}};
// Send argumentsForTool to moment_overlays_update via tools/call.
```

Required `id` is an exact existing ID, at most 2,000 UTF-16 code units and not
whitespace-only. A missing card returns `NOT_FOUND`. Required `patch` may be empty;
success uses `{updated:true, outputDuration}`. No card creation, deletion,
reordering or ID renaming is provided by this tool.

| Text/type fields | Accepted values |
|---|---|
| `text`, `detail`, `label` | Each at most 2,000 UTF-16 code units |
| `kind`, `role` | `card`/`countdown`, `headline`/`free` |
| `presentation`, `animation` | `plain`/`panel`, `none`/`fade`/`slide`/`pop` |
| `enabled` | Boolean |

| Appearance fields | Accepted values |
|---|---|
| `color`, `accent`, `background` | `#RRGGBB` or `#RRGGBBAA` |
| `x`, `y`, `width` | Each 0–1 |
| `size`, `stroke` | 10–120, 0–20 |
| `backgroundOpacity` | 0–1 |

`start` and `end` are finite nonnegative **output seconds after speed**. Supplying
either validates the complete resulting interval: `0 <= start < end <= outputDuration`.
There is no fixed 86,400-second cap. Content-only edits leave already-valid stored
out-of-output-range timing untouched rather than clamping it.

Other cards, the base title, captions, media and clips are unchanged. In the
existing renderer, an active headline can hide the base title; the last active
headline in array order wins. Size/stroke scale by `min(width/540, height/960)`,
with text fitting; normalized positions are constrained to safe bounds. Card width
0 retains the 0.78 fallback, with displayed width capped at 0.82 of the canvas.
Do not promise fixed-pixel output from these values.

The [CLI example](../INTEGRATIONS.md#실제-카드-id를-조회하는-cli-예제) creates recipe
cards and reads a real ID. Save the edited project via a separate read; no video
is encoded by this tool.

### Create scripted cards without importing a whole project

Read the current project first. For a 12-second output, call `moment_overlays_add`
once for each object below, in order:

```json
[
  {"projectId":"session","id":"hook","patch":{"text":"세 가지 팁","start":0,"end":2}},
  {"projectId":"session","id":"tip","patch":{"text":"핵심부터 간단히","start":2,"end":8}},
  {"projectId":"session","id":"cta","patch":{"text":"직접 시도해 보세요","start":8,"end":12}}
]
```

This example is **three separate tool calls**, not one array argument. Use
`moment_project_batch` if all three must validate and commit together. Confirm
the actual output duration and choose IDs absent from the current project first.
Each call validates and commits one appended card, using existing new-card visual
defaults plus supplied fields from the [card styling table](#edit-an-existing-timed-card).

| Operation | Contract |
|---|---|
| Add ID | Required nonblank string, at most 2,000 UTF-16 code units; duplicate → `INVALID_ARGUMENT`, never upsert |
| Add patch | Required `text`, `start`, `end`; `0 <= start < end <= outputDuration`, after speed |
| Capacity | At most 12 cards, including disabled cards; full capacity → `INVALID_ARGUMENT`, no mutation |
| Remove ID | Exact nonempty ID, including a legacy whitespace-only ID; missing → `NOT_FOUND` |

Remove the example CTA with `moment_overlays_remove` arguments
`{"projectId":"session","id":"cta"}`. Remaining card order and unrelated project
content stay intact. Both operations return `{updated:true, outputDuration, id}`;
retrieve `moment_project_get` to save the result.

Retain caller-chosen IDs across retries. If a response is lost, read the live
project before adding again: a duplicate error is not permission to overwrite
or generate another copy. Appended headline cards can hide the base title; when
headlines overlap, the last active one wins. No media is uploaded or encoded.

### Change card stacking

Read `project.overlays`, then call `moment_overlays_move` with the existing ID
and its zero-based **final destination**. For the three-card example above,
before removing the CTA:

```json
{"projectId":"session","id":"hook","toIndex":2}
```

| Input/result | Meaning |
|---|---|
| `id` | Exact nonempty existing ID, at most 2,000 UTF-16 code units, including legacy whitespace-only IDs; missing → `NOT_FOUND`, re-read the current cards |
| `toIndex` | Integer from `0` to card count minus one, including disabled cards; outside → `INVALID_ARGUMENT` |
| Stack order | Index `0` is back; last index is front among cards, not among all renderer layers |
| Result | `{updated, id, toIndex, outputDuration}`; same index → `updated:false`, no commit |

Timing, text and all other card properties remain unchanged; the other cards
keep their relative order. Overlapping `free` cards draw in array order; only
the last active `headline` is shown. This does not move cards above/below captions
or other base layers. Browser **Bring to front / Send to back** uses the same card stack and
keeps the selected card. Real UI moves have one undo step; MCP has no undo tool.
If the response is lost, inspect the current ID/order before retrying; retrieve
`moment_project_get` afterward to save the document.

## Interface language is not project language

The browser offers Korean (`ko`), English (`en`) and Simplified Chinese (`zh-CN`).
Its saved language choice takes priority over a supported browser language, then
falls back to Korean. This is browser presentation state, not an MCP session option.
A failed preference write still allows switching for the current session.

Switching UI language does not translate captions, titles, credits, speaker names,
project names, custom templates or imported content. Built-in gallery metadata is
localized separately from its authored Korean example text. Applying example
content is still an explicit editing command. The ASR language remains a separate
choice. CLI/MCP tool names, arguments, enums, error codes and paths are unchanged;
do not treat a localized label as a template ID or parse translated error prose.
No new tool or project-schema field is required for UI language.

## Repository skill and verification

[The repository skill](../.agents/skills/moment-editor/SKILL.md) routes project
editing and source changes to focused references. Agents with repository skill
discovery can load it directly; otherwise point them to that file. No global
installation or proprietary agent runtime is required.

```sh
npm test
node examples/use-editor-service.mjs
node examples/use-mcp-client.mjs
node --test tests/mcp-stdio.test.mjs
```

Protocol tests use actual Node subprocesses for handshake, import/edit/export,
isolation, errors, notifications and oversized frames. The example verifies the
client workflow across a restart. These checks do not claim live browser testing,
external client-app compatibility, microphone access or actual media encoding.

Protocol references: [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
