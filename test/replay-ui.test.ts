// @vitest-environment jsdom
// The replay UI controller: picking a start bar (guide line, veil, mirrored ghost on the other
// charts), the floating control bar, and leaving nothing behind on exit.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReplayUi, type ReplayBarSaved, type ReplayBarStore, type ReplayUiCell, type ReplayUiOptions, type ReplayUiReplay } from '../src/widget/replay-ui';
import type { ReplayState } from '../src/core/ReplayControl';
import type { ClickEvent, CrosshairEvent } from '../src/core/ports/IChartRenderer';
import type { WorkspaceReplayEventMap } from '../src/workspace/WorkspaceReplay';

// jsdom ships no CSS.escape; the kit's style injection needs it for its id lookup.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

class FakeRenderer {
    override: unknown = null;
    ghost: number | null = null;
    readonly clicks = new Set<(e: ClickEvent) => void>();
    readonly moves = new Set<(e: CrosshairEvent) => void>();
    readonly setCalls: Array<[string, unknown]> = [];
    get(key: string): unknown {
        return key === 'crosshairOverride' ? this.override : undefined;
    }
    set(key: string, value: unknown): this {
        this.setCalls.push([key, value]);
        if (key === 'crosshairOverride') this.override = value;
        return this;
    }
    onClick(cb: (e: ClickEvent) => void): () => void {
        this.clicks.add(cb);
        return () => this.clicks.delete(cb);
    }
    onCrosshairMove(cb: (e: CrosshairEvent) => void): () => void {
        this.moves.add(cb);
        return () => this.moves.delete(cb);
    }
    setExternalCrosshair(time: number | null): this {
        this.ghost = time;
        return this;
    }
    click(time: number | null): void {
        for (const cb of [...this.clicks]) cb({ time, price: null });
    }
    hover(time: number | null): void {
        for (const cb of [...this.moves]) cb({ time, price: null, values: new Map(), ohlc: null });
    }
    get listeners(): number {
        return this.clicks.size + this.moves.size;
    }
}

class FakeReplay {
    calls: string[] = [];
    startArgs: Array<{ from: number; cell?: string }> = [];
    private handlers = new Map<string, Set<(p: never) => void>>();
    private s: ReplayState = { active: false, playing: false, cursorTime: null, remaining: 0, nextTime: null, intervalMs: 1000 };
    stepResult = true;
    rejectStart: Error | null = null;

    get state(): ReplayState {
        return this.s;
    }
    on<K extends keyof WorkspaceReplayEventMap>(event: K, handler: (p: WorkspaceReplayEventMap[K]) => void): () => void {
        const set = this.handlers.get(String(event)) ?? new Set();
        set.add(handler as (p: never) => void);
        this.handlers.set(String(event), set);
        return () => set.delete(handler as (p: never) => void);
    }
    emit<K extends keyof WorkspaceReplayEventMap>(event: K, payload: WorkspaceReplayEventMap[K]): void {
        for (const h of [...(this.handlers.get(String(event)) ?? [])]) (h as (p: WorkspaceReplayEventMap[K]) => void)(payload);
    }
    get handlerCount(): number {
        let n = 0;
        for (const set of this.handlers.values()) n += set.size;
        return n;
    }
    async start(o: { from: number; cell?: string }): Promise<void> {
        this.calls.push('start');
        this.startArgs.push(o);
        if (this.rejectStart) throw this.rejectStart;
        this.s = { ...this.s, active: true, playing: false, cursorTime: o.from, remaining: 40 };
        this.emit('replay:start', { cursorTime: o.from, remaining: 40 });
    }
    step(): boolean {
        this.calls.push('step');
        if (this.stepResult) {
            this.s = { ...this.s, remaining: this.s.remaining - 1 };
            this.emit('replay:step', { cursorTime: 0, remaining: this.s.remaining });
        }
        return this.stepResult;
    }
    play(ms?: number): this {
        this.calls.push(`play:${ms}`);
        this.s = { ...this.s, playing: true, intervalMs: ms ?? this.s.intervalMs };
        this.emit('replay:play', { intervalMs: this.s.intervalMs });
        return this;
    }
    pause(): this {
        this.calls.push('pause');
        this.s = { ...this.s, playing: false };
        this.emit('replay:pause', undefined);
        return this;
    }
    stop(): this {
        this.calls.push('stop');
        this.s = { ...this.s, active: false, playing: false, cursorTime: null, remaining: 0 };
        this.emit('replay:end', { reason: 'stopped' });
        return this;
    }
}

/** A bar-position store that lives in memory, recording every save. */
function memoryStore(initial: ReplayBarSaved = { pinned: false, placement: null }): ReplayBarStore & { saved: ReplayBarSaved[] } {
    let value = initial;
    const saved: ReplayBarSaved[] = [];
    return { saved, load: () => value, save: (v) => { value = v; saved.push(v); } };
}

interface Rig {
    host: HTMLElement;
    replay: FakeReplay;
    renderers: Map<string, FakeRenderer>;
    cells: ReplayUiCell[];
    ui: ReplayUi;
    toasts: string[];
    dateOpened: number;
    fireCells: (e: { kind: 'created' | 'destroyed' | 'active'; id: string }) => void;
    cellSubs: number;
    addCell(id: string): void;
    removeCell(id: string): void;
}

function make(cellIds: string[] = ['a'], extra: Partial<ReplayUiOptions> = {}, replay = new FakeReplay()): Rig {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const renderers = new Map<string, FakeRenderer>();
    const cells: ReplayUiCell[] = [];
    const add = (id: string): void => {
        const renderer = new FakeRenderer();
        renderers.set(id, renderer);
        cells.push({ id, chart: { renderer: renderer as never } });
    };
    for (const id of cellIds) add(id);
    const subs = new Set<(e: { kind: 'created' | 'destroyed' | 'active'; id: string }) => void>();
    const rig = { host, replay, renderers, cells, toasts: [] as string[], dateOpened: 0 } as unknown as Rig;
    rig.fireCells = (e) => {
        for (const h of [...subs]) h(e);
    };
    Object.defineProperty(rig, 'cellSubs', { get: () => subs.size });
    rig.addCell = (id) => {
        add(id);
        rig.fireCells({ kind: 'created', id });
    };
    rig.removeCell = (id) => {
        const i = cells.findIndex((c) => c.id === id);
        if (i >= 0) cells.splice(i, 1);
        rig.fireCells({ kind: 'destroyed', id });
    };
    rig.ui = new ReplayUi({
        host,
        replay: replay as unknown as ReplayUiReplay,
        cells: () => cells,
        activeId: () => cells[0]?.id ?? null,
        onCells: (h) => {
            subs.add(h);
            return () => subs.delete(h);
        },
        openDatePicker: () => (rig.dateOpened += 1),
        toast: (m) => rig.toasts.push(m),
        store: memoryStore(),
        ...extra,
    });
    return rig;
}

const bar = (rig: Rig): HTMLElement => rig.host.querySelector<HTMLElement>('.vela-replay')!;
const btn = (rig: Rig, act: string): HTMLButtonElement => rig.host.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!;
const visible = (el: HTMLElement | null): boolean => !!el && !el.hidden && !el.closest('[hidden]');

const last = <T>(a: readonly T[]): T | undefined => a[a.length - 1];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let rig: Rig;
beforeEach(() => {
    document.body.innerHTML = '';
    rig = make(['a', 'b']);
});
afterEach(() => rig.ui.destroy());

describe('idle', () => {
    it('shows nothing until a replay is asked for', () => {
        expect(rig.ui.phase).toBe('idle');
        expect(bar(rig).hidden).toBe(true);
        expect(rig.renderers.get('a')!.override).toBeNull();
        expect(rig.renderers.get('a')!.listeners).toBe(0);
    });
});

describe('picking a start bar', () => {
    it('sets a dashed vertical guide with the right side veiled on every chart, and listens for clicks', () => {
        rig.ui.beginPick();
        expect(rig.ui.phase).toBe('picking');
        for (const r of rig.renderers.values()) {
            expect(r.override).toMatchObject({ vertical: true, horizontal: false, style: 'dashed', shadeRight: expect.objectContaining({ opacity: expect.any(Number) }) });
            expect(r.clicks.size).toBe(1);
        }
        expect(visible(bar(rig))).toBe(true);
        expect(rig.host.querySelector('.vela-replay-hint')!.textContent).toMatch(/click a bar/i);
    });

    it('mirrors the hovered time as a ghost on the OTHER charts only, and clears it when the pointer leaves', () => {
        rig.ui.beginPick();
        rig.renderers.get('a')!.hover(1_000);
        expect(rig.renderers.get('a')!.ghost).toBeNull();
        expect(rig.renderers.get('b')!.ghost).toBe(1_000);
        rig.renderers.get('a')!.hover(null);
        expect(rig.renderers.get('b')!.ghost).toBeNull();
    });

    it('a click on a bar starts the replay at that bar on that cell, and leaves no pick state behind', async () => {
        rig.ui.beginPick();
        rig.renderers.get('b')!.hover(5_000);
        rig.renderers.get('b')!.click(5_000);
        await flush();
        expect(rig.replay.startArgs).toEqual([{ from: 5_000, cell: 'b' }]);
        expect(rig.ui.phase).toBe('paused');
        for (const r of rig.renderers.values()) {
            expect(r.override).toBeNull();
            expect(r.ghost).toBeNull();
            expect(r.listeners).toBe(0);
        }
    });

    it('a click off the bars does nothing and keeps picking', () => {
        rig.ui.beginPick();
        rig.renderers.get('a')!.click(null);
        expect(rig.replay.calls).toEqual([]);
        expect(rig.ui.phase).toBe('picking');
    });

    it('Escape cancels the pick and restores every chart', () => {
        rig.ui.beginPick();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(rig.ui.phase).toBe('idle');
        expect(bar(rig).hidden).toBe(true);
        for (const r of rig.renderers.values()) {
            expect(r.override).toBeNull();
            expect(r.listeners).toBe(0);
        }
    });

    it('Escape inside an open dialog leaves the pick alone', () => {
        rig.ui.beginPick();
        const dlg = document.createElement('div');
        dlg.setAttribute('role', 'dialog');
        const input = document.createElement('input');
        dlg.append(input);
        document.body.append(dlg);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(rig.ui.phase).toBe('picking');
    });

    it('restores a crosshair override a host had set before the pick', () => {
        const prior = { color: '#fff' };
        rig.renderers.get('a')!.override = prior;
        rig.ui.beginPick();
        rig.ui.cancelPick();
        expect(rig.renderers.get('a')!.override).toBe(prior);
    });

    it('the Cancel and Select-date buttons work', () => {
        rig.ui.beginPick();
        btn(rig, 'date').click();
        expect(rig.dateOpened).toBe(1);
        btn(rig, 'cancel').click();
        expect(rig.ui.phase).toBe('idle');
    });

    it('a chart added mid-pick joins it; one removed is dropped', () => {
        rig.ui.beginPick();
        rig.addCell('c');
        expect(rig.renderers.get('c')!.override).not.toBeNull();
        expect(rig.renderers.get('c')!.clicks.size).toBe(1);
        rig.removeCell('c');
        expect(rig.renderers.get('c')!.listeners).toBe(0); // its listeners went with it
        rig.renderers.get('c')!.click(7);
        expect(rig.replay.calls).toEqual([]);
        expect(rig.ui.phase).toBe('picking'); // the others are still picking
        rig.ui.cancelPick();
        expect(rig.renderers.get('a')!.listeners).toBe(0);
    });

    it('the date dialog result starts the replay on the active cell', async () => {
        rig.ui.beginPick();
        await rig.ui.startFromDate(9_000);
        expect(rig.replay.startArgs).toEqual([{ from: 9_000, cell: 'a' }]);
        expect(rig.ui.phase).toBe('paused');
    });

    it('a failed start toasts and returns to idle', async () => {
        rig.replay.rejectStart = new Error('no data');
        rig.ui.beginPick();
        rig.renderers.get('a')!.click(3);
        await flush();
        expect(rig.ui.phase).toBe('idle');
        expect(rig.toasts.join(' ')).toMatch(/no data/);
    });
});

describe('control bar', () => {
    beforeEach(async () => {
        await rig.ui.startFromDate(100);
    });

    it('shows the transport, hides the pick hint', () => {
        expect(visible(bar(rig))).toBe(true);
        expect(visible(btn(rig, 'play'))).toBe(true);
        expect(visible(rig.host.querySelector('.vela-replay-hint'))).toBe(false);
        expect(rig.host.querySelector('.vela-replay-status')!.textContent).toBe('40 bars left');
    });

    it('play starts at the current pace, then pause stops it; the icon and label follow', () => {
        btn(rig, 'play').click();
        expect(last(rig.replay.calls)).toBe('play:1000');
        expect(rig.ui.phase).toBe('playing');
        expect(btn(rig, 'play').getAttribute('aria-label')).toBe('Pause');
        btn(rig, 'play').click();
        expect(last(rig.replay.calls)).toBe('pause');
        expect(rig.ui.phase).toBe('paused');
        expect(btn(rig, 'play').getAttribute('aria-label')).toBe('Play');
    });

    it('step reveals one bar and updates the count', () => {
        btn(rig, 'step').click();
        expect(last(rig.replay.calls)).toBe('step');
        expect(rig.host.querySelector('.vela-replay-status')!.textContent).toBe('39 bars left');
    });

    it('step with nothing left says so', () => {
        rig.replay.stepResult = false;
        btn(rig, 'step').click();
        expect(rig.toasts).toContain('No more bars to reveal');
    });

    it('speed buttons: 1x / 3x / 10x pick 1000 / 333 / 100 ms; the pressed one follows; a change while playing applies at once', () => {
        expect(btn(rig, 'speed-1x').getAttribute('aria-pressed')).toBe('true');
        btn(rig, 'speed-10x').click();
        expect(btn(rig, 'speed-10x').getAttribute('aria-pressed')).toBe('true');
        expect(btn(rig, 'speed-1x').getAttribute('aria-pressed')).toBe('false');
        expect(rig.replay.calls).not.toContain('play:100'); // paused: only the pace is remembered
        btn(rig, 'play').click();
        expect(last(rig.replay.calls)).toBe('play:100');
        btn(rig, 'speed-3x').click();
        expect(last(rig.replay.calls)).toBe('play:333');
        expect(btn(rig, 'speed-3x').getAttribute('aria-pressed')).toBe('true');
    });

    it('choosing a new start pauses playback and shows the pick hint again', () => {
        btn(rig, 'play').click();
        btn(rig, 'restart').click();
        expect(last(rig.replay.calls)).toBe('pause');
        expect(rig.ui.phase).toBe('picking');
        expect(visible(rig.host.querySelector('.vela-replay-hint'))).toBe(true);
        expect(visible(btn(rig, 'play'))).toBe(false);
        rig.ui.cancelPick();
        expect(rig.ui.phase).toBe('paused');
    });

    it('exit stops the replay and hides the bar', () => {
        btn(rig, 'exit').click();
        expect(last(rig.replay.calls)).toBe('stop');
        expect(rig.ui.phase).toBe('idle');
        expect(bar(rig).hidden).toBe(true);
    });

    it('the engine ending the replay by itself (last bar) hides the bar and says so', () => {
        rig.replay.emit('replay:end', { reason: 'finished' });
        expect(rig.ui.phase).toBe('idle');
        expect(bar(rig).hidden).toBe(true);
        expect(rig.toasts).toContain('Replay reached the last bar');
    });

    it('a pace set by the API shows on the selector', () => {
        rig.replay.play(333);
        expect(btn(rig, 'speed-3x').getAttribute('aria-pressed')).toBe('true');
    });
});

describe('toggle', () => {
    it('idle → picking → idle; replaying → exit', async () => {
        rig.ui.toggle();
        expect(rig.ui.phase).toBe('picking');
        rig.ui.toggle();
        expect(rig.ui.phase).toBe('idle');
        await rig.ui.startFromDate(1);
        rig.ui.toggle();
        expect(rig.ui.phase).toBe('idle');
        expect(last(rig.replay.calls)).toBe('stop');
    });

    it('does nothing with no chart to replay', () => {
        const empty = make([]);
        empty.ui.toggle();
        expect(empty.ui.phase).toBe('idle');
        empty.ui.destroy();
    });
});

describe('lifecycle', () => {
    it('reports every phase change to onChange', () => {
        const seen: string[] = [];
        const r2 = make(['a'], { onChange: (s) => seen.push(s.phase) });
        seen.length = 0;
        r2.ui.beginPick();
        r2.ui.cancelPick();
        expect(seen).toEqual(['picking', 'idle']);
        r2.ui.destroy();
    });

    it('adopts a replay that was already running', () => {
        const replay = new FakeReplay();
        replay.play(333); // not active: ignored
        const r2 = make(['a'], {}, replay);
        expect(r2.ui.phase).toBe('idle');
        r2.ui.destroy();

        const running = new FakeReplay();
        void running.start({ from: 5 });
        running.play(100);
        const r3 = make(['a'], {}, running);
        expect(r3.ui.phase).toBe('playing');
        expect(visible(bar(r3))).toBe(true);
        r3.ui.destroy();
    });

    it('destroy mid-pick removes the bar, the listeners and every override', () => {
        rig.ui.beginPick();
        rig.ui.destroy();
        expect(rig.host.querySelector('.vela-replay')).toBeNull();
        expect(rig.replay.handlerCount).toBe(0);
        expect(rig.cellSubs).toBe(0);
        for (const r of rig.renderers.values()) {
            expect(r.override).toBeNull();
            expect(r.listeners).toBe(0);
            expect(r.ghost).toBeNull();
        }
    });

    it('a full enter/exit cycle leaves no residue', async () => {
        const before = rig.replay.handlerCount;
        rig.ui.beginPick();
        rig.renderers.get('a')!.click(11);
        await flush();
        btn(rig, 'play').click();
        btn(rig, 'exit').click();
        expect(rig.replay.handlerCount).toBe(before);
        expect(rig.cellSubs).toBe(0);
        expect(bar(rig).hidden).toBe(true);
        for (const r of rig.renderers.values()) {
            expect(r.override).toBeNull();
            expect(r.listeners).toBe(0);
            expect(r.ghost).toBeNull();
        }
    });
});

const lastSet = (rig: Rig, id: string, key: string): unknown => last(rig.renderers.get(id)!.setCalls.filter(([k]) => k === key))?.[1];

describe('the start marker', () => {
    it('marks the start bar on every chart once the replay starts', async () => {
        await rig.ui.startFromDate(5000);
        expect(lastSet(rig, 'a', 'replayStart')).toBe(5000);
        expect(lastSet(rig, 'b', 'replayStart')).toBe(5000);
    });

    it('moves when another start is chosen, and stays put while one is being chosen', async () => {
        await rig.ui.startFromDate(5000);
        rig.ui.beginPick();
        expect(lastSet(rig, 'a', 'replayStart')).toBe(5000);
        rig.renderers.get('a')!.click(9000);
        await flush();
        expect(lastSet(rig, 'a', 'replayStart')).toBe(9000);
        expect(lastSet(rig, 'b', 'replayStart')).toBe(9000);
    });

    it('is taken down on exit', async () => {
        await rig.ui.startFromDate(5000);
        rig.ui.exit();
        expect(lastSet(rig, 'a', 'replayStart')).toBeNull();
        expect(lastSet(rig, 'b', 'replayStart')).toBeNull();
    });

    it('reaches a chart added during the replay, and is cleared from it on exit', async () => {
        await rig.ui.startFromDate(5000);
        rig.addCell('c');
        expect(lastSet(rig, 'c', 'replayStart')).toBe(5000);
        rig.ui.exit();
        expect(lastSet(rig, 'c', 'replayStart')).toBeNull();
    });

    it('is cleared when the UI is destroyed mid-replay', async () => {
        await rig.ui.startFromDate(5000);
        rig.ui.destroy();
        expect(lastSet(rig, 'a', 'replayStart')).toBeNull();
    });

    it('is not set by cancelling a pick', () => {
        rig.ui.beginPick();
        rig.ui.cancelPick();
        expect(lastSet(rig, 'a', 'replayStart')).toBeUndefined();
    });
});

/** Give the bar and its host a size (jsdom lays nothing out) and a starting spot. */
function measure(rig: Rig, host = { w: 1000, h: 600 }, barSize = { w: 400, h: 40 }, at = { left: 300, top: 10 }): void {
    const def = (el: HTMLElement, props: Record<string, number>): void => {
        for (const [k, v] of Object.entries(props)) Object.defineProperty(el, k, { configurable: true, get: () => v });
    };
    def(rig.host, { clientWidth: host.w, clientHeight: host.h });
    def(bar(rig), { offsetWidth: barSize.w, offsetHeight: barSize.h, offsetLeft: 999, offsetTop: 999 }); // offsets are a decoy: a centring transform makes them lie
    // Where the bar visibly is, relative to the host (both rects share an origin here).
    rig.host.getBoundingClientRect = () => new DOMRect(0, 0, host.w, host.h);
    bar(rig).getBoundingClientRect = () => new DOMRect(at.left, at.top, barSize.w, barSize.h);
}
const grip = (rig: Rig): HTMLElement => btn(rig, 'grip');
const pointer = (el: Element, type: string, x: number, y: number): void => {
    el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
};
const drag = (rig: Rig, from: [number, number], to: [number, number]): void => {
    pointer(grip(rig), 'pointerdown', ...from);
    pointer(grip(rig), 'pointermove', ...to);
    pointer(grip(rig), 'pointerup', ...to);
};

describe('moving the bar', () => {
    beforeEach(async () => {
        await rig.ui.startFromDate(5000);
        measure(rig);
    });

    it('has a grip and a pin, off the default spot until moved', () => {
        expect(grip(rig)).toBeTruthy();
        expect(btn(rig, 'pin').getAttribute('aria-pressed')).toBe('false');
        expect(bar(rig).style.left).toBe('');
    });

    it('follows the grip', () => {
        drag(rig, [500, 20], [560, 90]);
        expect(bar(rig).style.left).toBe('360px'); // 300 + 60
        expect(bar(rig).style.top).toBe('80px'); // 10 + 70
        expect(bar(rig).style.transform).toBe('none');
    });

    it('stays inside its host', () => {
        drag(rig, [500, 20], [9000, 9000]);
        expect(bar(rig).style.left).toBe('600px');
        expect(bar(rig).style.top).toBe('560px');
        drag(rig, [500, 20], [-9000, -9000]);
        expect(bar(rig).style.left).toBe('0px');
        expect(bar(rig).style.top).toBe('0px');
    });

    it('ignores a move that never started on the grip', () => {
        pointer(grip(rig), 'pointermove', 900, 900);
        expect(bar(rig).style.left).toBe('');
    });

    it('goes back to its default spot for the next replay when not pinned', async () => {
        drag(rig, [500, 20], [560, 90]);
        rig.ui.exit();
        await rig.ui.startFromDate(6000);
        expect(bar(rig).style.left).toBe('');
        expect(bar(rig).style.top).toBe('');
    });
});

describe('pinning the bar', () => {
    beforeEach(async () => {
        await rig.ui.startFromDate(5000);
        measure(rig);
    });

    it('locks it in place: the grip no longer moves it', () => {
        btn(rig, 'pin').click();
        expect(btn(rig, 'pin').getAttribute('aria-pressed')).toBe('true');
        drag(rig, [500, 20], [560, 90]);
        expect(bar(rig).style.left).toBe('');
        expect(bar(rig).dataset.pinned).toBe('1');
    });

    it('remembers where it was put, across replays', async () => {
        const store = memoryStore();
        rig.ui.destroy();
        rig = make(['a', 'b'], { store });
        await rig.ui.startFromDate(5000);
        measure(rig);
        drag(rig, [500, 20], [560, 90]);
        btn(rig, 'pin').click();
        expect(last(store.saved)).toEqual({ pinned: true, placement: { fx: 360 / 600, fy: 80 / 560 } });
        rig.ui.exit();
        await rig.ui.startFromDate(6000);
        measure(rig);
        expect(bar(rig).style.left).not.toBe('');
        expect(btn(rig, 'pin').getAttribute('aria-pressed')).toBe('true');
    });

    it('restores a pinned bar from storage at once, in the same spot', async () => {
        rig.ui.destroy();
        rig = make(['a', 'b'], { store: memoryStore({ pinned: true, placement: { fx: 0.5, fy: 1 } }) });
        await rig.ui.startFromDate(5000);
        measure(rig);
        rig.ui.startFromDate(6000); // placing needs the bar's size, known once shown
        await flush();
        measure(rig);
        window.dispatchEvent(new Event('resize'));
        expect(bar(rig).style.left).toBe('300px'); // half of the 600 free
        expect(bar(rig).style.top).toBe('560px');
        expect(btn(rig, 'pin').getAttribute('aria-pressed')).toBe('true');
    });

    it('unpinning frees the grip and forgets the saved spot', () => {
        const store = memoryStore({ pinned: true, placement: { fx: 0.2, fy: 0.2 } });
        rig.ui.destroy();
        rig = make(['a', 'b'], { store });
        btn(rig, 'pin').click();
        expect(btn(rig, 'pin').getAttribute('aria-pressed')).toBe('false');
        expect(last(store.saved)).toEqual({ pinned: false, placement: null });
    });

    it('keeps the bar inside a host that got smaller', async () => {
        rig.ui.destroy();
        rig = make(['a', 'b'], { store: memoryStore({ pinned: true, placement: { fx: 1, fy: 1 } }) });
        await rig.ui.startFromDate(5000);
        measure(rig, { w: 500, h: 300 });
        window.dispatchEvent(new Event('resize'));
        expect(bar(rig).style.left).toBe('100px');
        expect(bar(rig).style.top).toBe('260px');
    });
});

describe('the start marker across timeframes', () => {
    const H = 3_600_000;
    /** Cells with their own timeframes; the first is active (the replay's own cursor comes from it). */
    function mixed(tfs: Record<string, string>): Rig {
        rig.ui.destroy();
        const r = make(Object.keys(tfs));
        for (const c of r.cells) (c.chart as { market?: { timeframe: string } }).market = { timeframe: tfs[c.id]! };
        return r;
    }

    it('marks each chart at the last bar IT keeps at the start, not the active chart\'s time', async () => {
        const r = mixed({ h1: '60', m10: '10', d: 'D' });
        const T = 10 * 24 * 24 * H; // an hourly bar open (multiple of a day, so bar edges are easy to read)
        await r.ui.startFromDate(T + 5 * H);
        // the fake replay reports cursorTime = the requested time; the hourly bar closes at +1 h
        expect(lastSet(r, 'h1', 'replayStart')).toBe(T + 5 * H);
        expect(lastSet(r, 'm10', 'replayStart')).toBe(T + 5 * H + H - 10 * 60_000); // the last 10 m bar closed by then
        expect(lastSet(r, 'd', 'replayStart')).toBe(T + 5 * H + H - 24 * H); // the day containing it has not closed: the previous day's bar
        r.ui.destroy();
    });

    it('a chart added mid-replay is marked the same way', async () => {
        const r = mixed({ h1: '60' });
        const T = 10 * 24 * 24 * H;
        await r.ui.startFromDate(T + 5 * H);
        r.addCell('m10');
        (r.cells.find((c) => c.id === 'm10')!.chart as { market?: { timeframe: string } }).market = { timeframe: '10' };
        r.fireCells({ kind: 'created', id: 'm10' });
        expect(lastSet(r, 'm10', 'replayStart')).toBe(T + 5 * H + H - 10 * 60_000);
        r.ui.destroy();
    });
});
