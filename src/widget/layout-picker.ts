// Layout picker — the topbar's LAYOUT dropdown. The windows of the chart area, chosen the way
// a trader thinks of them: one row per window COUNT (1, 2, 3, 4 … 16), each with a small diagram
// per arrangement (side by side, stacked, one big and the rest small …); the current one is
// marked, a click applies it. Below sit the workspace SYNC switches, and — only when plugins
// registered arrangements the catalogue does not know — a "Custom" list of labelled rows.
//
// The panel is a lightweight anchored popover (outside-pointerdown + Escape dismiss)
// rather than a kit Menu: it mixes diagram buttons and switch rows, which is beyond the menu
// machine's item model. The host element provides the theme tokens (the panel portals
// inside it, same as the menu positioner).
//
// The bare 4×4 canvas below (`layoutGridCanvas`) is still what the phone drawer taps.
import { injectStyles } from '../ui/styles';
import { ensureLayout } from '../workspace/layouts';
import { layoutCatalog, type LayoutGroup } from '../workspace/layout-catalog';
import { layoutIconEl } from './layout-icon';

const STYLE_ID = 'vela-widget-layout-picker-v15';
// One monochrome selection language across the panel: lit cells and sync ON
// switches both speak --vela-selected-*.
const CSS = `
.vela-lp-layer { position: absolute; z-index: var(--vela-z-menu); }
.vela-lp {
    background: var(--vela-surface-elev);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-radius: 8px;
    box-shadow: var(--vela-shadow);
    padding: 10px 12px 10px;
    font-size: 13px;
    user-select: none;
    transform-origin: top;
    animation: vela-lp-in var(--vela-dur-fast) var(--vela-ease);
}
@keyframes vela-lp-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
.vela-lp-cols { display: flex; align-items: stretch; gap: 14px; }
.vela-lp-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--vela-fg-faint);
    margin-bottom: 10px;
}
/* "?" help badge: hover it for the canvas explainer. */
.vela-lp-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid var(--vela-border-strong);
    color: var(--vela-fg-muted);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0;
    cursor: default;
    transition: color var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-badge:hover { color: var(--vela-fg-bright); border-color: var(--vela-fg-muted); }
.vela-lp-tip { display: flex; flex-direction: column; gap: 4px; max-width: 230px; white-space: normal; }
.vela-lp-vsep { width: 1px; flex: none; align-self: stretch; background: var(--vela-border-faint); }
.vela-lp-layout { width: 132px; display: flex; flex-direction: column; align-items: center; }
.vela-lp-layout > .vela-lp-heading,
.vela-lp-layout > .vela-lp-presets { align-self: stretch; }
.vela-lp-grid { display: grid; grid-template-columns: repeat(4, 24px); grid-auto-rows: 24px; gap: 4px; }
.vela-lp-sq {
    all: unset;
    box-sizing: border-box;
    border-radius: 4px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-faint);
    cursor: pointer;
    transition: background var(--vela-dur-fast) var(--vela-ease), border-color var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-sq:hover { background: var(--vela-hover-strong); border-color: var(--vela-border-strong); }
/* Selected/previewed squares — the shared monochrome selection chip. */
.vela-lp-sq[data-on='1'] {
    background: var(--vela-selected-bg);
    border-color: var(--vela-selected-bg);
}
.vela-lp-presets { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
.vela-lp-preset { all: unset; padding: 5px 8px; border-radius: 4px; cursor: pointer; color: var(--vela-fg-muted); font-size: 12px; white-space: nowrap; transition: transform 120ms var(--vela-ease); }
.vela-lp-preset:hover { background: var(--vela-hover); }
.vela-lp-preset:active { transform: scale(0.98); }
.vela-lp-preset[data-checked='1'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-lp-sync { display: flex; flex-direction: column; gap: 4px; min-width: 118px; }
.vela-lp-sync-row { all: unset; display: flex; align-items: center; gap: 14px; padding: 6px 8px; border-radius: 5px; cursor: pointer; }
.vela-lp-sync-row:hover { background: var(--vela-hover); }
.vela-lp-sync-row .vela-lp-label { flex: 1 1 auto; }
/* Toggle pill — same control language as the menu's switch rows, monochrome ON state. */
.vela-lp-switch {
    position: relative;
    flex: none;
    width: 34px;
    height: 18px;
    border-radius: 9px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-soft);
    transition: background 0.16s ease, border-color 0.16s ease;
}
.vela-lp-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--vela-fg-muted);
    transition: transform 0.16s ease, background 0.16s ease;
}
.vela-lp-switch.on { background: var(--vela-selected-bg); border-color: var(--vela-selected-bg); }

.vela-lp-switch.on::after { transform: translateX(16px); background: var(--vela-selected-fg); }

/* ── the window-count list ── */
.vela-lp--list { width: 408px; max-width: calc(100vw - 16px); padding: 6px 12px 8px; }
.vela-lp-list { max-height: min(560px, calc(100vh - 260px)); overflow-y: auto; margin: 0 -4px; padding: 0 4px; }
.vela-lp-row { display: flex; align-items: center; gap: 4px; padding: 5px 0; border-bottom: 1px solid var(--vela-border-faint); }
.vela-lp-row:last-child { border-bottom: 0; }
.vela-lp-count { flex: none; width: 28px; color: var(--vela-fg-muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.vela-lp-icons { display: flex; flex-wrap: wrap; gap: 4px; }
.vela-lp-icon {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 32px;
    border-radius: 5px;
    color: var(--vela-fg-bright);
    cursor: pointer;
    transition: background var(--vela-dur-fast) var(--vela-ease);
}
.vela-lp-icon:hover { background: var(--vela-hover); }
.vela-lp-icon:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: -2px; }
/* The current arrangement — the shared monochrome selection chip. */
.vela-lp-icon[data-current='1'] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
.vela-lp-heading--section { margin: 12px 0 6px; padding: 0 2px; }
.vela-lp-custom { margin-top: 4px; }
`;

/** The picker canvas is a fixed 4×4 — 16 cells, the workspace pool capacity. */
const GRID = 4;

/** The current layout's footprint on the canvas (mirrors the workspace's LayoutShape). */
export type LayoutPickerShape = { rows: number; cols: number };

/** Build the bare 4×4 canvas (16 squares, row-major). Interaction wiring stays with the
 *  caller — the desktop popover adds hover previews, the mobile drawer taps to apply. */
export function layoutGridCanvas(doc: Document): { el: HTMLElement; squares: HTMLButtonElement[] } {
    injectStyles(STYLE_ID, CSS, doc);
    const el = doc.createElement('div');
    el.className = 'vela-lp-grid';
    const squares: HTMLButtonElement[] = [];
    for (let r = 0; r < GRID; r += 1) {
        for (let c = 0; c < GRID; c += 1) {
            const sq = doc.createElement('button');
            sq.className = 'vela-lp-sq';
            sq.dataset.r = String(r);
            sq.dataset.c = String(c);
            sq.setAttribute('aria-label', `${c + 1} × ${r + 1}`);
            squares.push(sq);
            el.appendChild(sq);
        }
    }
    return { el, squares };
}

/** Light the `shape` rectangle from the top-left (null = nothing lit). */
export function paintLayoutGrid(squares: readonly HTMLButtonElement[], shape: LayoutPickerShape | null): void {
    for (const sq of squares) {
        const on = shape !== null && Number(sq.dataset.r) < shape.rows && Number(sq.dataset.c) < shape.cols;
        if (on) sq.dataset.on = '1';
        else delete sq.dataset.on;
    }
}

export interface LayoutPickerOptions {
    /** Topbar button that toggles the panel. */
    trigger: HTMLElement;
    /** Positioning/theming host (the widget root — the panel portals inside it). */
    host: HTMLElement;
    /** The arrangements to offer, grouped by window count (default: the built-in catalogue). */
    groups?: () => LayoutGroup[];
    /** The id of the layout showing now. */
    current: () => string;
    /** Registered layouts the catalogue does not hold (plugins') — rendered as labelled rows. */
    presets: () => Array<{ id: string; label: string; checked: boolean }>;
    /** An arrangement was chosen (never called for the one already showing). */
    onSelect: (id: string) => void;
    /** SYNC switch rows (re-read on every open and after every toggle). */
    syncs: () => Array<{ id: string; label: string; checked: boolean }>;
    onToggleSync: (id: string) => void;
    onOpenChange?: (open: boolean) => void;
}

export class LayoutPicker {
    private readonly opts: LayoutPickerOptions;
    private readonly doc: Document;
    private readonly layer: HTMLElement;
    private readonly listEl: HTMLElement;
    private readonly customEl: HTMLElement;
    private readonly syncEl: HTMLElement;
    private isOpen = false;

    private readonly onDocPointerDown = (e: Event): void => {
        const t = e.target as Node | null;
        if (t && (this.layer.contains(t) || this.opts.trigger.contains(t))) return;
        this.close();
    };
    private readonly onDocKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') this.close();
    };

    constructor(opts: LayoutPickerOptions) {
        this.opts = opts;
        this.doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, this.doc);
        const doc = this.doc;

        this.layer = doc.createElement('div');
        this.layer.className = 'vela-ui-layer vela-lp-layer';
        this.layer.style.display = 'none';
        const panel = doc.createElement('div');
        panel.className = 'vela-lp vela-lp--list';
        this.layer.appendChild(panel);

        this.listEl = doc.createElement('div');
        this.listEl.className = 'vela-lp-list';
        this.customEl = doc.createElement('div');
        this.customEl.className = 'vela-lp-custom';
        const syncHeading = doc.createElement('div');
        syncHeading.className = 'vela-lp-heading vela-lp-heading--section vela-lp-sync-heading';
        syncHeading.textContent = 'Sync in layout';
        this.syncEl = doc.createElement('div');
        this.syncEl.className = 'vela-lp-sync';
        panel.append(this.listEl, this.customEl, syncHeading, this.syncEl);

        opts.trigger.addEventListener('click', () => this.toggle());
        opts.trigger.setAttribute('aria-haspopup', 'true');
        opts.trigger.setAttribute('aria-expanded', 'false');
        opts.host.appendChild(this.layer);
    }

    toggle(): void {
        if (this.isOpen) this.close();
        else this.open();
    }

    open(): void {
        if (this.isOpen) return;
        this.isOpen = true;
        this.render();
        this.layer.style.display = '';
        this.position();
        this.opts.trigger.setAttribute('aria-expanded', 'true');
        this.doc.addEventListener('pointerdown', this.onDocPointerDown, true);
        this.doc.addEventListener('keydown', this.onDocKeydown, true);
        this.opts.onOpenChange?.(true);
    }

    close(): void {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.layer.style.display = 'none';
        this.opts.trigger.setAttribute('aria-expanded', 'false');
        this.doc.removeEventListener('pointerdown', this.onDocPointerDown, true);
        this.doc.removeEventListener('keydown', this.onDocKeydown, true);
        this.opts.onOpenChange?.(false);
    }

    /** Re-read the current layout, presets and syncs (no-op while closed — `open` re-reads). */
    refresh(): void {
        if (this.isOpen) this.render();
    }

    destroy(): void {
        this.close();
        this.layer.remove();
    }

    // ── internals ──
    private render(): void {
        this.renderList();
        this.renderCustom();
        this.renderSyncs();
    }

    private renderList(): void {
        const doc = this.doc;
        const current = this.opts.current();
        const groups = this.opts.groups ? this.opts.groups() : layoutCatalog();
        this.listEl.replaceChildren(
            ...groups.map((g) => {
                const row = doc.createElement('div');
                row.className = 'vela-lp-row';
                const count = doc.createElement('span');
                count.className = 'vela-lp-count';
                count.textContent = String(g.count);
                const icons = doc.createElement('div');
                icons.className = 'vela-lp-icons';
                for (const def of g.layouts) {
                    const b = doc.createElement('button');
                    b.type = 'button';
                    b.className = 'vela-lp-icon';
                    b.dataset.layout = def.id;
                    b.setAttribute('aria-label', `${g.count} ${g.count === 1 ? 'window' : 'windows'}: ${def.label}`);
                    b.title = def.label;
                    const isCurrent = def.id === current;
                    b.setAttribute('aria-pressed', String(isCurrent));
                    if (isCurrent) b.dataset.current = '1';
                    b.appendChild(layoutIconEl(doc, ensureLayout(def.id) ?? def));
                    b.addEventListener('click', () => this.choose(def.id));
                    icons.appendChild(b);
                }
                row.append(count, icons);
                return row;
            }),
        );
    }

    private renderCustom(): void {
        const doc = this.doc;
        const presets = this.opts.presets();
        this.customEl.replaceChildren();
        this.customEl.style.display = presets.length > 0 ? '' : 'none';
        if (presets.length === 0) return;
        const heading = doc.createElement('div');
        heading.className = 'vela-lp-heading vela-lp-heading--section vela-lp-custom-heading';
        heading.textContent = 'Custom';
        this.customEl.appendChild(heading);
        for (const p of presets) {
            const b = doc.createElement('button');
            b.className = 'vela-lp-preset';
            b.textContent = p.label;
            if (p.checked) b.dataset.checked = '1';
            b.addEventListener('click', () => this.choose(p.id));
            this.customEl.appendChild(b);
        }
    }

    private choose(id: string): void {
        const already = id === this.opts.current();
        this.close();
        if (!already) this.opts.onSelect(id);
    }

    private renderSyncs(): void {
        const doc = this.doc;
        this.syncEl.replaceChildren();
        for (const s of this.opts.syncs()) {
            const row = doc.createElement('button');
            row.className = 'vela-lp-sync-row';
            const label = doc.createElement('span');
            label.className = 'vela-lp-label';
            label.textContent = s.label;
            const pill = doc.createElement('span');
            pill.className = 'vela-lp-switch' + (s.checked ? ' on' : '');
            pill.setAttribute('aria-hidden', 'true');
            row.setAttribute('role', 'switch');
            row.setAttribute('aria-checked', String(s.checked));
            row.append(label, pill);
            row.addEventListener('click', () => {
                this.opts.onToggleSync(s.id);
                this.renderSyncs(); // switches stay open — flip, see, flip again
            });
            this.syncEl.appendChild(row);
        }
    }

    /** Anchor under the trigger, clamped to the host's right edge. */
    private position(): void {
        const hostRect = this.opts.host.getBoundingClientRect();
        const trigRect = this.opts.trigger.getBoundingClientRect();
        let left = trigRect.left - hostRect.left;
        const top = trigRect.bottom - hostRect.top + 4;
        const width = this.layer.offsetWidth;
        if (left + width > hostRect.width - 8) left = Math.max(8, hostRect.width - 8 - width);
        this.layer.style.left = `${left}px`;
        this.layer.style.top = `${top}px`;
    }
}
