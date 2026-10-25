# Working on Moment source

**Change the existing responsibility owner, preserve its public contract, and test through the real entry point.**

Read [CONTRIBUTING.md](../../../../CONTRIBUTING.md) for repository conventions. Use this map to keep changes in the existing responsibility boundary rather than adding an integration-only implementation.

## Engineering workflow

This is a **pstack-inspired project workflow**, not an installation of the pstack
plugin or a claim of host support. It adapts the [upstream workflow](https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/poteto-mode/SKILL.md)
at commit `99b609a72323b70204eab407c622f436e858e112` (pstack 0.15.32).
Use the actual host's tools and authorized environment, not assumed Cursor commands,
model names or automation features. Read this reference explicitly for source work;
file presence or a successful manual read does not prove future automatic loading.

For nontrivial work, follow **Understand → Decompose → Explore → Design → Execute →
Verify → Critique → Fix → Report**. First inspect the current owner, callers, tests
and relevant product behavior; do not propose an already-supported feature. Compare
at least two approaches for material decisions on simplicity, maintenance,
consistency, risk, scope and verifiability. Prefer the smallest complete change.
For a small task, intent → edit → direct check → answer is enough; do not manufacture
agents, alternatives or public process logs for trivial work.

### One job per role

Give each delegated task or routine a contract before it starts:

| Field | Required decision |
|---|---|
| JOB | One outcome, owned files/artifacts and allowed actions |
| SUCCESS | Observable completion condition |
| ANTI-JOBS | Adjacent work and side effects it must not take on |
| ESCALATE | Missing authority, conflicting ownership or evidence that requires a new decision |
| VERIFY | Exact artifact/version, check and evidence the recipient must return |

The lead owns scope and synthesis. A builder owns the bounded edit; a critic returns
read-only findings; a verifier checks the actual resulting artifact. Small tasks
may use one worker, but report that limitation rather than claiming independence.
Assign disjoint writes or serialize shared files. Use only supported models within
the user's choices; different role labels are not evidence of model diversity.

| Need | Routing and boundary |
|---|---|
| Independent coverage | [Swarm](https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/swarm/SKILL.md): partition evidence, declare required coverage and a done condition; missing coverage is not a pass |
| Competing designs | [Arena](https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/arena/SKILL.md): independent alternatives against the same criteria, separate writable artifacts, then verify the synthesis |
| Large or hard-to-reverse boundary change | [Architect](https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/architect/SKILL.md): compare designs before implementation and obtain a human design checkpoint |
| Adversarial review | [Interrogate](https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/interrogate/SKILL.md): trace concrete failure paths; return a verdict, not edits |

The lead accepts or rejects findings with reasons. The authorized builder applies
accepted fixes; the verifier reruns the original and nearby checks on the new
version. Repeated failures from the same assumption require a new hypothesis, not
weaker assertions. Use the [validation checklist](#validate-the-affected-surface)
below; unrun checks and unavailable target surfaces stay explicit gaps.
Report what changed, verification evidence, remaining risks and human decisions,
not a process diary.

### Recovery and durable lessons

For a recurring mistake, [Correct](https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/correct/SKILL.md)
favors architecture/types → static checks/CI → behavioral tests → instructions.
Trace the first wrong decision and prefer an enforceable prevention. Prove a new
check fails on a real prior mistake in an isolated tree and passes after the fix;
do not overwrite a working checkout or invent a failure to claim regression proof.
Record the relevant rule, enforcing command and coverage limit in the task evidence.

[Reflect](https://github.com/cursor/plugins/blob/99b609a72323b70204eab407c622f436e858e112/pstack/skills/reflect/SKILL.md)
produces evidence-backed accepted/rejected/backlog proposals, not automatic
self-rewrites. Future changes to persistent operating rules, skills or routines
require explicit approval for the selected changes. Reuse existing guidance;
do not turn every cycle into a new instruction file.

### Quiet checkpoint routines

Run these at task boundaries or after a relevant failure, not as background timers.
Each routine has one job and no implementation authority of its own.

| Routine | JOB / SUCCESS | ANTI-JOBS | ESCALATE | VERIFY |
|---|---|---|---|---|
| Workflow healthcheck | Compare the work with its scope, owner, review and evidence gates; classify clean, actionable gap or blocked | No automatic code, rule or setting changes | Missing permission, conflicting changes or an unsupported completion claim | Re-read the actual diff, artifact/version and check outputs; account for skipped checks |
| Routine healthcheck | Check each active routine still has a distinct job, useful result, bounded trigger and verification | No new timers, deletion or unilateral schedule changes | Duplicate, noisy, obsolete or unsafe routines; propose the smallest correction | Inspect the actual routine definition and recent outcome, not merely tool availability |

Keep clean results quiet. Surface actionable decisions, blockers, important failures,
risks or changed goals. A weekly review is a **schedule proposal only**, not enabled
by this file; a concrete day/time/timezone and authorization are needed before
creating a recurring task.

This workflow grants no external-action authority. Confirm the applicable approval
before public posting, deployment, payments, destructive or irreversible changes,
external-person messages, security/account changes, credential access or new
secret transfers. Existing scoped authorization may cover an action; do not infer
it from a skill, research source or tool's availability.

## Find the owner

| Change | Owner |
|---|---|
| Document validation, source/timeline/output time rules, SRT/VTT/TXT export | `dist/core/project.mjs`, `dist/captions.mjs` |
| Ordered command descriptions/input schemas, cloned catalog accessors and batch allowlist | `dist/core/command-catalog.mjs`; no execution or project-state ownership |
| Copy-before-commit preparation/execution and existing public export façade | `dist/core/commands.mjs`; keep catalog/schema rules in their catalog owner |
| Serialized execution, commit port, sanitized errors, optional jobs | `dist/integration/editor-service.mjs` |
| Tool naming, project resolution, dispatch/result mapping and input descriptions | `dist/integration/mcp-adapter.mjs` |
| MCP success/error envelopes and command-data output schemas, not dispatch or execution | `dist/integration/mcp-output-schema.mjs` |

### Runtime entry points

| Change | Owner |
|---|---|
| Stdio lifecycle and framing | `cli/mcp.mjs`, `cli/mcp-session.mjs` |
| CLI file loading, safe output publication and options | `cli/moment.mjs` |
| Browser orchestration and integration boundary | `dist/app.js` |
| Caption panel, inspection/navigation and overlap-tool composition | `dist/caption-workspace.mjs`; individual panel/dialog modules retain rendering and handlers, app retains project/history/media/persistence authority |
| Transient download URL/anchor cleanup | `dist/download.mjs`; never owns media-source URLs. The existing 60-second delay after a successful click is not download-completion detection or a guarantee |
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

Editable time fields must round-trip the model's numeric value. Do not populate
them with a rounded `toFixed` summary: applying an untouched form can then alter
cut boundaries. Use the shared `decimalTime` formatter for non-negative time values when a
non-exponent representation is needed, and allow arbitrary fractions in trim inputs. Read-only summaries may
remain rounded. Preserving a number is not a claim of frame/sample-accurate media seeking.

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

For optional official SDK interoperability, run `python examples/use-mcp-sdk.py`
only in an existing Python 3.10+ environment with `mcp==1.29.0` and Node 20+ on PATH.
It uses the v1 ClientSession API, not v2; no installation is performed. This is a
separate consumer smoke check, not part of `npm test` or default CI. It imports and
edits an isolated demo, checks invalid-input recovery, then transfers the document
in memory to a fresh stdio session. It does not connect to the user's browser or
save files. [Prerequisites, timeout and result contract](../../../../docs/MCP.md#optional-official-python-sdk-smoke-test).

None of these establishes actual browser rendering or codec behavior.

For a refactor, preserve observable input/output and errors, then test the extracted owner directly and through its existing entry point. Keep files readable and cohesive around 500 lines; do not compress or split solely to meet a number.

Browser rendering, file pickers, microphone permissions, actual media encoding and third-party client-app integration require separate authorized verification. Do not label VM fixtures or stdio subprocess tests as browser QA. Follow the user's current environment restrictions, even when another machine or browser executable is available.

When publication is authorized, inspect the latest remote head, preserve concurrent changes, and verify the published tree and its CI before saying the change is shipped. This skill itself does not authorize pushing, force-pushing, deployment or rewriting history.
