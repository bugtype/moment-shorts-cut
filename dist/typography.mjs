import { defaultEnhancements, activeSceneLayers, migrateSceneLayers } from './effects.mjs';
// Shared by the preview and encoder so the exported composition matches the editor.
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const DESIGN_VERSION = 4;

export function defaultDesign() {
  return {
    layout: 'framed', background: '#080808', top: .25, bottom: .79,
    title: {
      enabled: true, lines: ['평범했던 하루가', '기억하고 싶은 순간으로'],
      colors: ['#ffffff', '#b5ff00'], x: .48, y: .145, size: 39,
      italic: true, stroke: 0, start: 0, end: null,
    },
    credit: {
      enabled: true, text: 'a little moment · 나의 기록', color: '#b8b8b8',
      x: .47, y: .835, size: 18, italic: true, start: 0, end: null,
    },
  };
}

export function migrateProject(saved, defaults) {
  const additions = defaultEnhancements();
  const project = { ...additions, ...defaults, ...saved, schemaVersion: DESIGN_VERSION, effects: { ...additions.effects, ...saved.effects }, overlays: saved.overlays || [] };
  const design = defaultDesign();
  if (saved.design) {
    project.design = {
      ...design, ...saved.design,
      title: { ...design.title, ...saved.design.title },
      credit: { ...design.credit, ...saved.design.credit },
    };
  } else {
    // Existing projects keep their framing, text and empty-title choice.
    project.design = {
      ...design, layout: 'full',
      title: { ...design.title, enabled: !!saved.overlay,
        lines: [saved.overlay || '', ''], colors: [saved.overlayColor || '#ffffff', '#b5ff00'],
        y: .2, x: .5, size: 35, italic: false, stroke: 5 },
      credit: { ...design.credit, enabled: false },
    };
    project.captionX = .5;
    project.captionItalic = false;
    project.captionAnimation = 'none';
  }
  migrateSceneLayers(project);
  delete project.overlay;
  delete project.overlayColor;
  return project;
}

export function applyDesignPreset(project, preset) {
  const old = project.design || defaultDesign();
  const next = defaultDesign();
  next.title.lines = old.title.lines.some(line => line.trim()) ? [...old.title.lines] : next.title.lines;
  next.credit.text = old.credit.text;
  if (preset === 'clean') {
    next.layout = 'full';
    next.title = { ...next.title, colors: ['#ffffff', '#fff4b8'], y: .17, italic: false, size: 32, stroke: 2 };
    next.credit.enabled = false;
  } else if (preset === 'punch') {
    next.layout = 'full';
    next.title = { ...next.title, colors: ['#ffffff', '#ffd13e'], y: .19, size: 43, stroke: 3 };
    next.credit.y = .81;
  }
  project.design = next;
  project.captionSize = preset === 'clean' ? 29 : 36;
  project.captionY = preset === 'clean' ? .75 : .55;
  project.captionX = .47;
  project.captionColor = '#ffffff';
  project.captionAccent = preset === 'punch' ? '#ffd13e' : '#b5ff00';
  project.captionStroke = preset === 'clean' ? 2 : 3;
  project.captionItalic = preset !== 'clean';
  project.captionAnimation = preset === 'clean' ? 'none' : 'pop';
  project.style = preset === 'clean' ? 'minimal' : 'impact';
}

export function videoFrame(design, width, height) {
  if (design.layout !== 'framed') return { x: 0, y: 0, w: width, h: height };
  const top = clamp(Number(design.top) || .25, .15, .4);
  const bottom = clamp(Number(design.bottom) || .79, top + .25, .91);
  return { x: 0, y: height * top, w: width, h: height * (bottom - top) };
}

export function layerVisible(layer, time) {
  return layer.enabled && time >= layer.start && (layer.end == null || time < layer.end);
}

const lineSegmenter = typeof globalThis.Intl?.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
// Older engines retain the previous code-point wrapping behavior without failing
// drawing. Native segmentation keeps combining marks and joined emoji together.
const lineUnits = text => lineSegmenter
  ? Array.from(lineSegmenter.segment(text), part => part.segment) : Array.from(text);

// Keep full sentences. Wrapping never silently drops text or invents word timing.
export function measureLines(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let units = [];
    for (const unit of lineUnits(paragraph)) {
      if (units.length && context.measureText(units.join('') + unit).width > maxWidth) {
        // Trim whitespace-only units, not the whitespace inside a grapheme such
        // as a space followed by a combining mark.
        while (units.length && /^\s+$/u.test(units.at(-1))) units.pop();
        lines.push(units.join(''));
        units = /^\s+$/u.test(unit) ? [] : [unit];
      } else units.push(unit);
    }
    lines.push(units.join(''));
  }
  return lines;
}

function keywordSegments(line, keywords) {
  const pattern = new RegExp(keywords.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
  const segments = []; let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index > cursor) segments.push([line.slice(cursor,match.index),false]);
    segments.push([match[0],true]); cursor = match.index + match[0].length;
  }
  if (cursor < line.length) segments.push([line.slice(cursor),false]);
  return segments;
}

// Observe only this sprite; a retained old surface must not retain its renderer.
function observeSpriteRestoration(item) {
  try {
    item.surface.addEventListener?.('contextrestored', () => { item.invalid = true; });
  } catch { /* Event observation is optional for non-browser Canvas ports. */ }
}

export function createTypographyRenderer(makeCanvas = () => document.createElement('canvas')) {
  const cache = new Map();
  let pixels = 0;
  const maxPixels = 8_000_000;
  function clear() { cache.clear(); pixels = 0; }
  function sprite(text, options) {
    const key = JSON.stringify([text, options]);
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      if (!hit.invalid) { cache.set(key, hit); return hit; }
      pixels -= hit.pixels;
    }
    const surface = makeCanvas();
    const context = surface.getContext('2d');
    const font = size => `${options.italic ? 'italic ' : ''}${options.weight || 900} ${size}px "Noto Sans KR", sans-serif`;
    let size = options.size;
    const lineHeight=options.lineHeight||1.34;
    context.font = font(size);
    if (options.singleLine) {
      size *= Math.min(1, options.maxWidth / Math.max(1, context.measureText(text).width));
      context.font = font(size);
    }
    let lines = options.singleLine ? [text.replace(/\n/g, ' ')] : measureLines(context, text, options.maxWidth);
    // Fit long captions inside their zone without cropping the last lines.
    while (lines.length * size * lineHeight > options.maxHeight && size > 10) {
      size *= .92; context.font = font(size);
      lines = measureLines(context, text, options.maxWidth);
    }
    const widths = lines.map(line => context.measureText(line).width);
    const padding = Math.ceil(size * .45 + options.stroke * 2);
    surface.width = Math.ceil(Math.max(1, ...widths) + padding * 2);
    surface.height = Math.ceil(lines.length * size * lineHeight + padding * 2);
    context.font = font(size);
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.lineJoin = 'round';
    lines.forEach((line, i) => {
      const x = surface.width / 2, y = padding + size * lineHeight * (i + .5);
      if (options.box) {
        context.fillStyle = options.box;
        context.beginPath();
        context.roundRect(x - widths[i] / 2 - size * .24, y - size * .67, widths[i] + size * .48, size * lineHeight, size * .12);
        context.fill();
      }
      if (options.stroke) {
        context.strokeStyle = '#090909'; context.lineWidth = options.stroke * 2;
        context.strokeText(line, x, y);
      }
      const keywords = (options.keywords || []).filter(Boolean);
      if (!keywords.length) {
        context.fillStyle = options.color; context.fillText(line, x, y);
      } else {
        const segments = keywordSegments(line, keywords);
        context.textAlign = 'left'; let left = x - widths[i] / 2;
        for (const [segment, marked] of segments) {
          context.fillStyle = marked ? options.accent : options.color;
          context.fillText(segment,left,y); left += context.measureText(segment).width;
        }
        context.textAlign = 'center';
      }
    });
    const item = { surface, pixels: surface.width * surface.height };
    while (cache.size && (pixels + item.pixels > maxPixels || cache.size >= 48)) {
      const first = cache.keys().next().value; pixels -= cache.get(first).pixels; cache.delete(first);
    }
    if (item.pixels <= maxPixels) {
      observeSpriteRestoration(item);
      cache.set(key, item); pixels += item.pixels;
    }
    return item;
  }
  function text(context, value, x, y, options, scale = 1) {
    if (!String(value).trim()) return;
    const { surface } = sprite(value, options);
    context.drawImage(surface, x - surface.width * scale / 2, y - surface.height * scale / 2, surface.width * scale, surface.height * scale);
    return { height:surface.height * scale, width:surface.width * scale };
  }
  function draw(context, width, height, project, sourceTime, timelineTime, cap) {
    const design = project.design, unit = width / 540;
    const title = design.title, credit = design.credit;
    if (layerVisible(title, timelineTime) && !activeSceneLayers(project,timelineTime).some(card=>(card.role||'headline')==='headline')) {
      const visible = title.lines.map((line, i) => ({ line, color: title.colors[i] || title.colors[0] })).filter(item => item.line.trim());
      const gap = title.size * unit * 1.4;
      visible.forEach((item, i) => text(context, item.line, width * title.x, height * title.y + (i - (visible.length - 1) / 2) * gap, {
        size: title.size * unit, color: item.color, italic: title.italic, stroke: title.stroke * unit,
        maxWidth: width * .84, maxHeight: height * .11, weight: 900, singleLine: true,
      }));
    }
    if (cap) {
      const enter = Math.min(1, Math.max(0, (sourceTime - cap.start) / .18));
      const pop = project.captionAnimation === 'pop' ? .88 + .12 * enter : 1;
      const keywords = [...String(project.globalKeywords || '').split(/[,\n]/), ...String(cap.keywords || '').split(/[,\n]/)].map(word=>word.trim()).filter(Boolean).slice(0,30);
      const speaker = ['0','1'].includes(String(cap.speaker)) ? Number(cap.speaker) : null;
      context.save();
      if (project.captionAnimation === 'fade' || project.captionAnimation === 'slide') context.globalAlpha = enter;
      const dy = project.captionAnimation === 'slide' ? (1-enter)*14*unit : 0;
      const bounds = text(context, cap.text, width * project.captionX, height * project.captionY + dy, {
        size: project.captionSize * unit,
        color: project.style === 'highlight' ? '#10160b' : speaker != null ? project.speakerColors[speaker] : project.style === 'accent' ? project.captionAccent : project.captionColor,
        box: project.style === 'highlight' ? project.captionAccent : null,
        italic: project.captionItalic, stroke: (project.style === 'highlight' ? 0 : project.captionStroke) * unit,
        weight: project.style === 'minimal' ? 600 : 900, maxWidth: width * .78, maxHeight: height * .22,
        keywords:project.style === 'highlight'?[]:keywords,accent:project.captionAccent,
      }, pop);
      if (speaker != null && bounds) text(context, project.speakerLabels[speaker], width * project.captionX, height * project.captionY + dy - bounds.height / 2 - 10 * unit, {
        size:13*unit,color:project.speakerColors[speaker],box:'#111827',stroke:0,weight:700,maxWidth:width*.5,maxHeight:30*unit,singleLine:true,
      });
      context.restore();
    }
    if (layerVisible(credit, timelineTime)) text(context, credit.text, width * credit.x, height * credit.y, {
      size: credit.size * unit, color: credit.color, italic: credit.italic, stroke: 0,
      weight: 700, maxWidth: width * .78, maxHeight: height * .08,
    });
  }
  return { draw, clear, label:(c,value,x,y,options)=>text(c,value,x,y,{stroke:0,weight:800,italic:false,...options}), cacheInfo: () => ({ entries: cache.size, pixels }) };
}
