import { assertUnicodeText } from './unicode-text.mjs';
import { t, message } from '../i18n.mjs';
import { validateProject, outputDuration } from './project.mjs';
import { fail } from './validation.mjs';

// A human-readable saved-text inventory, not a rendered transcript or import format.
export function projectGraphicsText(project) {
  validateProject(project);
  const metadata = (key, value) => `${t(`graphics.${key}`)}: ${String(value)}`;
  function authored(key, value, path) {
    if (value.includes('\0')) fail(message('errors.graphicsNul'), path);
    assertUnicodeText(value, path);
    // Do not normalize whitespace, line endings, markup or user-authored labels.
    return `${t(`graphics.${key}`)}:\n${value}`;
  }
  const timing = layer => [
    metadata('enabled', layer.enabled),
    metadata('start', layer.start),
    metadata('end', layer.end),
  ];
  const title = project.design.title;
  const credit = project.design.credit;
  const sections = [
    [
      t('graphics.heading'),
      t('graphics.inventory'),
      t('graphics.clock'),
      t('graphics.countdown'),
      metadata('duration', outputDuration(project)),
    ],
    [
      `[${t('graphics.title')}]`,
      ...timing(title),
      authored('line1', title.lines[0], 'project.design.title.lines[0]'),
      authored('line2', title.lines[1], 'project.design.title.lines[1]'),
    ],
    [
      `[${t('graphics.credit')}]`,
      ...timing(credit),
      authored('text', credit.text, 'project.design.credit.text'),
    ],
  ];
  for (const [index, card] of project.overlays.entries()) {
    sections.push([
      `[${t('graphics.card', { index: index + 1 })}]`,
      ...timing(card),
      metadata('role', card.role),
      metadata('kind', card.kind),
      authored('label', card.label, `project.overlays[${index}].label`),
      authored('text', card.text, `project.overlays[${index}].text`),
      authored('detail', card.detail, `project.overlays[${index}].detail`),
    ]);
  }
  return sections.map(lines => lines.join('\n')).join('\n\n') + '\n';
}
