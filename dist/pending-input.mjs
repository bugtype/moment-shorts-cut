// Classify uncommitted panel input; event binding and model updates stay in each panel.
export function createPendingInputCheck(input, {current, read, composing, nullable}) {
  const initial = read(), displayed = input.value;
  return () => {
    if (!current()) return false;
    const value = read(), numeric = input.type === 'number';
    const canBeBlank = nullable?.(value);
    if (composing?.() || (numeric && (input.validity?.badInput || (input.value === '' && !canBeBlank)))) return true;
    if (value === initial && input.value === displayed) return false;
    if (numeric) {
      // Nullable fields check the blank display before comparing numeric values.
      if (nullable && input.value === '' && canBeBlank) return false;
      return !Number.isFinite(input.valueAsNumber) || input.valueAsNumber !== value;
    }
    return input.value !== value;
  };
}
