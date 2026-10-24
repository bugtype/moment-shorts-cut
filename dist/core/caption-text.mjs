import { fail } from './validation.mjs';

// Correct authored text only: timing, ownership and metadata remain untouched.
// String splitting is intentional: regex and replacement-token syntax are not used.
export function replaceCaptionText(captions, { find, replacement }) {
  if (typeof find !== 'string' || !find.length || find.length > 2000)
    fail('찾을 내용은 1~2,000자로 입력하세요.', 'arguments.find');
  if (typeof replacement !== 'string' || replacement.length > 2000)
    fail('바꿀 내용은 2,000자 이하로 입력하세요.', 'arguments.replacement');
  let matches = 0, changedCaptions = 0;
  const next = captions.map((caption, index) => {
    const parts = caption.text.split(find), count = parts.length - 1;
    matches += count;
    if (!count || find === replacement) return caption;
    // Check size before joining to avoid allocating an oversized replacement.
    const length = caption.text.length + count * (replacement.length - find.length);
    if (length > 2000) fail('바꾼 자막이 2,000자를 넘습니다. 더 짧게 바꿔 주세요.', `project.captions[${index}].text`);
    const text = parts.join(replacement);
    if (!text.trim()) fail('바꾼 자막이 비게 됩니다. 자막을 지우려면 삭제 기능을 사용하세요.', `project.captions[${index}].text`);
    changedCaptions++;
    return { ...caption, text };
  });
  return { captions: changedCaptions ? next : captions, matches, changedCaptions };
}
