import { SUPPORTED_LOCALES, translateFor } from './i18n.mjs';

// Navigation metadata only. The controller owns current access checks and actions.
// Search never reads authored text, project state or browser storage.
const targets = [
  { id: 'finder.templates', panel: 'templates', selector: '#templateSearch' },
  { id: 'finder.captionReview', panel: 'captions', selector: '#inspectCaptions', details: '#captionTools' },
  { id: 'finder.captionFind', panel: 'captions', selector: '#captionFind', details: '#captionTools' },
  { id: 'finder.subtitleImport', panel: 'captions', selector: '#importSrt', details: '#captionCreate' },
  { id: 'finder.subtitleExport', panel: 'captions', selector: '#captionExportFormat' },
  { id: 'finder.framing', panel: 'settings', selector: '#openPanelFraming' },
  { id: 'finder.moveClip', panel: 'settings', selector: '#panelMoveClip' },
  { id: 'finder.audio', panel: 'audio', selector: '#chooseAudio' },
  { id: 'finder.seek', action: 'seek' },
  { id: 'finder.projectFiles', action: 'projectFiles' },
];

export function findToolTargets(query = '') {
  if (typeof query !== 'string') return [];
  const tokens = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  return targets.filter(({ id }) => {
    const searchable = SUPPORTED_LOCALES.map(locale =>
      `${translateFor(locale, id)} ${translateFor(locale, `${id}Keywords`)}`
    ).join(' ').toLowerCase();
    return tokens.every(token => searchable.includes(token));
  }).map(target => ({ ...target, labelKey: target.id }));
}
