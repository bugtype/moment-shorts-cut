const markup = new WeakMap();
export function updateTimelineMarkup(track, html) {
  if (markup.get(track) === html) return;
  track.innerHTML = html;
  markup.set(track, html);
}

export function renderCaptionTrack(track, occurrences, duration, speed) {
  const previous = new Map([...track.children].map(node => [node.dataset.captionKey, node]));
  occurrences.forEach((caption, index) => {
    const key = `${caption.captionIndex}:${caption.clipIndex ?? 'audio'}`;
    const button = previous.get(key) || track.ownerDocument.createElement('button');
    previous.delete(key);
    button.className = 'caption-block';
    button.dataset.captionKey = key;
    button.dataset.captionIndex = String(caption.captionIndex);
    button.dataset.captionTime = String(caption.start);
    button.setAttribute('aria-label', `자막 ${caption.captionIndex + 1}, ${(caption.start / speed).toFixed(1)}초: ${caption.text}`);
    button.textContent = caption.text;
    button.style.left = `${caption.start / duration * 100}%`;
    button.style.width = `${(caption.end - caption.start) / duration * 100}%`;
    // Keep the pointer/keyboard target alive while a field commits on blur.
    if (track.children[index] !== button) track.insertBefore(button, track.children[index] || null);
  });
  for (const button of previous.values()) button.remove();
}

// Replace all occurrence targets on failure; never leave a partial or stale lane.
export function renderCaptionTrackError(track, message) {
  const focused = [...track.children].includes(track.ownerDocument.activeElement);
  for (const node of [...track.children]) node.remove();
  const error = track.ownerDocument.createElement('span');
  error.className = 'caption-track-error';
  error.setAttribute('role', 'status');
  error.textContent = message;
  track.insertBefore(error, null);
  if (focused) {
    track.setAttribute('tabindex', '-1');
    track.focus({preventScroll:true});
  }
}
