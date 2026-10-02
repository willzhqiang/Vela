// @vitest-environment jsdom
// The little diagram of a layout: one outlined rectangle per window, drawn from the layout's own geometry.
import { describe, it, expect } from 'vitest';
import { layoutIconEl, ICON_W, ICON_H } from '../src/widget/layout-icon';
import { catalogLayout } from '../src/workspace/layout-catalog';
import { ensureLayout, registerBuiltinLayouts } from '../src/workspace/layouts';

registerBuiltinLayouts();

const rects = (svg: SVGElement): SVGRectElement[] => [...svg.querySelectorAll('rect')];
const num = (el: Element, a: string): number => Number(el.getAttribute(a));

describe('layoutIconEl', () => {
    it('draws one rectangle per window inside the icon box', () => {
        for (const id of ['1', '2h', '4', 'g3x3', 'bl3', 'bt5', 't2b3', 'g4x4']) {
            const def = ensureLayout(id)!;
            const svg = layoutIconEl(document, def);
            expect(svg.getAttribute('viewBox')).toBe(`0 0 ${ICON_W} ${ICON_H}`);
            expect(rects(svg)).toHaveLength(def.cells.length);
            for (const r of rects(svg)) {
                expect(num(r, 'x')).toBeGreaterThanOrEqual(0);
                expect(num(r, 'y')).toBeGreaterThanOrEqual(0);
                expect(num(r, 'x') + num(r, 'width')).toBeLessThanOrEqual(ICON_W);
                expect(num(r, 'y') + num(r, 'height')).toBeLessThanOrEqual(ICON_H);
                expect(num(r, 'width')).toBeGreaterThan(0);
                expect(num(r, 'height')).toBeGreaterThan(0);
            }
        }
    });

    it('keeps a visible gap between neighbouring windows', () => {
        const [a, b] = rects(layoutIconEl(document, ensureLayout('2h')!));
        expect(num(b!, 'x') - (num(a!, 'x') + num(a!, 'width'))).toBeGreaterThanOrEqual(1);
    });

    it('mirrors the layout: the big window of "big left" is the wide one on the left', () => {
        const [big, a, b] = rects(layoutIconEl(document, catalogLayout('bl3')!));
        expect(num(big!, 'x')).toBeLessThan(num(a!, 'x'));
        expect(num(big!, 'width')).toBeGreaterThan(num(a!, 'width') * 1.5);
        expect(num(big!, 'height')).toBeGreaterThan(num(a!, 'height') * 1.5);
        expect(num(a!, 'y')).toBeLessThan(num(b!, 'y'));
    });

    it('is outlined, takes the text colour, and is hidden from assistive tech', () => {
        const svg = layoutIconEl(document, ensureLayout('4')!);
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.getAttribute('fill')).toBe('none');
        expect(svg.getAttribute('stroke')).toBe('currentColor');
        expect(svg.classList.contains('vela-layout-icon')).toBe(true);
    });

    it('draws a dense grid with a thinner outline so windows stay distinct', () => {
        const thin = num(layoutIconEl(document, ensureLayout('g4x4')!), 'stroke-width');
        const thick = num(layoutIconEl(document, ensureLayout('1')!), 'stroke-width');
        expect(thin).toBeLessThan(thick);
    });
});
