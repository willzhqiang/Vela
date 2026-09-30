// The pre/post-market price the chart shows next to the regular last price: where it comes from
// (an optional provider call), when it is asked for, and what counts as a usable answer.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ExtendedPriceTracker } from '../src/widget/extended-price';
import type { ExtendedQuote } from '../src/core/ports/DataProvider';

interface FakeProvider {
    getExtendedQuote?: (ticker: string) => Promise<ExtendedQuote | null>;
}

function fakeData(provider: FakeProvider | undefined, resolved: { provider: string; ticker: string } | null = { provider: 'us', ticker: 'SPY' }) {
    return {
        resolve: vi.fn(() => resolved),
        providerInstance: vi.fn(() => provider),
    } as never;
}

const quote = (over: Partial<ExtendedQuote> = {}): ExtendedQuote => ({ price: 764.7, time: 1_000, session: 'pre', ...over });
const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ExtendedPriceTracker', () => {
    it('asks the provider for the resolved ticker and reports the quote', async () => {
        const getExtendedQuote = vi.fn(async () => quote());
        const seen: Array<ExtendedQuote | null> = [];
        const t = new ExtendedPriceTracker((q) => seen.push(q));
        t.track(fakeData({ getExtendedQuote }), 'us:SPY', 'regular');
        await flush();
        expect(getExtendedQuote).toHaveBeenCalledWith('SPY');
        expect(seen).toEqual([quote()]);
        t.stop();
    });

    it('polls again every 30 s, and reports only changes', async () => {
        let n = 0;
        const getExtendedQuote = vi.fn(async () => quote({ price: n++ < 2 ? 764.7 : 765 }));
        const seen: Array<ExtendedQuote | null> = [];
        const t = new ExtendedPriceTracker((q) => seen.push(q));
        t.track(fakeData({ getExtendedQuote }), 'SPY', 'regular');
        await flush();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(getExtendedQuote).toHaveBeenCalledTimes(2);
        expect(seen.map((q) => q?.price)).toEqual([764.7]); // the same print: nothing new to say
        await vi.advanceTimersByTimeAsync(30_000);
        expect(seen.map((q) => q?.price)).toEqual([764.7, 765]);
        t.stop();
    });

    it('shows nothing when the chart already includes extended hours', async () => {
        const getExtendedQuote = vi.fn(async () => quote());
        const seen: Array<ExtendedQuote | null> = [];
        const t = new ExtendedPriceTracker((q) => seen.push(q));
        t.track(fakeData({ getExtendedQuote }), 'SPY', 'extended');
        await flush();
        expect(getExtendedQuote).not.toHaveBeenCalled();
        expect(seen).toEqual([]); // nothing was showing, nothing to clear
        await vi.advanceTimersByTimeAsync(120_000);
        expect(getExtendedQuote).not.toHaveBeenCalled();
    });

    it('a new track() takes down the previous symbol\'s quote at once', async () => {
        const seen: Array<ExtendedQuote | null> = [];
        const t = new ExtendedPriceTracker((q) => seen.push(q));
        t.track(fakeData({ getExtendedQuote: async () => quote() }), 'SPY', 'regular');
        await flush();
        t.track(fakeData({}), 'QQQ', 'regular');
        expect(seen.map((q) => q?.price ?? null)).toEqual([764.7, null]);
        t.stop();
    });

    it('a quote that stops being one (an answer of null) takes the label down', async () => {
        let answer: ExtendedQuote | null = quote();
        const seen: Array<ExtendedQuote | null> = [];
        const t = new ExtendedPriceTracker((q) => seen.push(q));
        t.track(fakeData({ getExtendedQuote: async () => answer }), 'SPY', 'regular');
        await flush();
        answer = null;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(seen.map((q) => q?.price ?? null)).toEqual([764.7, null]);
        t.stop();
    });

    it('shows nothing for a provider without the capability, or an unresolvable symbol', async () => {
        for (const data of [fakeData({}), fakeData(undefined), fakeData({ getExtendedQuote: async () => quote() }, null)]) {
            const seen: Array<ExtendedQuote | null> = [];
            const t = new ExtendedPriceTracker((q) => seen.push(q));
            t.track(data, 'SPY', 'regular');
            await flush();
            expect(seen).toEqual([]);
            t.stop();
        }
    });

    it('drops a quote that is not a usable price', async () => {
        for (const bad of [null, { price: NaN, time: 1, session: 'pre' }, { price: 0, time: 1, session: 'pre' }, { price: 5, time: NaN, session: 'post' }, { price: 5, time: 1, session: 'regular' }]) {
            const seen: Array<ExtendedQuote | null> = [];
            const t = new ExtendedPriceTracker((q) => seen.push(q));
            t.track(fakeData({ getExtendedQuote: async () => bad as never }), 'SPY', 'regular');
            await flush();
            expect(seen).toEqual([]);
            t.stop();
        }
    });

    it('keeps the last quote through a failed poll and recovers on the next', async () => {
        let call = 0;
        const getExtendedQuote = vi.fn(async () => {
            call += 1;
            if (call === 2) throw new Error('offline');
            return quote({ price: call === 1 ? 764.7 : 766 });
        });
        const seen: Array<ExtendedQuote | null> = [];
        const t = new ExtendedPriceTracker((q) => seen.push(q));
        t.track(fakeData({ getExtendedQuote }), 'SPY', 'regular');
        await flush();
        await vi.advanceTimersByTimeAsync(30_000); // fails
        expect(seen.map((q) => q?.price)).toEqual([764.7]);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(seen.map((q) => q?.price)).toEqual([764.7, 766]);
        t.stop();
    });

    it('a new track() clears the old symbol at once and ignores its late answer', async () => {
        let release!: (q: ExtendedQuote) => void;
        const slow = new Promise<ExtendedQuote>((r) => (release = r));
        const seen: Array<ExtendedQuote | null> = [];
        const t = new ExtendedPriceTracker((q) => seen.push(q));
        t.track(fakeData({ getExtendedQuote: () => slow }), 'SPY', 'regular');
        t.track(fakeData({ getExtendedQuote: async () => quote({ price: 400 }) }, { provider: 'us', ticker: 'QQQ' }), 'QQQ', 'regular');
        await flush();
        release(quote({ price: 764.7 }));
        await flush();
        expect(seen.map((q) => q?.price)).toEqual([400]);
        t.stop();
    });

    it('stop() ends the polling', async () => {
        const getExtendedQuote = vi.fn(async () => quote());
        const t = new ExtendedPriceTracker(() => undefined);
        t.track(fakeData({ getExtendedQuote }), 'SPY', 'regular');
        await flush();
        t.stop();
        await vi.advanceTimersByTimeAsync(300_000);
        expect(getExtendedQuote).toHaveBeenCalledTimes(1);
    });
});
