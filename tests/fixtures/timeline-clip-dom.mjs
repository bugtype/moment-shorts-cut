// Only clip-button identity, classes and native-style removal are modeled here.
// This is not browser layout, keyboard dispatch, scrolling or assistive-technology QA.
export function installClipTrackDom(track, document, focusEvents = []) {
  let html = '', children = [], writes = 0;
  Object.defineProperties(track, {
    children: { configurable: true, get: () => children },
    writes: { configurable: true, get: () => writes },
    innerHTML: {
      configurable: true,
      get: () => html,
      set(value) {
        if (children.includes(document.activeElement)) document.activeElement = document.body;
        for (const node of children) { node.isConnected = false; node.parentNode = null; }
        html = value;
        writes++;
        children = [...value.matchAll(/<button class="([^"]*\bclip\b[^"]*)" data-clip="(\d+)"[^>]*>[\s\S]*?<\/button>/g)].map(match => {
          const classes = new Set(match[1].split(/\s+/).filter(Boolean));
          const node = {
            dataset: { clip: match[2] }, isConnected: true, parentNode: track,
            rect: { left: 100, width: 400 },
            classList: {
              contains: name => classes.has(name),
              toggle(name, force) {
                const next = force ?? !classes.has(name);
                if (next) classes.add(name); else classes.delete(name);
                return next;
              },
            },
            getBoundingClientRect() { return this.rect; },
            closest(selector) { return selector === '[data-clip]' ? this : null; },
            focus(options) {
              document.activeElement = this;
              focusEvents.push({ target: this, action: 'focus', options });
            },
          };
          Object.defineProperty(node, 'className', { get: () => [...classes].join(' ') });
          return node;
        });
      },
    },
  });
  track.querySelectorAll = selector => ['.clip', '[data-clip]', '.clip[data-clip]'].includes(selector) ? children : [];
  track.contains = node => children.includes(node);
  return track;
}
