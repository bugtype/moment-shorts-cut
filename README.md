# Moment · Shorts Studio

**Turn your footage into short videos, with editing, captions, and export in your browser.**

**English** · [한국어](README.ko.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/bugtype/moment-shorts-cut/actions/workflows/ci.yml/badge.svg)](https://github.com/bugtype/moment-shorts-cut/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Moment is a local-first video editor with Korean, English and Simplified Chinese interfaces. Trim a clip, choose a template, add captions or narration, and export a short without uploading your media to an app server. No account or API key is required.

The editor also exposes a shared command core, a project JSON CLI with SRT/VTT/TXT export, and a local stdio MCP server for AI clients. This is an early-stage project; see [tested behavior and remaining gaps](docs/BROWSER_QA.md) before relying on a particular browser or codec.

![Moment editor with a template gallery, vertical video preview, and editing timeline](docs/editor-desktop.png)

[Quick start](#quick-start) · [Features](#features) · [Examples](#example-results) · [Workflows](#pick-a-workflow) · [CLI and integrations](#cli-and-integrations) · [Privacy and limits](#privacy-and-limits) · [Development](#development)

## Quick start

You need **Git and Node.js 20 or later**, including npm. There are no npm dependencies to install and no build step.

```sh
git clone https://github.com/bugtype/moment-shorts-cut.git
cd moment-shorts-cut
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The editor starts with a **12-second motion-graphic sample**, so you can try templates and export before bringing your own footage. The sample captions are examples; the sample has no speech to transcribe.

Keep the server running while editing; press `Ctrl+C` to stop it. It binds to `127.0.0.1` and serves only `dist/`. Open the HTTP address rather than double-clicking `dist/index.html`, because the app uses JavaScript modules, workers, and browser storage.

### Interface language

Choose **한국어**, **English** or **简体中文** in the language selector. A saved
choice takes priority over a supported browser language; otherwise the editor uses
Korean. If browser storage is unavailable, switching still works for the current
session, but the choice may not survive a reload.

Changing the interface language does **not** translate your project name, captions,
titles, credits, speaker names, imported files or saved custom-template content.
Existing Korean demo and built-in example text stays Korean; applying example
content remains an explicit edit. Language selection does not change the speech
recognition language. Choose that separately for the source audio.
Screenshots and rendered examples below show their original Korean content.

### Make your first short

Select **English** in the language selector. The steps below use English interface labels:

1. **Media:** upload a video, or keep the sample. Use **Frame** to choose 9:16, 4:5, 1:1, or 16:9 and adjust the framing; trim, split, and reorder clips on the timeline.
2. **Templates:** choose a composition. **Apply style only** keeps your text; applying the example composition replaces title, credit, and timed-text content while preserving footage and dialogue captions.
3. **Captions:** import SRT/VTT, write captions, or generate them locally from speech. Review the text and timing. Use **Title** and **Effects** for headlines and timed text.
4. **Audio:** add an audio file or record narration with microphone permission. Adjust its start time and volume alongside the original audio.
5. **Export:** choose an available MP4/WebM format and 720p or 1080p. **Keep the tab visible until export finishes**, then play the downloaded file to check the result.

The header folder icon opens **Project files**, including on compact screens. **Guide** also provides settings import/save.

**Guide → Find a tool** searches ten fixed destinations using Korean, English or
Simplified Chinese keywords—not your authored content. Choose a result to reveal
and focus an existing control (such as caption review or framing); only output-time
navigation and Project files open their existing dialogs. This does not activate
editing, downloads, file pickers, recognition, recording or export for you.

Tab to a result button to activate it; Enter while typing does not choose a result.
Escape or Cancel returns focus to Guide. Stale project/media/panel results refuse
to navigate; existing busy/recovery guards apply. There is no new header button or
keyboard shortcut, and queries/history are not saved. Existing destination behavior
is unchanged; leaving an input to open Guide can still commit its normal draft.

| Action | Where your work goes |
|---|---|
| **Save** | Browser storage |
| **Project files → Save settings** | Download a `.moment.json` metadata backup |
| **Project files → Import settings** | Restore a saved settings document |
| **Project files → Graphics text (.txt)** | [Human review of saved title, credit and cards](INTEGRATIONS.md#그래픽-문구-검토용-txt); not a project backup |

Settings files must fit **10 MiB (10,485,760 UTF-8 bytes)** for both save and restore; oversized output is rejected, not truncated. Keep your original video and audio separately: **the JSON does not contain media files**.

**Project-name draft:** the header name survives status-only inspector refreshes
within the same project, including audio setup completion. Leave the field to
finish editing; accepted changes are trimmed, with blank becoming **Untitled short**.
Until committed, the draft is not in project settings, backups or browser autosave.
Changes to the project name value or replacing the project (including import/reset/Undo/Redo)
resynchronize the field, even when a replacement has the same name.

| Next task | Read only what you need |
|---|---|
| Navigate the preview | [Fine steps, cut boundaries and exact output time](#navigate-the-preview) |
| Reframe without dragging | [Exact offsets, zoom and thirds grid](#reframe-the-source-video) |
| Edit timing | [Capture trim values and set an exact speed](#edit-timing-from-the-preview) |
| Save an image | [Preview bitmap or output-size PNG](#save-a-preview-image) |
| Back up connected media | [Original video and added audio files](#back-up-connected-media) |
| Audio and video export | [Mix volumes, preview mute and recording options](#audio-export) |
| Troubleshoot or relink | [Storage errors and originals for this tab](#troubleshooting) |
| Duplicate a clip block | [Copy consecutive clips once, not looping playback](#duplicate-clip-range) |
| Repeat playback | [Session-only loop, card preview and export boundaries](#repeat-the-full-preview) |
| Caption workflows | [Import, review, navigate and edit authored rows](docs/CAPTION_WORKFLOWS.md) |

## Features

| Work on | Available tools | Important boundary |
| --- | --- | --- |
| Video and timing | Trim, split, reorder, delete, speed, pan/zoom, undo/redo; brightness, contrast, saturation, vignette, slow zoom and progress bar | One source video and one video track; boundary fades/flash do not overlap clips |
| Layout and text | 16 built-in templates, search/favorites, up to 20 local custom templates with individual JSON import/export, title/credit styling and 12 timed text layers | Style-only preserves authored text; example content replaces title, credit and timed cards |
| Captions and audio | SRT/VTT import, edited SRT/VTT/TXT export, literal find/replace-all, highlighting, effects, two manual speakers; one added audio file or microphone narration | On-device ASR uses Transformers.js 3.8.1 + `Xenova/whisper-tiny`; recognition and estimated split timing need review |
| Save and automate | Browser storage, project JSON, CLI, repository skill and stdio MCP; Canvas/Web Audio → MediaRecorder export | Project JSON contains no media; CLI/MCP do not encode video |

The built-in templates cover review stories, bold opening lines, vlogs, explainers, interviews, recipes, rankings, product reviews, quizzes, and cinematic moments. Preview each with its animated sample. Quiz choices and countdowns are video graphics, not interactive polls.

**Opening hooks:** six additional compositions cover result-first reveals, mistake fixes,
A/B comparisons, a 10-second mini experiment, a 3-second observation quiz, and myth checks.
Choose **Opening hooks** in Templates. Use **Apply example content** for their timed
story structure, or **Apply style only** to retain your wording. Example application
replaces title, credit and timed cards; footage and dialogue captions stay intact.
The default 12-second structure uses 0–2 / 2–5 / 5–8 / 8 seconds to the end;
the quiz uses 0–3 / 3–5 / 5–8 / 8 seconds to the end. **When applying example content,**
these opening boundaries stay fixed for outputs of at least 12 seconds and compress
only for shorter outputs. **Later clip-length or speed edits proportionally retime
the cards**, so review the opening again and adjust card times as needed.
Match your footage and claims to the example text yourself; templates do not reorder
footage, create split screens or verify facts. [Research, six practical cases, implementation plan and review criteria (Korean)](docs/SHORTS_HOOK_TEMPLATES.md)
explain the design. For a cover candidate, use [Save preview PNG](#save-a-preview-image)
at the desired moment; it saves the current canvas size and does not upload or set a
YouTube thumbnail. A template does not guarantee views or completion.

**Compare a template on your scene:** open a template preview and choose **Current
scene**, then switch **Current style / Selected style**. Both use the same frozen
raw frame and current timeline time; the selected view applies the existing
style-only rules to a detached project copy. Authored title/credit/card text and
captions are retained, but visual settings and applicable layer timing can differ.
Comparison does not apply the template, edit, save, seek or play audio; opening the
template preview already pauses playback. Use the existing apply buttons only when ready.
The dialog starts in **Sample**, which remains available when current media is not ready. Reopen after the
project, media, selection or playhead changes. This is a visual preview, not a
native-resolution or source-frame-accurate export.

**Reuse a card’s appearance:** choose **Copy style** on the selected timed card, select
another card, then **Paste style**. Only color, text size/stroke, background styling, presentation
and animation transfer; text, timing, position/width, role, type and enabled state stay intact.
The copied snapshot lives only in editor memory, not the OS clipboard or storage;
later source edits/deletion do not change it. A changed paste is one undo step;
pasting an identical style changes nothing.

### Share a custom template

Export an individual custom-template card in the gallery, then use the gallery’s
import button in another browser. Import adds a **new copy** under **My templates**,
with a new ID; it does not replace a saved template, change favorites or apply
the template to the current project. Preview it, then choose style-only or
example-content application as usual.

New saves, updates from the current composition and `template.export` preserve
the captured cards' stacking order, rather than sorting by start time. This keeps
overlapping card order and the last active headline's priority. Output-range
clipping and relative timing are unchanged; existing saved/exported templates
keep their stored order and are not automatically repaired or rewritten.

**Move several saved templates together:** choose **Export my template collection** in the gallery, then use the existing import action in another browser.

- **Add copies:** fresh IDs under **My templates**, no overwrite or automatic application. An empty collection adds nothing.
- **Validate together:** collection ≤6 MiB, each template ≤256 KiB; the combined library must pass validation and fit 20 entries. Invalid entries or a failed save reject the entire addition.
- **Not a full restore:** favorites, project and media are excluded. [Collection contract](INTEGRATIONS.md#사용자-템플릿-컬렉션)

**While a template file is loading:** successful single/collection import refreshes
the gallery only if **Templates** is open when it finishes. On another panel,
completion does not rebuild that panel or clear its uncommitted inputs. Return to
Templates to review the updated library; existing search text still applies.
Changing panels or projects does not itself cancel this library import, and nothing
is applied to the project. This is not draft autosaving or a change to project/SRT/VTT
import conflict rules.

**Duplicate a saved custom template** with its **Duplicate…** action. Edit the
suggested copy name (trimmed, nonblank, at most 40 UTF-16 code units), then confirm.
The new ID holds an independent copy of the **saved** settings, cards, timing and
metadata—not the active project's composition. It does not apply the template or
change project/history/favorites. A free slot is required in the 20-template library.
If the source changes, reopen; cancel or failed storage leaves the library intact,
and a failed write permits retry. A blocked/corrupt library cannot be duplicated.

**Rename a saved template** from its custom card without making another copy.
Names are trimmed, nonblank and at most 40 UTF-16 code units. The ID, favorites,
saved styling/content and current project stay intact, even with a full 20-entry
library. Names need not be unique; gallery search and export filenames use the
new name. Cancel or a failed save keeps the original. A failed save leaves the
dialog open for retry.

**Update a saved custom template from the current composition** using its card’s **Update from current composition** action, then confirm **Update**. The composition is captured when you confirm, replacing
saved styling/content while keeping the template’s ID, name, category and favorites.
This works even with 20 templates: it replaces one, not appends a copy. It does not
change the current project, media or other projects, or automatically apply a template.
Export the old template first if you need a backup; this is an overwrite, not version history.
Cancel or a failed save preserves the original; a failed save allows retry.

After a successful custom-template save, duplicate, rename or update, focus moves
to the current/new template's **name button** while that gallery view is still current.
Deletion or a filtered-out target returns focus to **template search** instead.
Failed storage keeps the dialog open for retry without moving focus outside it.
This management focus transfer does not apply to cancellations, unchanged renames or file imports.

| File | What it carries | What it does not do |
|---|---|---|
| Project JSON | Editing settings, timeline and captions | Embed source media |
| Single-template JSON | Saved styles, title/credit/card text, keywords and speaker labels | Back up the whole library or current project |
| Custom-template collection JSON | All saved custom templates in their current order | Restore favorites, built-ins, UI preferences or the project |
| SRT/VTT | Edited subtitle text and timing | Preserve visual styling or media |
| TXT | Edited caption text in output order | Recover timing or act as a project backup |

**Review saved wording before sharing a template.** There is no video/audio in the
file, but titles, credits, cards, global keywords and speaker labels can be private.
Single-template import accepts UTF-8 JSON up to 256 KiB, including an optional leading BOM, and
requires room in the 20-template library. Invalid files or failed saves leave the
library and current project unchanged. [File contract and recovery](INTEGRATIONS.md#개별-사용자-템플릿-파일)
cover format/version checks and concurrent selections. This browser-library
workflow remains separate from CLI/MCP: they can [apply an exported template document](INTEGRATIONS.md#내보낸-템플릿을-climcp로-적용) to the current project, but cannot list or save the browser’s custom-template library.

CLI/MCP can also [export the current composition as a portable template](docs/MCP.md#export-the-current-composition-as-a-template) with `template.export`, without changing the project or browser library. This captures style and saved title/credit/card content, not captions or media.

## Preview and timing reference

### Navigate the preview

**Select a timeline clip with the keyboard:** focus its video-track button with
`Tab`, then press `Enter` or `Space` to select it, pause and seek to that occurrence's
start, regardless of horizontal scrolling. Selection-only updates keep the focused
button; mouse/touch selection still seeks to the pressed position within the clip.
Selection itself does not edit, save or add undo history. Content, timing or thumbnail
changes can still rebuild the track; this is not general focus or draft preservation.

**Text-layer timeline buttons:** ordinary title/credit/card text and timing updates
keep existing buttons when the displayed layer order and lane structure are unchanged.
Their text, position and width still update; structural changes or legacy rendering
fallback can rebuild the lane. Timing edits can move a target under the pointer, so
clicking immediately after editing is not guaranteed to activate it. Selection/seek
rules stay unchanged, and this does not save input drafts.

**Preview shortcuts:** unmodified `,` / `.` move backward/forward by 1/30 of an
output second to inspect cut or caption boundaries. Arrow keys still move one
pre-speed timeline second. The fine step uses the 30 fps output reference—not
source-frame accuracy or frame-grid snapping—and retains any starting subframe
offset. It is ignored in editing fields, during IME composition, with modifier
keys or while busy.

**Text / Effects tabs:** `Tab` enters the active tab; unmodified `←` / `→` wrap
through tabs and activate them, while `Home` / `End` select the first/last tab.
Focus follows the selected tab after the panel redraws. `Tab` leaves the tab list;
`Enter` / `Space` retain native button activation and `↑` / `↓` their native behavior.
Tab navigation itself does not seek, change playback or edit/save the project;
preview arrow-key seeking outside tabs is unchanged.

**Review cut boundaries:** use **Previous cut / Next cut** beside the scrubber to
pause and move to the strictly previous/next edited clip boundary, including the
start and end. At a boundary, the next action goes to the adjacent boundary, not
back to the same one. Unmodified `[` / `]` do the same; they are ignored in
editing/form controls, during IME composition, with a dialog open or while blocked
by busy state or recovery without session media access. At an endpoint with no boundary in that direction, nothing
changes, including playback. Speed changes displayed output times, not which cuts are
visited. Navigation does not select another clip, edit, save or add undo history;
this does not promise source-frame-accurate seeking.

**Go to an output time:** click the preview time display (**Go to output time**),
enter seconds such as `2.5`, `01:02.5` or `00:01:02.5`, then choose **Go**.
The value uses output time **after speed**, from zero through the output end.
Confirming pauses and seeks; cancel leaves playback unchanged. It does not edit,
save or add undo history. Reopen if the project or media source changed; busy/recovery guards apply.
This is time navigation, not frame/sample-accurate seeking.

### Choose the frame ratio

**Frame** offers numeric presets **9:16, 4:5, 1:1 and 16:9**. Export quality sets
the short edge; preview/preview PNG uses the fixed bitmap below.

| Ratio | Preview / preview PNG | 720 export | 1080 export |
|---|---|---|---|
| 9:16 | 540×960 | 720×1280 | 1080×1920 |
| 4:5 | 540×675 | 720×900 | 1080×1350 |
| 1:1 | 960×960 | 720×720 | 1080×1080 |
| 16:9 | 960×540 | 1280×720 | 1920×1080 |

Changing ratio does not redesign existing text/cards; review framing and text placement. Existing project files remain readable. New 4:5 files need an updated Moment build; older builds reject that ratio even though the schema version is unchanged. Portable templates do not include or change the ratio. Dimensions are not a guarantee of platform compliance or native codec support.

### Reframe the source video

Choose **Framing…** beside zoom in the desktop Frame inspector or the **Frame**
panel on compact screens. Enter fractional percentages, then **Apply**:

| Control | Meaning |
|---|---|
| Horizontal / Vertical offset | −100–100%; zero centers the fitted video, positive moves right/down relative to the video frame region |
| Zoom | 100–300%; multiplies the existing cover/contain fit and clip-effect zoom |

Only changed fields are applied in one undoable edit; untouched values retain
stored precision. Content/timing and the current playhead position stay unchanged.
Cancel or unchanged values add no command or pause; opening the dialog can still
trigger another field's normal blur/change. Reopen after project/media/context
changes. Valid failed-recovery edits remain in memory and need a settings backup.
This edits metadata even without ready media, so a missing source may show no visual
change. Offsets are not source-pixel coordinates or necessarily whole-canvas
percentages; clipping and uncovered space are possible, with no safe-area guarantee.

**Axis-locked preview drag:** hold only **Shift before starting** to move the selected
video, title, credit, shared captions or timed card along one axis. The first nonzero
screen movement chooses the dominant axis (ties choose horizontal), which stays locked
even after releasing Shift. The opposite stored coordinate stays exact; the moved axis
keeps its existing drag bounds. Shift pressed mid-drag, or combined with Ctrl/Meta/Alt
at the start, leaves free dragging; unmodified mouse/touch dragging is unchanged.
A real move is one Undo; no motion adds no history. Pointer cancellation or lost capture
keeps and commits the partial move, rather than rolling it back. Use **Framing…** or
**Position…** for keyboard/numeric editing. This does not add snapping or centering.

**View-only framing aid:** enable **Thirds grid** in desktop **Frame** or its compact-screen panel; both controls stay synchronized. It divides the whole composition into thirds, not a source-video crop or platform-safe area. Default off; the choice survives panel/project changes in this session and resets on reload. It does not snap objects, change playback/project/history/storage, or appear in preview PNG, output PNG or video exports.

### Edit timing from the preview

**Fill trim values from the playhead:** select a clip and move playback inside that
selected occurrence. Use the target icon beside start/end (**Use playhead for
start / Use playhead for end**). It pauses and fills only that field with the
source time, keeping its precision and the opposite draft unchanged. It does not
seek, edit, save or add history until you explicitly **Apply selected range**
(or **Apply range** in the **Frame** panel). Repeated source clips use the selected occurrence;
speed does not change the captured source value. Endpoint captures may leave an
invalid range: correct it before applying; the 0.1-second minimum still applies.
Outside the selected occurrence, the draft is left unchanged and a message asks
you to move inside it. This is not a source-frame-accuracy guarantee.

**Set an exact speed:** keep using the preview speed presets, or choose **Custom…**,
enter a finite multiplier from **0.25 to 4**, then **Apply**. The current value is
prefilled without rounding; non-preset values remain visible in the speed control.
This changes the whole project's preview/output speed, not one clip. Existing
speed-edit rules retime titles, credits and timed cards; stored clip/caption times
and audio-offset data keep their existing clocks. Canceling or applying the same
value does not edit, save, pause or add history. Reopen the dialog if the project
or media changed. Pitch, codec behavior and frame accuracy are not guaranteed.

### Repeat the full preview

In the **Frame** panel, enable **Loop full preview**, then start playback. This session-only
choice defaults off and resets on reload; it never changes project JSON, saves or undo history.

| Playback | Loop behavior |
|---|---|
| Full preview | Restarts from the beginning; enabling it while paused does not start playback |
| Timed-card preview | Still stops at that card’s end |
| Export | Always one pass, regardless of the preview setting |

Turning it off lets the current pass finish, but cancels a pending restart. Manual
pause/seek, hiding the tab or changing media takes priority. Seamless playback is not guaranteed.

### Save a preview image

| Frame action | Image and playback behavior |
|---|---|
| **Save preview PNG** | Copy the displayed preview bitmap without pausing |
| **Output PNG… → Pause and save PNG** | Choose 720/1080 short-edge output dimensions (default 1080); pause and rerender the currently decoded scene at that size |

**Output PNG** captures on confirmation, not when the dialog opens; opening or
canceling does not pause playback. It renders from decoded source media with the
existing composition renderer, not by enlarging the preview bitmap. It does not
seek, initialize audio/recording, edit, save the project or add undo history.
Wait for fonts/seeking/media readiness and retry if blocked; changed context or a
new request suppresses stale downloads. The local file is
`project-name.scene-WIDTHxHEIGHT.png`. More pixels do not recover source detail or
guarantee exact-frame selection. This is browser-only, not a CLI/MCP PNG renderer.

In **Frame**, choose **Save preview PNG** to download the edited canvas **as displayed
when clicked**: 540×960 (9:16), 540×675 (4:5), 960×960 (1:1) or 960×540 (16:9). It captures
rendered video, text and effects—not DOM guides/selection handles or audio—and does
not rerender at 1080p, seek, pause or change project/history. No media is uploaded.
This works independently of MediaRecorder; it is not source-frame-accurate export.
Busy states and recovery without session media access block capture; a newer request or project/media change cancels
an outdated pending download. Normal playback advancing does not change the snapshot.

<a id="back-up-added-audio"></a>
### Back up connected media

Download the connected files separately from your settings backup:

| Where | Action and file |
|---|---|
| **Media**, beneath the current video asset | **Download original video** saves the connected video file with its original bytes, name and media type; available only for a video project with a connected file |
| **Audio**, beside the attached asset | **Download original audio** saves the full added file, including microphone narration—not an edited mix or audio extracted from the source video |

Neither action applies cuts, offsets, volumes, speed, text or effects, transcodes,
uploads media, pauses, seeks or changes project/history/storage. Project JSON still
contains no media. A missing source cannot be recovered by this download; a relinked
file is the file you supplied, not cryptographically proven to be the original.

The project must be ready or have a confirmed session-only media connection.
Busy states, unavailable recovery media and stale actions are blocked;
this does not repair storage or re-enable browser saving.

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
node cli/moment.mjs exec captions.export --project edited.json --json '{"format":"vtt"}' --out captions.vtt
node cli/moment.mjs exec captions.export --project edited.json --json '{"format":"txt"}' --out captions.txt

# Replace matching caption text without changing timing or speaker metadata.
node cli/moment.mjs exec captions.text.replace --project edited.json --json '{"find":"하루","replacement":"하루의 기록"}' --out corrected.json

# Make all captions larger without replacing their text or timing.
node cli/moment.mjs exec captions.style.update --project corrected.json --json '{"patch":{"captionSize":48}}' --out styled.json

# List commands and their input schemas.
node cli/moment.mjs commands
```

Existing output files are protected; use `--overwrite` only when you intend to replace one. Add `--dry-run` to an `exec` command to inspect its result without writing output. JSON inputs are limited to 10 MiB (10,485,760 bytes).

Generated arguments can be piped as one JSON object with [`--args-file -`](INTEGRATIONS.md#표준-입력으로-json-인수-전달); it waits for EOF and retains the 10 MiB UTF-8 limit. Do not combine it with `--json`.

### Choose an integration

| Need | Use | Start here |
| --- | --- | --- |
| Edit project JSON or export caption files | Node CLI; existing outputs are protected | [Command contracts and file workflow](INTEGRATIONS.md) |
| Give an AI agent project guidance | Repository skill, no global installation | [Moment editor skill](.agents/skills/moment-editor/SKILL.md) |
| Connect an AI client | Local stdio MCP server: `node cli/mcp.mjs` | [Client setup, tools, errors and recovery](docs/MCP.md) |
| Integrate with your own code | Same-page `window.moment` or the reusable service/adapter | `node examples/use-editor-service.mjs` |

**Unapplied trim range:** the same guard covers start/end drafts and active composition in the **Frame** panel. Use **Apply range**, or restore both original values and finish composition, before re-reading and retrying. Source-second precision is unchanged; untouched or numerically equivalent values are not drafts. This does not extend to every numeric input.

**Project-name drafts:** `window.moment.execute` also returns `CONFLICT` while the header name has an uncommitted value or active composition. Finish/commit the name edit or restore its original value and end composition, then re-read and retry. The name is not silently committed or discarded; explicit local replacements keep their existing behavior.

**Live caption drafts:** same-page `window.moment.execute` returns `CONFLICT` before a project commit while the open caption panel has uncommitted row edits or an active composition. Finish/commit the edit or restore its original value, then re-read and retry; the API does not blur, auto-save or discard the draft. Reads, previews and genuine no-op results remain available. This does not change CLI/MCP, explicit file import, local UI edits or Undo, and is not a guard for every editor input. [Exact boundary](INTEGRATIONS.md#브라우저와-파일-왕복)

Run `node examples/use-mcp-client.mjs` for an executable handshake → import → edit → SRT → restart/reimport example. It launches local Node processes and keeps its exported document in memory; it does not write your files or connect to a browser.

**Optional smaller MCP tool list:** [`--tools`](docs/MCP.md#choose-a-smaller-tool-list-optional) selects direct commands for one process; default remains all 41. Include import/get for document handoff; if get is omitted, selected `render.plan` can return the document in `data.project` (not the whole plan). This is not a security or read-only boundary: selected batch/preview retains its full nested command set.

**MCP changes disappear when its process exits.** Retrieve `moment_project_get` and save `structuredContent.data` through your client's authorized file workflow. The bundled server has one temporary `session` project, not your open browser project.

**`render.plan` does not produce an MP4.** Neither the CLI nor the bundled MCP server uploads media or encodes video. A custom remote host must supply its own transport, authentication and storage. An external AI client may send project text to its provider; review that client's privacy settings before sharing private captions.

## Pick a workflow

### Captions

| Task | Use | Keep in mind |
|---|---|---|
| Read nearby authored captions | [`captions.list`](INTEGRATIONS.md#저장된-자막을-나눠-조회) | Read up to 50 exact cues per page, then target a current index with `captions.update`. Pre-speed times; live pages are not snapshots or project backups. |
| Insert a caption or remove a range | [`captions.insert` / `captions.remove`](INTEGRATIONS.md#자막-하나-추가연속-범위-삭제) | Use the current authored index; no sorting or retiming of other cues. Re-read after uncertain results—blind retries can affect the wrong cue. |
| Edit one authored caption | [`captions.update`](INTEGRATIONS.md#자막-하나만-수정) | Patch text, timing, speaker or keywords without resending all cues. Read the current array index first; basis and estimated-timing metadata are preserved. |
| Apply reviewed, different corrections to several rows | [Text-only batch example](examples/correct-caption-text.mjs) | Inspect current indexes, preview then batch up to 20 `captions.update` text patches. Changes only text, unlike subtitle replacement import; preserves timing and metadata. Atomicity is per batch. |
| Correct repeated wording | [`captions.text.replace`](INTEGRATIONS.md#자막-문구-일괄-교정) | Literal, case-sensitive, non-overlapping; no regex/Unicode normalization. Preserves timing, speaker/keyword metadata and order. Blank or overlong results reject the whole edit. Browser UI previews occurrence counts and applies one undo step. |
| Locate a caption in the edit | Row action **View in video** | One occurrence seeks directly; repeated occurrences let you choose. Temporal navigation only, not an edit. |
| Review individual matches | Browser previous/next search controls | Wrap through every literal occurrence, including multiple matches in one row and trimmed-out captions; reveal its page and select the exact substring. Current/total counts are occurrences, not rows. Navigation does not seek, edit or save. |
| Replace one match | **Replace match** after selecting a search result | Replaces only that substring in one undo step, preserving cue timing/metadata. Highlights the replacement; Next continues after it. Same replacement is a no-op; blank/overlong cue results are rejected. Finish pending row edits and reselect stale matches instead of overwriting them. |
| Replace within authored rows | Enter Find/Replacement, then **Replace in range…** | Review the captured literal text and inclusive **1-based** first/last rows (default: selected match’s row, otherwise the current page’s first row; one row). Live counts cover that range; confirm one undoable edit. Outside cues/timing/metadata stay unchanged. Not a persistent selection; Match/All/search navigation remain separate. |
| Find/replace across line breaks | Two-row Find and Replacement fields | Type or paste actual newlines; `\n` stays literal backslash + n. Matching remains case-sensitive and non-overlapping, without regex; replacements preserve cue timing and metadata. |
| Shift a constant subtitle delay | [`captions.timing.shift`](INTEGRATIONS.md#자막-시간을-앞뒤로-이동) | Choose source/timeline and signed seconds **before speed**. Optional authored-row range, then basis filtering; omitted range moves all matching cues. Any out-of-bounds result rejects the whole edit. Browser caption tools apply a real change as one undo step. |
| Review overlapping times | **Caption timing overlaps** or [`captions.overlaps`](INTEGRATIONS.md#자막-시간-겹침-점검) | One representative conflict per overlapping output occurrence, not all pairs or a visibility prediction. Read total/flagged/omitted counts. |
| Review caption timing | Browser **Caption review** or [`captions.inspect`](INTEGRATIONS.md#편집-후-자막-표시-속도-점검) | Optional reading-speed/duration thresholds and overlap findings after cuts, repeats and speed; [save the shown JSON findings](docs/CAPTION_WORKFLOWS.md#review-timing). Advisory only; no automatic correction or compliance claim. |
| Export only selected authored captions | [`captions.export`](INTEGRATIONS.md#선택한-원본-자막-행만-출력) with `captionIndex`/`count` | Browser **Authored row range… → Save**, or CLI/MCP; all clips/speed and full-output timestamps remain, including repetitions. Not a time-window crop or redaction guarantee. |
| Split long captions in bulk or a range | [`captions.split.long`](INTEGRATIONS.md#긴-자막을-전체-또는-범위로-분할) | 12/18/24-grapheme targets, estimated timing and trimmed split-boundary whitespace. API or browser **Range…** can target authored rows; the original split button still covers all cues. |
| Split one caption at the caret | [`captions.split`](INTEGRATIONS.md#자막-하나를-커서-위치에서-분할) or the row split action | Keeps literal text and metadata; estimates timing by grapheme counts, not speech alignment. A caret boundary must not cut an emoji/combined character. Separate from bulk long-caption splitting. |
| Merge adjacent captions | [`captions.merge`](INTEGRATIONS.md#인접한-자막-합치기) or row action **Merge with next caption** | Combines the next authored row, even across pages. Requires matching clock/speaker/keywords and non-overlapping chronological times; merged text also appears across any gap. One browser undo step. |
| Change appearance | [`captions.style.update`](INTEGRATIONS.md#자막-스타일-수정) | Size, position, colors, animation and the two speaker labels/colors: only supplied fields change, without resubmitting the project. Visual styles are absent from plain SRT/VTT. |
| Clear keyword emphasis | **Text → Dialogue → Clear keyword emphasis…**, then confirm | Clears global and every cue’s keyword fields in one undo step, not caption text/timing/speakers or highlight-box styling. Cancel or already-empty keywords add no edit; if the project changes, reopen to confirm. |
| Add caption rows without replacing work | [`captions.append`](INTEGRATIONS.md#기존-자막을-유지하며-여러-행-추가) | Nonempty cue array; keeps existing rows/metadata, including out-of-output cues. Combined limit 10,000; no sorting, shifting or deduplication. Retrying an accepted append duplicates cues. |
| Import subtitle text | [`captions.import`](INTEGRATIONS.md#srtvtt-본문을-명령으로-가져오기) | Default `replace` replaces all captions; `mode:"append"` keeps existing rows and adds parsed cues. Supply contents, not a path, and source/timeline time **before speed**, not output time. API: 100,000 UTF-16 code units; browser files: 2 MiB. |

For browser steps and their warnings, see [Caption workflows](docs/CAPTION_WORKFLOWS.md).

### Clips and composition

| Task | Use | Keep in mind |
|---|---|---|
| Inspect project structure | [`project.summary`](INTEGRATIONS.md#프로젝트-구조-먼저-확인) | Ratio, speed, source/timeline/output durations and authored counts without text. Media flags are requirements, not readiness. Follow with paged reads; save the full document with `project.get`. |
| Inspect clip positions and clocks | [`timeline.list`](INTEGRATIONS.md#타임라인-구간과-시간-나눠-조회) | Up to 50 indexed clips per page with source, pre-speed timeline and after-speed output times. Re-read positional indexes after edits. |
| Move a clip directly | **Move clip…** in the clip inspector or **Frame**, or [`timeline.move`](INTEGRATIONS.md#클립을-지정한-위치로-이동) | UI positions are 1-based; API indices are 0-based final destinations. Same position/cancel are no-ops. |
| Inspect a built-in template | [`template.inspect`](INTEGRATIONS.md#기본-템플릿-적용-전-점검) | Read metadata and proposed title/credit/card text and times before applying; not a rendered preview or reserved state. |
| Review a proposed edit bundle | [`project.preview`](INTEGRATIONS.md#편집-묶음의-반영-전-요약) | Read-only counts and changed-field summary, not a visual preview or state reservation. Later batch revalidates. |
| Apply related edits together | [`project.batch`](INTEGRATIONS.md#여러-편집을-한-번에-반영) | Validate 1–20 supported edits in sequence, then commit once; a rejected step leaves the project unchanged. Not a JSON-RPC batch or a cross-host storage transaction. |
| Keep source sections currently omitted | Desktop Frame inspector or **Frame** panel → **Keep gaps…** | Review the remaining source intervals and confirm a full timeline replacement; source order, not current order/repeats. |
| Remove consecutive clips | Clip inspector or **Frame** → **Remove clip range…** | Enter inclusive first/last positions (1-based); at least one clip must remain. One undoable edit. |
| Repeat consecutive clips | Clip inspector or **Frame** → **Duplicate clip range…**, or [`timeline.duplicate`](INTEGRATIONS.md#클립-구간-복제) | UI uses inclusive 1-based first/last positions; API uses 0-based `clipIndex` plus optional `count` (default 1). |
| Split one clip | [`timeline.split`](INTEGRATIONS.md#클립-구간-분할) | Original source time, not output time; identify the intended occurrence and check boundaries. No full-timeline replacement. |
| Adjust video effects | [`effects.update`](INTEGRATIONS.md#영상-효과-수정) | Brightness, contrast, motion, boundary overlays and progress styling without replacing content or timing. Boundary overlays are not crossfades. |
| Set a source credit | [`credit.update`](INTEGRATIONS.md#출처-크레딧-수정) | Text, appearance and output-time visibility without changing title/captions/cards. Maximum 100 UTF-16 code units; not included in subtitle files. |
| Set text coordinates | Title, credit, shared caption or selected card → **Position…** | Enter horizontal/vertical percentages and Apply together; unchanged axes retain their stored values. |
| Move a card without resizing | Selected card → **Move in time…** | Enter a new start in output seconds **after speed**; both endpoints update together as one undoable edit. |
| Script timed cards | [`overlays.add`, `overlays.update`, `overlays.remove`](INTEGRATIONS.md#스크립트에-맞춰-카드-추가삭제) | Individual IDs and output time **after speed**, without replacing the project. Additions append; `overlays.move` changes card stacking. In the selected card’s stacking controls, **Bring forward / Send backward** moves one stored-card position (including disabled/off-time cards); **Bring to front / Send to back** jumps to an edge. One undo step, no timing/content change; only card order, not its layer relationship to captions. |

<a id="duplicate-clip-range"></a>

**Duplicate clip range…** starts with the selected clip as both bounds. It inserts
one ordered copy immediately after the original block, selects the first copy and
seeks its start, with one Undo. The whole range must exist and the result must stay
within 1,000 clips; invalid ranges/capacity reject without a partial copy. Cancel
makes no additional edit. Source captions recur in the copies; timeline captions
and audio offset keep their numeric values. Title/credit/card times scale once
with the new output duration—they are not copied. This copies source intervals,
not media files; it does not create a persistent multi-clip selection.

**Position…** edits the layer's normalized anchor, not its rendered bounding box.
Changed title coordinates accept X **5–95%**, Y **6–93%**; credit, shared captions
and cards accept **0–100%** on each axis. Fractional input is allowed. Applying
changed axes is one undoable edit without changing content, timing or styling;
an untouched axis retains its exact stored value, even an imported title coordinate
outside the current edit bounds. Cancel or unchanged values add no edit. Panel
entries remain available on compact layouts. Reopen after project/layer/media
changes; valid failed-recovery edits remain in memory and need a settings backup.
Renderers use different anchors and may fit/clamp text, so these percentages do
not guarantee visible centering, pixel alignment or safe-area containment.

**Use playhead for start** in **Move in time…** fills the draft with the current output time (after speed), then updates the calculated end. Review and choose **Move** to apply; capture alone does not edit, pause, seek, save or add history. Overflow is not cropped.

For example, to move a card from 0–3 to 7–10 seconds, choose **Move in time…**,
enter `7`, review the calculated end and choose **Move**. Its duration, ID, stacking
order, content and style remain; other cards are unchanged. A changed move pauses
playback but keeps the current playhead time—it does not seek to the card. The whole interval must
fit within the output: an out-of-range or too-long card is rejected, not cropped.
Cancel or the same start does not edit, pause, seek, save or add history. Card, title and credit start/end inputs show the stored decimal value without
two-decimal rounding and accept fractional seconds without a 0.1-second step grid.
An unset title/credit end stays blank/null; read-only summaries may still be rounded.
This does not change when edits commit or the existing interval checks. Fractional
times use ordinary floating-point precision, not sample accuracy. Reopen after
project, media or selected-card changes. Valid failed-recovery settings remain
in-memory edits only: browser saving stays blocked, so back up settings separately.

Caption/card start and end fields cannot be blank; enter `0` or fractional seconds
explicitly within a valid interval. Captions use source/timeline seconds **before
speed**, cards use output seconds **after speed**; optional title/credit ends still
accept blank/null for the output end.

Choose **Move clip…**, enter a position from 1 to the clip count and choose **Move**.
A changed move is one undoable edit: selection follows the moved clip, playback
pauses and seeks its new start. Existing arrows use the same operation. The moved
clip’s trim drafts are preserved; do not assume all other panel drafts survive an
edit. Reopen if project/media/selection changed. Source ranges and stored caption
and title/card times are not rewritten; source-caption occurrences follow the new
order, while timeline captions retain their absolute times.
If recovery failed but valid settings were readable, moves remain in-memory edits;
browser saving stays blocked, so download a settings backup before reloading.


Use **Remove clip range…** for one contiguous range, not a saved multi-selection.
Confirming selects the first surviving clip after that range, or the last survivor
if there is no successor, and seeks its start. Source captions remain authored;
timeline-caption times and audio offset stay absolute. Title, credit and timed-card
output times rescale proportionally with the shortened timeline. This structural
edit resets trim drafts; cancel preserves them. Reopen after project/media/selection
changes. Valid failed-recovery edits still require a settings backup before reload,
not browser saving.

**Keep gaps…** takes the union of every current clip's source range and keeps its
complement within the full source duration. For a 12-second source with clips
2–4 and 6–8, the result is 0–2, 4–6 and 8–12—even if current clips repeat or appear
in another order. Review source intervals (20 per page), count and after-speed output duration, then confirm.
One undoable replacement selects the first result and seeks its start.

This action refuses no remaining gaps, any positive result gap shorter than
**0.1 seconds**, or more than **1,000** result clips; it never silently drops tiny
gaps. That minimum is specific to this UI action, not all imported project clips.
Source-caption values remain, so captions can return with restored source sections;
timeline captions and added-audio offset stay absolute. Title/credit/card output
times rescale with the new duration. It is not lossless rendering or reversible
history: use Undo/settings backup, rather than expecting a second inversion to
restore ordering and repeats. Reopen after context changes; valid failed-recovery
edits still need a settings backup before reloading.

## Privacy and limits

**Media stays on your device, but the app is not fully offline.** Fonts load from Google Fonts; automatic captions download code from jsDelivr and model/runtime assets from Hugging Face and related runtime sources. Speech inference runs in a browser worker. See [SECURITY.md](SECURITY.md) for network requests and trust boundaries.

| Input or project limit | Maximum |
| --- | --- |
| Video / additional audio | 500 MiB / 100 MiB |
| Project-settings JSON save/restore / SRT or VTT input | 10 MiB / 2 MiB, UTF-8 |
| Clips / source caption cues | 1,000 / 10,000; 2,000 UTF-16 code units per cue |
| Custom templates / timed text layers | 20 / 12 |

At 1,000 clips, delete a clip before splitting another.

**These are validation limits, not memory or codec guarantees.** Browser storage is not a backup: media and settings are written separately and can fall out of sync after a failed save. Keep the original media and export project JSON regularly.

**Automatic captions:** the original video must be **180 seconds or shorter**, even after trimming. Selected audio is processed for at most 180 seconds. Recognition, manual speaker labels and estimated split timing need review.

<a id="audio-export"></a>

## Audio and video export

<a id="audio-mix"></a>

**Balance the mix in Audio:** both existing project gains are available together when their sources apply.

| Audio control | Scope |
|---|---|
| **Original video volume** | Video projects only; the same source gain remains available in Frame |
| **Added audio volume** | Shown when an added audio file is connected |

Both use 0–100% global gains, not per-clip mixing or new audio processing. A video project does not necessarily contain an audio track. These controls change the recorded mix; the session-only monitor mute below remains separate.

**Audio start position:** enter output seconds, including an explicit `0` to start
at the beginning. An empty or invalid numeric entry keeps the draft and shows a
warning without changing the offset, captions or history. Accepted numeric edits
retain the existing clamping and timeline-caption shift behavior; this does not
change which captions follow the added audio.

**While added audio loads:** if **Title**, **Effects**, **Templates** or **Frame** is
open when loading succeeds, completion does not rebuild that pane and erase its
uncommitted inputs. **Audio**, **Captions** and **Media** still refresh for the new
source. Normal pausing, timeline/inspector updates and storage rules are unchanged;
this adds no draft autosave or preservation through Undo or project replacement.

**Preview mute is not export silence.** The preview speaker button mutes only what
you hear, including during export; the recorded mix still uses the project's
source-volume and added-audio-volume settings. Set **both volumes to 0** for a
silent mix. Preview mute stays as selected through export, cancel and retry, but
is session-only (reload defaults to unmuted), not a saved project field.

### Recording options

**Video export:** keep the tab visible; hiding it cancels recording. MP4/WebM support depends on the browser. Recording is real-time, with a 30 fps target rather than a fixed-rate guarantee. The historical 4-second Chromium test averaged about 21.7 fps; see [the measured report](docs/BROWSER_QA.md).

Both export options start checked whenever you open the dialog. Their values are
captured on Start for that request only; they do not edit/save the project or add history.

| Export option | When unchecked |
|---|---|
| **Include captions in video** | Omits only Moment’s authored caption layer; checked still respects the project's caption visibility setting |
| **Include audio** | Omits audio tracks from the recording stream, rather than recording a silent mix |

Audio inclusion does not change project volumes or preview mute/monitoring. To keep
an audio track with a silent mix instead, leave it checked and set both project
volumes to 0. Existing audio preparation and browser codec checks still apply;
unchecking is not a workaround for audio preparation errors. Cancel/retry cannot
reuse a previous request's options; a newly opened dialog starts checked again.

Caption inclusion affects these outputs:

| Output | Effect of unchecking |
|---|---|
| Recorded video | Omits authored captions; titles, credits, timed cards and source footage remain |
| Normal editor/PNG/template preview before and after export | Unchanged; PNG capture remains blocked while recording |
| Preview during recording | Mirrors the chosen recorded output, including omitted captions |
| SRT/VTT sidecar files | Unchanged; save separately from the caption panel |

This does not remove text already present in source pixels or create a switchable
subtitle track inside MP4/WebM. CLI/MCP `render.plan` has no new toggle and remains a plan, not video encoding.

## Storage and file formats

<details>
<summary>Storage, pending imports and transcription conflicts</summary>

**Storage:** media is stored in IndexedDB and editing state in localStorage. They are written separately; a failed save can leave them out of sync. Storage belongs to the current browser and origin; changing the host or port opens a different storage area. Clearing browser data, private browsing, or storage exhaustion can lose work. There is no cloud sync or remote backup.

**Pending imports:** if the project changes while a text file is being read or waiting to apply, the import is rejected; select the file again to apply it to the current project. Selecting another JSON/SRT/VTT file supersedes the earlier pending import, even if the newer file fails. These checks cover applied project state, not uncommitted text-field drafts.

**Pending transcription:** results are not applied if the source media or existing captions changed, or the project was replaced; added-audio results also require unchanged audio offset and edited duration. Generate again against the updated input. Appearance changes remain usable. This protects applied edits, not uncommitted text-field drafts, and does not promise to stop model computation when a conflict is detected.

</details>

<details>
<summary>UTF-8, subtitle formats and timing rules</summary>

**Text imports:** save project JSON and SRT/VTT files as UTF-8; a leading UTF-8 BOM is supported. Subtitle LF, CRLF and CR line endings are normalized to LF while preserving payload line breaks. Invalid UTF-8 is rejected without replacing the current project or captions. Other encodings are not detected or converted automatically.

**Caption files:** select **SRT**, **VTT**, **TXT** or **Review TXT** and use the caption panel’s single save button. SRT is the default; the selection survives paging.

**Plain WebVTT:** select **VTT**, or pass `format: "vtt"` to the CLI/MCP export command. Omitting `format` still exports SRT; a `.vtt` filename alone does not select it. VTT uses a `WEBVTT` header and dot-separated milliseconds, with the same edited timing and text escaping. Rich styles, regions and speaker metadata are not exported. VTT rejects NUL characters. With no cues, CLI/MCP return `WEBVTT\n\n`; the browser does not download an empty caption file.

**Choose a text export:**

| Choice | What you receive |
|---|---|
| **TXT** | Existing caption paragraphs, no timing or speaker labels |
| **Review TXT** | `.review.txt` with after-speed output seconds, explicitly assigned nonempty speaker names and cue text; repeated/overlapping occurrences listed separately |

Review headings follow UI language; authored names/text are not translated. This is human review—not an import format, rendered-visibility guarantee, audio-verified transcript or project backup. Both modes use LF and UTF-8 without BOM; empty output downloads no file. Used labels also count toward the final 2 MiB budget and cannot contain NUL. [CLI/MCP opt-in and limits](INTEGRATIONS.md#자막-검토용-txt)

**Plain TXT:** one paragraph per derived cue, ordered using clips, repetitions and source/timeline captions after speed. Repeated or split clips can repeat words; this is not a deduplicated or word-accurate transcript. No timestamps, IDs, speakers, titles, cards or styling are included. Literal `<>&`, whitespace and multiline text are preserved, with LF line endings, a blank line between cues and a final newline. Blank lines and sub-millisecond cues are allowed; NUL is rejected. Empty export returns `""`. TXT cannot be imported by SRT/VTT import or recover cue timing.

**UTF-8 export boundary:** emitted isolated UTF-16 surrogates are rejected instead of silently becoming `U+FFFD`. This applies to SRT/VTT/TXT and review-TXT cue text, used review speaker labels, and authored fields emitted in the graphics inventory.

Trimmed/excluded cues, unused labels and unrelated graphics do not block scoped subtitle export. No Unicode normalization or repair is performed; valid paired emoji, combining characters and deliberately authored `U+FFFD` remain unchanged by this check.

Model/import validation is unchanged; project JSON retains escaped code units for recovery. Correct the intended text before retrying.

**SRT/VTT text:** all SRT/VTT/TXT exports reject NUL (`U+0000`) rather than stripping it. Correct/remove that unsupported character and retry; project JSON retains authored text, and a failed export does not overwrite an existing output file. Blank lines separate cues. Export rejects empty cues or blank lines inside an exported caption instead of dropping paragraphs or assigning new times. Remove the blank lines to export SRT/VTT; project JSON retains the original text. Ordinary multiline captions are supported, with CRLF/CR normalized to LF in output. Subtitle-player markup support varies; universal compatibility is not claimed.

**SRT/VTT timing:** timestamps round to milliseconds after trimming and speed changes. Export rejects a cue whose rounded start and end are equal; adjust its interval or playback speed. It does not extend, drop or move cues automatically, and the original project keeps its precise timing.

</details>

<details>
<summary>Derived caption budgets and long-caption splitting</summary>

**Derived caption limits:** the timeline caption lane and SRT/VTT/TXT export support at most 10,000 edited occurrences and 2 MiB of UTF-8 caption text, counting each clip repetition. Each completed caption file has a separate 2 MiB limit including escaping, timing, separators, the VTT header when present and any emitted BOM (browser SRT exports include a BOM; browser VTT/TXT and CLI/service exports do not). Exceeding a limit rejects the entire derived output, including for older projects; reduce repeated clips or captions to restore it. Original caption editing, project JSON, undo and saving remain available. These budgets do not guarantee UI responsiveness or available memory.

**Long-caption splitting:** the 12/18/24-character targets and estimated timing weights count grapheme clusters, keeping combining marks and joined emoji together without Unicode normalization. Whitespace at split boundaries is removed as whole clusters. This action requires native `Intl.Segmenter`; unsupported runtimes show an error and leave captions unchanged. The separate 2,000 UTF-16 code-unit input limit and UTF-8 byte budgets still apply. Segmentation depends on the runtime’s Unicode data, and estimated timing still needs review against the audio.

</details>

## Troubleshooting

- **The page does not load:** confirm `npm start` is still running. If port 4173 is occupied, stop the other server or set the `PORT` environment variable to an available port; use the address printed by the server.
- **A video will not open, or export is unavailable:** try an H.264 MP4 or WebM input and another browser with the required media APIs. MOV support depends on the codec inside the file. For export errors, also try 720p.
- **Automatic captions fail:** use a short original with audible speech, check the selected language and network access, or import SRT/VTT and edit manually. The built-in sample cannot be transcribed.
- **A project appears empty:** return to the same browser, host, and port. To restore JSON in another browser, first reconnect the original video and any additional audio, then choose **Project files → Import settings**.
- **Saved templates cannot be read:** malformed custom templates or favorites are isolated for the session, and library save/delete/favorite changes are blocked to preserve the original storage values. Built-in templates and project editing remain available when the project itself loads. Reload retries reading; it does not repair the library. No entries are automatically deleted or salvaged.
- **Restore fails:** the editor pauses project saving, media replacement, recording, and reset to preserve stored data. If settings were readable, you can edit them in memory and use **Project files → Save settings** before reloading. These edits are not saved in the browser. Reload only retries loading; it cannot recover missing media or guarantee codec support. An exit warning may appear for unsaved edits, but browsers may omit it. [Relink originals for this tab](#relink-originals-for-this-tab-only) can enable preview/export without repairing storage.

### Relink originals for this tab only

If restoration failed **but valid project settings were readable**, open **Project
files → Relink original files**. Select every required original
video/added-audio file, explicitly confirm they are this project's originals, then
choose **Connect for this tab**. Temporary probes and the actual editor media
elements must finish loading before playback access is enabled.

| After successful relinking | Boundary |
|---|---|
| Preview, seeking, video export and preview PNG | Available in this tab; no automatic playback |
| In-memory metadata edits, undo and settings backup | Still available; download the settings before reloading |
| Browser Save/autosave, ordinary import, reset, recording and ASR | Still blocked; storage failure/status is not cleared |
| Reload | Original files must be supplied again; this is not persistence repair |

Names must match, but matching names/durations **do not prove file identity**.
Video must cover the stored duration and all clips; it cannot be shorter and may
exceed the stored duration by at most 0.05 seconds. Added audio must have a finite
positive duration; no stored audio duration exists for comparison. The existing
500 MiB video / 100 MiB audio limits apply. Retain the actual originals.
Relinking itself changes no project JSON, history, IndexedDB or localStorage.
A project/media-contract change or failed/canceled load cannot grant stale access.

## Development

```sh
npm test
node examples/use-editor-service.mjs
node examples/use-mcp-client.mjs
```

`npm test` runs syntax checks, editor regression checks, and Node tests for CLI file I/O, project validation, MCP lifecycle/schema/request isolation, the interactive MCP client example, subtitle parsing, and the local HTTP server. Each `tests/app-*.test.mjs` suite uses its own synthetic app VM and DOM; `verify.mjs` retains composition and gesture checks. Run `npm test` for the complete regression set. CI is configured for Node 20/22/24 on Linux and Node 24 on Windows; the badge links to actual results.

Storage tests inject synthetic transaction failures to check cancellation, queued retries, and save status. They do not verify real browser quota failures, eviction, or crash recovery.

`dist/` contains the **maintained application source**, not generated build output:

```text
dist/               Browser UI, rendering, captions, and local persistence
  core/             DOM-free project model, validation, and editing commands
  integration/      Editor service and MCP adapter
cli/                Node.js project/caption CLI, stdio MCP session and transport
scripts/            Local preview server
examples/           Command arguments and runnable service/MCP examples
tests/              Node test suites
verify.mjs          Composition and preview-gesture regression checks
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for changes and bug reports, [ROADMAP.md](ROADMAP.md) for planned work, and [SECURITY.md](SECURITY.md) for private vulnerability reporting. Some supporting documents are in Korean; MCP setup and skill references are also available in English.

The [browser verification report](docs/BROWSER_QA.md) records a Chromium/macOS test of upload, captions, persistence, and MP4 export, with its performance limits. [QA.md](QA.md) describes regression coverage. Automated tests use simulated browser APIs where needed; they do not establish microphone, speech recognition, or cross-browser compatibility.

## License

Project code and documentation are licensed under [MIT](LICENSE). Downloaded fonts, libraries, and models retain their own terms; see [THIRD_PARTY.md](THIRD_PARTY.md).
