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
