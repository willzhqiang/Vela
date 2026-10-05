// @vitest-environment jsdom
// Switching the window layout from the topbar: the button and picker follow, and windows the user adds
// open on what they are looking at.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { ChartCell } from '../src/workspace/ChartCell';

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

describe('indicators on windows added by a layout switch', () => {
    const MANIFEST = { indicators: [{ name: 'Demo', script: '//@version=5\nindicator("Demo")\nplot(close)', enabled: true }] };
    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

    /** Which cells were told to seed the manifest's enabled entries, by cell id. */
    function spySeeding() {
        const calls = new Map<string, boolean[]>();
        const spy = vi.spyOn(ChartCell.prototype, 'setManifest').mockImplementation(function (this: ChartCell, _list, seedEnabled) {
            calls.set(this.id, [...(calls.get(this.id) ?? []), seedEnabled]);
        });
        return { calls, spy };
    }
    afterEach(() => vi.restoreAllMocks());

    it('start bare: only the windows the shell started with seed the manifest', async () => {
        const { calls } = spySeeding();
        const ws = mount({ indicators: MANIFEST });
        await flush();
        const first = ws.cells()[0]!.id;
        expect(calls.get(first)).toContain(true);
        calls.clear();
        ws.setLayout('4');
        await flush();
        const added = ws.cells().map((c) => c.id).filter((id) => id !== first);
        expect(added).toHaveLength(3);
        for (const id of added) expect(calls.get(id), id).toEqual([false]);
        expect(calls.get(first)).toBeUndefined(); // the first window is not re-seeded
    });

    it('a layout switch before the manifest has resolved stays bare when it does resolve', async () => {
        const { calls } = spySeeding();
        let release!: (m: typeof MANIFEST) => void;
        const slow = new Promise<typeof MANIFEST>((r) => (release = r));
        const ws = mount({ indicators: () => slow });
        const first = ws.cells()[0]!.id;
        ws.setLayout('2h');
        const second = ws.cells().map((c) => c.id).find((id) => id !== first)!;
        release(MANIFEST);
        await flush();
        expect(calls.get(first)).toContain(true);
        expect(calls.get(second)).not.toContain(true);
    });

    it('a window the host declared still seeds the manifest', async () => {
        const { calls } = spySeeding();
        mount({ indicators: MANIFEST, cells: { a: {}, b: {} }, layout: '2h' });
        await flush();
        expect(calls.get('a')).toContain(true);
        expect(calls.get('b')).toContain(true);
    });

    it('newWindowIndicators: true brings the old behaviour back', async () => {
        const { calls } = spySeeding();
        const ws = mount({ indicators: MANIFEST, newWindowIndicators: true });
        await flush();
        const first = ws.cells()[0]!.id;
        calls.clear();
        ws.setLayout('2h');
        const second = ws.cells().map((c) => c.id).find((id) => id !== first)!;
        expect(calls.get(second)).toEqual([true]);
    });

    it('a window parked by a shrink keeps its own indicators when it returns (restored, not seeded)', async () => {
        const { calls } = spySeeding();
        const ws = mount({ indicators: MANIFEST });
        await flush();
        ws.setLayout('2h');
        const second = ws.cells()[1]!.id;
        ws.setLayout('1');
        calls.clear();
        ws.setLayout('2h');
        // Restored from its parked state: the ledger, not the manifest, decides — the cell is told not to seed.
        expect(calls.get(second)).not.toContain(true);
    });
});

describe('indicators a host declares for one window', () => {
    const script = (title: string): string => `//@version=5\nindicator("${title}")\nplot(close)`;
    const MANIFEST = {
        indicators: [
            { name: 'Alpha', script: script('Alpha'), enabled: true },
            { name: 'Beta', script: script('Beta'), enabled: false },
            { name: 'Gamma', script: script('Gamma'), enabled: false },
        ],
    };
    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
    const names = (ws: VelaWorkspace, id: string): string[] => ws.cell(id)!.instances.map((i) => i.entry.name);

    it('a window with an `indicators` seed opens on exactly that set, parameters and hidden flag included', async () => {
        const ws = mount({
            layout: '2h',
            indicators: MANIFEST,
            cells: {
                a: { indicators: { manifest: ['Beta', { name: 'Gamma', inputs: { len: 34 }, hidden: true }, { name: 'Gamma', inputs: { len: 50 } }] } },
                b: {},
            },
        });
        await flush();
        expect(names(ws, 'a')).toEqual(['Beta', 'Gamma', 'Gamma']); // Alpha is enabled in the manifest but this window declared its own set
        expect(ws.cell('a')!.instances.map((i) => i.values?.inputs)).toEqual([undefined, { len: 34 }, { len: 50 }]);
        expect(ws.cell('a')!.instances[1]!.handle?.visible).toBe(false);
        expect(names(ws, 'b')).toEqual(['Alpha']); // an undeclared window still seeds the enabled entries
    });

    it('an empty manifest list declares "no indicators" for that window', async () => {
        const ws = mount({ indicators: MANIFEST, cells: { a: { indicators: { manifest: [] } } } });
        await flush();
        expect(names(ws, 'a')).toEqual([]);
    });

    it('the declared set is what a saved state reports (volume stays unless the seed says otherwise)', async () => {
        const ws = mount({ indicators: MANIFEST, cells: { a: { indicators: { manifest: ['Gamma'] } } } });
        await flush();
        const cell = ws.getState().charts.find((c) => c.id === 'a');
        expect(cell?.indicators?.manifest).toEqual(['Gamma']);
    });
});
