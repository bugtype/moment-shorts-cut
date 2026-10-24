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

## Localize presentation, not authored content

Use `dist/i18n.mjs` and the responsibility-specific `dist/i18n/catalogs/` messages.
Keep semantic keys and interpolation parameters in parity for `ko`, `en` and
`zh-CN`. Use `t` for plain strings, `text` for escaped text leaves, `mark` for
whole-leaf/option markers, `attrs` for localized attributes, and `setText`/`setAttr`
for dynamic marked values. Pass `message(key, params)` or a keyed error to live
toasts/dialog headings so an already-visible message can switch languages. Use
`formatError` only at a final plain-text boundary; retain unknown original errors
rather than inventing translations. Clear old translation markers when replacing
a known status with raw provider text.

Translate visible text, accessibility labels, titles, status announcements and
errors together. Locale changes update marked leaves/attributes in place; they
must not reconstruct panels, overwrite input values, move focus, change project
data or add history. Preserve precise limits, units and interpolation placeholders.

Built-in template display metadata can be localized by stable ID. Its example
titles/cards remain authored content; custom names/descriptions and user text are
not translation keys. UI selection does not set ASR language. API commands, IDs,
enums, schemas, error codes and paths remain canonical. Keep all three README
versions aligned, including warnings. Test key/placeholder parity and project,
draft-input and focus preservation; automated checks are not browser-layout QA.

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
