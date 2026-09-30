// The layouts controller: which layout is current, whether the chart differs from it, autosave, and the
// actions behind the menu — driven against an in-memory store and a fake workspace, on fake timers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LayoutsController } from '../src/workspace/LayoutsController';
import type { LayoutRecord, LayoutStore, LayoutSummary } from '../src/widget/layouts-model';

type State = { version: 1; layout: string; charts: Array<{ id: string; symbol: string; timeframe: string }>; n?: number };
const doc = (symbol: string, timeframe = '10', n = 0): State => ({ version: 1, layout: '1', charts: [{ id: 'c1', symbol, timeframe }], n });

class FakeStore implements LayoutStore {
    rows = new Map<string, LayoutRecord>();
    calls: string[] = [];
    fail: Set<string> = new Set();
    private seq = 0;
    private clock = 1_000;
    private tick = (): number => (this.clock += 10);
    private check(op: string): void {
        this.calls.push(op);
        if (this.fail.has(op)) throw new Error(`${op} failed`);
    }
    seed(name: string, state: State, opened = this.tick()): LayoutRecord {
        const rec: LayoutRecord = { id: `id${(this.seq += 1)}`, name, saved: opened, opened, symbol: state.charts[0]!.symbol, timeframe: state.charts[0]!.timeframe, state };
        this.rows.set(rec.id, rec);
        return rec;
    }
    summary = (r: LayoutRecord): LayoutSummary => ({ id: r.id, name: r.name, saved: r.saved, opened: r.opened, symbol: r.symbol, timeframe: r.timeframe });
    async list() {
        this.check('list');
        return [...this.rows.values()].map(this.summary);
    }
    async load(id: string) {
        this.check('load');
        const r = this.rows.get(id);
        if (!r) throw new Error('missing');
        return structuredClone(r);
    }
    async create(name: string, state: unknown) {
        this.check('create');
        const rec = this.seed(name, structuredClone(state) as State);
        return structuredClone(rec);
    }
    async save(id: string, state: unknown, name?: string) {
        this.check('save');
        const r = this.rows.get(id)!;
        r.state = structuredClone(state);
        const s = state as State;
        r.symbol = s.charts[0]!.symbol;
        r.timeframe = s.charts[0]!.timeframe;
        r.saved = this.tick();
        if (name !== undefined) r.name = name;
        return structuredClone(r);
    }
    async rename(id: string, name: string) {
        this.check('rename');
        const r = this.rows.get(id)!;
        r.name = name;
        return this.summary(r);
    }
    async touch(id: string) {
        this.check('touch');
        this.rows.get(id)!.opened = this.tick();
    }
    async remove(id: string) {
        this.check('remove');
        this.rows.delete(id);
    }
    saves(): number {
        return this.calls.filter((c) => c === 'save').length;
    }
}

class FakeHost {
    state: State = doc('SPY');
    applied: State[] = [];
    private subs = new Set<() => void>();
    getState = (): State => structuredClone(this.state);
    applyState = (s: unknown): void => {
        this.state = structuredClone(s) as State;
        this.applied.push(this.state);
    };
    onStateChanged = (fn: () => void): (() => void) => {
        this.subs.add(fn);
        return () => this.subs.delete(fn);
    };
    /** The user (or a late async load) changes the chart and the workspace reports it. */
    change(patch: Partial<State['charts'][0]> | { n: number }): void {
        if ('n' in patch) this.state = { ...this.state, n: patch.n };
        else this.state = { ...this.state, charts: [{ ...this.state.charts[0]!, ...patch }] };
        for (const fn of [...this.subs]) fn();
    }
    get subscribers(): number {
        return this.subs.size;
    }
}

const SETTLE = 800;
const AUTOSAVE = 1_500;
let store: FakeStore;
let host: FakeHost;
let ctl: LayoutsController;
const make = (opts: Partial<ConstructorParameters<typeof LayoutsController>[0]> = {}): LayoutsController =>
    (ctl = new LayoutsController({ store, host, autosaveDelayMs: AUTOSAVE, settleMs: SETTLE, ...opts }));
/** Let the promise chains and the settle window run out. */
const settle = async (ms = SETTLE + 50): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
    vi.useFakeTimers();
    store = new FakeStore();
    host = new FakeHost();
});
afterEach(() => {
    ctl?.destroy();
    vi.useRealTimers();
});

describe('bootstrap', () => {
    it('with nothing saved there is no current layout and nothing is dirty', async () => {
        make();
        await ctl.bootstrap();
        await settle();
        expect(ctl.status()).toMatchObject({ current: null, dirty: false, layouts: [] });
        expect(host.applied).toEqual([]);
    });

    it('opens the most recently opened layout, marks it opened, and is not dirty afterwards', async () => {
        store.seed('old', doc('QQQ'), 100);
        const latest = store.seed('latest', doc('NVDA', '5'), 900);
        make();
        await ctl.bootstrap();
        await settle();
        expect(host.applied).toEqual([latest.state]);
        expect(ctl.status().current?.name).toBe('latest');
        expect(ctl.status().dirty).toBe(false);
        expect(store.calls).toContain('touch');
        expect(ctl.status().layouts).toHaveLength(2);
    });

    it('changes that arrive while the restored layout is still loading are absorbed, not "unsaved"', async () => {
        store.seed('a', doc('SPY'), 900);
        make();
        await ctl.bootstrap();
        host.change({ timeframe: '10', symbol: 'SPY' });   // indicators finishing, bars deepening…
        await vi.advanceTimersByTimeAsync(300);
        host.change({ n: 1 });
        await settle();
        expect(ctl.status().dirty).toBe(false);
        expect(store.saves()).toBe(0);
    });

    it('a list that fails is reported and the chart keeps its defaults', async () => {
        store.fail.add('list');
        const errors: string[] = [];
        make({ onError: (m) => errors.push(m) });
        await ctl.bootstrap();
        await settle();
        expect(ctl.status().error).toMatch(/list failed/);
        expect(errors).toHaveLength(1);
        expect(host.applied).toEqual([]);
    });
});

describe('unsaved changes and autosave', () => {
    beforeEach(async () => {
        store.seed('mine', doc('SPY'), 900);
        make();
        await ctl.bootstrap();
        await settle();
    });

    it('a change after the layout settled saves it after the delay, then the chart is clean', async () => {
        host.change({ timeframe: '60' });
        expect(ctl.status().dirty).toBe(true);
        await vi.advanceTimersByTimeAsync(AUTOSAVE - 100);
        expect(store.saves()).toBe(0);
        await vi.advanceTimersByTimeAsync(200);
        expect(store.saves()).toBe(1);
        expect(store.rows.get('id1')!.state).toMatchObject({ charts: [{ timeframe: '60' }] });
        expect(ctl.status().dirty).toBe(false);
        expect(ctl.status().current?.timeframe).toBe('60');
    });

    it('a burst of changes is one save, of the latest state', async () => {
        host.change({ timeframe: '5' });
        await vi.advanceTimersByTimeAsync(700);
        host.change({ timeframe: '15' });
        await vi.advanceTimersByTimeAsync(700);
        host.change({ timeframe: '30' });
        await vi.advanceTimersByTimeAsync(AUTOSAVE + 50);
        expect(store.saves()).toBe(1);
        expect(store.rows.get('id1')!.state).toMatchObject({ charts: [{ timeframe: '30' }] });
    });

    it('changing back to what is saved is clean again and nothing is written', async () => {
        host.change({ timeframe: '60' });
        host.change({ timeframe: '10' });
        expect(ctl.status().dirty).toBe(false);
        await vi.advanceTimersByTimeAsync(AUTOSAVE * 2);
        expect(store.saves()).toBe(0);
    });

    it('with autosave off the chart stays "unsaved" and nothing is written until Save layout', async () => {
        ctl.setAutosave(false);
        host.change({ timeframe: '60' });
        await vi.advanceTimersByTimeAsync(AUTOSAVE * 3);
        expect(ctl.status()).toMatchObject({ dirty: true, autosave: false });
        expect(store.saves()).toBe(0);
        expect(await ctl.save()).toBe(true);
        expect(store.saves()).toBe(1);
        expect(ctl.status().dirty).toBe(false);
    });

    it('turning autosave on while there are unsaved changes saves them', async () => {
        ctl.setAutosave(false);
        host.change({ timeframe: '60' });
        ctl.setAutosave(true);
        await vi.advanceTimersByTimeAsync(AUTOSAVE + 50);
        expect(store.saves()).toBe(1);
        expect(ctl.status().dirty).toBe(false);
    });

    it('turning autosave off cancels a save that was pending', async () => {
        host.change({ timeframe: '60' });
        ctl.setAutosave(false);
        await vi.advanceTimersByTimeAsync(AUTOSAVE * 2);
        expect(store.saves()).toBe(0);
        expect(ctl.status().dirty).toBe(true);
    });

    it('the autosave choice is reported to the host so it can remember it', async () => {
        const seen: boolean[] = [];
        ctl.destroy();
        make({ onAutosaveChange: (on) => seen.push(on) });
        ctl.setAutosave(false);
        ctl.setAutosave(false);
        ctl.setAutosave(true);
        expect(seen).toEqual([false, true]);
    });

    it('a change made while a save is in flight is saved next, not lost', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const realSave = store.save.bind(store);
        store.save = async (...a: Parameters<FakeStore['save']>) => {
            await gate;
            return realSave(...a);
        };
        host.change({ timeframe: '60' });
        await vi.advanceTimersByTimeAsync(AUTOSAVE + 10);   // save started, waiting on the gate
        expect(ctl.status().busy).toBe(true);
        host.change({ timeframe: '120' });
        release();
        await vi.advanceTimersByTimeAsync(AUTOSAVE + 100);
        expect(store.rows.get('id1')!.state).toMatchObject({ charts: [{ timeframe: '120' }] });
        expect(ctl.status()).toMatchObject({ dirty: false, busy: false });
    });

    it('a failed save is reported, stays unsaved, and is retried by the next change (not in a loop)', async () => {
        store.fail.add('save');
        host.change({ timeframe: '60' });
        await vi.advanceTimersByTimeAsync(AUTOSAVE + 50);
        expect(ctl.status()).toMatchObject({ dirty: true, error: 'save failed' });
        await vi.advanceTimersByTimeAsync(AUTOSAVE * 5);
        expect(store.saves()).toBe(1);
        store.fail.clear();
        host.change({ timeframe: '30' });
        await vi.advanceTimersByTimeAsync(AUTOSAVE + 50);
        expect(ctl.status()).toMatchObject({ dirty: false, error: null });
    });
});

describe('with no current layout', () => {
    beforeEach(async () => {
        make();
        await ctl.bootstrap();
        await settle();
    });

    it('changes are unsaved but never autosaved (there is nowhere to write)', async () => {
        host.change({ symbol: 'NVDA' });
        await vi.advanceTimersByTimeAsync(AUTOSAVE * 3);
        expect(ctl.status().dirty).toBe(true);
        expect(store.calls.filter((c) => c === 'save' || c === 'create')).toEqual([]);
    });

    it('Save layout needs a name, and then makes the layout and makes it current', async () => {
        expect(await ctl.save()).toBe(false);
        expect(await ctl.save('  My layout ')).toBe(true);
        expect(ctl.status().current?.name).toBe('My layout');   // trimmed before it reaches the store
        expect(ctl.status()).toMatchObject({ dirty: false });
        expect(store.rows.size).toBe(1);
        expect([...store.rows.values()][0]!.state).toEqual(host.state);
    });

    it('rename has nothing to rename', async () => {
        expect(await ctl.rename('x')).toBe(false);
    });
});

describe('actions', () => {
    let a: LayoutRecord;
    beforeEach(async () => {
        a = store.seed('alpha', doc('AAPL'), 900);   // differs from the chart's boot defaults (SPY), so "defaults" is distinguishable
        make();
        await ctl.bootstrap();
        await settle();
    });

    it('make a copy saves what is on screen under the new name and switches to it', async () => {
        host.change({ symbol: 'QQQ' });
        expect(await ctl.makeCopy('alpha copy')).toBe(true);
        const copy = [...store.rows.values()].find((r) => r.name === 'alpha copy')!;
        expect(copy.state).toMatchObject({ charts: [{ symbol: 'QQQ' }] });
        expect(ctl.status().current?.id).toBe(copy.id);
        expect(ctl.status().dirty).toBe(false);
        expect(store.rows.get(a.id)!.state).toMatchObject({ charts: [{ symbol: 'AAPL' }] }); // the original is untouched
        expect(ctl.status().layouts.map((l) => l.name).sort()).toEqual(['alpha', 'alpha copy']);
    });

    it('rename changes the current layout\'s name, in the store and the list', async () => {
        expect(await ctl.rename('beta')).toBe(true);
        expect(store.rows.get(a.id)!.name).toBe('beta');
        expect(ctl.status().current?.name).toBe('beta');
        expect(ctl.status().layouts.find((l) => l.id === a.id)?.name).toBe('beta');
    });

    it('create new starts from the defaults the chart had at boot, under the new name', async () => {
        host.change({ symbol: 'NVDA' });
        await vi.advanceTimersByTimeAsync(AUTOSAVE + 50);   // the change autosaves into alpha first
        expect(await ctl.createNew('fresh')).toBe(true);
        const fresh = [...store.rows.values()].find((r) => r.name === 'fresh')!;
        expect(fresh.state).toMatchObject({ charts: [{ symbol: 'SPY' }] });   // the boot defaults, captured before alpha (AAPL) was applied
        expect(host.state).toEqual(fresh.state);
        expect(ctl.status().current?.id).toBe(fresh.id);
        expect(store.rows.get(a.id)!.state).toMatchObject({ charts: [{ symbol: 'NVDA' }] });
    });

    it('opening another layout applies it, marks it opened, and does not autosave the applied state back', async () => {
        const b = store.seed('bravo', doc('NVDA', '5'), 500);
        await ctl.refresh();
        const before = store.saves();
        expect(await ctl.open(b.id)).toBe(true);
        expect(host.state).toEqual(b.state);
        expect(ctl.status().current?.id).toBe(b.id);
        host.change({ n: 1 });            // the workspace reporting what applyState just did
        await settle(AUTOSAVE * 2);
        expect(store.saves()).toBe(before);
        expect(ctl.status().dirty).toBe(false);
    });

    it('opening another layout first saves pending changes to the one being left', async () => {
        const b = store.seed('bravo', doc('NVDA', '5'), 500);
        await ctl.refresh();
        host.change({ timeframe: '60' });            // pending autosave for alpha
        await ctl.open(b.id);
        expect(store.rows.get(a.id)!.state).toMatchObject({ charts: [{ timeframe: '60' }] });
        expect(host.state).toEqual(b.state);
    });

    it('needs confirming only when opening would throw away unsaved work', async () => {
        expect(ctl.requiresConfirm()).toBe(false);
        ctl.setAutosave(false);
        expect(ctl.requiresConfirm()).toBe(false);
        host.change({ timeframe: '60' });
        expect(ctl.requiresConfirm()).toBe(true);
        ctl.setAutosave(true);
        expect(ctl.requiresConfirm()).toBe(false);
    });

    it('deleting the current layout leaves the chart as it is, unsaved; deleting another leaves the current one', async () => {
        const b = store.seed('bravo', doc('NVDA'), 500);
        await ctl.refresh();
        expect(await ctl.remove(b.id)).toBe(true);
        expect(ctl.status().current?.id).toBe(a.id);
        expect(ctl.status().layouts.map((l) => l.id)).toEqual([a.id]);
        expect(await ctl.remove(a.id)).toBe(true);
        expect(ctl.status()).toMatchObject({ current: null, layouts: [], dirty: true });
        expect(host.applied).toHaveLength(1);        // only the boot restore
    });

    it('an open that cannot load leaves everything as it was and says why', async () => {
        store.fail.add('load');
        const before = host.applied.length;
        expect(await ctl.open(a.id)).toBe(false);
        expect(ctl.status().error).toBe('load failed');
        expect(host.applied).toHaveLength(before);
        expect(ctl.status().current?.id).toBe(a.id);
    });
});

describe('subscriptions', () => {
    it('subscribers hear about changes, and stop after unsubscribing', async () => {
        store.seed('a', doc('SPY'), 900);
        make();
        const seen: boolean[] = [];
        const off = ctl.subscribe((s) => seen.push(s.dirty));
        await ctl.bootstrap();
        await settle();
        host.change({ timeframe: '60' });
        expect(seen).toContain(true);
        const n = seen.length;
        off();
        host.change({ timeframe: '30' });
        expect(seen).toHaveLength(n);
    });

    it('destroy stops listening to the workspace and cancels a pending save', async () => {
        store.seed('a', doc('SPY'), 900);
        make();
        await ctl.bootstrap();
        await settle();
        host.change({ timeframe: '60' });
        ctl.destroy();
        expect(host.subscribers).toBe(0);
        await vi.advanceTimersByTimeAsync(AUTOSAVE * 2);
        expect(store.saves()).toBe(0);
    });
});
