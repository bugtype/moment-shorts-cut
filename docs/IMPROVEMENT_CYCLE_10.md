# Cycle 10: reject ambiguous SRT exports without changing authored text

Research and baseline checked on 2026-10-23 (UTC), before implementation.

## Evidence and comparison

A project caption `first\n\nsecond` exports without error, but importing the output retains only `first`. CRLF has the same result. Blank lines delimit cues; neither assigning new times to the second paragraph nor silently collapsing its spacing preserves the author's intent. Empty imported cues also need regression coverage so their payload cannot consume the following cue.

- The [Library of Congress SRT format description](https://www.loc.gov/preservation/digital/formats/fdd/fdd000569.shtml) describes blank lines as subtitle terminators and notes the lack of a formal, consistently implemented standard.
- [YouTube's supported caption formats](https://support.google.com/youtube/answer/2734698?hl=en) supports basic UTF-8 SRT without styling. This does not establish that markup-based blank-line substitutes work across players; no such workaround will be introduced.

`projectSrt` is shared by browser downloads and the service/CLI/MCP `captions.export` command. The service already transports typed `CommandError` failures; the CLI checks the result before opening output files. The browser currently calls the serializer directly and needs to surface a validation error before creating a download. Project JSON can retain arbitrary authored line breaks and remains the lossless project format.

## Plan

1. Reject exported cues with empty or space/tab-only lines, including leading/trailing empty lines. Explain that the user must remove the blank line for SRT; leave project text, timing and history intact. Normalize CRLF/CR line endings to LF only in serialized output. Validate only cues present in the edited output.
2. Use the existing typed error path in the shared serializer and show its message in the browser download handler. Preserve CLI output files on failure. Do not normalize paragraphs, invent timings, add controls or evaluate HTML.
3. Cover LF/CRLF, consecutive/whitespace/edge blank lines, empty/malformed imported cues, multiple cue separators, numeric/timestamp-looking text, entity round trips, service/MCP errors, CLI no-write behavior and browser-handler recovery. Make only a small parser boundary correction if the empty-cue regression confirms it is necessary.
4. Run full automated checks and inspect the diff before a normal push. Direct browser, OS file selection and external-player verification remain unperformed.

## Result and verification

SRT export now returns an actionable `INVALID_ARGUMENT` error naming the output cue when a line is empty or contains only spaces/tabs. The browser catches it before creating a download; service/MCP/CLI callers use their existing error contract. Project JSON, authored line endings, timing and history stay unchanged. Ordinary output line endings normalize to LF. Empty imported cues now stop at their separator instead of stealing the following cue's number, timing and text.

- Three new parser/serializer regressions failed before implementation and now pass. Coverage includes LF/CRLF separators, CR output normalization, consecutive/edge/whitespace-only blank lines, malformed/empty cues, numeric and timestamp-looking text, Unicode, entity round trips and cues removed by trimming.
- Service and MCP tests verify typed errors, unchanged project state, lossless project JSON and successful export after correction. CLI tests use actual temporary files: failure leaves the existing SRT and input JSON untouched and creates no missing destination.
- The application event harness verifies the error message, zero downloads, unchanged history, successful correction and Undo restoring the authored paragraph break. These are handler tests, not a browser interaction pass.
- `npm test` passes syntax checks, the application harness and all 37 Node tests. The editor-service example passes with `rendered: false`. No dependencies, HTML evaluation, new controls or timing rules were added.
- Direct browser/native file-picker and external subtitle-player checks remain unperformed. Import still skips malformed cues under its existing policy; this change does not reconstruct orphan paragraphs or promise universal SRT compatibility.

Next correctness candidate: SRT millisecond rounding can collapse a valid short cue to equal start/end times (reproduced with a 1 ms source cue at 4× speed), which the importer then rejects. Research an explicit precision policy before changing output times or rejecting additional cases. Deferred native text/color/IME QA also remains outstanding.
