// Group native continuous edits without treating focus as a project change.
export function createInputHistory(snapshot, blocked = () => false) {
  let active = null;
  const reset = () => { active = null; };
  function bind(input, read, update) {
    const range = input.type === 'range', color = input.type === 'color';
    let composing = false, colorValue = input.value;
    const apply = event => {
      if (blocked() || composing || event?.isComposing) return;
      const value = range ? Number(input.value) : input.value;
      const previous = color ? colorValue.toLowerCase() : read();
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
      input.onpointerdown = input.onpointerup = input.onpointercancel = input.onblur = reset;
    } else {
      input.onchange = () => { apply(); reset(); };
      input.onblur = reset;
      if (color) input.onclick = reset;
      else {
        input.oncompositionstart = () => { composing = true; };
        input.oncompositionend = () => { composing = false; apply(); };
      }
    }
  }
  return {bind, reset};
}
