// Keeps ONE chart's pre/post-market price current: while the chart shows only the regular
// session, asks the symbol's provider (optional `getExtendedQuote`) for the latest extended-hours
// print and reports it, polling on a slow timer. Nothing to ask for ⇒ reports null and stays quiet.
import type { DataControl } from '../core/DataControl';
import type { MarketSession } from '../core/options';
import type { ExtendedQuote } from '../core/ports/DataProvider';

/** How often the print is re-read. The bars service caches for 15 s, so faster only repeats. */
const POLL_MS = 30_000;

/** A quote with a real price, a real time and a side; anything else is "no quote". */
function usable(q: ExtendedQuote | null | undefined): ExtendedQuote | null {
    if (!q || !Number.isFinite(q.price) || q.price <= 0 || !Number.isFinite(q.time)) return null;
    if (q.session !== 'pre' && q.session !== 'post') return null;
    return { price: q.price, time: q.time, session: q.session };
}

const same = (a: ExtendedQuote | null, b: ExtendedQuote | null): boolean => (a === null || b === null ? a === b : a.price === b.price && a.time === b.time && a.session === b.session);

export class ExtendedPriceTracker {
    /** Invalidates detached async work — bumped by every track()/stop(). */
    private epoch = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** What was last reported (nothing, to begin with) — only changes are passed on. */
    private last: ExtendedQuote | null = null;

    constructor(private readonly onQuote: (quote: ExtendedQuote | null) => void) {}

    /** (Re)bind to a chart's data surface, symbol and shown session. The old symbol's quote is cleared at once. */
    track(data: DataControl, symbol: string, session: MarketSession): void {
        const my = ++this.epoch;
        this.clearTimer();
        this.report(null);
        if (session !== 'regular') return; // the extended tape is on the chart itself
        const resolved = data.resolve(symbol);
        const provider = resolved ? data.providerInstance(resolved.provider) : undefined;
        const ask = provider?.getExtendedQuote?.bind(provider);
        if (!resolved || !ask) return;
        const tick = (): void => {
            void (async () => {
                // A hidden tab has nothing to draw on; it catches up when it is visible again.
                if (!(typeof document !== 'undefined' && document.hidden)) {
                    try {
                        const q = usable(await ask(resolved.ticker));
                        if (my !== this.epoch) return;
                        this.report(q);
                    } catch {
                        if (my !== this.epoch) return; // keep the last print; the next poll retries
                    }
                }
                if (my !== this.epoch) return;
                this.timer = setTimeout(tick, POLL_MS);
            })();
        };
        tick();
    }

    stop(): void {
        this.epoch += 1;
        this.clearTimer();
    }

    private report(q: ExtendedQuote | null): void {
        if (same(q, this.last)) return;
        this.last = q;
        this.onQuote(q);
    }

    private clearTimer(): void {
        if (this.timer != null) clearTimeout(this.timer);
        this.timer = null;
    }
}
