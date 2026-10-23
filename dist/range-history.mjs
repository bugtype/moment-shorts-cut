// Native range events keep their default keyboard/pointer behavior.
export function createRangeHistory(snapshot, blocked = () => false) {
  let active = null;
  const reset = () => { active = null; };
  function bind(input, read, update) {
    input.onpointerdown = input.onpointerup = input.onpointercancel = input.onblur = reset;
    input.oninput = () => {
      const value = Number(input.value);
      if (blocked() || !Number.isFinite(value) || value === read()) return;
      if (active !== input) {
        snapshot();
        active = input;
      }
      update(value);
    };
  }
  return {bind, reset};
}
