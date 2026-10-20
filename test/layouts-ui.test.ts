// @vitest-environment jsdom
// The "Manage layouts" menu and the "Layouts" dialog as a user drives them, against a fake shell.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { LayoutsMenu } from '../src/widget/layouts-menu';
import { LayoutsDialog } from '../src/widget/layouts-dialog';
import type { LayoutsActions, LayoutsStatus, LayoutSummary, LayoutTemplate, LayoutTemplates } from '../src/widget/layouts-model';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

const T = Date.UTC(2026, 8, 29, 19, 56);
const L = (id: string, name: string, symbol: string, timeframe: string, opened = 0): LayoutSummary => ({ id, name, symbol, timeframe, saved: T, opened });
const LAYOUTS = [L('a', 'Morning SPY', 'SPY', '10', 5), L('b', 'NVDA earnings', 'NVDA', '5', 4), L('c', 'Daily view', 'QQQ', 'D', 3), L('d', 'Layout 2', 'SPX', '5', 2), L('e', 'Layout 10', 'SPX', '60', 1)];

function fake(over: Partial<LayoutsStatus> = {}, confirmNeeded = false) {
    let status: LayoutsStatus = { current: LAYOUTS[0]!, dirty: false, autosave: true, busy: false, error: null, layouts: LAYOUTS, ...over };
    const subs = new Set<(s: LayoutsStatus) => void>();
    const actions = {
        status: () => status,
        subscribe: (fn: (s: LayoutsStatus) => void) => {
            subs.add(fn);
            return () => subs.delete(fn);
        },
        requiresConfirm: vi.fn(() => confirmNeeded),
        setAutosave: vi.fn(),
        refresh: vi.fn(async () => true),
        save: vi.fn(async () => true),
        makeCopy: vi.fn(async () => true),
        rename: vi.fn(async () => true),
        createNew: vi.fn(async () => true),
        open: vi.fn(async () => true),
        remove: vi.fn(async () => true),
    } satisfies LayoutsActions;
    const push = (next: Partial<LayoutsStatus>): void => {
        status = { ...status, ...next };
        for (const fn of subs) fn(status);
    };
    return { actions, push, subs };
}

const qa = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const q = (sel: string): HTMLElement => document.querySelector<HTMLElement>(sel)!;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10));
const button = (text: string): HTMLButtonElement => qa('button').find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const write = (el: HTMLInputElement, text: string): void => {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
};
const item = (label: string): HTMLElement => qa('.vela-lm-item').find((i) => i.querySelector('.vela-lm-label')?.textContent === label)!;

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const c of cleanups.splice(0)) c();
    document.body.innerHTML = '';
});

function makeMenu(f = fake(), extra: Partial<ConstructorParameters<typeof LayoutsMenu>[0]> = {}) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const anchor = document.createElement('button');
    host.appendChild(anchor);
    const onDownload = vi.fn();
    const menu = new LayoutsMenu({ host, actions: f.actions, zone: () => 'UTC', onDownload, ...extra });
    cleanups.push(() => menu.destroy());
    return { menu, host, anchor, onDownload, ...f };
}

describe('the Manage layouts menu', () => {
    it('lists the actions in order, then recently used, then Open layout…', () => {
        const { menu, anchor } = makeMenu();
        menu.toggle(anchor);
        expect(qa('.vela-lm-item').map((i) => i.querySelector('.vela-lm-label')!.textContent)).toEqual([
            'Save layout',
            'Autosave',
            'Make a copy…',
            'Rename…',
            'Download chart data…',
            'Create new layout…',
            'Morning SPY',
            'NVDA earnings',
            'Daily view',
            'Layout 2',
            'Open layout…',
        ]);
        expect(q('.vela-lm-heading').textContent).toBe('Recently used');
        expect(anchor.getAttribute('aria-expanded')).toBe('true');
    });

    it('shows symbol and timeframe under each recent name, and marks the current one', () => {
        const { menu, anchor } = makeMenu();
        menu.toggle(anchor);
        const recent = qa('.vela-lm-recent');
        expect(recent).toHaveLength(4);
        expect(recent[0]!.querySelector('.vela-lm-sub')!.textContent).toBe('SPY, 10');
        expect(recent[0]!.dataset.current).toBe('1');
        expect(recent[1]!.dataset.current).toBeUndefined();
    });

    it('toggles closed on a second click, on Escape and on a press outside', () => {
        const { menu, anchor } = makeMenu();
        menu.toggle(anchor);
        menu.toggle(anchor);
        expect(q('.vela-lm')).toBeNull();
        expect(anchor.getAttribute('aria-expanded')).toBe('false');
        menu.toggle(anchor);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(q('.vela-lm')).toBeNull();
        menu.toggle(anchor);
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(q('.vela-lm')).toBeNull();
    });

    it('Save layout saves the current layout and closes', () => {
        const { menu, anchor, actions } = makeMenu();
        menu.toggle(anchor);
        item('Save layout').click();
        expect(actions.save).toHaveBeenCalledWith();
        expect(q('.vela-lm')).toBeNull();
    });

    it('Save layout on an unsaved chart asks for a name first', async () => {
        const { menu, anchor, actions } = makeMenu(fake({ current: null, dirty: true }));
        menu.toggle(anchor);
        item('Save layout').click();
        await flush();
        expect(document.querySelector('.vela-dialog-title')!.textContent).toBe('Save layout');
        write(document.querySelector<HTMLInputElement>('input[type="text"]')!, 'Fresh');
        button('Save').click();
        await flush();
        expect(actions.save).toHaveBeenCalledWith('Fresh');
    });

    it('the Autosave switch flips autosave and keeps the menu open', () => {
        const { menu, anchor, actions } = makeMenu();
        menu.toggle(anchor);
        const sw = item('Autosave').querySelector<HTMLElement>('[role="switch"]')!;
        expect(sw.getAttribute('aria-checked')).toBe('true');
        item('Autosave').click();
        expect(actions.setAutosave).toHaveBeenCalledWith(false);
        expect(q('.vela-lm')).not.toBeNull();
    });

    it('the Autosave switch follows the status', () => {
        const { menu, anchor, push } = makeMenu(fake({ autosave: false }));
        menu.toggle(anchor);
        const sw = (): HTMLElement => item('Autosave').querySelector<HTMLElement>('[role="switch"]')!;
        expect(sw().getAttribute('aria-checked')).toBe('false');
        push({ autosave: true });
        expect(sw().getAttribute('aria-checked')).toBe('true');
    });

    it('Make a copy asks for a name proposed from the current one', async () => {
        const { menu, anchor, actions } = makeMenu();
        menu.toggle(anchor);
        item('Make a copy…').click();
        await flush();
        const field = document.querySelector<HTMLInputElement>('input[type="text"]')!;
        expect(field.value).toBe('Morning SPY (copy)');
        write(field, 'SPY b');
        button('OK').click();
        await flush();
        expect(actions.makeCopy).toHaveBeenCalledWith('SPY b');
    });

    it('cancelling the name prompt does nothing', async () => {
        const { menu, anchor, actions } = makeMenu();
        menu.toggle(anchor);
        item('Rename…').click();
        await flush();
        button('Cancel').click();
        await flush();
        expect(actions.rename).not.toHaveBeenCalled();
    });

    it('Rename starts from the current name', async () => {
        const { menu, anchor, actions } = makeMenu();
        menu.toggle(anchor);
        item('Rename…').click();
        await flush();
        const field = document.querySelector<HTMLInputElement>('input[type="text"]')!;
        expect(field.value).toBe('Morning SPY');
        write(field, 'Open drive');
        button('Rename').click();
        await flush();
        expect(actions.rename).toHaveBeenCalledWith('Open drive');
    });

    it('Rename and Make a copy are unavailable while the chart has no saved layout', () => {
        const { menu, anchor } = makeMenu(fake({ current: null }));
        menu.toggle(anchor);
        expect(item('Rename…').hasAttribute('data-disabled')).toBe(true);
        expect(item('Make a copy…').hasAttribute('data-disabled')).toBe(true);
        item('Rename…').click();
        expect(document.querySelector('.vela-dialog')).toBeNull();
    });

    it('Download chart data calls the host and closes', () => {
        const { menu, anchor, onDownload } = makeMenu();
        menu.toggle(anchor);
        item('Download chart data…').click();
        expect(onDownload).toHaveBeenCalledTimes(1);
        expect(q('.vela-lm')).toBeNull();
    });

    it('Create new layout asks for a name, then creates', async () => {
        const { menu, anchor, actions } = makeMenu();
        menu.toggle(anchor);
        item('Create new layout…').click();
        await flush();
        expect(document.querySelector('.vela-dialog-title')!.textContent).toBe('Create new layout');
        write(document.querySelector<HTMLInputElement>('input[type="text"]')!, 'Scratch');
        button('Create').click();
        await flush();
        expect(actions.createNew).toHaveBeenCalledWith('Scratch');
    });

    it('opens a recent layout on click', async () => {
        const { menu, anchor, actions } = makeMenu();
        menu.toggle(anchor);
        item('NVDA earnings').click();
        await flush();
        expect(actions.open).toHaveBeenCalledWith('b');
        expect(q('.vela-lm')).toBeNull();
    });

    it('clicking the current layout in the list just closes', async () => {
        const { menu, anchor, actions } = makeMenu();
        menu.toggle(anchor);
        item('Morning SPY').click();
        await flush();
        expect(actions.open).not.toHaveBeenCalled();
        expect(q('.vela-lm')).toBeNull();
    });

    it('warns before leaving unsaved changes, and stays put on "keep"', async () => {
        const { menu, anchor, actions } = makeMenu(fake({ dirty: true, autosave: false }, true));
        menu.toggle(anchor);
        item('NVDA earnings').click();
        await flush();
        expect(document.querySelector('.vela-lay-prompt-message')!.textContent).toMatch(/unsaved changes/i);
        expect(actions.open).not.toHaveBeenCalled();
        button('Cancel').click();
        await flush();
        expect(actions.open).not.toHaveBeenCalled();
        menu.toggle(anchor);
        item('NVDA earnings').click();
        await flush();
        button('Discard and open').click();
        await flush();
        expect(actions.open).toHaveBeenCalledWith('b');
    });

    it('Open layout… opens the Layouts dialog', async () => {
        const { menu, anchor, actions } = makeMenu();
        menu.toggle(anchor);
        item('Open layout…').click();
        await flush();
        expect(q('.vela-lm')).toBeNull();
        expect(document.querySelector('.vela-dialog-title')!.textContent).toBe('Layouts');
        expect(actions.refresh).toHaveBeenCalled();
    });

    it('re-renders while open when the layouts change, and stops listening once closed', () => {
        const { menu, anchor, push, subs } = makeMenu();
        menu.toggle(anchor);
        expect(subs.size).toBe(1);
        push({ layouts: [L('z', 'Only one', 'IWM', '15', 9)], current: null });
        expect(qa('.vela-lm-recent').map((r) => r.querySelector('.vela-lm-label')!.textContent)).toEqual(['Only one']);
        menu.toggle(anchor);
        expect(subs.size).toBe(0);
    });

    it('shows the last store error inside the menu', () => {
        const { menu, anchor } = makeMenu(fake({ error: 'layouts: 500' }));
        menu.toggle(anchor);
        expect(q('.vela-lm-error').textContent).toBe('layouts: 500');
    });

    it('omits "Recently used" until there is a layout', () => {
        const { menu, anchor } = makeMenu(fake({ layouts: [], current: null }));
        menu.toggle(anchor);
        expect(q('.vela-lm-heading')).toBeNull();
    });
});

function makeDialog(f = fake(), templates?: LayoutTemplates) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dialog = new LayoutsDialog({ host, actions: f.actions, zone: () => 'UTC', templates });
    cleanups.push(() => dialog.destroy());
    dialog.open();
    return { dialog, host, ...f };
}
const rows = (): HTMLElement[] => qa('.vela-ld-row');
const names = (): string[] => rows().map((r) => r.querySelector('.vela-ld-name')!.textContent!);

describe('the Layouts dialog', () => {
    it('lists every layout with its symbol, timeframe and last-saved time', () => {
        makeDialog();
        expect(document.querySelector('.vela-dialog-title')!.textContent).toBe('Layouts');
        expect(rows()).toHaveLength(5);
        const first = rows().find((r) => r.querySelector('.vela-ld-name')!.textContent === 'Morning SPY')!;
        expect(first.querySelector('.vela-ld-detail')!.textContent).toBe('SPY, 10m (Sep 29, 2026, 19:56)');
    });

    it('starts sorted by name, and the sort button reverses it', () => {
        makeDialog();
        expect(names()).toEqual(['Daily view', 'Layout 2', 'Layout 10', 'Morning SPY', 'NVDA earnings']);
        (q('.vela-ld-sort') as HTMLButtonElement).click();
        expect(names()).toEqual(['NVDA earnings', 'Morning SPY', 'Layout 10', 'Layout 2', 'Daily view']);
    });

    it('filters as you type by name, symbol or timeframe', () => {
        makeDialog();
        const search = q('.vela-ld-search input') as HTMLInputElement;
        write(search, 'nvda');
        expect(names()).toEqual(['NVDA earnings']);
        write(search, 'spx 1h');
        expect(names()).toEqual(['Layout 10']);
        write(search, 'zzz');
        expect(names()).toEqual([]);
        expect(q('.vela-ld-empty').textContent).toBe('No layouts match "zzz"');
    });

    it('marks the current layout', () => {
        makeDialog();
        const cur = rows().filter((r) => r.dataset.current === '1');
        expect(cur.map((r) => r.querySelector('.vela-ld-name')!.textContent)).toEqual(['Morning SPY']);
    });

    it('a row opens that layout and closes the dialog', async () => {
        const { actions, dialog } = makeDialog();
        rows()[0]!.click(); // Daily view
        await flush();
        expect(actions.open).toHaveBeenCalledWith('c');
        expect(dialog.isOpen).toBe(false);
    });

    it('the current row only closes', async () => {
        const { actions, dialog } = makeDialog();
        await flush();
        rows().find((r) => r.dataset.current === '1')!.click();
        await flush();
        expect(actions.open).not.toHaveBeenCalled();
        expect(dialog.isOpen).toBe(false);
    });

    it('warns before leaving unsaved changes', async () => {
        const { actions } = makeDialog(fake({ dirty: true, autosave: false }, true));
        rows()[0]!.click();
        await flush();
        expect(document.querySelector('.vela-lay-prompt-message')!.textContent).toMatch(/unsaved changes/i);
        button('Discard and open').click();
        await flush();
        expect(actions.open).toHaveBeenCalledWith('c');
    });

    it('deletes after a confirmation naming the layout, without opening it', async () => {
        const { actions } = makeDialog();
        const row = rows()[0]!; // Daily view
        (row.querySelector('.vela-ld-delete') as HTMLElement).click();
        await flush();
        expect(actions.open).not.toHaveBeenCalled();
        expect(document.querySelector('.vela-lay-prompt-message')!.textContent).toContain('Daily view');
        button('Delete').click();
        await flush();
        expect(actions.remove).toHaveBeenCalledWith('c');
    });

    it('keeps the layout when the deletion is cancelled', async () => {
        const { actions } = makeDialog();
        (rows()[0]!.querySelector('.vela-ld-delete') as HTMLElement).click();
        await flush();
        button('Cancel').click();
        await flush();
        expect(actions.remove).not.toHaveBeenCalled();
    });

    it('follows the list while open (a deletion, a save elsewhere)', () => {
        const { push } = makeDialog();
        push({ layouts: LAYOUTS.slice(0, 2) });
        expect(names()).toEqual(['Morning SPY', 'NVDA earnings']);
    });

    it('says so when there are no layouts yet', () => {
        makeDialog(fake({ layouts: [], current: null }));
        expect(q('.vela-ld-empty').textContent).toBe('No saved layouts yet');
    });

    it('refreshes the list when it opens', () => {
        const { actions } = makeDialog();
        expect(actions.refresh).toHaveBeenCalledTimes(1);
    });

    it('stops listening when it closes', () => {
        const { dialog, subs } = makeDialog();
        expect(subs.size).toBe(1);
        dialog.close();
        expect(subs.size).toBe(0);
    });
});

const tpl = (id: string, name: string, description: string) => ({ id, name, description, open: vi.fn<() => void>() }) satisfies LayoutTemplate;
function templates(active?: string) {
    const list = [tpl('default', 'Default', 'One chart'), tpl('multi', 'Multi', '2×2 · 10m / 1h / D / 5m'), tpl('dt', 'DT Charts', '10m · 1h · D, light'), tpl('casey', 'Casey', 'Left 2m EMA 13/48/200 · right 15m levels · SPX/SPY/QQQ/IWM')];
    return { list, active, byId: (id: string) => list.find((t) => t.id === id)! };
}
const templateRows = (): HTMLElement[] => qa('.vela-ld-row[data-template]');
const savedNames = (): string[] => qa('.vela-ld-row:not([data-template]) .vela-ld-name').map((n) => n.textContent!);
const headings = (): string[] => qa('.vela-ld-heading').map((h) => h.textContent!);

describe('layout templates in the Layouts dialog', () => {
    it('lists the templates first, in the host order, with their descriptions, then the saved layouts', () => {
        makeDialog(fake(), templates());
        expect(headings()).toEqual(['Templates', 'Saved layouts']);
        expect(templateRows().map((r) => r.querySelector('.vela-ld-name')!.textContent)).toEqual(['Default', 'Multi', 'DT Charts', 'Casey']);
        expect(templateRows()[3]!.querySelector('.vela-ld-detail')!.textContent).toBe('Left 2m EMA 13/48/200 · right 15m levels · SPX/SPY/QQQ/IWM');
        expect(savedNames()).toEqual(['Daily view', 'Layout 2', 'Layout 10', 'Morning SPY', 'NVDA earnings']);
        const list = q('.vela-ld-list');
        expect(list.children[0]!.textContent).toBe('Templates');
        expect([...list.children].indexOf(qa('.vela-ld-heading')[1]!)).toBe(5);
    });

    it('still shows the templates when there are no saved layouts; "No saved layouts yet" sits under Saved layouts', () => {
        makeDialog(fake({ layouts: [], current: null }), templates('default'));
        expect(templateRows()).toHaveLength(4);
        const list = [...q('.vela-ld-list').children];
        expect(list[list.length - 2]!.textContent).toBe('Saved layouts');
        expect(list[list.length - 1]!.textContent).toBe('No saved layouts yet');
        expect(qa('.vela-ld-empty')).toHaveLength(1);
    });

    it('template rows are read-only: no trash button', () => {
        makeDialog(fake(), templates());
        expect(templateRows().every((r) => r.querySelector('.vela-ld-delete') === null)).toBe(true);
        expect(qa('.vela-ld-delete')).toHaveLength(5);
    });

    it('search covers templates and saved layouts together', () => {
        makeDialog(fake(), templates());
        const search = q('.vela-ld-search input') as HTMLInputElement;
        write(search, 'casey');
        expect(templateRows().map((r) => r.dataset.template)).toEqual(['casey']);
        expect(q('.vela-ld-empty').textContent).toBe('No layouts match "casey"');
        write(search, 'spx');
        expect(templateRows().map((r) => r.dataset.template)).toEqual(['casey']);
        expect(savedNames()).toEqual(['Layout 2', 'Layout 10']);
        write(search, 'nvda');
        expect(templateRows()).toEqual([]);
        expect(headings()).toEqual(['Saved layouts']);
        expect(savedNames()).toEqual(['NVDA earnings']);
    });

    it('sorting reorders the saved layouts only', () => {
        makeDialog(fake(), templates());
        (q('.vela-ld-sort') as HTMLButtonElement).click();
        expect(templateRows().map((r) => r.dataset.template)).toEqual(['default', 'multi', 'dt', 'casey']);
        expect(savedNames()[0]).toBe('NVDA earnings');
    });

    it('highlights the active template while no saved layout is current', () => {
        const { push } = makeDialog(fake({ current: null }), templates('casey'));
        expect(templateRows().filter((r) => r.dataset.current === '1').map((r) => r.dataset.template)).toEqual(['casey']);
        expect(qa('.vela-ld-row[data-current="1"]')).toHaveLength(1);
        push({ current: LAYOUTS[0]! }); // a saved layout was opened (or the template saved under a name)
        expect(templateRows().filter((r) => r.dataset.current === '1')).toEqual([]);
        expect(qa('.vela-ld-row[data-current="1"] .vela-ld-name').map((n) => n.textContent)).toEqual(['Morning SPY']);
    });

    it('a template row calls its open() and closes the dialog — nothing goes through the store', async () => {
        const t = templates();
        const { actions, dialog } = makeDialog(fake(), t);
        templateRows()[3]!.click();
        await flush();
        expect(t.byId('casey').open).toHaveBeenCalledTimes(1);
        expect(dialog.isOpen).toBe(false);
        for (const fn of [actions.open, actions.save, actions.makeCopy, actions.rename, actions.createNew, actions.remove]) expect(fn).not.toHaveBeenCalled();
    });

    it('opens from the keyboard too', async () => {
        const t = templates();
        makeDialog(fake(), t);
        templateRows()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await flush();
        expect(t.byId('multi').open).toHaveBeenCalledTimes(1);
    });

    it('the active template only closes', async () => {
        const t = templates('casey');
        const { dialog } = makeDialog(fake({ current: null }), t);
        await flush();
        templateRows()[3]!.click();
        await flush();
        expect(t.byId('casey').open).not.toHaveBeenCalled();
        expect(dialog.isOpen).toBe(false);
    });

    it('warns before leaving unsaved changes, and stays put on "keep"', async () => {
        const t = templates();
        makeDialog(fake({ dirty: true, autosave: false }, true), t);
        templateRows()[3]!.click();
        await flush();
        expect(document.querySelector('.vela-lay-prompt-message')!.textContent).toMatch(/unsaved changes/i);
        button('Cancel').click();
        await flush();
        expect(t.byId('casey').open).not.toHaveBeenCalled();
        templateRows()[3]!.click();
        await flush();
        button('Discard and open').click();
        await flush();
        expect(t.byId('casey').open).toHaveBeenCalledTimes(1);
    });

    it('without templates the dialog has no headings', () => {
        makeDialog(fake(), { list: [] });
        expect(headings()).toEqual([]);
        expect(rows()).toHaveLength(5);
    });
});

describe('layout templates in the Manage layouts menu', () => {
    const labels = (): string[] => qa('.vela-lm-item').map((i) => i.querySelector('.vela-lm-label')!.textContent!);

    it('lists them under "Templates", after recently used and before Open layout…', () => {
        const { menu, anchor } = makeMenu(fake(), { templates: templates() });
        menu.toggle(anchor);
        expect(qa('.vela-lm-heading').map((h) => h.textContent)).toEqual(['Recently used', 'Templates']);
        expect(labels().slice(-5)).toEqual(['Default', 'Multi', 'DT Charts', 'Casey', 'Open layout…']);
        expect(qa('.vela-lm-template[data-template="casey"]')[0]!.title).toContain('EMA 13/48/200');
    });

    it('shows them even with no saved layouts, and marks the active one', () => {
        const { menu, anchor } = makeMenu(fake({ layouts: [], current: null }), { templates: templates('dt') });
        menu.toggle(anchor);
        expect(qa('.vela-lm-heading').map((h) => h.textContent)).toEqual(['Templates']);
        expect(qa('.vela-lm-template[data-current="1"]').map((e) => e.dataset.template)).toEqual(['dt']);
    });

    it('a template opens through its open() and closes the menu', async () => {
        const t = templates();
        const { menu, anchor, actions } = makeMenu(fake(), { templates: t });
        menu.toggle(anchor);
        item('Casey').click();
        await flush();
        expect(t.byId('casey').open).toHaveBeenCalledTimes(1);
        expect(actions.open).not.toHaveBeenCalled();
        expect(menu.isOpen).toBe(false);
    });

    it('Open layout… hands the templates to the dialog', async () => {
        const { menu, anchor } = makeMenu(fake(), { templates: templates() });
        menu.toggle(anchor);
        item('Open layout…').click();
        await flush();
        expect(templateRows()).toHaveLength(4);
    });
});
