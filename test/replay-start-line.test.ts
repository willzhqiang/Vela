// The replay's start marker: a dashed vertical line at the bar the replay began on.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { DARK_THEME } from '../src/core/theme';
import { ACCENT } from '../src/core/palette';

const DATA_W = 700;
const DATA_H = 480;

function paint(replayStart: number | null, timeToX: (t: number) => number = (t) => t / 10) {
    const strokes: Array<{ style: string; dash: number[]; from: [number, number]; to: [number, number] }> = [];
    let dash: number[] = [];
    let at: [number, number] = [0, 0];
    let to: [number, number] = [0, 0];
    const ctx = {
        strokeStyle: '',
        lineWidth: 1,
        beginPath() {},
        moveTo(x: number, y: number) { at = [x, y]; },
        lineTo(x: number, y: number) { to = [x, y]; },
        stroke() { strokes.push({ style: String(ctx.strokeStyle), dash, from: at, to }); },
        setLineDash(d: number[]) { dash = d; },
    };
    const scene = new SceneGraph();
    scene.replayStart = replayStart;
    const coords = { timeToX } as unknown as CoordinateSystem;
    const chrome = new ChromeRenderer();
    (chrome as unknown as { drawReplayStart: (...a: unknown[]) => void }).drawReplayStart(ctx, scene, coords, DARK_THEME, DATA_W, DATA_H);
    return strokes;
}

describe('replay start line', () => {
    it('is one dashed vertical line, full height of the plot, on the start bar', () => {
        const s = paint(2000);
        expect(s).toHaveLength(1);
        expect(s[0]!.dash.length).toBeGreaterThan(0);
        expect(s[0]!.style).toBe(ACCENT);
        expect(s[0]!.from[0]).toBe(s[0]!.to[0]);
        expect(s[0]!.from[1]).toBe(0);
        expect(s[0]!.to[1]).toBe(DATA_H);
        expect(s[0]!.from[0]).toBe(Math.round(200) + 0.5); // crisp: on a half pixel
    });

    it('draws nothing without a start', () => {
        expect(paint(null)).toEqual([]);
    });

    it('draws nothing while the start is scrolled out of view', () => {
        expect(paint(2000, () => -20)).toEqual([]);
        expect(paint(2000, () => DATA_W + 40)).toEqual([]);
    });

    it('draws nothing for an unmappable time', () => {
        expect(paint(2000, () => NaN)).toEqual([]);
    });
});

describe('the replayStart feature', () => {
    it('is listed, round-trips a time, and clears on anything else', () => {
        const r = new NativeRenderer();
        expect(r.features).toContain('replayStart');
        expect(r.readFeature('replayStart')).toBeNull();
        r.applyFeature('replayStart', 1_700_000_000_000);
        expect(r.readFeature('replayStart')).toBe(1_700_000_000_000);
        for (const bad of [null, undefined, NaN, 'x', {}]) {
            r.applyFeature('replayStart', 5);
            r.applyFeature('replayStart', bad);
            expect(r.readFeature('replayStart')).toBeNull();
        }
    });
});
