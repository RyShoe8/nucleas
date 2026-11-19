import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerClipboard, writeAnswerClipboard } from './copyAnswer';

// Only the DOM surface the exporter reads; no browser or network dependency.
const text = (value: string) => ({ nodeType: 3, nodeName: '#text', textContent: value, childNodes: [] }) as unknown as Node;
const element = (tag: string, children: Node[], attributes: Record<string, string> = {}) => ({
    nodeType: 1, nodeName: tag.toUpperCase(), childNodes: children,
    getAttribute: (name: string) => attributes[name] ?? null,
}) as unknown as Node;

afterEach(() => vi.unstubAllGlobals());

describe('Ask clipboard export', () => {
    it('preserves semantic formatting and source links while removing the dark UI and controls', () => {
        const result = answerClipboard(element('div', [
            element('h3', [text('A useful answer')]),
            element('p', [element('strong', [text('Fact')]), text(' & context')], { style: 'color: white; background: black', class: 'dark' }),
            element('ul', [element('li', [text('One')]), element('li', [text('Two')])]),
            element('a', [text('Source')], { href: 'https://example.com/?a=1&b=2', onclick: 'bad()' }),
            element('button', [text('Copy answer')]),
        ]));
        expect(result.html).toContain('color: #000000');
        expect(result.html).toContain('<strong');
        expect(result.html).toContain('<ul');
        expect(result.html).toContain('href="https://example.com/?a=1&amp;b=2"');
        expect(result.html).not.toMatch(/white|class=|onclick|Copy answer/);
        expect(result.text).toContain('Fact & context');
        expect(result.text).toContain('• One\n• Two');
    });

    it('escapes text, drops executable URLs and never copies scripts', () => {
        const result = answerClipboard(element('div', [
            text('<img onerror="bad()">'),
            element('a', [text('Untrusted')], { href: 'javascript:bad()' }),
            element('script', [text('secret()')]),
        ]));
        expect(result.html).toContain('&lt;img onerror=&quot;bad()&quot;&gt;');
        expect(result.html).not.toContain('href=');
        expect(result.html).not.toContain('secret()');
    });

    it('writes both rich and plain text, falling back when rich clipboard is unavailable', async () => {
        const write = vi.fn().mockResolvedValue(undefined);
        const writeText = vi.fn().mockResolvedValue(undefined);
        class Item { constructor(public values: Record<string, Blob>) {} }
        vi.stubGlobal('ClipboardItem', Item);
        vi.stubGlobal('navigator', { clipboard: { write, writeText } });
        const content = element('p', [text('Complete answer')]);
        await writeAnswerClipboard(content);
        const item = write.mock.calls[0][0][0] as Item;
        expect(await item.values['text/html'].text()).toContain('color: #000000');
        expect(await item.values['text/plain'].text()).toBe('Complete answer');
        expect(writeText).not.toHaveBeenCalled();
        write.mockRejectedValueOnce(new Error('Rich clipboard denied'));
        await writeAnswerClipboard(content);
        expect(writeText).toHaveBeenCalledWith('Complete answer');
    });
});
