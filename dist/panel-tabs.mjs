// Automatic tab activation is local navigation, never a project edit or seek.
export function bindPanelTabs(root, { selector, key, active, select, current, contextCurrent = () => true }) {
    const tabs = [...root.querySelectorAll(selector)];
    let composing = false;
    const owns = button => current() && [...root.querySelectorAll(selector)].includes(button);
    const ignored = event => composing || event?.isComposing || event?.keyCode === 229 ||
        event?.defaultPrevented || event?.altKey || event?.ctrlKey || event?.metaKey || event?.shiftKey;
    function activate(button, focus) {
        const value = button.dataset[key];
        if (value !== active) select(value);
        // Selection synchronously remounts the controls. Never focus the old node.
        if (focus && contextCurrent()) {
            const replacement = [...root.querySelectorAll(selector)].find(tab => tab.dataset[key] === value);
            if (replacement?.getAttribute('aria-selected') === 'true') replacement.focus();
        }
    }
    for (const button of tabs) {
        button.oncompositionstart = () => { if (owns(button)) composing = true; };
        button.oncompositionend = () => { composing = false; };
        button.onclick = event => {
            if (!owns(button) || ignored(event)) return;
            activate(button, true);
        };
        button.onkeydown = event => {
            if (!owns(button) || ignored(event)) return;
            const index = tabs.indexOf(button);
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault();
            event.stopPropagation();
            activate(tabs[next], true);
        };
    }
}
