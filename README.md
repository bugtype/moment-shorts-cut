# Moment shorts studio

A Korean, browser-local shorts editor. Static assets are in `dist/`.

Integration entry points are now available without changing hosting: a DOM-free command core, a real Node.js CLI for project JSON/SRT, a browser `window.moment` API and an MCP tool-mapping adapter. See [INTEGRATIONS.md](INTEGRATIONS.md) for commands, contracts, examples and the remaining server/media-provider work. No remote MCP server or headless encoder is enabled. The Help dialog can save/load editing settings without embedding media files.

Implemented: video upload and local IndexedDB persistence; 9:16, 1:1 and 16:9 framing; pan and zoom; trim, split, reorder and delete clips; playback speed; original audio gain; additional audio uploads and microphone recording; captions with editable source timestamps; SRT/VTT import and edited-timeline SRT export; text overlay; browser MediaRecorder output with canvas compositing and a mixed audio track.

Automatic captions use a module worker loading Transformers.js 3.8.1 and the multilingual `Xenova/whisper-tiny` model. Model assets require an internet connection, but input media stays in the browser. Browser speech inference is limited to originals up to 180 seconds. There is no hosted AI endpoint or API key. Transcription accuracy should be reviewed by the user.

Output is real-time at 30 fps; supported MP4/WebM encoders are detected via `MediaRecorder.isTypeSupported`. Keep the tab visible during export. A backgrounded export is cancelled rather than silently returning incomplete frames. The illustration is an original editable SVG and the initial project is explicitly identified as a motion-graphic sample with sample captions.

User files are retained in this browser only. Browser data deletion, storage quota, private browsing and unsupported input codecs can prevent persistence or decoding. MOV container support depends on its codec.

Validation: JavaScript syntax checks, DOM wiring and timeline/SRT transformation checks. The managed preview supervisor was unavailable, so browser rendering, microphone permission, AI model download/inference and final encoded media were not verified in this execution environment.

Developer references: https://huggingface.co/docs/transformers.js/v3.8.1/api/pipelines and https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder


## Typography editor and performance update

The Title tab now offers a reference-inspired review composition (dark upper/lower bands, a white/lime two-line headline, outlined in-video dialogue and a separate credit), an impact composition and a vlog composition. These are local design presets based on the supplied reference, not claims about popularity or performance. Title and credit visibility use output-video seconds; dialogue timestamps continue to use source-video seconds. Line colors, font size, italic, outline, placement, caption entrance effect and frame margins can be changed independently. Selecting a text layer changes canvas dragging from video pan to that layer's position. The timeline includes title and credit tracks. The optional platform guide is approximate and is never rendered into exports.

Saved v1 projects are migrated with their existing framing and overlay text intact. A preset is an explicit edit, supports undo, and retains typed text. Uploaded replacement footage retains typography settings.

The shared renderer in `dist/typography.mjs` is used by both preview and export. Text is cached as raster surfaces with both count and pixel limits. The sample SVG is rasterized once. Export draws the high-resolution frame once and scales that completed frame for preview. Animation callbacks stop while paused; playback rendering is capped at 30 fps, and timeline UI updates are throttled. Timeline lookup uses cached offsets and binary search. Pointer-driven changes are coalesced into one animation callback. Font loading invalidates text caches, and export waits for fonts.

`dist/project-store.mjs` retains one IndexedDB connection and serializes writes. Only changed media blobs are written, so adding audio does not rewrite the video. File decoding has timeouts, concurrent media replacement is guarded, and replacement audio URLs are released.

Run `node verify.mjs`. Tests cover legacy migration, layer visibility boundaries, composition geometry, text-cache reuse and bounds, no idle animation loop, changed-media persistence and write ordering, plus the existing split/undo, SRT and timeline tests. Real browser layout, microphone and export codec behavior still require browser verification because the managed preview supervisor is unavailable.

Official editing reference: https://support.google.com/youtube/answer/16215842?hl=en

## Template studio, timed headlines and detailed verification

The gallery contains ten original compositions: review, punch, vlog, explainer, interview, recipe, ranking, product review, quiz and cinematic. Search includes common Korean synonyms, with category/favorite filters and browser-local custom templates (up to 20). Each composition has a 12-second animated sample built with the same compositor as final output. Style-only application preserves title/credit text, dialogue and scene cards. Example application replaces title/credit/card content while preserving video and dialogue. Custom template timings are normalized to the new output duration.

The Effects tab supports up to 12 timed text layers, labels, explanations/options, countdowns, duplicate/delete/interval playback, entrance effects, size, position and colors. Default layers replace the base headline in the upper area; only one headline appears at a time. The default presentation is outlined text without a filled box. Free-positioned extra text and translucent panels are explicit options, and layers can be hidden individually or together. Motion controls include per-clip slow zoom, fade-to-black or flash, brightness, contrast, saturation, vignette and an optional progress bar. This is a single-track composition editor; fades are applied at clip boundaries, not overlapping cross-dissolves. Quiz options/countdowns are rendered video graphics, not clickable YouTube polls.

Dialogue supports shared/per-caption literal highlight words, two manually assigned speaker names/colors, fade/slide/pop entrances, and long-caption segmentation. Segmentation preserves Unicode characters and allocates estimated timing by text length; it is not word-level speech alignment or automatic speaker identification.

Narration captions now use the edited audio timeline, while original speech captions follow source footage. Repeated/reordered footage therefore does not duplicate an added narration caption. These caption clocks are stored before playback speed. SRT export maps both clocks to final output seconds. Title, credit and scene-card times use final-output seconds and are scaled proportionally when edited duration or speed changes. Changing an added audio offset shifts its existing narration captions as well.

Preview projects are cached rather than rebuilt on every frame, and the template animation is limited to 30 fps. The existing bounded typography cache, idle-frame scheduler and serialized changed-media writes remain in place. Failed IndexedDB connections/writes can be retried. Microphone initialization failure or delayed permission after leaving the audio panel releases the acquired stream. Double export starts are blocked and cancellation releases stream tracks without downloading.

Run `node verify.mjs` for the complete regression suite; see `QA.md` for detailed Korean results and remaining real-device checks. The tests use stub DOM/canvas/media APIs where required. They verify logic and lifecycle, not actual browser layout, real audio capture, AI model accuracy or codec output quality.

Run `npm test` for both the editor regressions and integration suite. The latter runs actual CLI subprocesses and file I/O, plus command atomicity, JSON validation, MCP resolver/error mapping and injected job-provider tests. The browser API is wired through the editor's real commit/undo path in the existing simulated DOM harness. Native browser file pickers and external MCP transport are not covered.

Official references used for the original template patterns:
- https://blog.youtube/news-and-events/new-creation-tools-youtube-shorts-2025/
- https://blog.youtube/creator-and-artist-stories/road-to-1-million-with-feel-good-foodie/
- https://blog.youtube/creator-and-artist-stories/the-definitive-guide-to-creating-engaging-podcast-content/
- https://blog.youtube/creator-and-artist-stories/grow-youtube-channel-interactive-shorts/

## Layout correction and native frame review

Version 4 removes the automatic central information panels. Review, punch, vlog and cinematic templates no longer add extra information layers; explainer, interview, recipe, ranking, product and quiz templates use the upper headline area. A visible timed headline replaces the base title instead of stacking over it. Canvas dragging selects that visible layer. Existing project/custom-template layers at the old default center position migrate upward with their text and timing preserved; manually positioned layers retain their position and become free text. Panel backgrounds are now opt-in. The sample SVG no longer contains baked-in decorative text that conflicted with editable titles.

The supplied Shorts reference and the actual caption/text screenshots in https://blog.youtube/news-and-events/6-new-youtube-shorts-tools/ were visually compared. The official product campaign PDF https://services.google.com/fh/files/events/ytw2024cj_1min.pdf was used only for its product-centered representative creative; it is not evidence of a vertical playback layout. Creator Shorts playback pages could not be retrieved, so no full-video comparison is claimed.

`qa/render-layout.mjs` renders the exact production compositor with native Canvas and Noto Sans KR. `qa/all-templates.png` and `qa/after-layout.png` show the revised ten-template layouts; individual samples also cover timed question/answer and later-stage changes. This review verifies composed still frames, not browser UI rendering, real media playback or encoded output. The managed browser preview supervisor remained unavailable. Run `node verify.mjs` for regression coverage of default panel removal, headline bounds, migration, visibility, replacement and dragging.
