// @vitest-environment jsdom
// The layout dropdown as a user drives it: windows grouped by count, a little diagram per arrangement,
// the current one marked, a click applies it, and the sync switches below stay open while flipped.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { LayoutPicker, type LayoutPickerOptions } from '../src/widget/layout-picker';
import { layoutCatalog } from '../src/workspace/layout-catalog';
import { registerBuiltinLayouts } from '../src/workspace/layouts';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
registerBuiltinLayouts();

const made: LayoutPicker[] = [];
afterEach(() => {
    for (const p of made.splice(0)) p.destroy();
    document.body.innerHTML = '';
});

function make(extra: Partial<LayoutPickerOptions> = {}) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const trigger = document.createElement('button');
    host.appendChild(trigger);
    let current = '2h';
    const syncs = [
        { id: 'symbol', label: 'Symbol', checked: false },
        { id: 'timeframe', label: 'Interval', checked: false },
        { id: 'crosshair', label: 'Crosshair', checked: true },
    ];
    const onSelect = vi.fn((id: string) => { current = id; });
    const onToggleSync = vi.fn((id: string) => { const s = syncs.find((x) => x.id === id)!; s.checked = !s.checked; });
    const onOpenChange = vi.fn();
    const picker = new LayoutPicker({ trigger, host, current: () => current, presets: () => [], onSelect, syncs: () => syncs, onToggleSync, onOpenChange, ...extra });
    made.push(picker);
    return { picker, trigger, host, onSelect, onToggleSync, onOpenChange, setCurrent: (id: string) => { current = id; } };
}
const qa = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const q = (sel: string): HTMLElement => document.querySelector<HTMLElement>(sel)!;
const iconFor = (id: string): HTMLElement => q(`.vela-lp-icon[data-layout="${id}"]`);

describe('the layout dropdown', () => {
    it('opens under the button and closes on a second click, Escape and an outside press', () => {
        const { trigger, onOpenChange } = make();
        trigger.click();
        expect(q('.vela-lp-layer').style.display).not.toBe('none');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(onOpenChange).toHaveBeenLastCalledWith(true);
        trigger.click();
        expect(q('.vela-lp-layer').style.display).toBe('none');
        trigger.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(q('.vela-lp-layer').style.display).toBe('none');
        trigger.click();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(q('.vela-lp-layer').style.display).toBe('none');
    });

    it('lists the window counts in order, each row with every arrangement of that count', () => {
        const { trigger } = make();
        trigger.click();
        const groups = layoutCatalog();
        expect(qa('.vela-lp-count').map((c) => c.textContent)).toEqual(groups.map((g) => String(g.count)));
        const rows = qa('.vela-lp-row');
        expect(rows).toHaveLength(groups.length);
        for (const [i, g] of groups.entries()) {
            expect([...rows[i]!.querySelectorAll<HTMLElement>('.vela-lp-icon')].map((b) => b.dataset.layout)).toEqual(g.layouts.map((d) => d.id));
        }
    });

    it('draws a diagram with the right number of windows on every button, and names it for assistive tech', () => {
        const { trigger } = make();
        trigger.click();
        const b = iconFor('bl3');
        expect(b.querySelectorAll('svg rect')).toHaveLength(3);
        expect(b.getAttribute('aria-label')).toMatch(/^3 windows/);
        expect(iconFor('1').getAttribute('aria-label')).toMatch(/^1 window\b/);
    });

    it('marks the current arrangement, and moves the mark when it changes', () => {
        const { trigger, picker, setCurrent } = make();
        trigger.click();
        expect(iconFor('2h').dataset.current).toBe('1');
        expect(iconFor('2h').getAttribute('aria-pressed')).toBe('true');
        expect(qa('.vela-lp-icon[data-current="1"]')).toHaveLength(1);
        setCurrent('bl3');
        picker.refresh();
        expect(qa('.vela-lp-icon[data-current="1"]').map((b) => b.dataset.layout)).toEqual(['bl3']);
    });

    it('applies the clicked arrangement and closes', () => {
        const { trigger, onSelect } = make();
        trigger.click();
        iconFor('bt4').click();
        expect(onSelect).toHaveBeenCalledWith('bt4');
        expect(q('.vela-lp-layer').style.display).toBe('none');
    });

    it('clicking the arrangement already showing just closes', () => {
        const { trigger, onSelect } = make();
        trigger.click();
        iconFor('2h').click();
        expect(onSelect).not.toHaveBeenCalled();
        expect(q('.vela-lp-layer').style.display).toBe('none');
    });

    it('lists plugin layouts the catalogue does not know under "Custom"', () => {
        const { trigger, onSelect } = make({ presets: () => [{ id: 'my-6', label: 'My six', checked: false }] });
        trigger.click();
        expect(q('.vela-lp-custom-heading').textContent).toBe('Custom');
        qa('.vela-lp-preset')[0]!.click();
        expect(onSelect).toHaveBeenCalledWith('my-6');
    });

    it('has no "Custom" section without plugin layouts', () => {
        make().trigger.click();
        expect(document.querySelector('.vela-lp-custom-heading')).toBeNull();
    });

    it('shows the sync switches under "Sync in layout", and keeps the panel open while one is flipped', () => {
        const { trigger, onToggleSync } = make();
        trigger.click();
        expect(q('.vela-lp-sync-heading').textContent).toBe('Sync in layout');
        const rows = qa('.vela-lp-sync-row');
        expect(rows.map((r) => r.querySelector('.vela-lp-label')!.textContent)).toEqual(['Symbol', 'Interval', 'Crosshair']);
        expect(rows.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
        rows[0]!.click();
        expect(onToggleSync).toHaveBeenCalledWith('symbol');
        expect(qa('.vela-lp-sync-row')[0]!.getAttribute('aria-checked')).toBe('true');
        expect(q('.vela-lp-layer').style.display).not.toBe('none');
    });

    it('scrolls its list instead of outgrowing the window', () => {
        make().trigger.click();
        expect(document.querySelector('.vela-lp-list')).not.toBeNull();
        const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
        expect(css).toMatch(/\.vela-lp-list\s*\{[^}]*overflow-y:\s*auto/);
    });
});
