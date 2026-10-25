import { outputSchema } from './mcp-output-schema.mjs';
import { commandDefinitions } from '../core/commands.mjs';
import { CommandError, assertJson, validate } from '../core/validation.mjs';
import { errorResult } from './editor-service.mjs';

function inputSchema(command) {
  const schema = structuredClone(command.inputSchema);
  schema.properties = {
    projectId: {
      type: 'string', minLength: 1, maxLength: 200,
      description: 'Project selector, not a path or credential. The bundled stdio server accepts only "session".',
    },
    ...schema.properties,
  };
  schema.required = ['projectId', ...schema.required];
  const p = schema.properties;
  if (command.name === 'template.export') {
    p.id.description = 'Caller-chosen stable template ID, nonblank, maximum 200 UTF-16 code units; preserved exactly and must not conflict with a built-in template. No browser-library entry is created.';
    p.name.description = 'Required name, maximum 40 UTF-16 code units before trimming; surrounding whitespace is trimmed, blank names rejected. Returns a portable moment-template document in data, not a project or media file. Captures visual settings, title/credit text and cards using existing relative output timing; excludes captions, clips and media. Cards are clipped to the output range and sorted by start. Existing 256 KiB pretty-printed UTF-8 budget applies. Read-only, with no project/history/storage changes.';
  }
  if (command.name === 'timeline.list') {
    p.offset.description = 'Zero-based current clip position, default 0, integer 0..1000. Authored order, including repeated source ranges. Reread after edits; positional indices are not stable IDs or a cross-request snapshot.';
    p.limit.description = 'Maximum rows, default 20, integer 1..50. Source bounds are original-media seconds; timeline positions accumulate edited intervals before speed; output positions divide by speed. Ordinary floating-point precision, no rounding or frame alignment. No captions, media access or project changes.';
  }
  if (command.name === 'captions.list') {
    p.offset.description = 'Zero-based authored array offset, default 0, integer 0–10,000. At or beyond the current count returns an empty page and nextOffset:null. This is ordinary tool pagination, not an MCP tools/list cursor. Pages are independent reads; indices may change after edits.';
    p.limit.description = 'Maximum returned authored cues, default 20, integer 1–50. Returns exact text and optional metadata without sorting, normalization, clipping, repetition or speed conversion. Missing basis means source; source and timeline times are both BEFORE speed. nextOffset is the next authored index or null. Read-only; does not change project/history.';
  }
  if (command.name === 'captions.overlaps') {
    p.limit.description = 'Maximum affected output occurrences returned, integer 1–100; default 20. Counts are occurrences, not pairs. Each has one deterministic representative conflict, in output occurrence order. Times are output seconds after speed; touching endpoints do not overlap. No text, automatic fixes or renderer-visibility guarantee.';
  }
  if (command.name === 'captions.inspect') {
    p.maxGraphemesPerSecond.description = 'Legacy mode positive review threshold (required unless review is supplied), not a universal language/Netflix standard. Count Intl grapheme clusters except whitespace-only clusters; punctuation and literal markup count. Rate uses each derived output occurrence after cuts/repeats/speed, not source duration. Does not assess speech alignment, rendered fit or export validity.';
    p.limit.description = 'Maximum returned issues, default 20, integer 1..100. Legacy mode sorts by highest rate, start, occurrenceIndex. review mode filters before limiting, then orders by occurrenceIndex and reading-speed/too-short/too-long/overlap. Full totals precede filter and limit; no text or project/history changes.';
    p.review.description = 'Opt-in combined output-occurrence review; cannot be combined with root maxGraphemesPerSecond. Empty object checks overlaps only. Positive caller-chosen thresholds are not delivery standards. minDuration/maxDuration use final output seconds with strict outside comparisons; minimum cannot exceed maximum. includeOverlaps defaults true; false requires a threshold. filter defaults all; a disabled check filter returns zero matched findings. Counts and unique flaggedOccurrences cover all enabled checks before filtering; totalFindings may exceed occurrences. No auto-fix, rendered fit, speech alignment or export-validity claim.';
  }
  if (command.name === 'project.preview') {
    p.operations.description = 'Read-only metadata preflight using exactly the project.batch closed allowlist, 1..20 sequential operations. No commit, provider calls, rendered validation, reservation or apply token. Later batch application revalidates current state; generated IDs may differ. wouldCommit tracks whether the batch prepares a project, even for redundant/roundtrip edits; changedFields lists sorted changed top-level JSON content, not a patch or complete visual review.';
  }
  if (command.name === 'project.batch') {
    p.operations.description = '1–20 sequential in-memory edit operations, prepared against each preceding result and committed once. All fail together on validation error. Not JSON-RPC batching, not a cross-writer/storage transaction. Reads, provider jobs, project.import and nested batches are forbidden. Indices/times refer to the evolving project; inspect project.get before retrying non-idempotent edits.';
    p.operations.items.properties.arguments.description = 'Arguments for the named existing editing command, following its individual tool schema but without projectId. Every step is validated. No references to prior result objects or per-step outputs.';
  }
  if (p.document) p.document.description = 'Complete moment-project document from project.get/browser settings export, not a partial patch. Media bytes are not included.';
  if (p.templateId) p.templateId.description = 'An ID from templates.list; browser-local custom templates are not available here.';
  if (p.withContent) p.withContent.description = 'Default false preserves authored content. True replaces title, credit and timed card content with template examples.';
  if (command.name === 'template.inspect') {
    p.withContent.description = 'Default false. Reuses template.apply on detached current state: false preserves authored title/credit/card content according to existing apply semantics; true uses template examples. Reports content and output-second timing after speed, not a full visual/style/render review. No project/library changes, media access, reservation or generated card IDs. Catalog metadata is canonical Korean as in templates.list; returned project text is not translated. Null text-layer end retains existing open-ended meaning.';
  }
  if (p.clips) {
    p.clips.description = 'Replace the entire ordered clip list. Times are source seconds; repeats are allowed. Each end must exceed start and stay within source duration.';
    p.clips.items.properties.start.description = 'Clip start in source seconds, not output seconds.';
    p.clips.items.properties.end.description = 'Clip end in source seconds, exclusive.';
  }
  if (command.name === 'template.apply.document') {
    p.document.description = 'Complete moment-template version 1 document, not a project or path. Strict known fields and a 256 KiB pretty-printed UTF-8 limit apply. Its ID becomes project.templateId; no browser-library save, ID reassignment or media access occurs.';
    p.withContent.description = 'Default false preserves title lines, credit text, existing scene cards and captions. Styles, effects, global keywords, speaker names/colors and title/credit timing can change. True also replaces title/credit text and scene cards, never captions. Relative title/credit timing scales when relativeTiming=true; imported card times scale by current output duration whenever content is applied, including supported legacy templates.';
  }
  if (command.name === 'timeline.move') {
    p.clipIndex.description = 'Existing zero-based authored clip index. Read the latest project before editing; repeated identical ranges remain distinct indexed occurrences.';
    p.toIndex.description = 'Final zero-based position after removal and insertion, within the current clip array. Same index is a no-op. Source intervals, captions, audio offsets and numeric output-layer times stay unchanged; no proportional retiming.';
  }
  if (command.name === 'timeline.duplicate') {
    p.count.description = 'Number of consecutive original clips to copy, default 1; not a repetition count. Integer 1–1,000, the full source range must exist and the resulting total must not exceed 1,000. Preserves block order, including repeated source ranges.';
    p.clipIndex.description = 'Existing zero-based clip occurrence index. Copies count consecutive source intervals once immediately after the original block, maximum 1,000 total clips. No media copy. Source caption occurrences repeat; timeline-basis captions and audioOffset stay absolute before speed. Title/credit/card times scale proportionally with output duration, preserving null ends, exactly as timeline.replace.';
  }
  if (command.name === 'timeline.split') {
    p.clipIndex.description = 'Zero-based index in the current ordered clips array from project.get. Identifies a specific occurrence when source ranges repeat; must be an existing integer index.';
    p.sourceTime.description = 'Absolute original-media seconds, NOT edited timeline or output seconds. Must leave at least 0.1 source seconds on each side. Adds one clip (maximum 1000), preserving order, caption metadata and output-layer timing.';
  }
  if (p.captions) {
    p.captions.description = 'Replace the entire caption list; [] clears it. Each interval must fit its time basis.';
    p.captions.items.properties.basis.description = 'Default source: original media seconds. timeline: edited timeline seconds BEFORE speed. SRT/VTT export converts to output seconds.';
    p.captions.items.properties.text.description = 'Authored caption text, at most 2,000 UTF-16 code units in runtime validation; do not silently truncate.';
    p.captions.items.properties.start.description = 'Start in the selected basis, not final output seconds.';
    p.captions.items.properties.end.description = 'End in the selected basis; must exceed start.';
  }
  if (command.name === 'credit.update') {
    p.patch.description = 'Partial footer-credit update only. Empty/redundant patches retain normal updated:true semantics. Unspecified credit fields and all titles/captions/cards/media stay unchanged. Content-only changes do not clamp existing times.';
    const fields = p.patch.properties;
    fields.text.description = 'Authored channel/source/narration credit, at most 100 UTF-16 code units; empty is allowed. Not dialogue captions or SRT/VTT/TXT transcript text.';
    fields.color.description = 'Credit text color in #RRGGBB or #RRGGBBAA form.';
    fields.x.description = 'Normalized horizontal center, 0..1.';
    fields.y.description = 'Normalized vertical center, 0..1.';
    fields.size.description = 'Canvas-relative font size: size × width / 540, with fitting within 78% width and 8% height. Existing renderer uses no stroke.';
    fields.start.description = 'Start in output seconds AFTER speed. When either time is patched, start must be less than current output duration; no fixed 24-hour cap.';
    fields.end.description = 'Exclusive end in output seconds AFTER speed, or null to follow output length. If either time is patched, finite end must exceed start and not exceed output duration.';
  }
  if (command.name === 'title.update') {
    p.patch.description = 'Partial base-title update, not timed scene cards. A visible scene card can hide this base title.';
    p.patch.properties.lines.description = 'Exactly two authored title lines; use an empty string for an unused line.';
    p.patch.properties.start.description = 'Start in final output seconds, AFTER speed.';
    p.patch.properties.end.description = 'End in final output seconds; null follows the full output duration.';
  }
  if (command.name === 'project.update') {
    p.patch.description = 'Only supplied settings change. Changing ratio resets zoom/pan; speed changes retime output text.';
    p.patch.properties.ratio.description = 'Supported canvas ratio: 9:16, 4:5, 1:1 or 16:9. Export quality sets the short edge; 4:5 produces 720×900 or 1080×1350. Older builds cannot read projects using the new 4:5 value.';
    p.patch.properties.speed.description = 'Playback speed multiplier; output duration is edited timeline duration divided by speed.';
  }
  if (command.name === 'overlays.move') {
    p.id.description = 'Exact existing scene-card ID, including legacy whitespace IDs. Does not rename or duplicate the card.';
    p.toIndex.description = 'Final zero-based destination in the current overlays array, 0..length-1. Last is foreground among scene cards; the last active enabled headline wins. Same index is a no-op. All card fields/times and other project data stay unchanged.';
  }
  if (command.name === 'overlays.remove') p.id.description = 'Exact existing scene-card ID, including legacy whitespace IDs. Removes one card and preserves remaining order. Missing ID returns NOT_FOUND; does not delete media or captions.';
  if (command.name === 'overlays.update' || command.name === 'overlays.add') {
    p.id.description = 'Exact ID of an existing scene card from project.get.project.overlays. Does not create, delete, reorder or rename IDs.';
    p.patch.description = 'Partial scene-card update. Unspecified fields, other cards, base title, captions, clips and media stay unchanged. Content-only edits do not clamp existing card times.';
    if (command.name === 'overlays.add') {
      p.id.description = 'Caller-chosen stable nonblank ID, at most 2,000 UTF-16 code units. Exact duplicates reject with INVALID_ARGUMENT, never upsert. Read project.get before retrying an uncertain result.';
      p.patch.description = 'Append one scene card with existing new-card visual defaults. text, start and end are required; only supplied optional fields override defaults. Maximum 12 cards including disabled cards. No reorder, caption change or template application.';
    }
    const fields = p.patch.properties;
    fields.start.description = 'Start in final output seconds AFTER speed. If start or end is supplied, the resulting interval must satisfy 0 <= start < end <= current output duration.';
    fields.end.description = 'Exclusive end in final output seconds AFTER speed, not source time. No fixed 24-hour cap; bounded by the current edited output.';
    fields.role.description = 'An active enabled headline card can hide the base title during its interval; free does not replace the base title.';
    fields.presentation.description = 'plain draws text without a panel; panel uses background and backgroundOpacity.';
    fields.kind.description = 'card is ordinary scene text; countdown adds remaining-time text during the interval, not an interactive quiz.';
    fields.x.description = 'Normalized horizontal center; renderer clamps it to scene-card safe bounds.';
    fields.y.description = 'Normalized vertical center; renderer clamps it to scene-card safe bounds.';
    fields.size.description = 'Scene font size scales by min(canvas width / 540, canvas height / 960), with text fitting; not fixed output pixels.';
    fields.stroke.description = 'Stroke width uses the same scene scaling as size.';
    fields.width.description = 'Requested fraction of composition width; renderer caps it at 0.82 and treats 0 as the existing 0.78 default.';
    for (const key of ['text', 'detail', 'label']) fields[key].description = 'Authored scene text, at most 2,000 UTF-16 code units. Does not modify dialogue captions or SRT/VTT text.';
    for (const key of ['color', 'accent', 'background']) fields[key].description = 'Color in #RRGGBB or #RRGGBBAA hexadecimal form.';
  }
  if (command.name === 'effects.update') {
    p.patch.description = 'Partial visual effects update only. Unspecified effect settings, captions, titles/cards, clips, audio and timing stay unchanged. Does not apply a template.';
    const fields = p.patch.properties;
    fields.motion.description = 'Per-clip camera zoom: none is fixed; in grows from 1 to 1+strength; out shrinks from 1+strength to 1. Multiplies the existing framing zoom.';
    fields.strength.description = 'Additional zoom fraction for motion, from 0 to 0.4; 0.12 means up to 12% extra zoom. Has no visible motion effect when motion=none.';
    fields.transition.description = 'Per-clip start/end overlay: none, fadeBlack (black), or flash (white, up to 75% opacity). NOT a crossfade between adjacent source frames.';
    fields.transitionDuration.description = 'Overlay duration at each clip edge in output seconds AFTER speed, limited to half that clip’s output duration. Stored range 0.05–0.7 seconds.';
    fields.brightness.description = 'Source-image brightness multiplier; 1 is unchanged. Does not recolor rendered text.';
    fields.contrast.description = 'Source-image contrast multiplier; 1 is unchanged.';
    fields.saturation.description = 'Source-image saturation multiplier; 1 is unchanged and 0 is grayscale.';
    fields.vignette.description = 'Dark edge overlay strength; 0 disables it. Applied before text and scene cards.';
    fields.progress.description = 'Whether to draw the output progress bar.';
    fields.progressPosition.description = 'Progress bar location: top or bottom of the composition.';
    fields.progressColor.description = 'Progress bar color in #RRGGBB or #RRGGBBAA hexadecimal form.';
  }
  if (command.name === 'captions.style.update') {
    p.patch.description = 'Partial visual-only update of shared caption styling. Only supplied fields change; no preset side effects. Caption text/timing/metadata and SRT/VTT output stay unchanged.';
    const fields = p.patch.properties;
    fields.speakerLabels.description = 'Exactly two display names for assigned speaker slots 0 and 1, each at most 80 UTF-16 code units; empty names allowed. Replaces the pair without changing any cue speaker assignment, text or timing. Visual only: SRT/VTT/TXT do not gain speaker names.';
    fields.speakerColors.description = 'Exactly two #RRGGBB or #RRGGBBAA colors for speaker slots 0 and 1. Replaces the pair. Speaker colors override ordinary caption text color; highlight style retains its dark caption text while speaker name labels retain speaker colors.';
    fields.style.description = 'Shared rendering style only, not a template. highlight uses accent as its background and suppresses stroke; speaker colors can override the text color.';
    fields.captionSize.description = 'Font size in shared canvas-relative units: rendered pixels = size × canvas width / 540, subject to text fitting. Not a fixed export-pixel size.';
    fields.captionX.description = 'Normalized horizontal caption center: 0 is left and 1 is right.';
    fields.captionY.description = 'Normalized vertical caption center: 0 is top and 1 is bottom.';
    fields.captionColor.description = 'Caption text color in #RRGGBB or #RRGGBBAA hexadecimal form; style and speaker colors may take precedence.';
    fields.captionAccent.description = 'Accent/highlight color in #RRGGBB or #RRGGBBAA hexadecimal form.';
    fields.captionStroke.description = 'Stroke width in the same canvas-relative units as captionSize; highlight style suppresses the stroke.';
    fields.captionItalic.description = 'Whether shared caption text is italic.';
    fields.captionAnimation.description = 'Shared caption entry animation; visual only, not a subtitle-file timing change.';
  }
  if (command.name === 'captions.import') {
    p.text.description = 'SRT or plain WebVTT text, not a path. Parses captions using the browser parser: clips cue ends to the chosen duration, skips invalid/empty/out-of-range cues, strips tags and decodes supported entities once. Not full subtitle-standard validation. Runtime limit is 100,000 UTF-16 code units plus the parser’s 2 MiB UTF-8 ceiling; each cue is at most 2,000 units and at most 10,000 cues are accepted.';
    p.mode.description = 'Optional replace (default) replaces all captions; append adds parsed cues after all existing authored rows without sorting, shifting or merging. Combined maximum 10,000 cues; retained rows including out-of-output cues remain unchanged. Append is not idempotent: an uncertain retry can duplicate cues.';
    p.basis.description = 'Required clock: source means original media seconds; timeline means edited timeline seconds BEFORE speed. No automatic time conversion. captions.export uses output seconds AFTER speed, so importing it as timeline is not a speed-adjusted round trip.';
  }
  if (command.name === 'captions.append') {
    p.captions.description = 'Required nonempty array of 1..10000 authored cues. Appends in supplied order; combined total must fit 10,000. Incoming times use source (default) or pre-speed timeline and must fit that clock. Existing rows, including out-of-output cues and speaker/keyword metadata, stay intact. No sorting, merging, offset, normalization or speech alignment. Non-idempotent: retry duplicates cues; reread captions.list after uncertain results.';
  }
  if (command.name === 'captions.insert') {
    p.captionIndex.description = 'Required zero-based insertion position in the current authored array, including its length to append. Maximum total 10,000 cues. Existing rows keep order and timing; this does not sort by start time. Non-idempotent: reread captions.list before retrying an uncertain insert.';
    p.caption.description = 'Complete new authored cue, copied exactly without normalization. Empty text is legal. Missing basis means source; source and timeline times are BEFORE speed. End must exceed start and not exceed the chosen clock duration, with the existing 86,400-second schema ceiling. Does not generate speech alignment.';
    p.caption.properties.text.description = 'Literal text, maximum 2,000 UTF-16 code units; empty text is allowed. No automatic escaping, trimming or normalization of authored content.';
    p.caption.properties.basis.description = 'source (default when omitted) uses original media seconds; timeline uses edited seconds BEFORE speed. A source cue can repeat across clips. Ownership is preserved exactly as supplied.';
  }
  if (command.name === 'captions.remove') {
    p.count.description = 'Optional integer 1..10000, default 1. Removes this many consecutive authored rows starting at captionIndex. The complete range must exist; overflow rejects atomically, never truncates. Surviving content, timing and ownership are unchanged.';
    p.captionIndex.description = 'Required existing zero-based authored caption index from captions.list, not an output occurrence. Removes count consecutive authored cues (default 1) and may leave an empty array. Remaining indices shift left without retiming. Returned captionIndex is the removed old position. Non-idempotent: reread before retrying an uncertain removal.';
  }
  if (command.name === 'captions.update') {
    p.captionIndex.description = 'Existing zero-based authored cue index, not an output occurrence or stable ID. Read current project before updating; preceding structural edits can shift indices.';
    p.patch.description = 'Only supplied fields change; basis and timing metadata cannot be changed. Empty/redundant patches retain normal updated:true semantics. Content-only changes preserve valid existing out-of-range timing.';
    p.patch.properties.text.description = 'Literal authored text, maximum 2,000 UTF-16 units; empty/whitespace text is allowed, as in captions.replace. Subtitle export validation still applies.';
    p.patch.properties.start.description = 'Start seconds in this cue’s EXISTING source or pre-speed timeline clock, never output seconds. Explicit timing edits require 0<=start<end<=that clock duration and the existing 86,400-second schema ceiling.';
    p.patch.properties.end.description = 'Exclusive end in the same existing pre-speed clock; use with start when changing both endpoints atomically.';
    p.patch.properties.keywords.description = 'Cue highlight keywords, maximum 500 UTF-16 units; other cues and global keywords are unchanged.';
  }
  if (command.name === 'captions.split.long') {
    p.limit.description = 'Grapheme chunk length: 12, 18 or 24; default 18. Same word-break preference and boundary-whitespace trimming as the browser whole-list splitter; not visual line wrapping or audio alignment. New parts receive estimated timing proportional to grapheme counts.';
    p.captionIndex.description = 'Optional zero-based starting authored cue index. Omitted means zero; an explicit index must exist. Processes the original range, not indices shifted by earlier splits. Basis and metadata are preserved.';
    p.count.description = 'Optional number of original cues. Omitted means the remaining tail; count alone selects a prefix. Must fit entirely. Both omitted selects all, including an empty-array no-op. More than 10,000 resulting cues or unrepresentable positive intervals rejects atomically.';
  }
  if (command.name === 'captions.split') {
    p.captionIndex.description = 'Zero-based authored caption index, not a rendered occurrence. One cue becomes two; maximum 10000 cues. Both preserve metadata and receive timing:estimated. Inspect project.get before retrying this non-idempotent edit.';
    p.textOffset.description = 'Internal UTF-16 text offset at a whole grapheme boundary, as used by textarea.selectionStart. Both literal sides must contain non-whitespace text. Timing is estimated proportionally by grapheme count in the existing pre-speed clock, not aligned to speech. Intl.Segmenter is required; no unsafe fallback.';
  }
  if (command.name === 'captions.merge') {
    p.captionIndex.description = 'Zero-based authored caption array index, not a rendered occurrence. Merge with its next entry in the same pre-speed clock; matching speaker/keywords and non-overlapping chronological times required. Texts join literally with one ASCII space (maximum 2000 UTF-16 units). The merged interval covers any gap; source captions still repeat across clips. Estimated timing warnings survive. This action is not idempotent: inspect project.get before retrying.';
  }
  if (command.name === 'captions.speaker.assign') {
    p.captionIndex.description = 'Required zero-based existing authored caption position, not an output occurrence or stable ID. Reread captions.list after structural edits before assigning or retrying.';
    p.count.description = 'Required integer 1..10000. The entire consecutive authored range must exist; overflow rejects without partial changes. No basis filter or time conversion.';
    p.speaker.description = 'Existing slot 0 or 1, or empty string for None. Only cue speaker assignment changes, not labels, colors, text, timing, basis, keywords or estimated timing flags. Missing speaker already means None and remains absent on a no-op. Repeating on unchanged indices is a no-op; indices are not reserved against concurrent edits.';
  }
  if (command.name === 'captions.timing.shift') {
    p.basis.description = 'Required scope and clock: source includes cues with omitted basis; timeline includes edited-timeline cues. Both are BEFORE speed. Other-basis cues are unchanged.';
    p.delta.description = 'Finite signed seconds: positive moves later, negative earlier. All matching cues inside the authored-index range must stay within their clock duration; no clipping, deletion, media shift or basis conversion. Zero/no matches is a no-op. Text, metadata and order are preserved.';
    p.captionIndex.description = 'Optional zero-based authored row index, not a rendered occurrence. Omitted means start at row 0; omitted count means through the end. Explicit indices must address an existing row, even for delta 0. Reread after insert/remove/reorder edits.';
    p.count.description = 'Optional number of authored rows, BEFORE filtering by basis. Omitted means all remaining rows; count alone selects the first count rows. Overflow rejects, never truncates. Both range fields omitted preserves all-row behavior, including an empty-list no-op.';
  }
  if (command.name === 'captions.text.replace') {
    p.find.description = 'Nonempty literal, case-sensitive text. No regex or Unicode normalization; matches do not overlap.';
    p.replacement.description = 'Literal replacement, including dollar signs. Changed cues inside the selected authored range must not become empty/whitespace-only or exceed 2,000 UTF-16 units. Any failure rejects the whole edit. Outside cues, timing and metadata stay unchanged. Returned matches and changedCaptions count only the selected range.';
    p.captionIndex.description = 'Optional zero-based first authored cue, default 0. If explicitly supplied it must exist, even for no-op/no-match requests. Not an output occurrence or stable ID; reread captions.list after structural edits.';
    p.count.description = 'Optional number of authored cues. Omitted means the remaining tail; count alone selects the first count cues. Integer 1..10,000 and must fit completely, never truncates. Both range fields omitted preserves all-cue behavior including an empty-array no-op. No clock/basis filtering.';
  }
  if (p.quality) p.quality.description = 'Output short edge in pixels; defaults to 1080. Creates a plan only.';
  if (command.name === 'captions.export') {
    p.captionIndex.description = 'Optional zero-based first authored caption index; an explicit index must exist. Omitted means zero. Selects rows before edited occurrence projection, retaining all clips, repeats and full output timestamps without rebasing. Not an occurrence index or stable ID.';
    p.count.description = 'Optional integer 1..10000; the complete authored range must exist. Omitted means through the end; both range fields omitted export all rows. Existing derived and final byte limits apply to the selected export. This is not a full-project backup or a security/redaction boundary.';
    p.review.description = 'Optional boolean, default false. True requires format txt and returns a human review transcript with raw output-second ranges and explicitly assigned nonempty speaker labels. No guessed speakers, no import/visibility/diarization guarantee. Repeated and overlapping edited occurrences remain separate. Metadata uses the active UI locale (default Korean in headless clients); authored text and labels are not translated. Existing derived limits and final 2 MiB UTF-8 limit include metadata. False preserves existing output bytes.';
  }
  if (p.format) p.format.description = command.name === 'captions.export'
    ? 'Format: srt (default), plain vtt, or txt (plain edited cue paragraphs by default; review:true adds output times and assigned speaker names). TXT preserves literal text and LF line breaks, rejects NUL, and shares the 2 MiB UTF-8 and 10,000 occurrence limits. The destination filename does not select the format.'
    : 'Planned output container; defaults to mp4, without checking local codec support.';
  return schema;
}

// Tool mapping only. The host supplies transport, discovery, authentication and storage.
// A project ID is a selector, never authorization. Resolve it per authenticated call.
export function createMcpToolAdapter({ resolveService, commands }) {
  if (typeof resolveService !== 'function') throw new TypeError('An authorized project resolver is required.');
  const definitions = commandDefinitions();
  if (commands !== undefined && (!Array.isArray(commands) || !commands.length ||
      new Set(commands).size !== commands.length ||
      Array.from(commands).some(name => typeof name !== 'string' || !definitions.some(command => command.name === name)))) {
    throw new TypeError('Tool selection must contain distinct existing command names.');
  }
  // Copy the selection into a fixed map in canonical catalog order.
  const selected = commands === undefined ? definitions : definitions.filter(command => commands.includes(command.name));
  const names = new Map(selected.map(command => [
    `moment_${command.name.replaceAll('.', '_')}`, command,
  ]));

  function listTools() {
    return structuredClone({
      resultType: 'complete',
      tools: [...names].map(([name, command]) => ({
        name, description: command.description,
        inputSchema: inputSchema(command), outputSchema: outputSchema(command.name),
        annotations: { readOnlyHint: !command.mutates, destructiveHint: command.mutates, openWorldHint: false },
      })),
    });
  }

  async function callTool(name, args, context) {
    const command = names.get(name);
    // Host must translate this into a JSON-RPC invalid-params protocol error.
    if (!command) throw new CommandError('UNKNOWN_TOOL', '지원하지 않는 MCP 도구입니다.');
    let result;
    try {
      if (!args || typeof args.projectId !== 'string' || !args.projectId.trim() || args.projectId.length > 200) {
        throw new CommandError('INVALID_ARGUMENT', 'projectId가 필요합니다.');
      }
      assertJson(args);
      // Capture nested input before the resolver yields to authentication/storage.
      const { projectId, ...input } = structuredClone(args);
      validate(command.inputSchema, input);
      const service = await resolveService(projectId, context);
      if (!service) throw new CommandError('NOT_FOUND', '접근 가능한 프로젝트를 찾을 수 없습니다.');
      result = await service.execute(command.name, input);
    } catch (error) {
      result = errorResult(command.name, error);
    }
    return {
      resultType: 'complete', content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result, isError: !result.ok,
    };
  }
  return { listTools, callTool };
}
