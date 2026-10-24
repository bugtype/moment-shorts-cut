# Local MCP and AI skill

Moment provides a dependency-free **stdio MCP server for project metadata** and a
repository skill for agents. **Save the edited document before disconnecting: the
session is temporary.** It does not install a service, connect to your open browser,
upload media or encode video.

| Goal | Start here |
|---|---|
| Check the local connection | [Connect a client](#connect-a-client) |
| Edit and keep a project | [Import, edit, inspect, save](#import-edit-inspect-save) |
| Find fields or recover an error | [Tool catalog](#tool-catalog) · [Responses and recovery](#responses-and-recovery) |

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

All nineteen tools require **`projectId: "session"`**. Each process owns one independent
in-memory project, initially the demo. This value is neither a path nor a credential.
Other project IDs return a tool error. A second client process does not share state.

The implementation separates [stdio transport](../cli/mcp.mjs) from
[session dispatch](../cli/mcp-session.mjs). Requests are serialized, output honors
backpressure, and each transport session has its own project and lifecycle state.
The reusable [adapter](../dist/integration/mcp-adapter.mjs) supplies tool mapping;
it is not itself a transport or an authentication server.

## Import, edit, inspect, save

1. Export editing settings from Moment's browser UI and supply that JSON document
   to your AI client. Do not send raw video as a tool argument.
2. Call `moment_project_import` with `{ "projectId": "session", "document": ... }`.
   `document` is the complete `{format:"moment-project", formatVersion:1, project:{...}}`
   envelope, not a filename or only its nested project.
3. Read `tools/list` for current schemas and apply the requested edits. Inspect
   `isError` and `structuredContent.ok` after every call.
4. Call `moment_project_get`, review the edited document, and save its
   **`structuredContent.data`** through the client's authorized file workflow.
   Keep the original file unless replacement was requested.
5. Import the saved document back into the browser. Connect matching original
   video/audio first where required. Matching uses names and video duration, not
   a content hash; retain the actual original media.

Example request after importing a document:

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"moment_project_update","arguments":{"projectId":"session","patch":{"name":"수정한 쇼츠","ratio":"9:16"}}}}
```

A successful mutation returns an acknowledgment such as
`{updated:true, outputDuration:12}` or `{imported:true}`, **not the edited document**.

| Needed result | Tool | Field to save |
|---|---|---|
| Project JSON | `moment_project_get` | `structuredContent.data` |
| SRT/VTT text | `moment_captions_export` | `structuredContent.data.text` |

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
result shape. Nested project state is intentionally an open object there; the
shared project validator still checks its version, required fields, types and
ranges at runtime. Schema discovery does not bypass that validation.

### Read and export

| Tool | Editing input | Successful `structuredContent.data` |
|---|---|---|
| `moment_project_get` | none | Full portable project document |
| `moment_templates_list` | none | Built-in template summaries: `id`, `name`, `category`, `description` |
| `moment_captions_export` | optional `format: "srt"` or `"vtt"` | `{format:"srt", text:"..."}` or `{format:"vtt", text:"..."}` |
| `moment_render_plan` | optional `quality`, `format` | Plan, project snapshot, output settings, required media and `rendered:false` |

Omitting `format` preserves the existing SRT output. To request plain WebVTT, call
`moment_captions_export` with these arguments after importing your document:

```json
{"projectId":"session","format":"vtt"}
```

Save `structuredContent.data.text` as UTF-8 `.vtt`; the server does not save files.

### Project and template changes

| Tool | Editing input | Successful `structuredContent.data` |
|---|---|---|
| `moment_project_update` | `patch` | Update acknowledgment and output duration |
| `moment_project_import` | `document` | `{imported:true}` |
| `moment_template_apply` | `templateId`, optional `withContent` | Update acknowledgment and output duration |
| `moment_template_apply_document` | `document`, optional `withContent` | `{updated:true, outputDuration}` |

### Timeline and text changes

| Tool | Editing input | Successful `structuredContent.data` |
|---|---|---|
| `moment_timeline_replace` | `clips: [{start,end}]` | Update acknowledgment and output duration |
| `moment_timeline_split` | `clipIndex`, `sourceTime` | `{updated:true, outputDuration}` |
| `moment_title_update` | `patch` | Update acknowledgment and output duration |
| `moment_effects_update` | `patch` | `{updated:true, outputDuration}` |

### Timed card operations

| Tool | Editing input | Successful `structuredContent.data` |
|---|---|---|
| `moment_overlays_update` | `id`, `patch` | `{updated:true, outputDuration}` |
| `moment_overlays_add` | `id`, `patch` requiring `text`, `start`, `end` | `{updated:true, outputDuration, id}` |
| `moment_overlays_remove` | `id` | `{updated:true, outputDuration, id}` |

### Caption changes

| Tool | Editing input | Successful `structuredContent.data` |
|---|---|---|
| `moment_captions_replace` | `captions` | Update acknowledgment and output duration |
| `moment_captions_import` | `text`, `basis` | `{updated:true, outputDuration, importedCaptions}` |
| `moment_captions_text_replace` | `find`, `replacement` | `{updated:boolean, matches:number, changedCaptions:number}` |
| `moment_captions_style_update` | `patch` | `{updated:true, outputDuration}` |

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
There is no arbitrary patch path, multi-command batch tool, file-save tool, media-upload tool,
transcription tool or video-rendering tool on this host.

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

This is **three tool calls**, not one array argument or an atomic batch. Confirm
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
| Tool `NOT_FOUND` | Inaccessible project or unknown built-in template; use `session` and discover template IDs. |
| Tool `UNSUPPORTED_VERSION` | Preserve the document and use a compatible editor; do not falsify its version. |
| Tool `CAPTION_OUTPUT_LIMIT` | Derived SRT/VTT exceeds its cue/byte budget; keep the project and reduce output only as requested. |

Tool **`INTERNAL_ERROR`** does not establish atomic failure in every custom host.
Inspect the session before retrying.

**Process exited or response lost:** unsaved state may be gone. If the process is
alive, read before replaying the edit. Otherwise import the last saved document
into a new session.

The shared service validates a copied project before committing. The local host's
commit replaces its in-memory project; reusable custom hosts must supply their own
storage atomicity and authorization. There is no automatic retry or rollback of
an already completed sequence of tool calls.

Input frames exceeding **10 MiB** terminate the process; this includes the whole
JSON-RPC frame, not only the nested project. A CLI document close to its own 10 MiB
limit may therefore be too large to wrap in an MCP import request. There is no
chunked import. Malformed frames receive parse errors and do not become tool calls.
Notifications never execute tools; cancellation notifications do not cancel work.
The host handles short metadata requests serially, not background media tasks.

SRT and VTT export are each limited to 10,000 resulting cues, 2 MiB of repeated raw
caption UTF-8 text and 2 MiB of the complete file, including escaping, timing,
separators and the VTT header where present. The service emits neither format with
a BOM. A source project can still be valid for JSON export when subtitle output
exceeds these limits.

VTT is plain UTF-8 WebVTT with a `WEBVTT` header and dot-separated milliseconds.
It uses the same clip/speed mapping and text escaping as SRT, not rich styles,
regions or speaker metadata. NUL characters are rejected for VTT. Empty VTT
export returns valid `WEBVTT\n\n`; the browser instead skips empty downloads.
Blank cues/paragraphs and intervals that collapse when rounded to milliseconds
are rejected rather than silently dropped or retimed.

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
