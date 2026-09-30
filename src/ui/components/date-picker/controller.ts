// DatePicker CONTROLLER — the calendar's state, no DOM. Three panels: the days of a month,
// the twelve months of a year, and a decade of years. The header month and year switch to
// their panel; picking a year leads to its months and picking a month back to its days.
// Dates travel as local `YYYY-MM-DD` strings.

export type DatePickerPanel = 'date' | 'month' | 'year';

export interface DatePickerControllerOptions {
    /** The selected date (`YYYY-MM-DD`); the calendar opens on its month. */
    value?: string;
    /** "Today" for the today ring and the initial month when nothing is selected. */
    today?: Date;
    /** First day of the week: 0 = Sunday (default), 1 = Monday. */
    weekStart?: 0 | 1;
    /** Earliest / latest pickable day (`YYYY-MM-DD`, inclusive). Days, months and years wholly outside are disabled. */
    min?: string;
    max?: string;
}

/** One cell of the current panel. `blank` cells pad the first week of a month. */
export interface DatePickerCell {
    label: string;
    /** The day (`YYYY-MM-DD`) on the date panel; the month index or the year otherwise. */
    value: string | number;
    checked: boolean;
    today: boolean;
    /** A padding year outside the decade on the year panel. */
    outside?: boolean;
    blank?: boolean;
    /** Outside `min`/`max` — shown dimmed and not pickable. */
    disabled?: boolean;
    /** Range marks (date panel, see {@link DatePickerController.setRange}): the ends, and the days strictly between. */
    rangeStart?: boolean;
    rangeEnd?: boolean;
    inRange?: boolean;
}

export interface DatePickerController {
    readonly panel: DatePickerPanel;
    readonly year: number;
    readonly month: number;
    readonly value: string | null;
    /** Weekday header labels, in the order the grid uses (starting at `weekStart`). */
    weekdays(): string[];
    /** Whether the arrows would step onto a panel wholly outside `min`/`max`. */
    nav(): { prevDisabled: boolean; nextDisabled: boolean };
    /** Header text: the month switch (hidden off the date panel) and the year switch. */
    header(): { month: string; monthVisible: boolean; year: string; yearDisabled: boolean };
    /** What the arrows step on the current panel. */
    navLabels(): { prev: string; next: string };
    cells(): DatePickerCell[];
    /** One month, one year or ten, depending on the panel. */
    step(dir: 1 | -1): void;
    showMonths(): void;
    showYears(): void;
    /** Activate a cell: a day returns its date (the pick); a month or year only navigates. */
    choose(cell: DatePickerCell): string | null;
    /** Rewrite the selection without emitting (and open on its month). */
    setValue(value: string | null, reveal?: boolean): void;
    /** Mark a range of days (both ends inclusive; null clears it) and open on the month of its start. The single selection stops being drawn while a range is set. */
    setRange(from: string | null, to: string | null, reveal?: boolean): void;
}

export const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

/** `YYYY-MM-DD` for a local date. */
export function isoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Accept `YYYY-MM-DD` or `YYYY-M-D` and return a padded ISO date, or null if unusable. */
export function normalizeDateInput(raw: string): string | null {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return isoDate(dt);
}

function parseIsoDate(raw: string | null | undefined): Date | null {
    const iso = raw ? normalizeDateInput(raw) : null;
    if (!iso) return null;
    const [y, mo, d] = iso.split('-').map(Number);
    return new Date(y!, mo! - 1, d!);
}

export function datePickerController(opts: DatePickerControllerOptions = {}): DatePickerController {
    const today = opts.today ?? new Date();
    let selected = parseIsoDate(opts.value);
    let year = selected?.getFullYear() ?? today.getFullYear();
    let month = selected?.getMonth() ?? today.getMonth();
    let panel: DatePickerPanel = 'date';
    const weekStart = opts.weekStart ?? 0;
    const min = opts.min ? normalizeDateInput(opts.min) : null;
    const max = opts.max ? normalizeDateInput(opts.max) : null;
    let range: { from: string; to: string } | null = null;
    const monthStart = (y: number, m: number): string => `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const monthEnd = (y: number, m: number): string => isoDate(new Date(y, m + 1, 0));
    /** A span of days `[a, b]` that lies wholly outside the limits. */
    const outsideLimits = (a: string, b: string): boolean => (min !== null && b < min) || (max !== null && a > max);

    const decade = (): number => Math.floor(year / 10) * 10;

    return {
        get panel() {
            return panel;
        },
        get year() {
            return year;
        },
        get month() {
            return month;
        },
        get value() {
            return selected ? isoDate(selected) : null;
        },
        weekdays() {
            return Array.from({ length: 7 }, (_, i) => WEEKDAY_LABELS[(i + weekStart) % 7] ?? '');
        },
        nav() {
            if (panel === 'date') {
                return { prevDisabled: outsideLimits(monthStart(year, month - 1), monthEnd(year, month - 1)), nextDisabled: outsideLimits(monthStart(year, month + 1), monthEnd(year, month + 1)) };
            }
            const span = panel === 'month' ? 1 : 10;
            const from = panel === 'month' ? year : decade();
            return {
                prevDisabled: outsideLimits(`${from - span}-01-01`, `${from - 1}-12-31`),
                nextDisabled: outsideLimits(`${from + span}-01-01`, `${from + 2 * span - 1}-12-31`),
            };
        },
        header() {
            return {
                month: MONTH_LABELS[month] ?? '',
                monthVisible: panel === 'date',
                year: panel === 'year' ? `${decade()}-${decade() + 9}` : String(year),
                yearDisabled: panel === 'year', // in the decade panel the year reads as its title
            };
        },
        navLabels() {
            if (panel === 'date') return { prev: 'Previous month', next: 'Next month' };
            if (panel === 'month') return { prev: 'Previous year', next: 'Next year' };
            return { prev: 'Previous decade', next: 'Next decade' };
        },
        cells() {
            const out: DatePickerCell[] = [];
            if (panel === 'date') {
                const startPad = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
                const days = new Date(year, month + 1, 0).getDate();
                const todayIso = isoDate(today);
                const selectedIso = selected ? isoDate(selected) : '';
                for (let i = 0; i < startPad; i++) out.push({ label: '', value: '', checked: false, today: false, blank: true });
                for (let day = 1; day <= days; day++) {
                    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const cell: DatePickerCell = { label: String(day), value: iso, checked: range ? iso === range.from || iso === range.to : iso === selectedIso, today: iso === todayIso };
                    if (outsideLimits(iso, iso)) cell.disabled = true;
                    if (range) {
                        if (iso === range.from) cell.rangeStart = true;
                        if (iso === range.to) cell.rangeEnd = true;
                        if (iso > range.from && iso < range.to) cell.inRange = true;
                    }
                    out.push(cell);
                }
                return out;
            }
            if (panel === 'month') {
                for (let m = 0; m < 12; m++) {
                    const cell: DatePickerCell = {
                        label: MONTH_SHORT[m] ?? '',
                        value: m,
                        checked: selected?.getFullYear() === year && selected.getMonth() === m,
                        today: today.getFullYear() === year && today.getMonth() === m,
                    };
                    if (outsideLimits(monthStart(year, m), monthEnd(year, m))) cell.disabled = true;
                    out.push(cell);
                }
                return out;
            }
            // One padding year on each side, so the decade fills the same 3×4 grid as the months.
            const d = decade();
            for (let y = d - 1; y <= d + 10; y++) {
                const cell: DatePickerCell = { label: String(y), value: y, checked: selected?.getFullYear() === y, today: today.getFullYear() === y, outside: y < d || y > d + 9 };
                if (outsideLimits(`${y}-01-01`, `${y}-12-31`)) cell.disabled = true;
                out.push(cell);
            }
            return out;
        },
        step(dir) {
            if (panel === 'date') {
                month += dir;
                if (month < 0) {
                    month = 11;
                    year -= 1;
                }
                if (month > 11) {
                    month = 0;
                    year += 1;
                }
            } else {
                year += panel === 'month' ? dir : dir * 10;
            }
        },
        showMonths() {
            panel = 'month';
        },
        showYears() {
            panel = 'year';
        },
        choose(cell) {
            if (cell.blank || cell.disabled) return null;
            if (panel === 'date') {
                selected = parseIsoDate(String(cell.value));
                return selected ? isoDate(selected) : null;
            }
            if (panel === 'month') {
                month = Number(cell.value);
                panel = 'date';
                return null;
            }
            year = Number(cell.value);
            panel = 'month';
            return null;
        },
        setValue(value, reveal = true) {
            selected = parseIsoDate(value);
            if (!reveal) return;
            if (selected) {
                year = selected.getFullYear();
                month = selected.getMonth();
            }
            panel = 'date';
        },
        setRange(from, to, reveal = true) {
            const a = from ? normalizeDateInput(from) : null;
            const b = to ? normalizeDateInput(to) : null;
            range = a && b ? (a <= b ? { from: a, to: b } : { from: b, to: a }) : null;
            if (!reveal) return;
            const start = parseIsoDate(range?.from);
            if (start) {
                year = start.getFullYear();
                month = start.getMonth();
            }
            panel = 'date';
        },
    };
}
