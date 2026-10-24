// Own only the transient download URL/anchor; never media-source URLs.
export function downloadBlob(blob, name, {document, URL, setTimer}) {
    const url = URL.createObjectURL(blob);
    let anchor, clicked = false, failed = false, failure;
    const remember = error => { if (!failed) { failed = true; failure = error; } };
    const revoke = () => URL.revokeObjectURL(url);
    try {
        anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        document.body.append(anchor);
        anchor.click();
        clicked = true;
    } catch (error) {
        remember(error);
    } finally {
        if (anchor) {
            try { anchor.remove(); }
            catch (error) {
                remember(error);
                // A failed remove must not strand our anchor or replace an earlier error.
                try { anchor.parentNode?.removeChild(anchor); } catch (error) { remember(error); }
            }
        }
        if (clicked) {
            // Even if detach failed, the browser may already be reading this URL.
            try { setTimer(revoke, 60000); }
            catch (error) {
                remember(error);
                try { revoke(); } catch (error) { remember(error); }
            }
        } else {
            try { revoke(); } catch (error) { remember(error); }
        }
    }
    if (failed) throw failure;
}
