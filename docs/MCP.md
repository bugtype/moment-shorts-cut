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

All ten tools require **`projectId: "session"`**. Each process owns one independent
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

### Timeline and text changes

| Tool | Editing input | Successful `structuredContent.data` |
|---|---|---|
| `moment_timeline_replace` | `clips: [{start,end}]` | Update acknowledgment and output duration |
| `moment_title_update` | `patch` | Update acknowledgment and output duration |
| `moment_captions_replace` | `captions` | Update acknowledgment and output duration |

Replacement tools replace the **entire array**. Preserve unrequested clips/captions
rather than sending only the changed entry. `withContent:true` applies example title, credit
and card content; use `false` when retaining authored content. `templates_list`
returns built-ins, not custom templates stored in a browser. `title_update` edits
the base title, not timed cards; `patch.lines` contains exactly two strings.

Project updates accept name, ratio, fit, zoom, pan, speed and volumes according to
the discovered schema. Runtime string limits count UTF-16 code units, so non-BMP
characters such as many emoji use two units; schema checks alone are not the
entire domain validation. Unknown fields are rejected. Changing ratio resets zoom/pan.
Timeline and speed changes retime output layers through the shared command logic.
There is no arbitrary patch path, batch tool, file-save tool, media-upload tool,
transcription tool or video-rendering tool on this host.

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
