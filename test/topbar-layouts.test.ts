// @vitest-environment jsdom
// The topbar's layouts button: the current layout's name with a chevron, a marker while it has unsaved changes.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Topbar } from '../src/widget/topbar';
import { resolveTopbarComposition } from '../src/widget/topbar-composition';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
import { registerBuiltinLayouts } from '../src/workspace/layouts';
registerBuiltinLayouts();
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
};

const bars: Topbar[] = [];
afterEach(() => {
    for (const b of bars.splice(0)) b.destroy();
    document.body.innerHTML = '';
});

function make(extra: Partial<ConstructorParameters<typeof Topbar>[1]> = {}) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bar = new Topbar(host, { symbol: 'SPY', timeframe: '10', timeframes: ['1', '5', '10', 'D'], priceStyle: 'candles', onTimeframe: () => undefined, onPriceStyle: () => undefined, ...extra });
    bars.push(bar);
    return { bar, host };
}
const btn = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('.vela-widget-layouts');

describe('the layouts button', () => {
    it('is absent without a handler', () => {
        make();
        expect(btn()).toBeNull();
    });

    it('shows the name and a chevron, and hands its element to the click handler', () => {
        const onLayoutsClick = vi.fn();
        make({ onLayoutsClick });
        const b = btn()!;
        expect(b.querySelector('.vela-widget-layouts-name')!.textContent).toBe('Unnamed');
        expect(b.querySelector('.vela-icon')).not.toBeNull();
        b.click();
        expect(onLayoutsClick).toHaveBeenCalledWith(b);
    });

    it('shows the name it is given and marks unsaved changes', () => {
        const { bar } = make({ onLayoutsClick: () => undefined });
        bar.setLayoutsState({ name: 'Morning SPY', dirty: false });
        expect(btn()!.querySelector('.vela-widget-layouts-name')!.textContent).toBe('Morning SPY');
        expect(btn()!.dataset.dirty).toBeUndefined();
        expect(btn()!.getAttribute('aria-label')).toBe('Manage layouts — Morning SPY');
        bar.setLayoutsState({ name: 'Morning SPY', dirty: true });
        expect(btn()!.dataset.dirty).toBe('1');
        expect(btn()!.getAttribute('aria-label')).toBe('Manage layouts — Morning SPY (unsaved changes)');
    });

    it('is placed on the right by default and removable by composition', () => {
        expect(resolveTopbarComposition().right[0]).toBe('layouts');
        make({ onLayoutsClick: () => undefined, composition: { right: ['screenshot'] } });
        expect(btn()).toBeNull();
    });

    it('setLayoutsState is safe when there is no button', () => {
        const { bar } = make();
        expect(() => bar.setLayoutsState({ name: 'x', dirty: true })).not.toThrow();
    });
});

describe('the replay button', () => {
    const replayBtn = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('.vela-widget-replay');

    it('is absent without a handler', () => {
        make();
        expect(replayBtn()).toBeNull();
    });

    it('carries its name, and hands the click over', () => {
        const onReplayClick = vi.fn();
        make({ onReplayClick });
        const b = replayBtn()!;
        expect(b.textContent).toContain('Replay');
        expect(b.querySelector('.vela-icon')).not.toBeNull();
        b.click();
        expect(onReplayClick).toHaveBeenCalledTimes(1);
    });

    it('shows pressed while a replay is being set up or runs', () => {
        const { bar } = make({ onReplayClick: () => undefined });
        expect(replayBtn()!.getAttribute('aria-pressed')).not.toBe('true');
        bar.setReplayActive(true);
        expect(replayBtn()!.dataset.active).toBe('1');
        expect(replayBtn()!.getAttribute('aria-pressed')).toBe('true');
        bar.setReplayActive(false);
        expect(replayBtn()!.dataset.active).toBe('');
        expect(replayBtn()!.getAttribute('aria-pressed')).toBe('false');
    });

    it('lights up in the selection colours, not the faint hover grey', () => {
        make({ onReplayClick: () => undefined });
        const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
        expect(css).toMatch(/\.vela-widget-replay\[data-active='1'\][^{]*\{[^}]*var\(--vela-selected-bg\)[^}]*var\(--vela-selected-fg\)/);
    });
});

describe('the window-layout button', () => {
    const layoutBtn = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('.vela-widget-layout');
    const layoutOpt = (over: Record<string, unknown> = {}) => ({
        current: '2h',
        presets: () => [],
        onSelectLayout: vi.fn(),
        syncs: () => [{ id: 'symbol', label: 'Symbol', checked: false }],
        onToggleSync: vi.fn(),
        ...over,
    });

    it('is absent without a layout block (single-chart shells)', () => {
        make();
        expect(layoutBtn()).toBeNull();
    });

    it('shows a diagram of the current layout, one rectangle per window', () => {
        make({ layout: layoutOpt() });
        const b = layoutBtn()!;
        expect(b.querySelectorAll('svg rect')).toHaveLength(2);
        expect(b.getAttribute('aria-label')).toBe('Layout — 2 side by side');
    });

    it('follows setLayout with the new diagram and name', () => {
        const { bar } = make({ layout: layoutOpt() });
        bar.setLayout('bl3');
        expect(layoutBtn()!.querySelectorAll('svg rect')).toHaveLength(3);
        expect(layoutBtn()!.getAttribute('aria-label')).toMatch(/^Layout — 1 big/);
    });

    it('opens the picker, and a pick reaches the shell by id', () => {
        const onSelectLayout = vi.fn();
        make({ layout: layoutOpt({ onSelectLayout }) });
        layoutBtn()!.click();
        document.querySelector<HTMLElement>('.vela-lp-icon[data-layout="bt4"]')!.click();
        expect(onSelectLayout).toHaveBeenCalledWith('bt4');
    });

    it('marks the current arrangement in the open picker after setLayout', () => {
        const { bar } = make({ layout: layoutOpt() });
        layoutBtn()!.click();
        bar.setLayout('bl3');
        expect(document.querySelector('.vela-lp-icon[data-current="1"]')!.getAttribute('data-layout')).toBe('bl3');
    });
});
