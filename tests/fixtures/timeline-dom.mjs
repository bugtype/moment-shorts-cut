// Minimal DOM fixture for node identity and track updates; browser QA checks native events.
export function createTrack() {
  const track = {children: [], writes: 0, html: '', attributes: {}};
  track.setAttribute = (name, value) => { track.attributes[name] = value; };
  track.focus = () => { track.ownerDocument.activeElement = track; };
  Object.defineProperty(track, 'innerHTML', {
    get() { return this.html; },
    set(value) { this.writes++; this.html = value; },
  });
  track.ownerDocument = {createElement() {
    const node = {dataset: {}, style: {}, attributes: {}, childNodes: []};
    // Model textContent's replacement semantics, not native selection or events.
    Object.defineProperties(node, {
      firstChild: {get() { return this.childNodes[0] ?? null; }},
      textContent: {
        configurable: true,
        get() { return this.childNodes.map(child => child.nodeType === 3 ? child.data : child.nodeType === 1 ? child.textContent : '').join(''); },
        set(value) {
          const text = value === null ? '' : String(value);
          this.childNodes = text ? [{nodeType: 3, data: text}] : [];
        },
      },
    });
    node.getAttribute = name => node.attributes[name] ?? null;
    node.setAttribute = (name, value) => { node.attributes[name] = value; };
    node.remove = () => {
      const index = track.children.indexOf(node);
      if (index !== -1) track.children.splice(index, 1);
    };
    return node;
  }};
  track.insertBefore = (node, next) => {
    node.remove();
    const index = next ? track.children.indexOf(next) : track.children.length;
    track.children.splice(index, 0, node);
  };
  return track;
}
