// @vitest-environment jsdom
// Switching the window layout from the topbar: the button and picker follow, and windows the user adds
// open on what they are looking at.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const made: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of made.splice(0)) ws.destroy();
    document.body.innerHTML = '';
});

function mount(opts: Record<string, unknown> = {}): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1', symbol: 'AAA', timeframe: '10', ...opts } as never);
    made.push(ws);
    return ws;
}
const ids = (ws: VelaWorkspace): string[] => ws.cells().map((c) => c.id);

describe('the layout button', () => {
    it('is on the topbar of a multi-window shell, and absent in single-chart mode', () => {
        mount();
        expect(document.querySelector('.vela-widget-layout')).not.toBeNull();
        document.body.innerHTML = '';
        mount({ layout: false });
        expect(document.querySelector('.vela-widget-layout')).toBeNull();
    });

    it('splits the grid when an arrangement is picked, and the button follows', () => {
        const ws = mount();
        expect(ws.cells()).toHaveLength(1);
        document.querySelector<HTMLElement>('.vela-widget-layout')!.click();
        document.querySelector<HTMLElement>('.vela-lp-icon[data-layout="bl3"]')!.click();
        expect(ws.cells()).toHaveLength(3);
        expect(document.querySelector('.vela-widget-layout svg')!.querySelectorAll('rect')).toHaveLength(3);
        ws.setLayout('1');
        expect(ws.cells()).toHaveLength(1);
    });

    it('restores a catalogue layout by id (a saved document)', () => {
        const ws = mount();
        ws.setLayout('bt5');
        expect(ws.cells()).toHaveLength(5);
        ws.setLayout('h6');
        expect(ws.cells()).toHaveLength(6);
        expect(() => ws.setLayout('no-such-layout')).toThrow(/unknown workspace layout/);
    });
});

describe('windows added by a layout switch', () => {
    it('open on the active window\'s symbol and timeframe, not the startup defaults', () => {
        const ws = mount();
        ws.active.setSymbol('BBB');
        ws.active.setTimeframe('60');
        ws.setLayout('4');
        expect(ids(ws)).toHaveLength(4);
        for (const cell of ws.cells()) {
            expect(cell.symbol).toMatch(/BBB$/);
            expect(cell.timeframe).toBe('60');
        }
    });

    it('a window the host declared keeps its own market', () => {
        const ws = mount({ cells: { a: {}, b: { symbol: 'CCC', timeframe: 'D' } } });
        ws.active.setSymbol('BBB');
        ws.active.setTimeframe('60');
        ws.setLayout('2h');
        const b = ws.cell('b')!;
        expect(b.symbol).toMatch(/CCC$/);
        expect(b.timeframe).toBe('D');
    });

    it('a window that was parked by an earlier shrink comes back as it was', () => {
        const ws = mount();
        ws.setLayout('2h');
        const second = ws.cells()[1]!;
        second.setSymbol('DDD');
        second.setTimeframe('5');
        const id = second.id;
        ws.setLayout('1');
        ws.active.setSymbol('BBB');
        ws.active.setTimeframe('60');
        ws.setLayout('2h');
        expect(ws.cell(id)!.symbol).toMatch(/DDD$/);
        expect(ws.cell(id)!.timeframe).toBe('5');
    });
});
