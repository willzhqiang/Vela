// Vertical placement of the price-axis chips: the regular last-price block and the Pre/Post chip
// each sit centred on their own price, and never overlap — the extended one steps away.
import { describe, it, expect } from 'vitest';
import { layoutPriceChips, CHIP_H } from '../src/renderers/native/chrome/price-chips';

const bounds = { top: 0, bottom: 600 };

describe('layoutPriceChips', () => {
    it('centres each chip on its own price when they are far apart', () => {
        const r = layoutPriceChips({ mainY: 300, mainH: CHIP_H, extY: 100, ...bounds });
        expect(r.main).toEqual({ top: 292, height: CHIP_H });
        expect(r.ext).toEqual({ top: 92, height: CHIP_H });
    });

    it('a stacked main block (label + countdown) is taller and starts at the same place', () => {
        const r = layoutPriceChips({ mainY: 300, mainH: 2 * CHIP_H, extY: 100, ...bounds });
        expect(r.main).toEqual({ top: 292, height: 2 * CHIP_H });
    });

    it('with no extended price there is no extended chip', () => {
        expect(layoutPriceChips({ mainY: 300, mainH: CHIP_H, extY: null, ...bounds }).ext).toBeNull();
    });

    it('an extended price above the main one, close by, sits directly above it', () => {
        const r = layoutPriceChips({ mainY: 300, mainH: CHIP_H, extY: 296, ...bounds });
        expect(r.ext).toEqual({ top: r.main.top - CHIP_H, height: CHIP_H });
    });

    it('an extended price below the main one, close by, sits directly below it', () => {
        const r = layoutPriceChips({ mainY: 300, mainH: CHIP_H, extY: 304, ...bounds });
        expect(r.ext).toEqual({ top: r.main.top + r.main.height, height: CHIP_H });
    });

    it('below means below the whole stacked block', () => {
        const r = layoutPriceChips({ mainY: 300, mainH: 2 * CHIP_H, extY: 305, ...bounds });
        expect(r.ext!.top).toBe(r.main.top + 2 * CHIP_H);
    });

    it('chips that merely touch are left alone', () => {
        const r = layoutPriceChips({ mainY: 300, mainH: CHIP_H, extY: 300 + CHIP_H, ...bounds });
        expect(r.ext).toEqual({ top: 300 + CHIP_H - 8, height: CHIP_H });
    });

    it('equal prices put the extended chip above', () => {
        const r = layoutPriceChips({ mainY: 300, mainH: CHIP_H, extY: 300, ...bounds });
        expect(r.ext!.top).toBe(r.main.top - CHIP_H);
    });

    it('stays inside the pane: pushed above the top edge, it goes below instead', () => {
        const r = layoutPriceChips({ mainY: 10, mainH: CHIP_H, extY: 8, top: 0, bottom: 600 });
        expect(r.ext!.top).toBe(r.main.top + r.main.height);
        expect(r.ext!.top).toBeGreaterThanOrEqual(0);
    });

    it('stays inside the pane: pushed below the bottom edge, it goes above instead', () => {
        const r = layoutPriceChips({ mainY: 590, mainH: CHIP_H, extY: 592, top: 0, bottom: 600 });
        expect(r.ext!.top + CHIP_H).toBeLessThanOrEqual(600);
        expect(r.ext!.top).toBe(r.main.top - CHIP_H);
    });
});
