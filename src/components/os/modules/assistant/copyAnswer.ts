import type { ClipboardEvent } from 'react';

const TAGS = new Set('p div span strong b em i u s h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code br hr table thead tbody tr th td a'.split(' '));
const BLOCKS = new Set('p div h1 h2 h3 h4 h5 h6 ul ol li blockquote pre tr'.split(' '));
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Export semantic formatting only. App colors, backgrounds and controls never reach the clipboard. */
export function answerClipboard(node: Node): { html: string; text: string } {
    const visit = (item: Node): { html: string; text: string } => {
        if (item.nodeType === 3) return { html: escape(item.textContent ?? ''), text: item.textContent ?? '' };
        const tag = item.nodeName.toLowerCase();
        if (['script', 'style', 'button', 'svg', 'input', 'textarea'].includes(tag)) return { html: '', text: '' };
        const children = Array.from(item.childNodes).map(visit);
        const body = children.map(c => c.html).join('');
        const text = children.map(c => c.text).join('');
        if (!TAGS.has(tag)) return { html: body, text };
        const href = tag === 'a' ? (item as Element).getAttribute('href') : null;
        const link = href && /^(https?:|mailto:)/i.test(href) ? ` href="${escape(href)}"` : '';
        const style = `color: #000000; background-color: transparent;${tag === 'pre' ? ' white-space: pre-wrap;' : ''}`;
        return {
            html: `<${tag}${link} style="${style}">${body}${tag === 'br' || tag === 'hr' ? '' : `</${tag}>`}`,
            text: tag === 'br' || tag === 'hr' ? '\n' : `${tag === 'li' ? '• ' : ''}${text}${BLOCKS.has(tag) ? '\n' : tag === 'td' || tag === 'th' ? '\t' : ''}`,
        };
    };
    const result = visit(node);
    return { html: `<div style="color: #000000; background-color: transparent;">${result.html}</div>`, text: result.text.replace(/\n{3,}/g, '\n\n').trim() };
}

/** Covers keyboard/context-menu copying without changing the dark chat presentation. */
export function copyAskSelection(event: ClipboardEvent<HTMLElement>) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!event.currentTarget.contains(range.startContainer) || !event.currentTarget.contains(range.endContainer)) return;
    const { html } = answerClipboard(range.cloneContents());
    event.clipboardData.setData('text/plain', selection.toString());
    event.clipboardData.setData('text/html', html);
    event.preventDefault();
}

export async function writeAnswerClipboard(node: Node) {
    const { html, text } = answerClipboard(node);
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        try {
            await navigator.clipboard.write([new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([text], { type: 'text/plain' }),
            })]);
            return;
        } catch { /* Some desktop webviews only permit plain text. */ }
    }
    await navigator.clipboard.writeText(text);
}
