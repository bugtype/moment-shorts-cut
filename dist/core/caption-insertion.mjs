import { MAX_CAPTIONS } from '../captions.mjs';
import { timelineDuration, outputDuration, validateProject } from './project.mjs';
import { fail } from './validation.mjs';
import { message } from '../i18n.mjs';

// Validate incoming clocks only. Retained cues may legally lie beyond edited output.
export function validateIncomingCaptions(project, captions) {
  const total = timelineDuration(project);
  for (const [index, caption] of captions.entries()) {
    if (caption.end <= caption.start || caption.end > (caption.basis === 'timeline' ? total : project.duration))
      fail(message('errors.captionClock'), `arguments.captions[${index}]`);
  }
}

export function prepareCaptionInsertion(project, args, append = false) {
  const index = append ? project.captions.length : args.captionIndex;
  const incoming = append ? args.captions : [args.caption];
  if (!append && (!Number.isInteger(index) || index < 0 || index > project.captions.length))
    fail(message('errors.insertCaptionIndex'), 'arguments.captionIndex');
  if (project.captions.length + incoming.length > MAX_CAPTIONS)
    fail(message('errors.captionLimit'), 'project.captions');
  if (append) validateIncomingCaptions(project, incoming);
  else {
    const caption = args.caption;
    const total = caption.basis === 'timeline' ? timelineDuration(project) : project.duration;
    if (caption.end <= caption.start || caption.end > total)
      fail(message('errors.insertCaptionClock'), 'arguments.caption');
  }
  const next = structuredClone(project);
  next.captions.splice(index, 0, ...structuredClone(incoming));
  validateProject(next);
  return {
    project: next,
    data: append ? {updated:true, outputDuration:outputDuration(next)} : {
      updated:true, captionIndex:index, totalCaptions:next.captions.length,
      outputDuration:outputDuration(next),
    },
  };
}
