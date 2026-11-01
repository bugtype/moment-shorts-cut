// Keep native button activation; expose selection in markup and restore only
// focus that the synchronous panel remount displaced. No tab/radio key model.
export function bindPanelChoices(root, {selector, key, activate, current, contextCurrent}) {
    const buttons = [...root.querySelectorAll(selector)];
    let composing = false;
    const available = button => button && !button.disabled && button.isConnected !== false &&
        !button.hidden && !button.closest?.('[hidden]');
    const owns = button => current() && available(button) &&
        [...root.querySelectorAll(selector)].includes(button);
    for (const button of buttons) {
        button.oncompositionstart = () => { if (owns(button)) composing = true; };
        button.oncompositionend = () => { composing = false; };
        button.onclick = event => {
            if (!owns(button) || composing || event?.isComposing || event?.keyCode === 229 || event?.defaultPrevented) return;
            const document = root.ownerDocument, focused = document?.activeElement === button;
            const value = button.dataset[key];
            // An already selected preset may still reapply its other settings.
            activate(value);
            if (!focused || !contextCurrent() || root.isConnected === false) return;
            const replacement = [...root.querySelectorAll(selector)].find(node => node.dataset[key] === value);
            if (replacement === button || !available(replacement) || replacement.getAttribute('aria-pressed') !== 'true') return;
            const active = document.activeElement;
            if (active === button || active === document.body || active === document.documentElement || active == null)
                replacement.focus({preventScroll: true});
        };
    }
}
