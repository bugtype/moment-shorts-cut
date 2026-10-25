# Export validation tools

These tools prepare synthetic inputs and check a detector, a frame schedule,
cancellation ownership and a bounded encoder probe. They do **not** export a Moment project or establish an
export speed improvement. Browser encoding, compositor pixels, audio mixing,
pitch, hardware acceleration, memory and native resource release need separate
measurement. The editor, CLI/MCP render-plan API and MediaRecorder path are unchanged.

## Checks included in the normal test suite

Node 20+ is sufficient. No package installation, browser or FFmpeg is needed:

```sh
npm test
node --test tests/export-schedule.test.mjs tests/export-ownership.test.mjs tests/export-markers.test.mjs tests/export-matrix.test.mjs
node --test tests/export-encoder-probe.test.mjs
```

- `qa/export-schedule.mjs` computes a bounded, silent 30 fps schedule. An explicit
  positive output interval must be at most 12 seconds; longer requests are rejected.
  Composition times are `index / 30`. Integer-microsecond timestamps are rounded
  independently, with the final duration clipped to the rounded endpoint. Twelve
  seconds contains 360 frames and no endpoint frame. Rounding within 0.5 µs of a
  boundary may affect frame count. This does not verify encoded timestamps.
- `qa/export-ownership.mjs` is a controlled-promise model with a fresh resource
  port for each run. Cancellation invalidates ownership immediately, including
  while finalization is pending. Tests cover retry, stage failures, disposal,
  interval/listener cleanup and original-error preservation. Its interval only
  exercises cleanup; it collects no performance metrics. A failed cleanup hook
  is reported, not proof that the resource was released. A synchronous publication
  callback can perform a side effect and then throw; that side effect cannot be undone.
- `qa/export-markers.mjs` checks this fixture's decoded buffers and probe metadata.
  Mutation tests reject missing/unknown/mispaired markers, wrong timestamps and
  extra schedule or duration errors in the negative control. They run without codecs.
- `qa/export-matrix.mjs` uses the existing project validator and `render.plan`.
  Its documents and plans remain metadata with `rendered:false`.
- `qa/export-encoder-probe.mjs` exercises a silent raw VP8 encoder boundary.
  Its Node tests inject controlled constructors, clocks and events. They establish
  orchestration contracts, **not native encoding or browser performance**.

## Silent encoder probe, separate from the editor

`runSilentEncoderProbe` is an opt-in QA function, not a new export mode. Importing
it performs no encoding. It uses runtime `VideoEncoder`/`VideoFrame` when called,
or returns `status: 'unsupported'` when the APIs or exact configuration are not
supported. It does not install a codec, select a fallback, produce a file, retain
encoded payloads or change the MediaRecorder path.

| Fixed experiment limit | Meaning |
|---|---|
| Positive duration ≤12 seconds, 30 fps, ≤360 frames | Reuses the rational frame schedule above, including a clipped final duration |
| 720/1080, one of the four supported ratios | Caller canvas must exactly match the requested dimensions; resizing during drawing is rejected |
| Queue threshold 4; 64 MiB observed encoded bytes | Bounds pending requests and scalar byte accounting, **not native encoder memory** |
| 30-second total watchdog | Includes capability checking, drawing, backpressure and flush; not a performance target |

The requested VP8 configuration uses quality latency and no hardware preference.
The API's queue size is not completion: the probe awaits `flush()`, checks the
timestamp/duration set, then closes the encoder before returning completion.
Quality mode forbids dropping frames to meet bitrate/frame-rate targets, but
actual runtime support still needs checking. Hardware preference is not evidence
of the implementation used. [WebCodecs encoder and configuration contracts](https://www.w3.org/TR/webcodecs/#videoencoder-interface),
[VP8 registration](https://www.w3.org/TR/webcodecs-vp8-codec-registration/).

### Future authorized browser smoke

Use a permitted secure-context QA harness that explicitly serves the QA modules
and their required `dist/core` imports. The normal `npm start` serves only `dist/`;
the following is **not** an editor-console command or an already-verified browser
run. Do not change browser security settings to make a blocked environment work.

Start with one solid-color frame before trying the 12-second schedule:

```js
import { runSilentEncoderProbe } from '/qa/export-encoder-probe.mjs';

const canvas = document.createElement('canvas');
canvas.width = 720;
canvas.height = 1280;
const context = canvas.getContext('2d');
const controller = new AbortController();
const result = await runSilentEncoderProbe({
  canvas, quality: 720, ratio: '9:16', outputDuration: 1 / 30,
  signal: controller.signal,
  drawFrame(target, frame) {
    context.fillStyle = frame.index % 2 ? '#ffffff' : '#101010';
    context.fillRect(0, 0, target.width, target.height);
  },
});
console.log(result);
```

For a subsequent bounded run, change `outputDuration` to `12` and connect a
separate Cancel action to `controller.abort()`. `drawFrame(canvas, frame)` receives
a frozen `{index, time, timestampUs, durationUs}` record. It must return
synchronously and finish promptly. Async callbacks are rejected; the probe cannot
undo work they independently scheduled. Timer-based yields allow cancellation
between batches, but no watchdog can preempt a blocked synchronous callback.

Only `status: 'completed'` establishes a complete metadata check for that invocation.
Unsupported and cancelled results are not passes; timeouts, malformed observations
and cleanup failures reject. A pre-aborted input reports `not-run`; an interrupted
attempt reports `not-completed` and may already have submitted frames.
Input frames close after submission, including failed
submissions. Abort/deadline/error paths close the encoder and wake pending waits;
retained callbacks from an old invocation cannot complete a later one. Failed
cleanup is reported, not proof of native release.

The result retains at most 360 scalar chunk descriptors, not chunks or byte
buffers. Injected dependencies label verification `injected-contract-only`;
runtime completion labels it `runtime-encoded-chunk-metadata`. Neither verifies
decoded pixels, a playable file, audio, compositor parity or export speed. The
discarded payloads cannot subsequently be decoded from this result.

Record the exact source revision, browser/OS, requested/supported configuration,
result and cancellation/failure observations. Native execution of this probe is
still required before using it as encoder evidence. A later compositor caller can
reuse `createCompositionRenderer().draw`; production integration, muxing, audio
and default activation remain outside this experiment.

## Optional file calibration

Use an existing FFmpeg/ffprobe installation on PATH with `libx264`, AAC encoding
and the `extractplanes` filter. The command installs nothing. It was checked with
FFmpeg/ffprobe 7.1.5; other builds must pass their own calibration.

```sh
node qa/export-calibration.mjs .moment-test-export
```

The destination must not exist; its parent must exist. Existing directories and
symlinks are refused before writing. On failure, logs and partial diagnostic
results remain in the new directory; do not treat them as a passed calibration.
Choose another fresh destination for a retry. `.moment-test-*/` is already ignored
by Git; do not commit generated media, machine logs or private paths.

The command creates and fully decodes three 12-second, 640×360, H.264/AAC files:

| File | Expected result |
|---|---|
| `synthetic-av.mp4` | 360 frames at 30 fps; identified marker pairs within ±5 ms |
| `synthetic-av-plus100ms.mp4` | The same video, audio delayed by 4,800 samples; +100 ms ±5 ms, fails zero-offset synchronization |
| `synthetic-av-wrong-identity.mp4` | Two tone identities swapped; rejected pairing and no aggregate offset |

Five nonperiodic markers have different luminance, duration and frequency IDs.
The analyzer extracts native luma to avoid a grayscale range conversion, uses
1 ms audio RMS bins, and identifies isolated tones by zero crossings plus a
fitted sinusoid. It checks identities, slot durations, frame count and timestamps
before reporting offsets. The negative control passes calibration only for its
specific intended identity mismatch; additional timing, duration or media errors
fail. Positive offset means audio follows the paired visual marker.

The ±5 ms onset tolerance covers AAC spread, source ramps, RMS bins and rounded
PTS. AAC trailing padding and any incomplete final RMS bin are reported. This
detector is fixture-specific: it cannot yet match edited cuts, repeated marker
occurrences, speed changes, overlays or mixed audio. FFmpeg source encoder identity
comes from the invoked command, not an inference about a browser encoder.

The output includes `analysis-report.json`, exact command arguments, tool versions,
source/media SHA-256 hashes, full decode logs and decoded buffers. Exit zero means
all three expected calibration outcomes passed; it does not mean all three files
are synchronized. A separate `bgm-60.wav` provides a low-amplitude synthetic chord
for project preparation; its sample count and decode are checked, not an app mix.

## Prepare A–E project inputs

```sh
node qa/export-matrix.mjs .moment-test-projects
```

This also requires a fresh destination. It creates 12 validated project documents
and 16 run settings: A is the 12-second demo; B is a 30-second multicut project;
C is 60 seconds with text/effects and additional audio; D pairs 720/1080 across
all four aspect ratios; E covers 0.25, 0.5, 1, 2 and 4× speed with reordered/repeated
clips, overlapping source/timeline captions and long estimated captions.

Video projects refer to `synthetic-av.mp4`; C/E also refer to `bgm-60.wav`. JSON
contains no media bytes. Attach the generated media explicitly in a permitted
browser; importing settings does not establish media readiness. Repeated source
markers require clip-occurrence-aware analysis beyond this calibration tool.

Run one real Moment smoke export and fully decode it before attempting the matrix.
Record the exact commit, inputs, settings, browser/OS, codec and encoder evidence;
wall-clock export/duration ratio; composition mean/p95; actual frames, PTS and A/V
sync; the measured memory type; cache hits; and cancellation/failure/repeat cleanup.
Use the same environment/input/settings for comparisons. Label missing values
unmeasured and keep synthetic or software/headless results separate from user
hardware. If the supported browser cannot start, report that blocker without
changing its security settings. See [browser QA scope](BROWSER_QA.md).
