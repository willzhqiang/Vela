// chart.replay — rewind to a past bar and reveal the following ones from the history in
// memory. Revealed bars travel the live-bar path; live updates pause meanwhile; stopping
// (or revealing the last bar) restores the full history and resumes them.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Vela } from '../src/index';
import type {
    IChartRenderer,
    RendererCapabilities,
    IndicatorRenderHandle,
    CrosshairEvent,
    ClickEvent,
    InputChangeEvent,
    VisibleRange,
} from '../src/core/ports/IChartRenderer';
import type { MarketDataFeed, BarRange } from '../src/core/ports/MarketDataFeed';
import type { MarketConfig, VelaTheme } from '../src/core/options';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { Pane } from '../src/core/model/scene';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ScenePatch } from '../src/core/model/patch';
import type { InputValue } from '../src/core/model/inputs';
import type { Unsubscribe } from '../src/core/util/types';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

/** The symbol's whole universe: `total` hourly bars, close = index (so a bar is identifiable). */
function universe(total: number): OHLCV[] {
    return Array.from({ length: total }, (_, i) => ({ time: T0 + i * HOUR, open: i, high: i + 1, low: i - 1, close: i, volume: 1 }));
}

/** Serves the NEWEST `cfg.bars` of a fixed universe; records ranges and live (un)subscriptions. */
class ReplayFeed implements MarketDataFeed {
    readonly all: OHLCV[];
    rangeCalls: BarRange[] = [];
    subs = 0;
    unsubs = 0;
    onBar: ((bar: OHLCV) => void) | null = null;

    constructor(total = 200) {
        this.all = universe(total);
    }

    async load(cfg: MarketConfig): Promise<OHLCV[]> {
        if (cfg.data?.length) return cfg.data;
        return this.all.slice(-(cfg.bars ?? 500));
    }

    /** While set, every ranged fetch waits on it — a source slow to serve old history. */
    gate: Promise<void> | null = null;

    async loadRange(_cfg: MarketConfig, range: BarRange): Promise<OHLCV[]> {
        this.rangeCalls.push({ ...range });
        if (this.gate) await this.gate;
        let out = this.all.filter((b) => (range.from == null || b.time >= range.from) && (range.to == null || b.time <= range.to));
        if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
        return out;
    }

    subscribe(_cfg: MarketConfig, onBar: (bar: OHLCV) => void): Unsubscribe {
        this.subs += 1;
        this.onBar = onBar;
        return () => {
            this.unsubs += 1;
            this.onBar = null;
        };
    }
}

class FakeRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true, paneManagement: false, fills: 'primitive', bgcolor: 'primitive', hline: 'native',
        markers: true, barcolor: 'approximated', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    };
    readonly name = 'fake';
    readonly features: readonly string[] = [];
    priceStyleFeature: unknown = undefined;
    bars: OHLCV[] = [];
    setBarsCalls: { n: number; preserveView: boolean }[] = [];
    updated: OHLCV[] = [];
    nativePushes: Array<[string, unknown]> = [];
    applyFeature(): void {}
    readFeature(key: string): unknown { return key === 'priceStyle' ? this.priceStyleFeature : undefined; }
    mount(_c: HTMLElement, _t: VelaTheme): void {}
    setTheme(): void {}
    resize(): void {}
    destroy(): void {}
    setBars(bars: OHLCV[], opts?: { preserveView?: boolean }): void {
        this.bars = [...bars];
        this.setBarsCalls.push({ n: bars.length, preserveView: !!opts?.preserveView });
    }
    updateBar(bar: OHLCV): void {
        this.updated.push(bar);
        const last = this.bars[this.bars.length - 1];
        if (last && last.time === bar.time) this.bars[this.bars.length - 1] = bar;
        else this.bars.push(bar);
    }
    setNativeData(type: string, data: unknown): void { this.nativePushes.push([type, data]); }
    ensurePane(_p: Pane): void {}
    removePane(_id: string): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle { return { id: model.id }; }
    updateIndicator(_h: IndicatorRenderHandle, _p: ScenePatch): void {}
    removeIndicator(_h: IndicatorRenderHandle): void {}
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    setIndicatorVisible(_h: IndicatorRenderHandle, _v: boolean): void {}
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe { return () => {}; }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe { return () => {}; }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe { return () => {}; }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe { return () => {}; }
    getVisibleRange(): VisibleRange | null { return null; }
    frames: VisibleRange[] = [];
    setVisibleRange(r: VisibleRange): void { this.frames.push(r); }
    onViewportChange(_cb: (r: VisibleRange) => void): Unsubscribe { return () => {}; }
}


const last = <T,>(a: T[]): T => a[a.length - 1] as T;
const EL = {} as unknown as HTMLElement;
const charts: Vela[] = [];
function make(opts: { bars?: number; total?: number } = {}) {
    const feed = new ReplayFeed(opts.total ?? 400);
    const renderer = new FakeRenderer();
    const chart = new Vela(EL, { symbol: 'AAA', timeframe: '60', bars: opts.bars ?? 100, live: false, volume: false }, { renderer, dataFeed: feed } as never);
    charts.push(chart);
    return { chart, feed, renderer };
}
afterEach(() => { for (const c of charts.splice(0)) c.destroy(); });

describe('chart.goToDate', () => {
    it('a target inside the loaded bars frames it without fetching anything', async () => {
        const { chart, feed, renderer } = make();
        await chart.ready();
        const calls = feed.rangeCalls.length;
        const target = renderer.bars[60]!.time;
        await chart.goToDate(target, { bars: 20 });
        expect(feed.rangeCalls.length).toBe(calls);
        expect(last(renderer.frames)).toEqual({ from: renderer.bars[50]!.time, to: renderer.bars[69]!.time });
    });

    it('accepts a Date and defaults to a ~120-bar frame', async () => {
        const { chart, renderer } = make({ bars: 300 });
        await chart.ready();
        await chart.goToDate(new Date(renderer.bars[150]!.time));
        const f = last(renderer.frames);
        expect(f.to - f.from).toBe(119 * HOUR);
    });

    it('a target older than the loaded history deepens it first, then frames the target', async () => {
        const { chart, feed, renderer } = make({ bars: 100, total: 400 });
        await chart.ready();
        expect(renderer.bars.length).toBe(100);                       // newest 100 of 400
        const target = feed.all[120]!.time;                            // far older than what is loaded
        await chart.goToDate(target, { bars: 30 });
        await flush();
        expect(feed.rangeCalls.length).toBeGreaterThan(0);            // history was fetched
        expect(renderer.bars[0]!.time).toBeLessThanOrEqual(target);   // and now reaches the target
        const f = last(renderer.frames);
        expect(f.from).toBeLessThanOrEqual(target);
        expect(f.to).toBeGreaterThanOrEqual(target);
        expect(f.to - f.from).toBe(29 * HOUR);
        expect(target - f.from).toBe(15 * HOUR);                       // centred
    });

    it('a target before the source\'s genesis frames the oldest bars instead of failing', async () => {
        const { chart, feed, renderer } = make({ bars: 100, total: 400 });
        await chart.ready();
        await chart.goToDate(feed.all[0]!.time - 1000 * HOUR, { bars: 25 });
        await flush();
        const f = last(renderer.frames);
        expect(f.from).toBe(renderer.bars[0]!.time);
        expect(renderer.bars[0]!.time).toBe(feed.all[0]!.time);        // deepened all the way to genesis
    });

    it('during a replay it frames only what is revealed and never deepens', async () => {
        const { chart, feed, renderer } = make({ bars: 100, total: 400 });
        await chart.ready();
        await chart.replay.start({ from: renderer.bars[40]!.time });
        const calls = feed.rangeCalls.length;
        const shown = renderer.bars.length;
        await chart.goToDate(feed.all[0]!.time, { bars: 10 });         // older than anything loaded
        expect(feed.rangeCalls.length).toBe(calls);
        expect(renderer.bars.length).toBe(shown);
        expect(last(renderer.frames)).toEqual({ from: renderer.bars[0]!.time, to: renderer.bars[9]!.time });
    });

    it('a non-finite target is ignored', async () => {
        const { chart, renderer } = make();
        await chart.ready();
        const n = renderer.frames.length;
        await chart.goToDate(NaN);
        expect(renderer.frames.length).toBe(n);
    });
});
