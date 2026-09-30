// The chart-data export: OHLCV bars as CSV, and the file name it downloads as.
import { describe, it, expect } from 'vitest';
import { barsToCsv, csvFileName } from '../src/widget/chart-data-csv';

const bar = (time: number, o: number, h: number, l: number, c: number, volume?: number) => ({ time, open: o, high: h, low: l, close: c, ...(volume === undefined ? {} : { volume }) });

describe('barsToCsv', () => {
    it('has a header, one line per bar, ISO UTC times, and a trailing newline', () => {
        const csv = barsToCsv([bar(Date.UTC(2026, 8, 29, 13, 30), 765.5, 766.25, 765, 766, 1200), bar(Date.UTC(2026, 8, 29, 13, 40), 766, 767, 765.75, 766.5, 900)]);
        expect(csv).toBe('time,open,high,low,close,volume\n2026-09-29T13:30:00Z,765.5,766.25,765,766,1200\n2026-09-29T13:40:00Z,766,767,765.75,766.5,900\n');
    });

    it('leaves volume empty when a bar has none', () => {
        expect(barsToCsv([bar(0, 1, 2, 0.5, 1.5)])).toBe('time,open,high,low,close,volume\n1970-01-01T00:00:00Z,1,2,0.5,1.5,\n');
    });

    it('keeps full precision and never writes exponents for ordinary prices', () => {
        const csv = barsToCsv([bar(0, 0.000123, 0.0002, 0.0001, 0.00015, 5)]);
        expect(csv.split('\n')[1]).toBe('1970-01-01T00:00:00Z,0.000123,0.0002,0.0001,0.00015,5');
    });

    it('is just the header for no bars', () => {
        expect(barsToCsv([])).toBe('time,open,high,low,close,volume\n');
    });
});

describe('csvFileName', () => {
    const now = Date.UTC(2026, 8, 30, 12, 0);
    it('names the symbol, the timeframe and the day', () => {
        expect(csvFileName('us:SPY', '10', now)).toBe('SPY_10_2026-09-30.csv');
    });
    it('keeps a daily timeframe readable and strips anything a file name should not carry', () => {
        expect(csvFileName('MNQ1!', 'D', now)).toBe('MNQ1_D_2026-09-30.csv');
        expect(csvFileName('BTC/USDT:PERP', '60', now)).toBe('PERP_60_2026-09-30.csv');
        expect(csvFileName('', '', now)).toBe('chart_2026-09-30.csv');
    });
});
