# Moment · Shorts Studio

**Turn your footage into short videos, with editing, captions, and export in your browser.**

**English** · [한국어](README.ko.md)

[![CI](https://github.com/bugtype/moment-shorts-cut/actions/workflows/ci.yml/badge.svg)](https://github.com/bugtype/moment-shorts-cut/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Moment is a local-first video editor with a Korean interface. Trim a clip, choose a template, add captions or narration, and export a short without uploading your media to an app server. No account or API key is required.

The editor also exposes a shared command core, a project JSON/SRT CLI, and an MCP adapter for integrations. This is an early-stage project; see [tested behavior and remaining gaps](docs/BROWSER_QA.md) before relying on a particular browser or codec.

![Moment editor with a template gallery, vertical video preview, and editing timeline](docs/editor-desktop.png)

[Quick start](#quick-start) · [Features](#features) · [Examples](#example-results) · [CLI and integrations](#cli-and-integrations) · [Privacy and limits](#privacy-and-limits) · [Development](#development)

## Quick start

You need **Git and Node.js 20 or later**, including npm. There are no npm dependencies to install and no build step.

```sh
git clone https://github.com/bugtype/moment-shorts-cut.git
cd moment-shorts-cut
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The editor starts with a **12-second motion-graphic sample**, so you can try templates and export before bringing your own footage. The sample captions are examples; the sample has no speech to transcribe.

Keep the server running while editing; press `Ctrl+C` to stop it. It binds to `127.0.0.1` and serves only `dist/`. Open the HTTP address rather than double-clicking `dist/index.html`, because the app uses JavaScript modules, workers, and browser storage.

### Make your first short

The interface is currently in Korean. These labels will help you find each step:

1. **미디어 (Media):** upload a video, or keep the sample. Use **화면 (Frame)** to choose 9:16, 1:1, or 16:9 and adjust the framing; trim, split, and reorder clips on the timeline.
2. **템플릿 (Templates):** choose a composition. **스타일만 적용 (Apply style only)** keeps your text; applying the example composition replaces title, credit, and timed-text content while preserving footage and dialogue captions.
3. **자막 (Captions):** import SRT/VTT, write captions, or generate them locally from speech. Review the text and timing. Use **타이틀 (Title)** and **연출 (Effects)** for headlines and timed text.
4. **오디오 (Audio):** add an audio file or record narration with microphone permission. Adjust its start time and volume alongside the original audio.
5. **내보내기 (Export):** choose an available MP4/WebM format and 720p or 1080p. **Keep the tab visible until export finishes**, then play the downloaded file to check the result.

Use **사용 가이드 (Help) → 편집 설정 저장 (Save editing settings)** to back up project JSON. Keep your original video and audio separately: **the JSON does not contain media files**.

## Features

- **Timeline editing:** trim, split, reorder, delete, change playback speed, pan and zoom, and undo/redo.
- **Templates and typography:** 10 built-in compositions, template search and favorites, up to 20 browser-local custom templates, title/credit styling, and up to 12 timed text layers.
- **Captions:** SRT/VTT import, edited-timeline SRT export, keyword highlighting, two manually assigned speakers, entrance effects, and long-caption splitting with estimated timing.
- **Audio and speech:** original-audio volume, an additional audio file or microphone recording, and on-device automatic captions using Transformers.js 3.8.1 and `Xenova/whisper-tiny`.
- **Visual effects:** slow zoom, fade-to-black or flash at clip boundaries, brightness, contrast, saturation, vignette, and an optional progress bar.
- **Local projects and export:** browser storage, project JSON import/export, and Canvas/Web Audio composition recorded through MediaRecorder.

The built-in templates cover review stories, bold opening lines, vlogs, explainers, interviews, recipes, rankings, product reviews, quizzes, and cinematic moments. Preview each with its animated sample. Quiz choices and countdowns are video graphics, not interactive polls.

## Example results

Four 1080×1920 vertical shorts made with Moment's Canvas composition engine and built-in templates. Select a thumbnail to open the MP4.

<table>
<tr>
<td width="50%" align="center">
<a href="docs/examples/cinema-sunset.mp4"><img src="docs/examples/cinema-sunset-thumb.jpg" width="260" alt="In front of the sunset — cinematic moment example video"></a><br>
<strong>In front of the sunset</strong><br>
<sub>Cinematic moment · 11.5s</sub>
</td>
<td width="50%" align="center">
<a href="docs/examples/city-night.mp4"><img src="docs/examples/city-night-thumb.jpg" width="260" alt="City night — bold opening line example video"></a><br>
<strong>City night</strong><br>
<sub>Bold opening line · 10.3s</sub>
</td>
</tr>
<tr>
<td width="50%" align="center">
<a href="docs/examples/coffee-recipe.mp4"><img src="docs/examples/coffee-recipe-thumb.jpg" width="260" alt="One cup for today — recipe example video"></a><br>
<strong>One cup for today</strong><br>
<sub>Recipe at a glance · 11.5s</sub>
</td>
<td width="50%" align="center">
<a href="docs/examples/forest-top3.mp4"><img src="docs/examples/forest-top3-thumb.jpg" width="260" alt="Three things a rushed day needs — top 3 example video"></a><br>
<strong>Three things a rushed day needs</strong><br>
<sub>TOP 3 list · 10.9s</sub>
</td>
</tr>
</table>

The app's **Export** button records the same composition in real time with MediaRecorder. These examples were rendered frame by frame through the same renderer and encoded at 30fps H.264 for higher final quality. Sources, music credits, and production notes are in [docs/examples/README.md](docs/examples/README.md).

## CLI and integrations

The CLI edits **project settings and subtitles**. Run these commands from the repository root:

```sh
# Create a sample project.
node cli/moment.mjs init --out project.json

# Apply the included explainer composition.
node cli/moment.mjs exec template.apply --project project.json --args-file examples/explainer.json --out edited.json

# Export captions with edits and playback speed reflected in the timestamps.
node cli/moment.mjs exec captions.export --project edited.json --out captions.srt

# List commands and their input schemas.
node cli/moment.mjs commands
```

Existing output files are protected; use `--overwrite` only when you intend to replace one. Add `--dry-run` to an `exec` command to inspect its result without writing output. JSON inputs are limited to 10 MB.

You can also call `window.moment` from the editor page or connect the MCP tool adapter to your own host. Run `node examples/use-editor-service.mjs` for a local service/adapter example.

**The CLI does not encode video.** `render.plan` produces a plan, not an MP4. The MCP adapter does not include a running server, transport, or authentication. See [INTEGRATIONS.md](INTEGRATIONS.md) for command contracts, caption time bases, media relinking, and host responsibilities.

## Privacy and limits

**Media stays on your device, but the app is not fully offline.** Fonts load from Google Fonts; automatic captions download code from jsDelivr and model/runtime assets from Hugging Face and related runtime sources. Speech inference runs in a browser worker. See [SECURITY.md](SECURITY.md) for network requests and trust boundaries.

- **Storage:** media is stored in IndexedDB and editing state in localStorage. They are written separately; a failed save can leave them out of sync. Storage belongs to the current browser and origin; changing the host or port opens a different storage area. Clearing browser data, private browsing, or storage exhaustion can lose work. There is no cloud sync or remote backup.
- **Input limits:** video up to 500 MB, additional audio up to 100 MB, project JSON up to 10 MB, and SRT/VTT up to 2 MB. Projects allow at most 1,000 clips; splitting at the limit requires deleting a clip first. Subtitles allow at most 10,000 cues and 2,000 characters per cue. These limits do not guarantee enough device memory or codec support.
- **Text imports:** save project JSON and SRT/VTT files as UTF-8; a leading UTF-8 BOM is supported. Subtitle LF, CRLF and CR line endings are normalized to LF while preserving payload line breaks. Invalid UTF-8 is rejected without replacing the current project or captions. Other encodings are not detected or converted automatically.
- **Pending imports:** if the project changes while a text file is being read or waiting to apply, the import is rejected; select the file again to apply it to the current project. Selecting another JSON/SRT/VTT file supersedes the earlier pending import, even if the newer file fails. These checks cover applied project state, not uncommitted text-field drafts.
- **Pending transcription:** results are not applied if the source media or existing captions changed, or the project was replaced; added-audio results also require unchanged audio offset and edited duration. Generate again against the updated input. Appearance changes remain usable. This protects applied edits, not uncommitted text-field drafts, and does not promise to stop model computation when a conflict is detected.
- **Derived caption limits:** the timeline caption lane and SRT export support at most 10,000 edited occurrences and 2 MiB of UTF-8 caption text, counting each clip repetition. The completed SRT has a separate 2 MiB limit including escaping, timing, separators and any emitted BOM (browser exports include a BOM; CLI/service exports do not). Exceeding a limit rejects the entire derived output, including for older projects; reduce repeated clips or captions to restore it. Original caption editing, project JSON, undo and saving remain available. These budgets do not guarantee UI responsiveness or available memory.
- **SRT text:** blank lines separate cues. Export rejects empty cues or blank lines inside an exported caption instead of dropping paragraphs or assigning new times. Remove the blank lines to export SRT; project JSON retains the original text. Ordinary multiline captions are supported, with CRLF/CR normalized to LF in output. Subtitle-player markup support varies; universal compatibility is not claimed.
- **SRT timing:** timestamps round to milliseconds after trimming and speed changes. Export rejects a cue whose rounded start and end are equal; adjust its interval or playback speed. It does not extend, drop or move cues automatically, and the original project keeps its precise timing.
- **Long-caption splitting:** the 12/18/24-character targets and estimated timing weights count grapheme clusters, keeping combining marks and joined emoji together without Unicode normalization. Whitespace at split boundaries is removed as whole clusters. This action requires native `Intl.Segmenter`; unsupported runtimes show an error and leave captions unchanged. The separate 2,000 UTF-16 code-unit input limit and UTF-8 byte budgets still apply. Segmentation depends on the runtime’s Unicode data, and estimated timing still needs review against the audio.
- **Automatic captions:** the original video must be **180 seconds or shorter**, even if its edited timeline is shorter. The selected audio is processed for at most 180 seconds. Check recognition results yourself; speaker labels are manual and split-caption timing is estimated.
- **Export:** recording runs in real time and is cancelled when the tab is hidden. Available MP4/WebM codecs depend on the browser. The capture target is 30 fps, **not a fixed-frame-rate guarantee**; the documented 4-second Chromium test averaged about 21.7 fps.
- **Editing model:** one source video, a single video track, and one additional audio file/recording. Fades occur at clip boundaries; clips do not overlap for cross-dissolves.

### Troubleshooting

- **The page does not load:** confirm `npm start` is still running. If port 4173 is occupied, stop the other server or set the `PORT` environment variable to an available port; use the address printed by the server.
- **A video will not open, or export is unavailable:** try an H.264 MP4 or WebM input and another browser with the required media APIs. MOV support depends on the codec inside the file. For export errors, also try 720p.
- **Automatic captions fail:** use a short original with audible speech, check the selected language and network access, or import SRT/VTT and edit manually. The built-in sample cannot be transcribed.
- **A project appears empty:** return to the same browser, host, and port. To restore JSON in another browser, first reconnect the original video and any additional audio, then import the settings through Help.
- **Saved templates cannot be read:** malformed custom templates or favorites are isolated for the session, and library save/delete/favorite changes are blocked to preserve the original storage values. Built-in templates and project editing remain available when the project itself loads. Reload retries reading; it does not repair the library. No entries are automatically deleted or salvaged.
- **Restore fails:** the editor pauses project saving, media replacement, recording, and reset to preserve stored data. If settings were readable, you can edit them in memory and use Help → Save editing settings before reloading. These edits are not saved in the browser. Reload only retries loading; it cannot recover missing media or guarantee codec support. An exit warning may appear for unsaved edits, but browsers may omit it.

## Development

```sh
npm test
node examples/use-editor-service.mjs
```

`npm test` runs syntax checks, editor regression checks, and Node tests for CLI file I/O, project validation, MCP request isolation, subtitle parsing, and the local HTTP server. Each `tests/app-*.test.mjs` suite uses its own synthetic app VM and DOM; `verify.mjs` retains composition and gesture checks. Run `npm test` for the complete regression set. CI is configured for Node 20/22/24 on Linux and Node 24 on Windows; the badge links to actual results.

Storage tests inject synthetic transaction failures to check cancellation, queued retries, and save status. They do not verify real browser quota failures, eviction, or crash recovery.

`dist/` contains the **maintained application source**, not generated build output:

```text
dist/               Browser UI, rendering, captions, and local persistence
  core/             DOM-free project model, validation, and editing commands
  integration/      Editor service and MCP adapter
cli/                Node.js project JSON/SRT command-line interface
scripts/            Local preview server
examples/           Command arguments and a runnable integration example
tests/              Node test suites
verify.mjs          Composition and preview-gesture regression checks
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for changes and bug reports, [ROADMAP.md](ROADMAP.md) for planned work, and [SECURITY.md](SECURITY.md) for private vulnerability reporting. Supporting documents are currently in Korean.

The [browser verification report](docs/BROWSER_QA.md) records a Chromium/macOS test of upload, captions, persistence, and MP4 export, with its performance limits. [QA.md](QA.md) describes regression coverage. Automated tests use simulated browser APIs where needed; they do not establish microphone, speech recognition, or cross-browser compatibility.

## License

Project code and documentation are licensed under [MIT](LICENSE). Downloaded fonts, libraries, and models retain their own terms; see [THIRD_PARTY.md](THIRD_PARTY.md).

## AI / MCP

[Repository skill and local stdio MCP setup](docs/MCP.md). Edit project metadata with AI; changes stay in memory until your client saves the exported document. No media upload or unattended rendering.
