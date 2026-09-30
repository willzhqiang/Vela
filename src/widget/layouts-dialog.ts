// The "Layouts" dialog — every saved layout in one searchable, sortable list. A row opens that
// layout; the trash button (shown on hover) deletes it after a confirmation.
import { Dialog } from '../ui/components/dialog';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { filterLayouts, layoutDetail, sortLayouts, type LayoutsActions, type LayoutsStatus } from './layouts-model';
import { confirmAction, confirmLeave } from './layouts-prompts';

const STYLE_ID = 'vela-widget-layouts-dialog';
const CSS = `
.vela-ld { width: 480px; max-width: calc(100vw - 32px); }
.vela-ld .vela-dialog-body { display: flex; flex-direction: column; gap: 10px; padding: 12px 0 8px; }
.vela-ld-tools { display: flex; align-items: center; gap: 8px; padding: 0 16px; }
.vela-ld-search {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 10px;
    border: 1px solid var(--vela-border-strong);
    border-radius: 8px;
    color: var(--vela-fg-muted);
}
.vela-ld-search:focus-within { border-color: var(--vela-focus); }
.vela-ld-search input { all: unset; flex: 1 1 auto; min-width: 0; color: var(--vela-fg-bright); font-size: 14px; }
.vela-ld-search input::placeholder { color: var(--vela-fg-faint); }
.vela-ld-sort {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    color: var(--vela-fg-muted);
    cursor: pointer;
}
.vela-ld-sort:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-ld-sort[data-dir='desc'] .vela-icon { transform: scaleY(-1); }
.vela-ld-list { display: flex; flex-direction: column; height: 340px; overflow-y: auto; }
.vela-ld-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    padding: 8px 16px;
    cursor: pointer;
}
.vela-ld-row:hover { background: var(--vela-hover); }
.vela-ld-row[data-current='1'] { background: var(--vela-hover-strong); }
.vela-ld-text { flex: 1 1 auto; min-width: 0; }
.vela-ld-name { color: var(--vela-fg-bright); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-ld-detail { margin-top: 2px; color: var(--vela-fg-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-ld-delete {
    all: unset;
    box-sizing: border-box;
    display: none;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--vela-fg-muted);
    cursor: pointer;
}
.vela-ld-row:hover .vela-ld-delete, .vela-ld-delete:focus-visible { display: inline-flex; }
.vela-ld-delete:hover { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-ld-empty { padding: 32px 16px; text-align: center; color: var(--vela-fg-muted); font-size: 14px; }
`;

export interface LayoutsDialogOptions {
    host: HTMLElement;
    actions: LayoutsActions;
    /** Time zone the "last saved" times are shown in. */
    zone?: () => string | undefined;
}

export class LayoutsDialog {
    private readonly opts: LayoutsDialogOptions;
    private readonly dialog: Dialog;
    private readonly searchEl: HTMLInputElement;
    private readonly sortBtn: HTMLButtonElement;
    private readonly listEl: HTMLElement;
    private dir: 'asc' | 'desc' = 'asc';
    private query = '';
    private unsub: (() => void) | null = null;

    constructor(opts: LayoutsDialogOptions) {
        this.opts = opts;
        const doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);

        const search = doc.createElement('label');
        search.className = 'vela-ld-search';
        this.searchEl = doc.createElement('input');
        this.searchEl.type = 'text';
        this.searchEl.placeholder = 'Search';
        this.searchEl.autocomplete = 'off';
        this.searchEl.spellcheck = false;
        this.searchEl.setAttribute('aria-label', 'Search layouts');
        this.searchEl.addEventListener('input', () => {
            this.query = this.searchEl.value;
            this.render();
        });
        search.append(iconEl('search', doc), this.searchEl);

        this.sortBtn = doc.createElement('button');
        this.sortBtn.type = 'button';
        this.sortBtn.className = 'vela-ld-sort';
        this.sortBtn.setAttribute('aria-label', 'Sort by name');
        this.sortBtn.append(iconEl('sort', doc));
        this.sortBtn.dataset.dir = this.dir;
        this.sortBtn.addEventListener('click', () => {
            this.dir = this.dir === 'asc' ? 'desc' : 'asc';
            this.sortBtn.dataset.dir = this.dir;
            this.render();
        });

        const tools = doc.createElement('div');
        tools.className = 'vela-ld-tools';
        tools.append(search, this.sortBtn);
        this.listEl = doc.createElement('div');
        this.listEl.className = 'vela-ld-list';

        this.dialog = new Dialog({
            title: 'Layouts',
            host: opts.host,
            draggable: true,
            closeOnInteractOutside: true,
            className: 'vela-dialog--form vela-ld',
            // Always a node: a prompt opened over this dialog hands focus back to it when it closes.
            initialFocusEl: () => this.searchEl,
            content: (body) => body.append(tools, this.listEl),
            onOpenChange: (open) => {
                if (!open) this.unlisten();
            },
        });
    }

    get isOpen(): boolean {
        return this.dialog.open;
    }

    open(): void {
        this.query = '';
        this.searchEl.value = '';
        this.dialog.show();
        this.unlisten();
        this.unsub = this.opts.actions.subscribe(() => this.render());
        this.render();
        void this.opts.actions.refresh();
        setTimeout(() => this.searchEl.focus(), 0);
    }

    close(): void {
        this.unlisten();
        this.dialog.hide();
    }

    destroy(): void {
        this.unlisten();
        this.dialog.destroy();
    }

    private unlisten(): void {
        this.unsub?.();
        this.unsub = null;
    }

    private render(): void {
        const doc = this.opts.host.ownerDocument;
        const status: LayoutsStatus = this.opts.actions.status();
        const shown = sortLayouts(filterLayouts(status.layouts, this.query), this.dir);
        if (shown.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-ld-empty';
            empty.textContent = status.layouts.length === 0 ? 'No saved layouts yet' : `No layouts match "${this.query.trim()}"`;
            this.listEl.replaceChildren(empty);
            return;
        }
        const zone = this.opts.zone?.();
        this.listEl.replaceChildren(
            ...shown.map((l) => {
                const row = doc.createElement('div');
                row.className = 'vela-ld-row';
                row.setAttribute('role', 'button');
                row.tabIndex = 0;
                if (status.current?.id === l.id) row.dataset.current = '1';
                const text = doc.createElement('div');
                text.className = 'vela-ld-text';
                const name = doc.createElement('div');
                name.className = 'vela-ld-name';
                name.textContent = l.name;
                const detail = doc.createElement('div');
                detail.className = 'vela-ld-detail';
                detail.textContent = layoutDetail(l, zone);
                text.append(name, detail);
                const del = doc.createElement('button');
                del.type = 'button';
                del.className = 'vela-ld-delete';
                del.setAttribute('aria-label', `Delete layout ${l.name}`);
                del.append(iconEl('trash', doc));
                del.addEventListener('click', (e) => {
                    e.stopPropagation();
                    void this.confirmDelete(l.id, l.name);
                });
                row.append(text, del);
                row.addEventListener('click', () => void this.choose(l.id, status.current?.id === l.id));
                row.addEventListener('keydown', (e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    void this.choose(l.id, status.current?.id === l.id);
                });
                return row;
            }),
        );
    }

    private async choose(id: string, isCurrent: boolean): Promise<void> {
        if (isCurrent) {
            this.close();
            return;
        }
        if (!(await confirmLeave(this.opts.actions, this.opts.host, 'open'))) return;
        this.close();
        await this.opts.actions.open(id);
    }

    private async confirmDelete(id: string, name: string): Promise<void> {
        const ok = await confirmAction({ host: this.opts.host, title: 'Delete layout', message: `Delete the layout "${name}"? This cannot be undone.`, confirmLabel: 'Delete', danger: true });
        if (ok) await this.opts.actions.remove(id);
    }
}
