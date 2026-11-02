// Group native continuous edits without treating focus as a project change.
export function createInputHistory(snapshot, blocked = () => false) {
  let active = null;
  const reset = () => { active = null; };
  function bind(input, read, update, current = null) {
    const range = input.type === 'range', color = input.type === 'color';
    let composing = false, colorValue = input.value;
    // HTML text controls can normalize imported CR/LF or NUL. An unchanged
    // display after IME cancellation must not rewrite that authored value.
    const initialText = ['text', 'textarea'].includes(input.type)
      ? { model: read(), displayed: input.value } : null;
    // A detached control must not write or reset a newer control's undo group.
    const resetInput = () => { if (current?.() !== false) reset(); };
    const apply = event => {
      if (current?.() === false || blocked() || composing || event?.isComposing) return;
      const value = range ? Number(input.value) : input.value;
      const previous = color ? colorValue.toLowerCase() : read();
      if (initialText && previous === initialText.model && value === initialText.displayed) return;
      if ((range && !Number.isFinite(value)) || value === previous) return;
      if (active !== input) {
        snapshot();
        active = input;
      }
      update(value);
      if (color) colorValue = value;
    };
    input.oninput = apply;
    if (range) {
      input.onpointerdown = input.onpointerup = input.onpointercancel = input.onblur = resetInput;
    } else {
      input.onchange = () => { apply(); resetInput(); };
      input.onblur = resetInput;
      if (color) input.onclick = resetInput;
      else {
        input.oncompositionstart = () => { if (current?.() !== false) composing = true; };
        input.oncompositionend = () => {
          if (current?.() === false) return;
          composing = false; apply();
        };
      }
    }
    return () => composing;
  }
  return {bind, reset};
}
