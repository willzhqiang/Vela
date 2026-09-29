import { describe, it, expect } from 'vitest';
import { frameAroundDate, barsNeededToReach, parseGoToDate, zonedWallToEpoch, DEFAULT_GOTO_BARS } from '../src/core/go-to-date';
import type { OHLCV } from '../src/core/model/ohlcv';

const bars = (n: number, step = 600_000, t0 = 1_700_000_000_000): OHLCV[] =>
    Array.from({ length: n }, (_, i) => ({ time: t0 + i * step, open: i, high: i + 1, low: i - 1, close: i, volume: 1 }));

describe('frameAroundDate', () => {
    const b = bars(1000);
    it('centres exactly `count` bars on the target bar', () => {
        const r = frameAroundDate(b, b[500]!.time, 100)!;
        expect(r).toEqual({ from: b[450]!.time, to: b[549]!.time });
    });
    it('a target between two bars lands on the next bar (at-or-after)', () => {
        const r = frameAroundDate(b, b[500]!.time - 1, 100)!;
        expect(r.from).toBe(b[450]!.time);
    });
    it('slides the window at the left edge instead of shrinking it', () => {
        expect(frameAroundDate(b, b[3]!.time, 100)).toEqual({ from: b[0]!.time, to: b[99]!.time });
        expect(frameAroundDate(b, -1, 100)).toEqual({ from: b[0]!.time, to: b[99]!.time });
    });
    it('slides the window at the right edge', () => {
        expect(frameAroundDate(b, b[998]!.time, 100)).toEqual({ from: b[900]!.time, to: b[999]!.time });
        expect(frameAroundDate(b, b[999]!.time + 10 ** 12, 100)).toEqual({ from: b[900]!.time, to: b[999]!.time });
    });
    it('frames everything when there are fewer bars than requested', () => {
        const few = bars(30);
        expect(frameAroundDate(few, few[10]!.time, 120)).toEqual({ from: few[0]!.time, to: few[29]!.time });
    });
    it('ignores session gaps: the window is measured in bars, not calendar time', () => {
        const day = 86_400_000;
        const gapped = [...bars(50), ...bars(50, 600_000, 1_700_000_000_000 + 3 * day)];   // 3-day hole in the middle
        const r = frameAroundDate(gapped, gapped[50]!.time, 40)!;
        expect(r).toEqual({ from: gapped[30]!.time, to: gapped[69]!.time });
    });
    it('returns null for no bars / a non-finite target; default count is exported', () => {
        expect(frameAroundDate([], 1)).toBeNull();
        expect(frameAroundDate(b, NaN)).toBeNull();
        expect(frameAroundDate(b, b[500]!.time)!.to - frameAroundDate(b, b[500]!.time)!.from).toBe((DEFAULT_GOTO_BARS - 1) * 600_000);
    });
});

describe('barsNeededToReach', () => {
    it('is what is held when the target is already loaded', () => {
        const b = bars(500);
        expect(barsNeededToReach(b, b[10]!.time)).toBe(500);
    });
    it('uses the loaded density, so session gaps do not cause a huge over-fetch', () => {
        // 5 days x 39 bars of 10m, one session per calendar day (23h gap between sessions)
        const day = 86_400_000;
        const sessions = Array.from({ length: 5 }, (_, d) => bars(39, 600_000, 1_700_000_000_000 + d * day)).flat();
        const target = sessions[0]!.time - 20 * day;     // 20 calendar days = 20 more sessions ~ 780 bars
        const naive = Math.ceil((sessions[0]!.time - target) / 600_000);   // 2880 if you assumed continuous trading
        const est = barsNeededToReach(sessions, target);
        expect(est).toBeGreaterThan(sessions.length + 700);
        expect(est).toBeLessThan(sessions.length + naive);              // far below the naive estimate
    });
});

describe('zonedWallToEpoch (DST-correct)', () => {
    it('New York wall time in summer (EDT, -4) and winter (EST, -5)', () => {
        expect(zonedWallToEpoch(2026, 6, 15, 9, 30, 'America/New_York')).toBe(Date.UTC(2026, 5, 15, 13, 30));
        expect(zonedWallToEpoch(2026, 1, 15, 9, 30, 'America/New_York')).toBe(Date.UTC(2026, 0, 15, 14, 30));
    });
    it('handles the spring-forward day', () => {
        expect(zonedWallToEpoch(2026, 3, 8, 12, 0, 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 16, 0));   // already EDT
        expect(zonedWallToEpoch(2026, 3, 8, 1, 0, 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 6, 0));      // still EST
    });
    it('Asia/Shanghai has no DST', () => {
        expect(zonedWallToEpoch(2026, 9, 29, 21, 30, 'Asia/Shanghai')).toBe(Date.UTC(2026, 8, 29, 13, 30));
    });
});

describe('parseGoToDate', () => {
    const NY = 'America/New_York';
    const now = Date.UTC(2026, 8, 29, 18, 0);   // 2026-09-29 14:00 New York
    const p = (s: string) => parseGoToDate(s, NY, now);

    it.each([
        ['2026-06-15', Date.UTC(2026, 5, 15, 4, 0)],
        ['2026/06/15', Date.UTC(2026, 5, 15, 4, 0)],
        ['20260615', Date.UTC(2026, 5, 15, 4, 0)],
        ['2026-06-15 10:30', Date.UTC(2026, 5, 15, 14, 30)],
        ['2026-06-15T10:30', Date.UTC(2026, 5, 15, 14, 30)],
        ['  2026-06-15  ', Date.UTC(2026, 5, 15, 4, 0)],
    ])('%s', (input, expected) => {
        expect(p(input)?.ts).toBe(expected);
    });

    it('today / yesterday are the start of that day in the zone', () => {
        expect(p('today')?.ts).toBe(Date.UTC(2026, 8, 29, 4, 0));
        expect(p('Yesterday')?.ts).toBe(Date.UTC(2026, 8, 28, 4, 0));
    });
    it('a month-day without a year is this year, or last year if that would be in the future', () => {
        expect(p('06-15')?.ts).toBe(Date.UTC(2026, 5, 15, 4, 0));      // past → this year
        expect(p('12-25')?.ts).toBe(Date.UTC(2025, 11, 25, 5, 0));     // future → last year (EST)
        expect(p('6/15 10:30')?.ts).toBe(Date.UTC(2026, 5, 15, 14, 30));
    });
    it('rejects garbage and impossible dates', () => {
        for (const bad of ['', 'hello', '2026-13-01', '2026-02-30', '2026-06-15 25:00', '2026-06-15 10:61', '0-0', '99999']) expect(p(bad), bad).toBeNull();
    });
    it('echoes what it understood, in the zone', () => {
        expect(p('2026-06-15 10:30')?.label).toBe('2026-06-15 10:30 (America/New_York)');
        expect(p('06-15')?.label).toBe('2026-06-15 (America/New_York)');
    });
});
