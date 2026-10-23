# Cycle 9: preserve escaped subtitle text

Research and baseline checked on 2026-10-23 (UTC), before implementation.

## Evidence and comparison

Importing a valid WebVTT cue containing `Tom &amp; Jerry &lt;b&gt;literal&lt;/b&gt;` stores those escape sequences verbatim. The preview/export paths use the stored plain text, so they cannot recover the intended ampersand or literal angle brackets. Separately, SRT export writes authored `<b>literal</b>` directly; importing that output strips the apparent tags and loses authored characters.

- [MDN WebVTT cue payload](https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API/Web_Video_Text_Tracks_Format#cue_payload) documents character references, including the six widely supported names `amp`, `lt`, `gt`, `lrm`, `rlm` and `nbsp`.
- [W3C WebVTT cue-text parsing](https://www.w3.org/TR/webvtt1/#webvtt-cue-text-parsing-rules) treats references as text tokens and markup as separate tokens. Decoding before stripping markup would incorrectly discard an escaped literal tag. The full standard supports more references than this focused change implements.

The shared parser has one application caller (`importSrt`); the shared SRT serializer serves browser download and the editor-service/CLI/MCP `captions.export` command. The model stores plain text. Existing timing, clip repetition, speed mapping, transactional replacement and undo already have regression coverage.

## Plan

1. Decode the six WebVTT names once, after stripping actual markup. Preserve unknown/malformed references as authored text; retain import size, cue count and decoded-text length limits. Keep this dependency-free parser's limited format support explicit instead of adding an HTML parser.
2. Escape ampersands and angle brackets in the shared SRT serializer so literal markup and entity-looking text survive export/reimport. Encode non-breaking spaces too, preserving them at cue boundaries where import trims file whitespace. Do not change stored text or output timing.
3. Test escaped/literal markup, one-pass decoding, directional/non-breaking characters, Unicode, limits, repeated clips/speed and application import/undo. Run the full suite and integration example. Direct browser/file-picker QA remains deferred; no browser validation is claimed.

## Result and verification

The parser decodes the six named references after removing actual markup. The shared serializer escapes plain-text delimiters and non-breaking spaces without mutating the project. No dependency, UI control or timing behavior was added.

- Three regression tests failed against the original implementation and pass with the fix. They cover real versus escaped tags, one-pass decoding, unknown/malformed references, Korean/emoji/directional characters, edge non-breaking spaces, decoded length limits, repeated clips, speed and two consecutive export/import round trips.
- The application harness imports escaped text, exports it through the public editor command, reimports the result and verifies Undo restores the original project. Existing invalid/oversized imports and export-busy guards remain covered.
- `npm test` passes: syntax checks, application/event harness and all 33 Node tests. `node examples/use-editor-service.mjs` passes and correctly reports `rendered: false`. The diff contains only parser/serializer changes, regression tests and this record.
- Direct browser, OS file-picker and third-party subtitle-player checks were not performed. This is a focused correction for six common names, not full HTML-character-reference or WebVTT conformance; other references remain unchanged.

Next correctness candidate: an authored caption containing a blank line (`first\n\nsecond`) exports successfully, but the current parser imports only `first` because a blank line terminates an SRT cue. Reproduced with a synthetic project; research an explicit preservation/validation policy before changing export behavior. Deferred native text/color/IME QA from cycle 8 remains outstanding.
