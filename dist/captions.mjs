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
export function editedCaptions(captions, clips, speed = 1) {
  const out = []; let offset = 0;
  for (const clip of clips) {
    for (const cap of captions) {
      if (cap.basis === 'timeline') continue;
      const start = Math.max(clip.start, cap.start), end = Math.min(clip.end, cap.end);
      if (end > start) out.push({start:(offset+start-clip.start)/speed,end:(offset+end-clip.start)/speed,text:cap.text});
    }
    offset += clip.end - clip.start;
  }
  for (const cap of captions) if (cap.basis === 'timeline') {
    const start = Math.max(0, cap.start), end = Math.min(offset, cap.end);
    if (end > start) out.push({start:start/speed,end:end/speed,text:cap.text});
  }
  return out.sort((a,b) => a.start-b.start);
}
export function mapAudioCaptions(captions, offset, total) {
  return captions.map(cap => ({...cap,basis:'timeline',start:Math.max(0,cap.start+offset),end:Math.min(total,cap.end+offset)}))
    .filter(cap => cap.end>cap.start);
}

// File size is checked before reading in the UI; keep the parser bounded for callers too.
export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
export function parseSubtitles(text, duration) {
  if (typeof text !== 'string' || text.length > MAX_SUBTITLE_BYTES) throw new Error('자막 파일은 2 MB 이하만 지원합니다.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('영상 길이를 확인하세요.');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const pattern = /^(?:(\d{1,2}):)?([0-5]\d):([0-5]\d)[,.](\d{3})[ \t]*-->[ \t]*(?:(\d{1,2}):)?([0-5]\d):([0-5]\d)[,.](\d{3})[^\n]*\n([\s\S]*?)(?=\n[ \t]*\n|(?![\s\S]))/gm;
  const captions = [];
  for (const match of normalized.matchAll(pattern)) {
    const start = (+match[1] || 0) * 3600 + (+match[2]) * 60 + (+match[3]) + (+match[4]) / 1000;
    const end = Math.min((+match[5] || 0) * 3600 + (+match[6]) * 60 + (+match[7]) + (+match[8]) / 1000, duration);
    const text = match[9].replace(/<[^>]*>/g, '').trim();
    if (!text || end <= start) continue;
    if (text.length > 2000) throw new Error('자막 한 구간은 2,000자 이하만 지원합니다.');
    if (captions.length >= 10000) throw new Error('자막은 10,000개 이하만 지원합니다.');
    captions.push({start, end, text});
  }
  if (!captions.length) throw new Error('유효한 SRT 또는 VTT 자막을 찾지 못했습니다.');
  return captions;
}
