# Browser caption workflows

[English](CAPTION_WORKFLOWS.md) · [한국어](CAPTION_WORKFLOWS.ko.md) · [简体中文](CAPTION_WORKFLOWS.zh-CN.md)

[Back to README](../README.md)

| Task |
|---|
| [Save a caption excerpt](#save-excerpt) |
| [Find a caption in the video](#view-in-video) |
| [Review caption timing](#review-timing) |
| [Split a range of long captions](#split-range) |
| [Edit precise caption times](#precise-times) |
| [Navigate caption pages](#caption-pages) |
| [Remove a caption range](#remove-range) |
| [Import and review subtitle files](#import-subtitles) |
| [Shift timing in a range](#shift-range) |
| [Assign a speaker to a range](#assign-speaker) |

<a id="save-excerpt"></a>

## Save a caption excerpt

**Save a caption excerpt:** keep **All captions** for the existing one-click save, or choose **Authored row range…** beside the format and click **Save**. Enter inclusive **1-based authored rows**, then explicitly save. Both fields initially show the visible page’s first row—not a selected page.

SRT, VTT, TXT and Review TXT use the same full-output clocks, repeats and trimmed-out omission rules; timestamps do not restart at zero. Range files add `.rows-FIRST-LAST`; empty output or errors keep the dialog open.

This does not edit, seek, pause, save project settings or add undo history. Review text and speaker labels before sharing.

<a id="view-in-video"></a>

## Find a caption in the video

**View in video** on a caption row pauses and seeks its temporal occurrence without
editing, saving, adding history or autoplaying. Repeated source clips open a chooser
with 20 occurrences per page (up to 1,000 clips); displayed times are after speed.
A trimmed-out cue only shows a notice. Reopen after project/media changes. This
navigates timing, not guaranteed rendered visibility: disabled captions or overlap
priority may hide the text, and source-frame accuracy is not promised.

<a id="review-timing"></a>

## Review caption timing

**Caption timing overlaps** shows up to 20 issues in occurrence order. Related
caption buttons focus the authored row without seeking; **View range** pauses and
seeks the overlap, then focuses the first related row without autoplay. Touching
endpoints do not count. Reopen after project/media changes. Review changes nothing;
video navigation needs normal or confirmed session-media access. No automatic fix.

In **Caption review**, optionally enter your own positive reading-speed, minimum
and maximum duration thresholds; blank fields disable those checks. Durations are
output seconds after speed, with minimum no greater than maximum. Overlaps are
checked by default. Choose all findings or one type; the report shows at most 20
matching findings, alongside all-check counts and matched/omitted totals. Repeats
are separate occurrences; overlap findings represent affected occurrences, not all pairs.

Changed criteria require a new inspection. A filter change recomputes the matching
report when the previous inspection is current; it does not filter only the first
20 rows. **Captions** focuses the authored row without seeking; **View range** pauses
and seeks the occurrence before focusing its row. Reopen after project/media changes.
Inspection/navigation does not edit, save project settings or add undo history.
Thresholds are not retained in editor settings, no automatic fixes are applied,
and the separate **Caption timing overlaps** entry remains available.

After inspection, **Save shown findings (.json)** downloads the current report as
`PROJECT.caption-findings.json`: the chosen thresholds/filter, full counts,
matched/omitted totals and at most **20 shown findings**. The canonical JSON keys,
**zero-based indexes** and **after-speed output seconds** match `captions.inspect`;
no caption text or project name is included in its contents. The filename uses
the project name. An empty filtered list does not mean all checks passed: inspect
the filter, enabled checks and full counts.

Saving does not close the dialog, alter the project/playhead, write browser storage
or add history. It needs no linked source media, but busy/recovery and stale-report
guards still apply. A download error leaves the report available to retry; the app
cannot confirm browser download completion. Keep the file with the unchanged
project settings: its indexes are a snapshot, not a portable project backup or
proof of compliance, rendered visibility or speech alignment.

<a id="split-range"></a>

## Split a range of long captions

For only part of the list, choose **Range…** beside the long-caption split control.
Enter inclusive first/last authored positions (1-based); both initially point to
this page's first cue. The dialog carries the selected 12/18/24 preset, which you
can change before applying. A changed result is one Undo; no change closes without
editing or pausing. Other rows keep their text, metadata and clock. Splitting still
trims boundary whitespace and estimates timing—review it against the audio.

<a id="precise-times"></a>

## Edit precise caption times

Caption-row start/end inputs retain stored fractional seconds instead of rounding
to tenths; editing one endpoint preserves the other. The cue's source or pre-speed
timeline clock and existing validation are unchanged. An explicit change event
still uses the existing edit/history path, even for the same value; this is not a
frame/sample-accuracy or no-op-history guarantee.

<a id="caption-pages"></a>

## Navigate caption pages

The caption editor shows **50 rows per page**, with previous/next controls and a
visible range. With more than 50 cues, enter a **1-based page number** and press
**Go** or Enter to focus its first cue. Use 1 through the displayed last page
(up to 200 pages); invalid input stays focused for correction. Switching UI language
preserves the page-input draft and focus. Paging alone does not edit, save, create
undo history or seek playback. Search, timeline
selection, import and adding a caption reveal the target row’s page. Search,
replace-all and the whole-list long-caption split still cover the full authored list; exports
retain the whole project’s clip/speed rules, not just the visible page. Existing
10,000-cue and 2 MiB limits are unchanged.

<a id="remove-range"></a>

## Remove a caption range

In caption tools, **Remove caption range…** accepts inclusive, **1-based authored
row numbers**, even across pages. Both fields start at the current page's first
row; they do not select search matches or derived video occurrences. Removing all
rows is allowed. One undoable edit preserves surviving cues exactly, including
out-of-timeline cues, without retiming; focus moves to a survivor's page or **Add
caption** if empty. Playback pauses but keeps its position. Cancel makes no additional edit and preserves the page and search draft; opening
the dialog may already commit a row edit through the field’s normal blur/change behavior. Re-read positions after structural edits;
valid failed-recovery edits still need a settings backup, not browser saving.

<a id="import-subtitles"></a>

## Import and review subtitle files

**Import SRT/VTT in the browser:** back up settings first. Choose **Replace all**
(default) or **Keep existing and add**, then select the file and its actual clock:

| Import clock | Use for |
|---|---|
| **Original media** (default) | Timestamps measured against the original source, before speed |
| **Edited output** | Timestamps of the current edited result, after speed; each parsed time is converted to stored timeline time using the captured speed |

Choose **Review file** to read and parse without editing captions, then check the
counts before explicitly replacing or adding. Add mode also shows the combined total against the 10,000-row limit.

| Review count | Meaning |
|---|---|
| Captions to import | Cues this parser will import |
| Of these, end times clipped | Accepted cues whose end was shortened to the selected duration; included in Captions to import, not additional cues |
| Recognized entries discarded | Pattern-matched candidates dropped because parsed text was empty or the clipped interval was nonpositive |

Malformed/unrecognized entries are **not counted**: these are not total-file counts
or full SRT/VTT validation. File/clock/action changes clear the review; project,
media or dialog changes invalidate it. Confirmation uses the reviewed private
file data, not a second read. Either mode
is one undoable edit and keeps the playhead position; addition focuses the first
new row. Check the clock and review before confirming; no automatic detection or
existing-cue migration occurs.

**Keep existing and add** preserves existing rows, speakers, keywords and authored
order—even valid captions outside the current edited timeline. It adds imported
rows at the end of the list, not at the end of the video; absolute times stay as
provided. It does not sort, offset, merge or deduplicate, and imported files do not
restore speaker metadata. Reimporting in add mode duplicates cues; overlapping
captions may be hidden. Replace all continues to discard all old captions, not
merely the visible page.

Exported subtitles already expand repeated cuts;
output-clock import keeps those as timeline cues, rather than mapping them back to
source occurrences. Later cuts/speed changes follow existing timeline-caption rules.
**Set added-audio offset before importing output-clock subtitles:** the existing
browser offset control shifts **all timeline-basis cues**, including these imported
cues, not just audio-generated captions. If moved accidentally, undo the whole
offset edit; later cuts do not automatically realign the imported file.
This is not a lossless round trip: exported millisecond rounding, stripped markup
and missing speaker/style/keyword metadata are not recovered. Cancel or a rejected/
stale import leaves captions unchanged. The legacy hidden picker and default programmatic imports remain
source-clock replacement. Valid failed-recovery edits remain in memory with browser
persistence blocked. CLI/MCP `captions.import` still accepts
only source or **pre-speed** timeline clocks—not this browser output choice.

Complete decimal `&#54620;` and hexadecimal `&#x4E2D;`/`&#X4E2D;` references
are decoded once after tag removal (for example, `한中`). Supported numeric values
are U+0020–U+10FFFF except DEL/C1 (U+007F–009F), U+2028/U+2029, surrogates,
U+FDD0–FDEF and each plane's U+FFFE/U+FFFF. Unsupported/malformed spellings,
including TAB/LF/FF/CR references, stay literal: no HTML error repair or control
remapping. Valid format/spacing characters can be invisible; this is not a
visibility guarantee. Escaped `&amp;#54620;` remains literal `&#54620;`, and encoded
tags remain text. Decoded whitespace is not trimmed; a whitespace-only cue may
still fail subtitle export. The 2,000 UTF-16-unit cue limit applies after decoding;
raw input byte/command-length limits remain unchanged.

<a id="shift-range"></a>

## Shift timing in a range

For a delay affecting only part of the subtitle list, choose **Shift range…** in
caption tools. Enter inclusive **1-based authored row** bounds, choose source or
pre-speed timeline time, and enter signed seconds. Both bounds initially use the
current page's first row; source/0 seconds are defaults, not an inferred selection.
Only matching-basis cues within that range move, across page boundaries; no clock
conversion occurs. A real change is one undo step, with the playhead position
unchanged. Cancel, zero or no matching changes add no edit; ordinary field blur
before opening may already commit a draft. Existing whole-list shift remains available.

<a id="assign-speaker"></a>

## Assign a speaker to a range

**Assign one speaker to several cues:** choose **Assign speaker to range…** in caption tools.

- Enter inclusive **1-based authored row** bounds; defaults are the current page’s first row and its current speaker, not search/output-occurrence selection.
- Choose one of the two existing speakers or None. Mixed time bases are included; wording, times and order stay intact.
- A real change is one undo step; cancel or unchanged assignment adds no edit. Shared Dialogue names/colors still apply—this is not automatic speaker identification. [CLI/MCP contract](../INTEGRATIONS.md#자막-범위의-화자-배정)
