import { beforeEach, expect, it } from 'vitest';
import { askNucleas, setAssistantFocus, takePendingAsk } from './assistantFocus';
beforeEach(() => { while (takePendingAsk()) { /* Drain only this in-memory test queue. */ } setAssistantFocus(null); });
it('retains repeated requests while Ask is busy and gives each a distinct identity', () => {
    askNucleas('What needs review?'); askNucleas('What needs review?');
    const first = takePendingAsk(), second = takePendingAsk();
    expect(first?.id).not.toBe(second?.id); expect(first?.text).toBe(second?.text); expect(takePendingAsk()).toBeNull();
});
it('keeps each request’s company context even when the user changes focus before delivery', () => {
    setAssistantFocus({ companyId: 'hearth', companyName: 'Hearth' }); askNucleas('What changed?');
    askNucleas('List all work', null); setAssistantFocus({ companyId: 'tailnote', companyName: 'Tailnote' });
    expect(takePendingAsk()?.focus?.companyId).toBe('hearth'); expect(takePendingAsk()?.focus).toBeNull();
});
