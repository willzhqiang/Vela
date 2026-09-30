import { describe, it, expect } from 'vitest';
import { maxRightOffset, reframeRightOffset } from '../src/renderers/native/core/viewportLimits';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

// A series replacement re-anchors the newest bars at the right margin while keeping the
// zoom. When the zoom is so deep that the margin alone is wider than the view, the newest
// bars used to end up outside it: the chart drew nothing at all (`getVisibleRange()` null).

const MIN_VISIBLE = 2;

describe('maxRightOffset', () => {
    it('is the whitespace that still leaves `minVisible` candles on screen', () => {
        // 800 px at 100 px per bar = 8 bars in view; 2 candles must stay ⇒ up to 7 bars of whitespace.
        expect(maxRightOffset(800, 100, 1, 500, MIN_VISIBLE)).toBe(7);
    });

    it('folds the spacing multiplier into the pitch', () => {
        expect(maxRightOffset(800, 50, 2, 500, MIN_VISIBLE)).toBe(7);
    });

    it('never asks for more candles than the series has', () => {
        expect(maxRightOffset(800, 100, 1, 1, MIN_VISIBLE)).toBe(8); // one bar ⇒ one candle needs to stay
    });
});

describe('reframeRightOffset', () => {
    it('keeps the configured right margin when the view is wide enough', () => {
        // 210 bars in view (a normal zoom), margin 10.
        expect(reframeRightOffset(10, 713, 713 / 210, 1, 549, MIN_VISIBLE)).toBe(10);
    });

    it('pulls the newest bars back into view when the zoom is deeper than the margin', () => {
        // 5 bars in view but a 10-bar margin: the whole view would be whitespace.
        const width = 713;
        const barSpacing = width / 5;
        const ro = reframeRightOffset(10, width, barSpacing, 1, 549, MIN_VISIBLE);
        expect(ro).toBeLessThan(5);
        // Positive proof, on the real coordinate system: the newest bar is inside the view.
        const cs = new CoordinateSystem();
        cs.setSize(width, 200, 1);
        cs.setBars(Array.from({ length: 549 }, (_, i) => 1000 + i));
        cs.setViewport({ barSpacing, rightOffset: ro });
        const vis = cs.visibleLogicalRange();
        expect(vis.to).toBeGreaterThanOrEqual(548);
        expect(vis.from).toBeLessThan(548);
    });

    it('the unbounded margin really did strand the view (regression guard for the scenario)', () => {
        const width = 713;
        const barSpacing = width / 5;
        const cs = new CoordinateSystem();
        cs.setSize(width, 200, 1);
        cs.setBars(Array.from({ length: 547 }, (_, i) => 1000 + i));
        cs.setViewport({ barSpacing, rightOffset: 10 });
        expect(cs.visibleLogicalRange().from).toBeGreaterThan(546); // entirely right of the newest bar
    });
});
