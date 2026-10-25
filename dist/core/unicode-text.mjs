import { message } from '../i18n.mjs';
import { fail } from './validation.mjs';

// UTF-8 encoders replace isolated UTF-16 surrogates. Reject only emitted text;
// JSON documents retain escaped code units for recovery. Unicode mode consumes
// valid surrogate pairs as one code point, leaving only unpaired code units here.
export function assertUnicodeText(text, path) {
  if (/[\uD800-\uDFFF]/u.test(text)) fail(message('errors.textUnicode'), path);
}
