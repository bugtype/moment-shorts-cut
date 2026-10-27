import { assertUnicodeText } from './unicode-text.mjs';
import { SUPPORTED_ASPECT_RATIOS } from './aspect-ratio.mjs';
import { projectCaptionReview } from './caption-review.mjs';
import { message as msg } from '../i18n.mjs';
import { defaultEnhancements } from '../effects.mjs';
import { defaultDesign, migrateProject, DESIGN_VERSION } from '../typography.mjs';
import { captionOccurrences, MAX_CAPTIONS, MAX_SUBTITLE_BYTES, captionOutputLimit } from '../captions.mjs';
import { assertJson, validate, object, string, number, choice, array, fail, CommandError } from './validation.mjs';

export function createDemoProject() {
  return {
    ...defaultEnhancements(),
    name: '나의 첫 번째 쇼츠',
    kind: 'demo',
    fileName: '느리게 걷는 하루 · 샘플',
    duration: 12,
    clips: [{
      start: 0,
      end: 12
    }],
    ratio: '9:16',
    fit: 'cover',
    zoom: 1,
    panX: 0,
    panY: 0,
    volume: 1,
    speed: 1,
    schemaVersion: DESIGN_VERSION,
    design: defaultDesign(),
    style: 'impact',
    captionSize: 36,
    captionY: .55,
    captionX: .47,
    captionColor: '#ffffff',
    captionAccent: '#b5ff00',
    captionStroke: 3,
    captionItalic: true,
    captionAnimation: 'pop',
    captions: [{
      start: 0,
      end: 4,
      text: '잠깐, 쉬어가도 괜찮아'
    }, {
      start: 4,
      end: 8,
      text: '나만의 속도로 걷는 하루'
    }, {
      start: 8,
      end: 12,
      text: '오늘의 순간을 기록해요'
    }],
    audioName: '',
    audioOffset: 0,
    audioVolume: .7
  };
}

// File transport limit only: in-memory documents and integrations may be larger.
export const MAX_PROJECT_FILE_BYTES = 10 * 1024 * 1024;
export function assertProjectFileSize(byteLength) {
  if (byteLength > MAX_PROJECT_FILE_BYTES)
    throw new CommandError('FILE_TOO_LARGE', msg('errors.projectFileLimit'));
}

export const MAX_CLIPS = 1000;
export const FORMAT = 'moment-project';
export const FORMAT_VERSION = 1;
export const timelineDuration = p => p.clips.reduce((sum, c) => sum + c.end - c.start, 0);
export const outputDuration = p => timelineDuration(p) / p.speed;

export const clipSchema = object({
  start: number(0, 86400),
  end: number(0, 86400)
}, ['start', 'end']);
export const captionSchema = object({
  start: number(0, 86400),
  end: number(0, 86400),
  text: string(2000),
  basis: choice('source', 'timeline'),
  speaker: choice('', '0', '1'),
  keywords: string(500),
  timing: choice('estimated')
}, ['start', 'end', 'text']);

function compatible(value, example, path) {
  if (example === null) {
    if (value !== null && !Number.isFinite(value))
      fail(msg('errors.endType'), path);
    return;
  }
  if (Array.isArray(example)) {
    if (!Array.isArray(value) || value.length > 10000)
      fail(msg('errors.array'), path);
    if (example.length)
      value.forEach((item, i) => compatible(item, example[0], `${path}[${i}]`));
  } else if (typeof example === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      fail(msg('errors.object'), path);
    for (const key of Object.keys(example))
      compatible(value[key], example[key], `${path}.${key}`);
  } else if (typeof value !== typeof example || (typeof example === 'number' && !Number.isFinite(value))) {
    fail(msg('errors.projectFieldType'), path);
  }
}

export function validateProject(project) {
  assertJson(project);
  if (project.schemaVersion !== DESIGN_VERSION)
    throw new CommandError('UNSUPPORTED_VERSION', msg('errors.projectVersion'));
  compatible(project, createDemoProject(), 'project');
  const p = project;

  validate(object({
    duration: number(.001, 86400),
    speed: number(.25, 4),
    ratio: choice(...SUPPORTED_ASPECT_RATIOS),
    fit: choice('cover', 'contain'),
    kind: choice('demo', 'video'),
    clips: array(clipSchema, MAX_CLIPS, 1)
  }, ['duration', 'speed', 'ratio', 'fit', 'kind', 'clips']), {
    duration: p.duration,
    speed: p.speed,
    ratio: p.ratio,
    fit: p.fit,
    kind: p.kind,
    clips: p.clips
  }, 'project');
  for (const [i, c] of p.clips.entries())
    if (c.end <= c.start || c.end > p.duration) fail(msg('errors.clipRange'), `project.clips[${i}]`);

  const bounded = {
    zoom: [1, 3],
    panX: [-1, 1],
    panY: [-1, 1],
    volume: [0, 1],
    audioVolume: [0, 1],
    audioOffset: [0, 86400],
    captionSize: [10, 120],
    captionX: [0, 1],
    captionY: [0, 1],
    captionStroke: [0, 20]
  };
  for (const [key, [min, max]] of Object.entries(bounded))
    validate(number(min, max), p[key], `project.${key}`);

  validate(choice('framed', 'full'), p.design.layout, 'project.design.layout');
  validate(choice('impact', 'accent', 'highlight', 'minimal'), p.style, 'project.style');
  validate(choice('none', 'fade', 'slide', 'pop'), p.captionAnimation, 'project.captionAnimation');
  validate(choice('none', 'in', 'out'), p.effects.motion, 'project.effects.motion');
  validate(choice('none', 'fadeBlack', 'flash'), p.effects.transition, 'project.effects.transition');
  validate(choice('top', 'bottom'), p.effects.progressPosition, 'project.effects.progressPosition');
  for (const [key, [min, max]] of Object.entries({
    strength: [0, .4],
    transitionDuration: [.05, .7],
    brightness: [.7, 1.3],
    contrast: [.7, 1.5],
    saturation: [0, 1.6],
    vignette: [0, .6]
  })) {
    validate(number(min, max), p.effects[key], `project.effects.${key}`);
  }

  validate(number(.15, .4), p.design.top, 'project.design.top');
  validate(number(.4, .91), p.design.bottom, 'project.design.bottom');
  validate(number(0, 20), p.design.title.stroke, 'project.design.title.stroke');

  validate(array(captionSchema, MAX_CAPTIONS), p.captions, 'project.captions');
  for (const [i, c] of p.captions.entries())
    if (c.end <= c.start) fail(msg('errors.captionEnd'), `project.captions[${i}]`);

  for (const [key, l] of Object.entries({
    title: p.design.title,
    credit: p.design.credit
  })) {
    for (const axis of ['x', 'y'])
      validate(number(0, 1), l[axis], `project.design.${key}.${axis}`);
    validate(number(10, 120), l.size, `project.design.${key}.size`);
    if (l.start < 0 || (l.end !== null && l.end <= l.start))
      fail(msg('errors.textTime'), `project.design.${key}`);
  }
  validate(array(string(200), 2, 2), p.design.title.lines, 'project.design.title.lines');
  validate(array(string(20), 2, 2), p.design.title.colors, 'project.design.title.colors');
  validate(array(string(80), 2, 2), p.speakerLabels, 'project.speakerLabels');
  validate(array(string(20), 2, 2), p.speakerColors, 'project.speakerColors');
  if (p.overlays.length > 12)
    fail(msg('errors.cardLimit'), 'project.overlays');

  const ids = new Set();
  for (const [i, c] of p.overlays.entries()) {
    const path = `project.overlays[${i}]`;
    for (const k of ['id', 'text', 'detail', 'label', 'color', 'accent', 'background'])
      validate(string(2000), c[k], `${path}.${k}`);
    if (!c.id || ids.has(c.id))
      fail(msg('errors.cardUniqueId'), path);
    ids.add(c.id);
    for (const k of ['x', 'y', 'width', 'backgroundOpacity'])
      validate(number(0, 1), c[k], `${path}.${k}`);
    validate(number(10, 120), c.size, `${path}.size`);
    validate(number(0, 20), c.stroke, `${path}.stroke`);
    validate(choice('plain', 'panel'), c.presentation, `${path}.presentation`);
    validate(choice('headline', 'free'), c.role, `${path}.role`);
    validate(choice('none', 'fade', 'slide', 'pop'), c.animation, `${path}.animation`);
    validate(choice('card', 'countdown'), c.kind, `${path}.kind`);
    if (typeof c.enabled !== 'boolean' || !Number.isFinite(c.start) ||
        !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start)
      fail(msg('errors.cardValues'), path);
  }
  for (const color of [
    p.captionColor,
    p.captionAccent,
    p.design.background,
    ...p.design.title.colors,
    p.design.credit.color,
    p.effects.progressColor,
    ...p.speakerColors,
    ...p.overlays.flatMap(c => [c.color, c.accent, c.background])
  ]) {
    if (!/^#[\da-f]{6}([\da-f]{2})?$/i.test(color))
      fail(msg('errors.color'), 'project.colors');
  }
  return p;
}

export function createProjectDocument(project) {
  validateProject(project);
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    project: structuredClone(project)
  };
}

export function readProjectDocument(document) {
  assertJson(document);
  if (document?.format !== FORMAT || document.formatVersion !== FORMAT_VERSION)
    throw new CommandError('UNSUPPORTED_VERSION', msg('errors.projectFileType'));
  if (!document.project || !Number.isInteger(document.project.schemaVersion) ||
      document.project.schemaVersion < 1 || document.project.schemaVersion > DESIGN_VERSION)
    throw new CommandError('UNSUPPORTED_VERSION', msg('errors.projectVersion'));
  // Only legacy versions need defaults. Repairing a malformed current document
  // would silently replace the user's authored settings during import.
  const project = structuredClone(document.project);
  return validateProject(project.schemaVersion === DESIGN_VERSION ? project : migrateProject(project, createDemoProject()));
}

export function srtTimestamp(t) {
  const ms = Math.round(t * 1000);
  return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;
}

export function projectSubtitles(p, options = {}) {
  const {format = 'srt', bom = false, review = false} = options;
  if (!['srt', 'vtt', 'txt'].includes(format))
    fail(msg('errors.subtitleFormat'));
  if (typeof review !== 'boolean')
    fail(msg('review.boolean'), 'arguments.review');
  if (review && format !== 'txt')
    fail(msg('review.txtOnly'), 'arguments.review');
  // Select authored rows before projection: keep every clip and the full output
  // clock, including repeated occurrences. The default path retains p itself.
  const hasIndex = Object.hasOwn(options, 'captionIndex');
  const hasCount = Object.hasOwn(options, 'count');
  let captionIndexOffset = 0;
  if (hasIndex || hasCount) {
    const first = hasIndex ? options.captionIndex : 0;
    if (hasIndex && (!Number.isInteger(first) || first < 0 || first > 9999 || first >= p.captions.length))
      fail(msg('errors.replaceCaptionIndex'), 'arguments.captionIndex');
    const count = hasCount ? options.count : p.captions.length - first;
    if (hasCount && (!Number.isInteger(count) || count < 1 || count > 10000 || first + count > p.captions.length))
      fail(msg('errors.replaceCaptionCount'), 'arguments.count');
    p = {...p, captions: p.captions.slice(first, first + count)};
    captionIndexOffset = first;
  }
  if (review)
    return projectCaptionReview(p, {bom, captionIndexOffset});
  const label = format.toUpperCase(),
    header = format === 'vtt' ? 'WEBVTT\n\n' : '';
  const chunks = [],
    encoder = new TextEncoder();
  let bytes = (bom ? 3 : 0) + encoder.encode(header).byteLength;
  const timestamp = t => format === 'vtt' ? srtTimestamp(t).replace(',', '.') : srtTimestamp(t);
  for (const [i, c] of captionOccurrences(p.captions, p.clips, p.speed).entries()) {
    const textPath = `project.captions[${captionIndexOffset + c.captionIndex}].text`;
    if (format === 'txt') {
      const text = c.text.replace(/\r\n?/g, '\n');
      if (text.includes('\0'))
        fail(msg('errors.txtNul', {index: i + 1}));
      assertUnicodeText(text, textPath);
      const chunk = text + '\n';
      bytes += encoder.encode(chunk).byteLength + (i ? 1 : 0);
      if (bytes > MAX_SUBTITLE_BYTES)
        captionOutputLimit(msg('errors.txtLimit'));
      chunks.push(chunk);
      continue;
    }
    const start = timestamp(c.start),
      end = timestamp(c.end);
    if (start === end)
      fail(msg('errors.subtitlePrecision', {format: label, index: i + 1}));
    const lines = c.text.replace(/\r\n?/g, '\n');
    if (/^[ \t]*$/m.test(lines))
      fail(msg('errors.subtitleBlank', {format: label, index: i + 1}));
    if (format === 'srt' && lines.includes('\0'))
      fail(msg('errors.srtNul', {index: i + 1}));
    if (format === 'vtt' && lines.includes('\0'))
      fail(msg('errors.vttNul', {index: i + 1}));
    assertUnicodeText(lines, textPath);
    const text = lines.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
    const chunk = `${i+1}\n${start} --> ${end}\n${text}\n`;
    bytes += encoder.encode(chunk).byteLength + (i ? 1 : 0);
    if (bytes > MAX_SUBTITLE_BYTES)
      captionOutputLimit(msg('errors.subtitleBytes', {format: label}));
    chunks.push(chunk);
  }
  return chunks.length || header ? (bom ? '\ufeff' : '') + header + chunks.join('\n') : '';
}

export function projectSrt(p, options = {}) {
  return projectSubtitles(p, {
    ...options,
    format: 'srt'
  });
}
