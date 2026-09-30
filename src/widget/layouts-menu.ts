// The "Manage layouts" menu — the panel under the topbar's layout-name button: save, autosave,
// copy, rename, download the loaded bars, create a new layout, the most recently used layouts,
// and "Open layout…" for the full list.
//
// A lightweight anchored panel (outside-pointerdown + Escape dismiss) rather than a kit Menu:
// it mixes plain rows, a switch row and two-line rows, beyond the menu machine's item model.
// The host element provides the theme tokens (the panel portals inside it, as the layout picker does).
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { LayoutsDialog } from './layouts-dialog';
import { layoutSubtitle, recentLayouts, type LayoutsActions, type LayoutsStatus } from './layouts-model';
import { confirmLeave, promptName } from './layouts-prompts';

const STYLE_ID = 'vela-widget-layouts-menu';
const CSS = `
.vela-lm-layer { position: absolute; z-index: var(--vela-z-menu); }
.vela-lm {
    box-sizing: border-box;
    width: 300px;
    max-width: calc(100vw - 16px);
    padding: 6px 0;
    background: var(--vela-surface-elev);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-radius: 8px;
    box-shadow: var(--vela-shadow);
    font-size: 14px;
    user-select: none;
}
.vela-lm-item {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 36px;
    padding: 0 16px;
    cursor: pointer;
}
.vela-lm-item:hover { background: var(--vela-hover); }
.vela-lm-item[data-disabled] { opacity: 0.4; cursor: default; pointer-events: none; }
.vela-lm-item > .vela-icon { flex: none; color: var(--vela-fg-muted); }
.vela-lm-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vela-fg-bright); }
.vela-lm-sep { height: 1px; margin: 6px 0; background: var(--vela-border); }
.vela-lm-heading { padding: 8px 16px 4px; color: var(--vela-fg-faint); font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; }
.vela-lm-recent { padding-top: 6px; padding-bottom: 6px; min-height: 48px; }
.vela-lm-recent .vela-lm-text { flex: 1 1 auto; min-width: 0; }
.vela-lm-recent .vela-lm-label { display: block; }
.vela-lm-sub { margin-top: 2px; color: var(--vela-fg-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-lm-recent[data-current='1'] { background: var(--vela-hover-strong); }
.vela-lm-error { padding: 6px 16px; color: var(--vela-danger); font-size: 12px; }
.vela-lm-switch {
    all: unset;
    position: relative;
    flex: none;
    width: 34px;
    height: 18px;
    border-radius: 9px;
    background: var(--vela-hover);
    border: 1px solid var(--vela-border-soft);
    transition: background 0.16s ease, border-color 0.16s ease;
}
.vela-lm-switch::after {
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
.vela-lm-switch[aria-checked='true'] { background: var(--vela-selected-bg); border-color: var(--vela-selected-bg); }
.vela-lm-switch[aria-checked='true']::after { transform: translateX(16px); background: var(--vela-selected-fg); }
`;

export interface LayoutsMenuOptions {
    /** Positioning/theming host (the widget root — the panel portals inside it). */
    host: HTMLElement;
    actions: LayoutsActions;
    /** Time zone the Layouts dialog shows "last saved" in. */
    zone?: () => string | undefined;
    /** Download the chart's loaded bars as a file. */
    onDownload: () => void;
    onOpenChange?: (open: boolean) => void;
}

export class LayoutsMenu {
    private readonly opts: LayoutsMenuOptions;
    private readonly doc: Document;
    private readonly layer: HTMLElement;
    private readonly panel: HTMLElement;
    /** Built on first use — a kit dialog puts its (hidden) DOM in the host as soon as it exists. */
    private dialog: LayoutsDialog | null = null;
    private anchor: HTMLElement | null = null;
    private unsub: (() => void) | null = null;

    private readonly onDocPointerDown = (e: Event): void => {
        const t = e.target as Node | null;
        if (t && (this.layer.contains(t) || this.anchor?.contains(t))) return;
        this.close();
    };
    private readonly onDocKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') this.close();
    };

    constructor(opts: LayoutsMenuOptions) {
        this.opts = opts;
        this.doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, this.doc);
        this.layer = this.doc.createElement('div');
        this.layer.className = 'vela-ui-layer vela-lm-layer';
        this.panel = this.doc.createElement('div');
        this.panel.className = 'vela-lm';
        this.panel.setAttribute('role', 'menu');
        this.layer.appendChild(this.panel);
    }

    get isOpen(): boolean {
        return this.layer.isConnected;
    }

    toggle(anchor: HTMLElement): void {
        if (this.isOpen) this.close();
        else this.open(anchor);
    }

    open(anchor: HTMLElement): void {
        if (this.isOpen) return;
        this.anchor = anchor;
        this.opts.host.appendChild(this.layer);
        this.render(this.opts.actions.status());
        this.position();
        anchor.setAttribute('aria-expanded', 'true');
        this.unsub = this.opts.actions.subscribe((s) => this.render(s));
        this.doc.addEventListener('pointerdown', this.onDocPointerDown, true);
        this.doc.addEventListener('keydown', this.onDocKeydown, true);
        this.opts.onOpenChange?.(true);
        void this.opts.actions.refresh();
    }

    close(): void {
        if (!this.isOpen) return;
        this.layer.remove();
        this.anchor?.setAttribute('aria-expanded', 'false');
        this.unsub?.();
        this.unsub = null;
        this.doc.removeEventListener('pointerdown', this.onDocPointerDown, true);
        this.doc.removeEventListener('keydown', this.onDocKeydown, true);
        this.opts.onOpenChange?.(false);
    }

    destroy(): void {
        this.close();
        this.dialog?.destroy();
    }

    private openDialog(): void {
        this.dialog ??= new LayoutsDialog({ host: this.opts.host, actions: this.opts.actions, zone: this.opts.zone });
        this.dialog.open();
    }

    private row(icon: string | null, label: string, onClick: () => void, disabled = false): HTMLElement {
        const el = this.doc.createElement('div');
        el.className = 'vela-lm-item';
        el.setAttribute('role', 'menuitem');
        if (disabled) el.dataset.disabled = '';
        if (icon) el.appendChild(iconEl(icon, this.doc));
        const text = this.doc.createElement('span');
        text.className = 'vela-lm-label';
        text.textContent = label;
        el.appendChild(text);
        el.addEventListener('click', () => {
            if (!disabled) onClick();
        });
        return el;
    }

    private sep(): HTMLElement {
        const el = this.doc.createElement('div');
        el.className = 'vela-lm-sep';
        el.setAttribute('role', 'separator');
        return el;
    }

    private render(status: LayoutsStatus): void {
        const { actions } = this.opts;
        const cur = status.current;
        const run = (fn: () => void | Promise<unknown>) => () => {
            this.close();
            void fn();
        };

        const autosave = this.row(null, 'Autosave', () => actions.setAutosave(!actions.status().autosave));
        const sw = this.doc.createElement('button');
        sw.type = 'button';
        sw.className = 'vela-lm-switch';
        sw.tabIndex = -1;
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(status.autosave));
        autosave.appendChild(sw);

        const recents = recentLayouts(status.layouts).map((l) => {
            const el = this.doc.createElement('div');
            el.className = 'vela-lm-item vela-lm-recent';
            el.setAttribute('role', 'menuitem');
            if (cur?.id === l.id) el.dataset.current = '1';
            const text = this.doc.createElement('span');
            text.className = 'vela-lm-text';
            const name = this.doc.createElement('span');
            name.className = 'vela-lm-label';
            name.textContent = l.name;
            const sub = this.doc.createElement('div');
            sub.className = 'vela-lm-sub';
            sub.textContent = layoutSubtitle(l);
            text.append(name, sub);
            el.appendChild(text);
            el.addEventListener('click', run(async () => {
                if (cur?.id === l.id) return;
                if (await confirmLeave(actions, this.opts.host, 'open')) await actions.open(l.id);
            }));
            return el;
        });

        const nodes: HTMLElement[] = [
            this.row('save', 'Save layout', run(async () => {
                if (cur) return void (await actions.save());
                const name = await promptName({ host: this.opts.host, title: 'Save layout', value: '', confirmLabel: 'Save' });
                if (name !== null) await actions.save(name);
            })),
            autosave,
            this.row('copy', 'Make a copy…', run(async () => {
                const name = await promptName({ host: this.opts.host, title: 'Make a copy', value: `${cur?.name ?? ''} (copy)` });
                if (name !== null) await actions.makeCopy(name);
            }), !cur),
            this.row('pen', 'Rename…', run(async () => {
                const name = await promptName({ host: this.opts.host, title: 'Rename layout', value: cur?.name ?? '', confirmLabel: 'Rename' });
                if (name !== null) await actions.rename(name);
            }), !cur),
            this.row('download', 'Download chart data…', run(() => this.opts.onDownload())),
            this.sep(),
            this.row('plus', 'Create new layout…', run(async () => {
                const name = await promptName({ host: this.opts.host, title: 'Create new layout', value: 'Unnamed', confirmLabel: 'Create' });
                if (name === null) return;
                if (await confirmLeave(actions, this.opts.host, 'create')) await actions.createNew(name);
            })),
            this.sep(),
        ];
        if (recents.length > 0) {
            const heading = this.doc.createElement('div');
            heading.className = 'vela-lm-heading';
            heading.textContent = 'Recently used';
            nodes.push(heading, ...recents, this.sep());
        }
        nodes.push(this.row('folder', 'Open layout…', run(() => this.openDialog())));
        if (status.error) {
            const err = this.doc.createElement('div');
            err.className = 'vela-lm-error';
            err.textContent = status.error;
            nodes.push(err);
        }
        this.panel.replaceChildren(...nodes);
    }

    /** Anchor under the trigger, clamped to the host's right edge. */
    private position(): void {
        if (!this.anchor) return;
        const hostRect = this.opts.host.getBoundingClientRect();
        const trigRect = this.anchor.getBoundingClientRect();
        let left = trigRect.left - hostRect.left;
        const top = trigRect.bottom - hostRect.top + 4;
        const width = this.layer.offsetWidth || 300;
        if (left + width > hostRect.width - 8) left = Math.max(8, hostRect.width - 8 - width);
        this.layer.style.left = `${left}px`;
        this.layer.style.top = `${top}px`;
    }
}
