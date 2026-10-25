# Export validation tools

These tools prepare synthetic inputs and check a detector, a frame schedule and
cancellation ownership. They do **not** export a Moment project or establish an
export speed improvement. Browser encoding, compositor pixels, audio mixing,
pitch, hardware acceleration, memory and native resource release need separate
measurement. The editor, CLI/MCP render-plan API and MediaRecorder path are unchanged.

## Checks included in the normal test suite

Node 20+ is sufficient. No package installation, browser or FFmpeg is needed:

```sh
npm test
node --test tests/export-schedule.test.mjs tests/export-ownership.test.mjs tests/export-markers.test.mjs tests/export-matrix.test.mjs
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
