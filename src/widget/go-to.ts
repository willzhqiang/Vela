// Go to — the "jump to a point in time" dialog: a Date tab (one day + time) and a Custom range tab
// (a start and an end), a month calendar that fills whichever field is active, and Cancel / Go to.
// Days and times are read on the chart's wall clock in its display time zone. The same dialog,
// without the range tab and with its own title and button, picks the start date of a replay.
import { Dialog } from '../ui/components/dialog';
import { DatePicker } from '../ui/components/date-picker';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { GoToModel, parseTimeInput, type GoToField, type GoToTab } from './go-to-model';

const STYLE_ID = 'vela-widget-goto';
const CSS = `
.vela-goto { width: 380px; }
.vela-goto [hidden] { display: none !important; }
.vela-goto .vela-dialog-body { display: flex; flex-direction: column; gap: 16px; padding: 16px 20px 12px; }
.vela-goto-tabs { display: flex; gap: 28px; border-bottom: 3px solid var(--vela-border); }
.vela-goto-tab {
    all: unset;
    cursor: pointer;
    position: relative;
    padding: 6px 0 10px;
    font-size: 16px;
    font-weight: 600;
    color: var(--vela-fg-muted);
}
.vela-goto-tab:hover { color: var(--vela-fg-bright); }
.vela-goto-tab:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: 2px; border-radius: 4px; }
.vela-goto-tab[aria-selected='true'] { color: var(--vela-fg-bright); }
.vela-goto-tab[aria-selected='true']::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -3px;
    height: 3px;
    border-radius: 2px;
    background: var(--vela-fg-bright);
}
.vela-goto-rows { display: flex; flex-direction: column; gap: 10px; }
.vela-goto-row { display: flex; gap: 12px; }
.vela-goto-field { position: relative; display: flex; align-items: center; }
.vela-goto-field[data-kind='date'] { flex: 1 1 auto; min-width: 0; }
.vela-goto-field[data-kind='time'] { flex: 0 0 128px; }
.vela-goto-field input {
    width: 100%;
    height: 42px;
    box-sizing: border-box;
    padding: 0 40px 0 12px;
    background: transparent;
    border: 1px solid var(--vela-border-strong);
    border-radius: 8px;
    color: var(--vela-fg-bright);
    font: inherit;
    font-size: 16px;
    font-variant-numeric: tabular-nums;
    outline: none;
}
.vela-goto-field input:focus, .vela-goto-field input[data-active] { border-color: var(--vela-focus); }
.vela-goto-field input[data-invalid] { border-color: var(--vela-danger); }
.vela-goto-field .vela-icon {
    position: absolute;
    right: 12px;
    width: 20px;
    height: 20px;
    font-size: 20px;
    color: var(--vela-fg-muted);
    pointer-events: none;
}
.vela-goto-cal { display: flex; justify-content: center; }
.vela-goto .vela-date-picker { --vela-date-picker-cell: 40px; }
.vela-goto .vela-date-picker-day { font-size: 16px; }
.vela-goto .vela-date-picker-day[data-checked] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); font-weight: 600; }
.vela-goto .vela-date-picker-switch, .vela-goto .vela-date-picker-week { font-size: 15px; }
.vela-goto-error { min-height: 16px; margin-top: -8px; color: var(--vela-danger); font-size: 12px; }
.vela-goto .vela-dialog-btn:disabled { opacity: 0.4; cursor: default; pointer-events: none; }
`;

export interface GoToDialogOptions {
    host?: HTMLElement;
    /** The IANA zone days and times are read in — the chart's display time zone. */
    zone: () => string;
    /** The chart's visible range, which the Custom range tab opens on. */
    current?: () => { from: number; to: number } | null;
    /** Dialog title (default `Go to`). */
    title?: string;
    /** Label of the primary button (default `Go to`). */
    applyLabel?: string;
    /** Offer the Custom range tab (default true). */
    ranges?: boolean;
    /** "Now", for today's date and the last pickable day (default: the clock). */
    now?: () => number;
    /** The Date tab's answer: epoch-ms of the chosen day and time. */
    onGoToDate: (ts: number) => void;
    /** The Custom range tab's answer: epoch-ms of the start and the end. */
    onGoToRange?: (from: number, to: number) => void;
    onOpenChange?: (open: boolean) => void;
}

interface Row {
    el: HTMLElement;
    date: HTMLInputElement;
    time: HTMLInputElement;
}

export class GoToDialog {
    private readonly dialog: Dialog;
    private readonly tabsEl: HTMLElement;
    private readonly tabButtons = new Map<GoToTab, HTMLButtonElement>();
    private readonly rowsEl: HTMLElement;
    private readonly rows: Record<GoToField, Row>;
    /** Rebuilt on every open: "today", the last pickable day, moves on while the dialog lives. */
    private picker: DatePicker | null = null;
    private readonly calEl: HTMLElement;
    private readonly errorEl: HTMLElement;
    private readonly cancelBtn: HTMLButtonElement;
    private readonly applyBtn: HTMLButtonElement;
    private model: GoToModel | null = null;
    private offModel: (() => void) | null = null;
    /** False while a calendar click repaints: the month the user is looking at must stay. */
    private reveal = true;

    constructor(private readonly opts: GoToDialogOptions) {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        const ranges = opts.ranges !== false;

        this.tabsEl = doc.createElement('div');
        this.tabsEl.className = 'vela-goto-tabs';
        this.tabsEl.setAttribute('role', 'tablist');
        for (const [id, label] of [['date', 'Date'], ['range', 'Custom range']] as const) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'vela-goto-tab';
            b.setAttribute('role', 'tab');
            b.textContent = label;
            b.addEventListener('click', () => this.model?.setTab(id));
            b.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                const next = id === 'date' ? 'range' : 'date';
                this.model?.setTab(next);
                this.tabButtons.get(next)?.focus();
            });
            this.tabButtons.set(id, b);
            this.tabsEl.appendChild(b);
        }

        this.rowsEl = doc.createElement('div');
        this.rowsEl.className = 'vela-goto-rows';
        this.rows = {
            date: this.buildRow(doc, 'date', 'Date', 'Time'),
            from: this.buildRow(doc, 'from', 'Start date', 'Start time'),
            to: this.buildRow(doc, 'to', 'End date', 'End time'),
        };

        this.calEl = doc.createElement('div');
        this.calEl.className = 'vela-goto-cal';

        this.errorEl = doc.createElement('div');
        this.errorEl.className = 'vela-goto-error';
        this.errorEl.setAttribute('aria-live', 'polite');

        this.cancelBtn = this.footerButton(doc, 'Cancel', false, () => this.close());
        this.applyBtn = this.footerButton(doc, opts.applyLabel ?? 'Go to', true, () => this.apply());

        this.dialog = new Dialog({
            title: opts.title ?? 'Go to',
            host: opts.host,
            draggable: true,
            closeOnInteractOutside: true,
            className: 'vela-dialog--form vela-goto',
            content: (body) => body.append(...(ranges ? [this.tabsEl] : []), this.rowsEl, this.calEl, this.errorEl),
            footer: (foot) => foot.append(this.cancelBtn, this.applyBtn),
            onOpenChange: (open) => {
                if (!open) this.release();
                opts.onOpenChange?.(open);
            },
        });
    }

    get isOpen(): boolean {
        return this.dialog.open;
    }

    /** Open on a fresh state: today, and the chart's visible range on the Custom range tab. */
    open(): void {
        this.release();
        const model = new GoToModel({ zone: this.opts.zone(), now: this.opts.now?.(), current: this.opts.current?.() ?? null, ranges: this.opts.ranges });
        this.model = model;
        const [y, m, d] = model.maxDay.split('-').map(Number);
        this.picker = new DatePicker({
            weekStart: 1,
            max: model.maxDay,
            today: new Date(y!, m! - 1, d!),
            onPick: (day) => {
                this.reveal = false; // the month the user is looking at stays
                try {
                    model.pickDay(day);
                } finally {
                    this.reveal = true;
                }
            },
        });
        this.calEl.replaceChildren(this.picker.el);
        this.offModel = model.subscribe(() => this.paint());
        this.paint();
        this.dialog.show();
        setTimeout(() => {
            const field = this.rows[model.field].date;
            field.focus();
            field.select();
        }, 0);
    }

    close(): void {
        this.dialog.hide();
    }

    destroy(): void {
        this.release();
        this.dialog.destroy();
    }

    private release(): void {
        this.offModel?.();
        this.offModel = null;
        this.model = null;
    }

    private apply(): void {
        const result = this.model?.result();
        if (!result) return;
        this.close();
        if (result.kind === 'date') this.opts.onGoToDate(result.ts);
        else this.opts.onGoToRange?.(result.from, result.to);
    }

    // ── model → DOM ──

    private paint(): void {
        const model = this.model;
        if (!model) return;
        for (const [id, b] of this.tabButtons) {
            const selected = id === model.tab;
            b.setAttribute('aria-selected', String(selected));
            b.tabIndex = selected ? 0 : -1;
        }
        const fields: GoToField[] = model.tab === 'range' ? ['from', 'to'] : ['date'];
        if (this.rowsEl.children.length !== fields.length || fields.some((f, i) => this.rowsEl.children[i] !== this.rows[f].el)) {
            this.rowsEl.replaceChildren(...fields.map((f) => this.rows[f].el));
        }
        for (const field of fields) {
            const row = this.rows[field];
            const stamp = model.stamp(field);
            for (const [el, value] of [[row.date, stamp.day], [row.time, stamp.time]] as const) {
                if (el.dataset.dirty !== '1') el.value = value;
                if (el.dataset.dirty !== '1') delete el.dataset.invalid;
            }
            if (field === model.field) row.date.dataset.active = '1';
            else delete row.date.dataset.active;
        }
        const days = model.rangeDays();
        if (days) this.picker?.setRange(days.from, days.to, this.reveal);
        else this.picker?.setValue(model.stamp('date').day, this.reveal);
        const error = model.error();
        this.errorEl.textContent = error ?? '';
        this.applyBtn.disabled = model.result() === null;
    }

    // ── DOM → model ──

    private buildRow(doc: Document, field: GoToField, dateLabel: string, timeLabel: string): Row {
        const el = doc.createElement('div');
        el.className = 'vela-goto-row';
        const make = (kind: 'date' | 'time', label: string, icon: string): HTMLInputElement => {
            const wrap = doc.createElement('div');
            wrap.className = 'vela-goto-field';
            wrap.dataset.kind = kind;
            const input = doc.createElement('input');
            input.type = 'text';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.setAttribute('aria-label', label);
            wrap.append(input, iconEl(icon, doc));
            el.appendChild(wrap);
            return input;
        };
        const date = make('date', dateLabel, 'calendar-grid');
        const time = make('time', timeLabel, 'clock');
        for (const [input, kind] of [[date, 'day'], [time, 'time']] as const) {
            input.addEventListener('focus', () => this.model?.focusField(field));
            input.addEventListener('input', () => {
                input.dataset.dirty = '1';
                const text = input.value.trim();
                const ok = text === '' || (kind === 'day' ? this.model?.validDay(text) === true : parseTimeInput(text) !== null);
                if (ok) delete input.dataset.invalid;
                else input.dataset.invalid = '1';
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.commit(field, input, kind);
                    this.apply();
                } else if (e.key === 'Tab') {
                    this.commit(field, input, kind);
                }
            });
            input.addEventListener('change', () => this.commit(field, input, kind));
            input.addEventListener('blur', () => this.commit(field, input, kind));
        }
        return { el, date, time };
    }

    /** Take a typed value into the model; an unusable one goes back to what the model holds. */
    private commit(field: GoToField, input: HTMLInputElement, kind: 'day' | 'time'): void {
        const model = this.model;
        if (!model || input.dataset.dirty !== '1') return;
        const text = input.value;
        delete input.dataset.dirty;
        const ok = kind === 'day' ? model.typeDay(field, text) : model.typeTime(field, text);
        if (!ok) {
            delete input.dataset.invalid;
            this.paint();
            return;
        }
        this.paint();
    }

    private footerButton(doc: Document, label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.className = primary ? 'vela-dialog-btn vela-dialog-btn-primary' : 'vela-dialog-btn';
        b.addEventListener('click', onClick);
        return b;
    }
}
