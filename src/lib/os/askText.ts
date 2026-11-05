/**
 * Asks for a line of text in a small dialog, and resolves to it, or null on Cancel. Use this instead of
 * window.prompt, which the desktop app does not support (it throws, so the button just stops working).
 */
export function askText(message: string, options: { initial?: string; placeholder?: string; confirm?: string } = {}): Promise<string | null> {
    return new Promise((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'ui-panel';
        dialog.style.cssText = 'width:min(30rem,calc(100vw - 2rem));padding:1rem;color:var(--text-primary);background:var(--background-elevated);border:1px solid var(--border);border-radius:0.5rem';

        const form = document.createElement('form');
        form.method = 'dialog';
        form.style.cssText = 'display:flex;flex-direction:column;gap:0.75rem';

        const label = document.createElement('label');
        label.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem;font-size:0.8125rem;line-height:1.4;white-space:pre-line';
        label.append(message);
        const input = document.createElement('input');
        input.className = 'ui-control';
        input.value = options.initial ?? '';
        input.placeholder = options.placeholder ?? '';
        input.maxLength = 2000;
        label.append(input);

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;justify-content:flex-end;gap:0.5rem';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'ui-button';
        cancel.textContent = 'Cancel';
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'ui-button-primary';
        submit.textContent = options.confirm ?? 'Continue';
        actions.append(cancel, submit);
        form.append(label, actions);
        dialog.append(form);

        let answer: string | null = null;
        form.addEventListener('submit', () => { answer = input.value; });
        cancel.addEventListener('click', () => dialog.close());
        // Closing by any route (Cancel, Escape, or the submit above) ends the question exactly once.
        dialog.addEventListener('close', () => {
            dialog.remove();
            resolve(answer);
        }, { once: true });

        document.body.append(dialog);
        dialog.showModal();
        input.focus();
    });
}
