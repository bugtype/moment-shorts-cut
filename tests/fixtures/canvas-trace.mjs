// Records canvas commands, not pixels or browser rendering behavior.
export function createCanvasTrace() {
  const events = [];
  let canvases = 0;
  function context(name) {
    return new Proxy({}, {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => {
          events.push([name, key, ...args.map(value => value?.traceName ?? value)]);
          if (key === 'measureText') return { width: String(args[0]).length * 10 };
          if (key === 'createRadialGradient') return {
            traceName: 'gradient',
            addColorStop(...stops) { events.push([name, 'addColorStop', ...stops]); },
          };
        };
      },
      set(target, key, value) {
        events.push([name, key, value?.traceName ?? value]);
        target[key] = value;
        return true;
      },
    });
  }
  return {
    events,
    context: context('output'),
    makeCanvas() {
      const traceName = `text-${++canvases}`, drawing = context(traceName);
      return { traceName, getContext: () => drawing };
    },
    get canvasCount() { return canvases; },
  };
}
