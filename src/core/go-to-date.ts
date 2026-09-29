import type { OHLCV } from './model/ohlcv';
import type { VisibleRange } from './ports/IChartRenderer';

/** Bars framed around the target by default — about one intraday session on a 10-minute chart. */
export const DEFAULT_GOTO_BARS = 120;

export interface GoToDateOptions {
    /** How many bars the frame shows (default {@link DEFAULT_GOTO_BARS}). */
    bars?: number;
}

/**
 * The visible range that centres `count` bars on the bar nearest AT-OR-AFTER `ts`.
 *
 * Index-based on purpose: weekends, holidays and overnight gaps are simply absent from the
 * bar array, so a window of N bars never wastes width on them. A target before the first
 * bar frames the start of the history; a target after the last bar frames the end. The
 * window is slid (never shrunk) when it would hang over an edge, so a chart with at least
 * `count` bars always shows exactly `count`.
 */
export function frameAroundDate(bars: readonly OHLCV[], ts: number, count = DEFAULT_GOTO_BARS): VisibleRange | null {
    const n = bars.length;
    if (n === 0 || !Number.isFinite(ts)) return null;
    const want = Math.max(2, Math.floor(count));
    // first index with time >= ts (binary search); past the end → the last bar
    let lo = 0;
    let hi = n;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (bars[mid]!.time < ts) lo = mid + 1;
        else hi = mid;
    }
    const at = Math.min(lo, n - 1);
    const size = Math.min(want, n);
    const start = Math.min(Math.max(0, at - Math.floor(size / 2)), n - size);
    return { from: bars[start]!.time, to: bars[start + size - 1]!.time };
}

/**
 * How many bars a deepening request needs to reach back to `ts`, estimated from the density
 * of the bars already loaded (which captures session gaps, unlike bars-per-calendar-interval),
 * plus half a frame of context and a small safety margin. Never less than what is held.
 */
export function barsNeededToReach(bars: readonly OHLCV[], ts: number, frameBars = DEFAULT_GOTO_BARS): number {
    const n = bars.length;
    if (n < 2) return n;
    const first = bars[0]!.time;
    if (ts >= first) return n;
    const avgMs = (bars[n - 1]!.time - first) / (n - 1);
    const missing = Math.ceil((first - ts) / avgMs);
    return n + Math.ceil(missing * 1.05) + Math.ceil(frameBars / 2) + 1;
}

// ── parsing the text a user types into the Go-to-date field ─────────────────────────────

export interface ParsedGoTo {
    /** Epoch-ms of the wall-clock time in the given zone. */
    ts: number;
    /** Human echo of what was understood, in that zone (shown as the field's hint). */
    label: string;
}

/** Epoch-ms of the wall time `y-m-d h:mi` in IANA `zone` (DST-correct, two-pass offset fix). */
export function zonedWallToEpoch(y: number, m: number, d: number, h: number, mi: number, zone: string): number {
    const guess = Date.UTC(y, m - 1, d, h, mi);
    const offsetAt = (t: number): number => {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }).formatToParts(new Date(t));
        const g = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
        return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - t;
    };
    let t = guess - offsetAt(guess);
    t = guess - offsetAt(t); // re-evaluate at the corrected instant (handles DST edges)
    return t;
}

function wallParts(ts: number, zone: string): { y: number; m: number; d: number; h: number; mi: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(ts));
    const g = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), mi: g('minute') };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Understands what a trader types: `2026-06-15`, `2026-06-15 10:30`, `2026/06/15`, `20260615`,
 * `06-15` / `6/15` (this year, or last year when that would be in the future), `today`,
 * `yesterday`. A date alone means the start of that day (00:00) in `zone`, so the frame
 * lands on that day's first bar. Impossible dates (`2026-02-30`) return null.
 */
export function parseGoToDate(input: string, zone: string, now: number = Date.now()): ParsedGoTo | null {
    const raw = input.trim().toLowerCase();
    if (!raw) return null;
    const today = wallParts(now, zone);
    let y: number;
    let m: number;
    let d: number;
    let h = 0;
    let mi = 0;
    let hasTime = false;

    if (raw === 'today' || raw === 'yesterday') {
        const base = wallParts(now - (raw === 'yesterday' ? 86_400_000 : 0), zone);
        ({ y, m, d } = base);
    } else {
        const full = /^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})(?:[ t]+(\d{1,2}):(\d{2}))?$/.exec(raw);
        const short = /^(\d{1,2})[-/.](\d{1,2})(?:[ t]+(\d{1,2}):(\d{2}))?$/.exec(raw);
        if (full) {
            y = Number(full[1]); m = Number(full[2]); d = Number(full[3]);
            if (full[4] !== undefined) { h = Number(full[4]); mi = Number(full[5]); hasTime = true; }
        } else if (short) {
            m = Number(short[1]); d = Number(short[2]); y = today.y;
            if (short[3] !== undefined) { h = Number(short[3]); mi = Number(short[4]); hasTime = true; }
            const candidate = zonedWallToEpoch(y, m, d, h, mi, zone);
            if (candidate > now) y -= 1;     // "06-15" typed in March means last June, not next June
        } else {
            return null;
        }
    }
    if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    const ts = zonedWallToEpoch(y, m, d, h, mi, zone);
    const back = wallParts(ts, zone);                // round-trip rejects 02-30 → 03-02 style rollovers
    if (back.y !== y || back.m !== m || back.d !== d) return null;
    return { ts, label: `${y}-${pad(m)}-${pad(d)}${hasTime ? ` ${pad(h)}:${pad(mi)}` : ''} (${zone})` };
}
