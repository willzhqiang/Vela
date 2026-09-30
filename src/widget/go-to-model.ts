// State of the Go to dialog: one date (Date tab) or a range (Custom range tab), each a day plus a
// time read on the chart's wall clock in its time zone. Pure state, no DOM: `go-to.ts` renders it.
import { parseGoToDate, zonedWallParts, zonedWallToEpoch } from '../core/go-to-date';

export type GoToTab = 'date' | 'range';
/** Which field the calendar writes to next. */
export type GoToField = 'date' | 'from' | 'to';

export interface GoToStamp {
    /** `YYYY-MM-DD`. */
    day: string;
    /** `HH:mm`, 24 hours. */
    time: string;
}

export type GoToResult = { kind: 'date'; ts: number } | { kind: 'range'; from: number; to: number };

export interface GoToModelOptions {
    /** IANA zone the days and times are read in. */
    zone: string;
    /** "Now", for today's date (default: the current time). */
    now?: number;
    /** The chart's visible range — what the Custom range tab opens on. */
    current?: { from: number; to: number } | null;
    /** Offer the Custom range tab (default true). Without it the dialog is a single date. */
    ranges?: boolean;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `H`, `HH`, `H:mm`, `HH:mm` or `HHmm` → `HH:mm`; null when it is not a time of day. */
export function parseTimeInput(raw: string): string | null {
    const m = /^(\d{1,2}):?(\d{2})$/.exec(raw.trim()) ?? /^(\d{1,2})$/.exec(raw.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mi = m[2] === undefined ? 0 : Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return `${pad(h)}:${pad(mi)}`;
}

function stampOf(ts: number, zone: string): GoToStamp {
    const p = zonedWallParts(ts, zone);
    return { day: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

function epochOf(s: GoToStamp, zone: string): number {
    const [y, m, d] = s.day.split('-').map(Number);
    const [h, mi] = s.time.split(':').map(Number);
    return zonedWallToEpoch(y!, m!, d!, h!, mi!, zone);
}

export class GoToModel {
    readonly maxDay: string;
    private tabValue: GoToTab = 'date';
    private fieldValue: GoToField = 'date';
    private readonly stamps: Record<GoToField, GoToStamp>;
    private readonly zone: string;
    private readonly ranges: boolean;
    private readonly listeners = new Set<() => void>();

    constructor(opts: GoToModelOptions) {
        const now = opts.now ?? Date.now();
        this.zone = opts.zone;
        this.ranges = opts.ranges !== false;
        const today = stampOf(now, opts.zone);
        this.maxDay = today.day;
        const from = opts.current ? stampOf(opts.current.from, opts.zone) : { day: stampOf(now - 86_400_000, opts.zone).day, time: '00:00' };
        const to = opts.current ? stampOf(opts.current.to, opts.zone) : today;
        this.stamps = { date: { day: today.day, time: '00:00' }, from, to };
    }

    get tab(): GoToTab {
        return this.tabValue;
    }

    get field(): GoToField {
        return this.fieldValue;
    }

    stamp(field: GoToField): GoToStamp {
        return { ...this.stamps[field] };
    }

    /** The days of the range, for the calendar to mark (null on the Date tab). */
    rangeDays(): { from: string; to: string } | null {
        if (this.tabValue !== 'range') return null;
        return { from: this.stamps.from.day, to: this.stamps.to.day };
    }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    setTab(tab: GoToTab): void {
        if (tab === 'range' && !this.ranges) return;
        if (tab === this.tabValue) return;
        this.tabValue = tab;
        this.fieldValue = tab === 'range' ? 'from' : 'date';
        this.emit();
    }

    focusField(field: GoToField): void {
        const allowed = this.tabValue === 'range' ? field !== 'date' : field === 'date';
        if (!allowed || field === this.fieldValue) return;
        this.fieldValue = field;
        this.emit();
    }

    /** A day picked on the calendar. Range tab: start, then end (then start again); an end before the start swaps them. */
    pickDay(day: string): void {
        if (day > this.maxDay) return;
        const before = this.snapshot();
        if (this.tabValue === 'date') {
            this.stamps.date.day = day;
        } else if (this.fieldValue === 'from') {
            this.stamps.from.day = day;
            if (this.stamps.to.day < day) this.stamps.to.day = day;
            this.fieldValue = 'to';
        } else {
            if (day < this.stamps.from.day) {
                this.stamps.to.day = this.stamps.from.day;
                this.stamps.from.day = day;
            } else {
                this.stamps.to.day = day;
            }
            this.fieldValue = 'from';
        }
        if (this.snapshot() !== before) this.emit();
    }

    /** Whether typed text names a pickable day (no change made). */
    validDay(text: string): boolean {
        const parsed = parseGoToDate(text, this.zone);
        return parsed !== null && stampOf(parsed.ts, this.zone).day <= this.maxDay;
    }

    /** Typed text for a field's day. Accepts what Alt+G always took (`2026-06-15`, `06-15`, `yesterday`, `2026-06-15 10:30`). False — nothing changes — when it is not a pickable day. */
    typeDay(field: GoToField, text: string): boolean {
        const parsed = parseGoToDate(text, this.zone);
        if (!parsed || !this.validDay(text)) return false;
        const next = stampOf(parsed.ts, this.zone);
        const hasTime = /[ t]+\d{1,2}:\d{2}$/i.test(text.trim());
        const before = this.snapshot();
        this.stamps[field].day = next.day;
        if (hasTime) this.stamps[field].time = next.time;
        if (this.snapshot() !== before) this.emit();
        return true;
    }

    /** Typed text for a field's time. False — nothing changes — when it is not a time of day. */
    typeTime(field: GoToField, text: string): boolean {
        const time = parseTimeInput(text);
        if (!time) return false;
        if (time !== this.stamps[field].time) {
            this.stamps[field].time = time;
            this.emit();
        }
        return true;
    }

    /** Why there is nothing to go to, or null. */
    error(): string | null {
        if (this.tabValue === 'range' && epochOf(this.stamps.to, this.zone) < epochOf(this.stamps.from, this.zone)) return 'The end is before the start';
        return null;
    }

    /** What "Go to" does now, or null while the input is not valid. */
    result(): GoToResult | null {
        if (this.error()) return null;
        if (this.tabValue === 'date') return { kind: 'date', ts: epochOf(this.stamps.date, this.zone) };
        return { kind: 'range', from: epochOf(this.stamps.from, this.zone), to: epochOf(this.stamps.to, this.zone) };
    }

    private snapshot(): string {
        return JSON.stringify([this.tabValue, this.fieldValue, this.stamps]);
    }

    private emit(): void {
        for (const fn of [...this.listeners]) fn();
    }
}
