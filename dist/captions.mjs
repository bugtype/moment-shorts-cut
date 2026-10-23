import { CommandError } from './core/validation.mjs';

export const MAX_CAPTIONS = 10000;
export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
export function captionOutputLimit(message) {
  throw new CommandError('CAPTION_OUTPUT_LIMIT', message, 'project.captions');
}

// Source speech follows clips; added narration follows the edited audio timeline.
// Both clocks are stored before playback speed, so retiming stays reversible.
export function captionClock(caption, sourceTime, timelineTime) {
  return caption.basis === 'timeline' ? timelineTime : sourceTime;
}
export function findCaption(captions, sourceTime, timelineTime) {
  return captions.find(caption => {
    const time = captionClock(caption, sourceTime, timelineTime);
    return time >= caption.start && time < caption.end;
  });
}
export function captionOccurrences(captions, clips, speed = 1) {
  const out = []; let offset = 0, bytes = 0;
  const textBytes = new Map();
  function append(cap, captionIndex, start, end, clipIndex) {
    if (out.length >= MAX_CAPTIONS) captionOutputLimit('편집 후 자막은 10,000개까지 표시·SRT 저장할 수 있습니다. 반복 클립이나 자막을 줄여 주세요.');
    if (!textBytes.has(captionIndex)) {
      if (cap.text.length > MAX_SUBTITLE_BYTES) captionOutputLimit('편집 후 자막 원문은 UTF-8 2 MiB까지 지원합니다. 반복 클립이나 자막을 줄여 주세요.');
      textBytes.set(captionIndex, encoder.encode(cap.text).byteLength);
    }
    bytes += textBytes.get(captionIndex);
    if (bytes > MAX_SUBTITLE_BYTES) captionOutputLimit('편집 후 자막 원문은 UTF-8 2 MiB까지 지원합니다. 반복 클립이나 자막을 줄여 주세요.');
    out.push({start:start/speed,end:end/speed,text:cap.text,captionIndex,...(clipIndex === undefined ? {} : {clipIndex})});
  }
  const sourceCaptions = [...captions.entries()].filter(([, cap]) => cap.basis !== 'timeline');
  for (const [clipIndex, clip] of clips.entries()) {
    for (const [captionIndex, cap] of sourceCaptions) {
      const start = Math.max(clip.start, cap.start), end = Math.min(clip.end, cap.end);
      if (end > start) append(cap,captionIndex,offset+start-clip.start,offset+end-clip.start,clipIndex);
    }
    offset += clip.end - clip.start;
  }
  for (const [captionIndex, cap] of captions.entries()) if (cap.basis === 'timeline') {
    const start = Math.max(0, cap.start), end = Math.min(offset, cap.end);
    if (end > start) append(cap,captionIndex,start,end);
  }
  return out.sort((a,b) => a.start-b.start);
}
export function editedCaptions(captions, clips, speed = 1) {
  return captionOccurrences(captions, clips, speed).map(({start,end,text}) => ({start,end,text}));
}
export function mapAudioCaptions(captions, offset, total) {
  return captions.map(cap => ({...cap,basis:'timeline',start:Math.max(0,cap.start+offset),end:Math.min(total,cap.end+offset)}))
    .filter(cap => cap.end>cap.start);
}

// File size is checked before reading in the UI; keep the parser bounded for callers too.
const subtitleReferences = {amp:'&',lt:'<',gt:'>',lrm:'\u200e',rlm:'\u200f',nbsp:'\u00a0'};
export function parseSubtitles(text, duration) {
  if (typeof text !== 'string' || text.length > MAX_SUBTITLE_BYTES || encoder.encode(text).byteLength > MAX_SUBTITLE_BYTES) throw new Error('자막 파일은 2 MB 이하만 지원합니다.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('영상 길이를 확인하세요.');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  // An empty first payload line ends the cue; never absorb the next cue's timing.
  const pattern = /^(?:(\d{1,2}):)?([0-5]\d):([0-5]\d)[,.](\d{3})[ \t]*-->[ \t]*(?:(\d{1,2}):)?([0-5]\d):([0-5]\d)[,.](\d{3})[^\n]*\n(?![ \t]*(?:\n|$))([\s\S]*?)(?=\n[ \t]*\n|(?![\s\S]))/gm;
  const captions = [];
  for (const match of normalized.matchAll(pattern)) {
    const start = (+match[1] || 0) * 3600 + (+match[2]) * 60 + (+match[3]) + (+match[4]) / 1000;
    const end = Math.min((+match[5] || 0) * 3600 + (+match[6]) * 60 + (+match[7]) + (+match[8]) / 1000, duration);
    // Decode once after removing markup, so escaped literal tags remain text.
    const text = match[9].replace(/<[^>]*>/g, '').trim()
      .replace(/&(amp|lt|gt|lrm|rlm|nbsp);/g, (_, name) => subtitleReferences[name]);
    if (!text || end <= start) continue;
    if (text.length > 2000) throw new Error('자막 한 구간은 2,000자 이하만 지원합니다.');
    if (captions.length >= MAX_CAPTIONS) throw new Error('자막은 10,000개 이하만 지원합니다.');
    captions.push({start, end, text});
  }
  if (!captions.length) throw new Error('유효한 SRT 또는 VTT 자막을 찾지 못했습니다.');
  return captions;
}
