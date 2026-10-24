// The caller supplies a validated project. Clear stored emphasis without
// interpreting keyword tokens or changing any other caption/style metadata.
export function clearCaptionKeywords(project) {
  let captions;
  for (const [index, caption] of project.captions.entries()) {
    if (!caption.keywords?.length) continue;
    captions ||= project.captions.slice();
    captions[index] = { ...caption, keywords: '' };
  }
  if (!project.globalKeywords.length && !captions) return project;
  return { ...project, globalKeywords: '', captions: captions || project.captions };
}
