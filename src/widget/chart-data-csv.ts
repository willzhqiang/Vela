// Export of a chart's loaded bars: CSV text and the file name it downloads as. No DOM.
import type { OHLCV } from '../core/model/ohlcv';

const HEADER = 'time,open,high,low,close,volume';

/** A price as plain decimal text — never an exponent, however small. */
function num(n: number): string {
    if (!Number.isFinite(n)) return '';
    const s = String(n);
    return /e/i.test(s) ? n.toFixed(12).replace(/\.?0+$/, '') : s;
}

/** One line per bar: the open time as ISO 8601 UTC, then open, high, low, close and volume (empty when unknown). */
export function barsToCsv(bars: readonly OHLCV[]): string {
    const lines = bars.map((b) => `${new Date(b.time).toISOString().replace('.000Z', 'Z')},${num(b.open)},${num(b.high)},${num(b.low)},${num(b.close)},${b.volume === undefined ? '' : num(b.volume)}`);
    return `${[HEADER, ...lines].join('\n')}\n`;
}

/** `SPY_10_2026-09-30.csv` — the symbol without its provider prefix, the timeframe, and the day (UTC). */
export function csvFileName(symbol: string, timeframe: string, now: number = Date.now()): string {
    const base = symbol.split(/[:/]/).pop() ?? '';
    const clean = (s: string): string => s.replace(/[^A-Za-z0-9.\-]+/g, '').replace(/[.\-]+$/, '');
    const parts = [clean(base) || 'chart', clean(timeframe)].filter(Boolean);
    return `${parts.join('_')}_${new Date(now).toISOString().slice(0, 10)}.csv`;
}
