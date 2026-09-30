// @vitest-environment jsdom
// The bottom bar's Go to date button: present only when the host wires it, opens the host's dialog.
import { describe, it, expect, vi } from 'vitest';
import { Bottombar } from '../src/widget/bottombar';

// jsdom ships no CSS.escape; the kit's style injection needs it for its id lookup.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

function make(onGoToDate?: () => void) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bar = new Bottombar(host, { timezone: 'UTC', onRange: () => undefined, onTimezone: () => undefined, ...(onGoToDate ? { onGoToDate } : {}) });
    return { host, bar };
}

describe('Bottombar Go to date', () => {
    it('has no button unless the host provides the action', () => {
        const { host, bar } = make();
        expect(host.querySelector('.vela-bb-goto')).toBeNull();
        expect(host.querySelector('.vela-bb-sep')).toBeNull();
        bar.destroy();
    });

    it('sits right after the range chips, is labelled, and calls the host on click', () => {
        const onGoToDate = vi.fn();
        const { host, bar } = make(onGoToDate);
        const btn = host.querySelector<HTMLButtonElement>('.vela-bb-goto')!;
        expect(btn).not.toBeNull();
        expect(btn.getAttribute('aria-label')).toBe('Go to date');
        expect(btn.querySelector('svg')).not.toBeNull(); // the calendar icon rendered
        const kids = [...host.querySelector('.vela-widget-bottombar')!.children];
        expect(kids[kids.indexOf(btn) - 2]!.textContent).toBe('ALL'); // …ALL | [sep] [goto]
        btn.click();
        expect(onGoToDate).toHaveBeenCalledTimes(1);
        bar.destroy();
        expect(host.querySelector('.vela-widget-bottombar')).toBeNull();
    });
});
