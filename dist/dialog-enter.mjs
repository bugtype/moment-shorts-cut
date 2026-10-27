// Native key-event eligibility only; dialog ownership and local composition stay with the caller.
export function dialogEnterBlocked(event) {
    return event.defaultPrevented || event.key !== 'Enter' || event.isComposing ||
        event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
}
