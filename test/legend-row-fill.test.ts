// @vitest-environment jsdom
// The wash behind an indicator's title and values: light over the price pane (candles show through),
// nearly solid over an indicator pane (reference lines must not strike through the text).
import { describe, it, expect } from 'vitest';
import { InputsUI, legendRowFill, LEGEND_FILL_ALPHA_PRICE, LEGEND_FILL_ALPHA_STUDY } from '../src/renderers/shared/InputsUI';
import { DARK_THEME } from '../src/core/theme';
import { parseAlpha } from './helpers/alpha';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

describe('legendRowFill', () => {
    it('is more opaque over an indicator pane than over the price pane', () => {
        expect(LEGEND_FILL_ALPHA_STUDY).toBeGreaterThan(LEGEND_FILL_ALPHA_PRICE);
        expect(LEGEND_FILL_ALPHA_STUDY).toBeGreaterThanOrEqual(0.85);
        expect(parseAlpha(legendRowFill('#151619', 'price'))).toBeCloseTo(LEGEND_FILL_ALPHA_PRICE, 2);
        expect(parseAlpha(legendRowFill('#151619', 'pane-1'))).toBeCloseTo(LEGEND_FILL_ALPHA_STUDY, 2);
    });
});

describe('a legend row in the UI', () => {
    const make = () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const ui = new InputsUI(container, { ...DARK_THEME, background: '#151619' });
        return { ui, container };
    };
    const rowEl = (c: HTMLElement, title: string): HTMLElement => [...c.querySelectorAll<HTMLElement>('div')].find((d) => d.style.background && d.textContent?.includes(title))!;
    const alphaOf = (el: HTMLElement): number => parseAlpha(el.style.background);

    it('gets the strong wash in an indicator pane and the light one on the price pane', () => {
        const { ui, container } = make();
        ui.upsert('a', 'Price study', [], {}, 'price');
        ui.upsert('b', 'Phase Oscillator', [], {}, 'pane-1');
        expect(alphaOf(rowEl(container, 'Price study'))).toBeCloseTo(LEGEND_FILL_ALPHA_PRICE, 2);
        expect(alphaOf(rowEl(container, 'Phase Oscillator'))).toBeCloseTo(LEGEND_FILL_ALPHA_STUDY, 2);
    });

    it('follows the row when it moves between panes', () => {
        const { ui, container } = make();
        ui.upsert('a', 'Moving study', [], {}, 'price');
        ui.setPane('a', 'pane-2');
        expect(alphaOf(rowEl(container, 'Moving study'))).toBeCloseTo(LEGEND_FILL_ALPHA_STUDY, 2);
        ui.upsert('a', 'Moving study', [], {}, 'price'); // routed back by an upsert
        expect(alphaOf(rowEl(container, 'Moving study'))).toBeCloseTo(LEGEND_FILL_ALPHA_PRICE, 2);
    });
});
