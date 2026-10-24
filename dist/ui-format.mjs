const paths = {
    playhead: 'M5 3h14l-7 7zM12 10v11M4 18h5M15 18h5',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    media: 'M3 5h18v14H3zM8 5v14M3 10h5M3 15h5M12 9l5 3-5 3z',
    video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
    captions: 'M3 5h18v14H3zM6 10h4M6 14h4M14 10h4M14 14h4',
    audio: 'M9 18V5l11-2v13M9 8l11-2M9 18c0 4-6 4-6 1s6-4 6-1M20 16c0 4-6 4-6 1s6-4 6-1',
    text: 'M4 5h16M12 5v15M8 20h8',
    sliders: 'M4 7h6M14 7h6M4 17h10M18 17h2M10 4v6M14 14v6',
    plus: 'M12 5v14M5 12h14',
    upload: 'M12 16V3M7 8l5-5 5 5M4 15v5h16v-5',
    export: 'M12 15V3M8 7l4-4 4 4M4 13v7h16v-7',
    save: 'M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8',
    help: 'M9 8a3 3 0 1 1 5 3c-2 1-2 2-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6',
    portrait: 'M6 2h12v20H6z',
    chevron: 'M7 10l5 5 5-5',
    safe: 'M8 3H3v5M16 3h5v5M3 16v5h5M16 21h5v-5M7 7h10v10H7z',
    play: 'M8 5l11 7-11 7z',
    pause: 'M8 5v14M16 5v14',
    skip: 'M6 5v14M18 5L8 12l10 7z',
    volume: 'M3 9h4l5-5v16l-5-5H3zM16 8q5 4 0 8M19 5q7 7 0 14',
    mute: 'M3 9h4l5-5v16l-5-5H3zM16 9l6 6M22 9l-6 6',
    undo: 'M9 4L4 9l5 5M4 9h10a6 6 0 0 1 0 12',
    redo: 'M15 4l5 5-5 5M20 9H10a6 6 0 0 0 0 12',
    scissors: 'M14 14l7 7M14 10l7-7M6 9l9 6M6 15l9-6M8 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0M8 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    left: 'M15 5l-7 7 7 7',
    right: 'M9 5l7 7-7 7',
    sparkle: 'M12 3l3 6 6 3-6 3-3 6-3-6-6-3 6-3zM20 2v4M18 4h4',
    mic: 'M8 5a4 4 0 0 1 8 0v7a4 4 0 0 1-8 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
    close: 'M6 6l12 12M18 6L6 18',
    check: 'M5 12l4 4L19 6',
    download: 'M12 3v13M7 11l5 5 5-5M4 17v4h16v-4',
    reset: 'M4 10a8 8 0 1 1 2 8M4 4v6h6',
    folder: 'M3 5h7l2 3h9v12H3z',
    zoom: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M16 16l5 5M8 11h6M11 8v6'
};
export function icon(name) {
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.plus}"/></svg>`;
}
export function esc(v) {
    return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function fmt(t) {
    t = Math.max(0, Number(t) || 0);
    return `${Math.floor(t / 60).toString().padStart(2, '0')}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
}

// Preserve non-negative finite time values without exponent notation or rounding past the end.
export function decimalTime(value) {
    const [coefficient, exponent] = String(value).split('e');
    if (exponent === undefined) return coefficient;
    const [whole, fraction = ''] = coefficient.split('.');
    const digits = whole + fraction, point = whole.length + Number(exponent);
    if (point <= 0) return '0.' + '0'.repeat(-point) + digits;
    if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
    return digits.slice(0, point) + '.' + digits.slice(point);
}
