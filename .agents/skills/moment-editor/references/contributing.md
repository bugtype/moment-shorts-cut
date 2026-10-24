# Working on Moment source

**Change the existing responsibility owner, preserve its public contract, and test through the real entry point.**

Read [CONTRIBUTING.md](../../../../CONTRIBUTING.md) for repository conventions. Use this map to keep changes in the existing responsibility boundary rather than adding an integration-only implementation.

## Find the owner

| Change | Owner |
|---|---|
| Document validation, source/timeline/output time rules, SRT/VTT/TXT export | `dist/core/project.mjs`, `dist/captions.mjs` |
| Public editing input schemas and copy-before-commit commands | `dist/core/commands.mjs` |
| Serialized execution, commit port, sanitized errors, optional jobs | `dist/integration/editor-service.mjs` |
| Tool naming, project resolution, MCP result mapping | `dist/integration/mcp-adapter.mjs` |

### Runtime entry points

| Change | Owner |
|---|---|
| Stdio lifecycle and framing | `cli/mcp.mjs`, `cli/mcp-session.mjs` |
| CLI file loading, safe output publication and options | `cli/moment.mjs` |
| Browser orchestration and integration boundary | `dist/app.js` |
| Browser playback, media imports, export and UI bindings | `dist/playback.mjs`, `dist/media-loader.mjs`, `dist/export-flow.mjs`, `dist/app-bindings.mjs` |

Inspect current imports before moving code; these are entry points, not an instruction to introduce additional modules. A responsibility split should reduce coupling, not replace a large function with a bag of callbacks.

## Preserve the contracts

- Keep browser/CLI/MCP commands on the shared validator. A mutation is prepared on a copy, validated, then committed; a failure must not replace the previous project.
- Capture caller inputs before asynchronous service/resolver work. The service queue serializes one instance only; it is not a cross-process or multi-tab transaction.
- `commitProject(next, {previous, command})` belongs to the storage owner. External concurrent writers need an atomic comparison/write there, not a speculative retry inside the command.
- The optional `beforeCommit` hook is synchronous and read-only; it is not a JSON tool argument and does not guard provider side effects.
- Preserve stdio stdout for protocol messages. Diagnostics go to stderr. Do not accidentally start the server on module import when extracting testable logic.
- Keep `projectId` as a selector. A reusable remote host must resolve an authorized service per call; the local server's fixed `session` identifier is not authentication.
- Input schemas, actual runtime validation and returned result fields must agree. Update executable examples and tests when changing a public boundary.
- No background service, external upload, network endpoint or real media provider is implied by a refactor. An accepted render job is not a finished encoded artifact.

## Validate the affected surface

```sh
npm test
node examples/use-editor-service.mjs
node --test tests/mcp-stdio.test.mjs
```

Run documented CLI/MCP examples when changing integration behavior. Add a regression that fails before a behavior fix, including repeated use, cancellation/retry or unchanged state when relevant.

| Check | What it establishes |
|---|---|
| Full test suite | Shared editing, CLI/subprocess protocols, synthetic DOM/media and provider mocks |
| CLI/MCP examples | Documented input/output workflows still execute |
| Direct owner + entry-point tests | A responsibility extraction preserves behavior across its boundary |

None of these establishes actual browser rendering or codec behavior.

For a refactor, preserve observable input/output and errors, then test the extracted owner directly and through its existing entry point. Keep files readable and cohesive around 500 lines; do not compress or split solely to meet a number.

Browser rendering, file pickers, microphone permissions, actual media encoding and third-party client-app integration require separate authorized verification. Do not label VM fixtures or stdio subprocess tests as browser QA. Follow the user's current environment restrictions, even when another machine or browser executable is available.

When publication is authorized, inspect the latest remote head, preserve concurrent changes, and verify the published tree and its CI before saying the change is shipped. This skill itself does not authorize pushing, force-pushing, deployment or rewriting history.
