# Local MCP and AI skill

Moment ships a repository skill and a dependency-free stdio MCP server for editing
project metadata. Neither installs a background service nor connects to your browser.

## Connect a client

Use Node.js 20+ and an MCP client supporting protocol **2025-11-25** and stdio.
Copy the entry from [mcp-client.json](../examples/mcp-client.json) into that client's
MCP configuration, replacing the absolute script path. The example uses the common
`mcpServers` shape; check your client's configuration format. If Node is not on the
client's PATH, use its absolute executable path. No working-directory setting,
package install, API key or HTTP port is needed.

The client launches:

```sh
node /absolute/path/to/moment-shorts-cut/cli/mcp.mjs
```

The process reads newline-delimited JSON-RPC on stdin and reserves stdout for
protocol responses. Closing stdin ends the session. The host negotiates
2025-11-25, requires initialize → notifications/initialized before tools, and
supports ping, tools/list and tools/call. It does not implement HTTP, resources,
prompts, background tasks or server-side authentication. Do not expose it as an
unauthenticated network service.

## Edit a project

All tools require `projectId: "session"`. Each process owns one independent
in-memory project, initially the demo. This identifier selects that project; it is
not a credential or a path. No other project ID resolves.

1. Save editing settings from the browser and supply that JSON to your AI client.
2. Call `moment_project_import` with `{projectId:"session", document:...}`.
3. Discover current inputs with tools/list, then use tools such as
   `moment_project_update`, `moment_timeline_replace` or `moment_captions_replace`.
4. Check `isError` and `structuredContent.ok` after each call.
5. Call `moment_project_get`. Save **structuredContent.data** as the project JSON
   through your client's authorized file workflow, then import it in the browser.
   Save `moment_captions_export`'s `structuredContent.data.text` for SRT.

**Changes disappear when the process exits.** The server never reads or writes
project files, and does not synchronize the open browser. Restarting starts a fresh
demo. For disk-based work, use the existing CLI with a new output path; see
[INTEGRATIONS.md](../INTEGRATIONS.md). Client-side file saving remains a separate
action with the client's own permissions.

The shared service validates changes before committing. Unknown methods/tools
produce JSON-RPC errors; invalid editing inputs and inaccessible projects return
tool errors with `isError: true`. Notifications never execute tools. Input frames
over 10 MiB terminate the process; malformed JSON receives a parse error.
Requests run serially and output honors stream backpressure.

Media bytes are never loaded by this host. Render planning is not encoding;
speech recognition, upload and media-job providers are not configured. A client
using an external AI provider may send project text to that provider: inspect its
privacy settings before supplying private captions.

## Repository skill

[.agents/skills/moment-editor/SKILL.md](../.agents/skills/moment-editor/SKILL.md)
guides project editing and source changes, including time-coordinate rules,
validation, local-first boundaries and test commands. Agents supporting repository
skill discovery can use it directly. Otherwise point the agent to that file;
no global installation or proprietary agent runtime is required.

## Verification and protocol reference

`node --test tests/mcp-stdio.test.mjs` launches actual Node subprocesses and checks
handshake/version negotiation, tool listing, import/edit/export, isolated sessions,
errors, notifications and oversized frames. `npm test` runs the complete suite.
These are synthetic protocol tests, not a claim of verification with every external
MCP client, live browser or media codec.

Protocol references: [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
The existing reusable adapter retains its complete-result metadata; this host
maps its results to the negotiated 2025-11-25 wire shape.
