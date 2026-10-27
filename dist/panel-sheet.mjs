// Own only responsive sheet presentation; selection, controls and media stay in the workspace.
export function createPanelSheet(app, { query: $, queryAll: $$ }) {
    let sheetOpen = false;

    // Compact layouts keep the preview visible and turn the side panel into a
    // sheet above the bottom tool rail. Desktop keeps the panel permanently docked.
    const isCompact = () => app.window.matchMedia?.('(max-width:700px), (max-height:560px) and (orientation:landscape)').matches === true;

    function syncSheet() {
        const library = $('#libraryPanel');
        if (!isCompact()) {
            sheetOpen = false;
            if (library)
                library.hidden = false;
            app.document.body.classList.remove('panel-sheet-open');
            fitSheet();
            setExpanded();
            return;
        }
        if (library)
            library.hidden = !sheetOpen;
        app.document.body.classList.toggle('panel-sheet-open', sheetOpen);
        fitSheet();
        setExpanded();
    }

    // The sheet grows from the rail up to just below the preview, so it uses the
    // room a given ratio leaves instead of an arbitrary share of the viewport.
    function fitSheet() {
        const library = $('#libraryPanel');
        if (!library)
            return;
        library.style.removeProperty('max-height');
        if (!isCompact() || !sheetOpen || app.window.matchMedia?.('(max-height:720px)').matches)
            return;
        const canvas = $('#canvasWrap')?.getBoundingClientRect();
        const rail = $('.rail')?.getBoundingClientRect();
        if (!canvas || !rail)
            return;
        const available = Math.floor(rail.top - canvas.bottom - 8);
        if (available > 0)
            library.style.maxHeight = `${Math.max(180, available)}px`;
    }

    function setExpanded() {
        $$('[data-panel]').forEach(button => {
            const active = button.dataset.panel === app.panel;
            button.setAttribute('aria-expanded', String(active && (!isCompact() || sheetOpen)));
        });
    }

    function setSheetOpen(open) {
        sheetOpen = !!open && isCompact();
        syncSheet();
    }

    function closePanelSheet() {
        if (!isCompact() || !sheetOpen)
            return;
        setSheetOpen(false);
        $$('[data-panel]').find(button => button.dataset.panel === app.panel)?.focus();
    }

    function togglePanelSheet() {
        if (!isCompact())
            return;
        setSheetOpen(!sheetOpen);
        if (sheetOpen)
            $('#panelClose')?.focus();
    }

    return { syncSheet, setSheetOpen, closePanelSheet, togglePanelSheet };
}
