// The last-price chips as painted: the symbol's name beside the label, and the pre/post-market chip + line.
import { describe, it, expect, vi } from 'vitest';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { DARK_THEME } from '../src/core/theme';
import { SESSION_POST, SESSION_PRE } from '../src/core/palette';

// Colors are parsed through a DOM canvas in the browser; a hex reader stands in here.
vi.mock('../src/renderers/native/backend/gl/color', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    parseColor: (css: string) => {
        const m = /^#([0-9a-f]{6})/i.exec(css);
        const n = m ? parseInt(m[1]!, 16) : 0;
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
    },
}));

const DATA_W = 700;
const LAST_OPEN = 1_000_000;

function recorder() {
    const fills: Array<{ style: string; rect: [number, number, number, number] }> = [];
    const texts: Array<{ text: string; x: number; y: number }> = [];
    const strokes: Array<{ style: string; dash: number[]; y: number }> = [];
    let dash: number[] = [];
    let at: [number, number] = [0, 0];
    const ctx = {
        font: '',
        textBaseline: '',
        textAlign: '',
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        beginPath() {},
        moveTo(x: number, y: number) { at = [x, y]; },
        lineTo() {},
        stroke() { strokes.push({ style: String(ctx.strokeStyle), dash, y: at[1] }); },
        setLineDash(d: number[]) { dash = d; },
        fillRect(x: number, y: number, w: number, h: number) { fills.push({ style: String(ctx.fillStyle), rect: [x, y, w, h] }); },
        fillText(text: string, x: number, y: number) { texts.push({ text, x, y }); },
        measureText: (t: string) => ({ width: t.length * 6 }),
    };
    return { ctx, fills, texts, strokes };
}

/** A price pane 0..500 px tall showing 0..100, so price p sits at y = 500 − 5p. */
function paint(setup: (s: SceneGraph) => void, close = 60) {
    const rec = recorder();
    const scene = new SceneGraph();
    const pane = scene.ensurePane('price', 'price', 0, 3);
    pane.bounds = { top: 0, height: 500 };
    pane.scale = { min: 0, max: 100 } as never;
    scene.bars = [{ time: LAST_OPEN - 3_600_000, open: 59, high: 61, low: 58, close: 59.5, volume: 1 }, { time: LAST_OPEN, open: close - 1, high: close + 1, low: close - 2, close, volume: 1 }];
    scene.showCountdown = false;
    setup(scene);
    const coords = { barInterval: 3_600_000, priceToY: (p: number) => 500 - p * 5, visibleLogicalRange: () => ({ from: 0, to: 1 }) } as unknown as CoordinateSystem;
    const chrome = new ChromeRenderer();
    (chrome as unknown as { drawPriceLineAndCountdown: (...a: unknown[]) => void }).drawPriceLineAndCountdown(rec.ctx, scene, coords, DARK_THEME, DATA_W, pane);
    return rec;
}
const ext = (over: Partial<{ price: number; time: number; session: 'pre' | 'post' }> = {}) => ({ price: 64.7, time: LAST_OPEN + 4 * 3_600_000, session: 'pre' as const, ...over });
const textsOf = (r: ReturnType<typeof recorder>): string[] => r.texts.map((t) => t.text);

describe('symbol name beside the last-price label', () => {
    it('draws the name in a block against the axis, on the label row', () => {
        const r = paint((s) => (s.symbolLabel = 'SPY'));
        expect(textsOf(r)).toEqual(['SPY', '60.00']);
        const name = r.fills[0]!.rect;
        const price = r.fills[1]!.rect;
        expect(name[0] + name[2]).toBe(price[0]); // touching the axis edge
        expect(name[1]).toBe(price[1]); // same row
        expect(r.fills[0]!.style).toBe(r.fills[1]!.style); // same color
    });

    it('is left out when switched off, when there is no name, or when the label itself is off', () => {
        expect(textsOf(paint((s) => { s.symbolLabel = 'SPY'; s.showSymbolLabel = false; }))).toEqual(['60.00']);
        expect(textsOf(paint((s) => (s.symbolLabel = null)))).toEqual(['60.00']);
        expect(textsOf(paint((s) => { s.symbolLabel = 'SPY'; s.showPriceLabel = false; }))).toEqual([]);
    });

    it('sits on the label row of a stacked label + countdown block, not on the countdown', () => {
        vi.spyOn(Date, 'now').mockReturnValue(LAST_OPEN + 60_000); // mid-bar, so a countdown exists
        const r = paint((s) => { s.symbolLabel = 'SPY'; s.showCountdown = true; });
        vi.restoreAllMocks();
        const name = r.fills[0]!.rect;
        const block = r.fills[1]!.rect;
        expect(name[1]).toBe(block[1]);
        expect(name[3]).toBe(16);
        expect(block[3]).toBe(32);
    });
});

describe('pre/post-market price', () => {
    it('draws a Pre chip and a dotted line in the pre-market color at its own price', () => {
        const r = paint((s) => (s.extendedPrice = ext()));
        expect(textsOf(r)).toEqual(['60.00', 'Pre', '64.70']);
        const orange = r.fills.filter((f) => f.style === SESSION_PRE);
        expect(orange).toHaveLength(2); // the tag and the price
        expect(orange[1]!.rect[1]).toBe(500 - 64.7 * 5 - 8); // centred on its price
        const line = r.strokes.find((s) => s.style === SESSION_PRE)!;
        expect(line.dash.length).toBeGreaterThan(0);
        expect(line.y).toBe(Math.round(500 - 64.7 * 5) + 0.5);
    });

    it('uses the after-hours color and word for a post-market print', () => {
        const r = paint((s) => (s.extendedPrice = ext({ session: 'post' })));
        expect(textsOf(r)).toContain('Post');
        expect(r.fills.some((f) => f.style === SESSION_POST)).toBe(true);
    });

    it('appears only while newer than the newest bar', () => {
        expect(textsOf(paint((s) => (s.extendedPrice = ext({ time: LAST_OPEN }))))).toEqual(['60.00']);
        expect(textsOf(paint((s) => (s.extendedPrice = ext({ time: LAST_OPEN - 5 }))))).toEqual(['60.00']);
        expect(textsOf(paint((s) => (s.extendedPrice = ext({ time: LAST_OPEN + 1 }))))).toContain('Pre');
    });

    it('label and line switch off independently', () => {
        const noLabel = paint((s) => { s.extendedPrice = ext(); s.showExtendedLabel = false; });
        expect(textsOf(noLabel)).toEqual(['60.00']);
        expect(noLabel.strokes.some((s) => s.style === SESSION_PRE)).toBe(true);
        const noLine = paint((s) => { s.extendedPrice = ext(); s.showExtendedLine = false; });
        expect(textsOf(noLine)).toContain('Pre');
        expect(noLine.strokes.some((s) => s.style === SESSION_PRE)).toBe(false);
    });

    it('does not depend on the regular label being shown', () => {
        const r = paint((s) => { s.extendedPrice = ext(); s.showPriceLabel = false; });
        expect(textsOf(r)).toEqual(['Pre', '64.70']);
    });

    it('steps clear of the regular block when the prices are close, keeping its own line', () => {
        const r = paint((s) => (s.extendedPrice = ext({ price: 60.4 })));
        const main = r.fills.find((f) => f.style !== SESSION_PRE)!.rect;
        const pre = r.fills.filter((f) => f.style === SESSION_PRE)[1]!.rect;
        expect(pre[1] + pre[3]).toBeLessThanOrEqual(main[1]); // directly above, no overlap
        expect(r.strokes.find((s) => s.style === SESSION_PRE)!.y).toBe(Math.round(500 - 60.4 * 5) + 0.5); // the line stays at the price
    });

    it('is not drawn when its price is off the visible scale', () => {
        expect(textsOf(paint((s) => (s.extendedPrice = ext({ price: 250 }))))).toEqual(['60.00']);
    });
});
