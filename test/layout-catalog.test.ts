// The layout catalogue behind the topbar's layout picker: which arrangements exist for each
// window count, the geometry of their little icons, and that every id resolves for restore.
import { describe, it, expect } from 'vitest';
import { layoutCatalog, catalogLayout, layoutRects, CATALOG_COUNTS } from '../src/workspace/layout-catalog';
import { ensureLayout, layoutDefinition, registerBuiltinLayouts, type LayoutDefinition } from '../src/workspace/layouts';

registerBuiltinLayouts();

const all = (): LayoutDefinition[] => layoutCatalog().flatMap((g) => g.layouts);

describe('layoutCatalog', () => {
    it('groups by window count, ascending, and every layout has exactly that many windows', () => {
        const groups = layoutCatalog();
        expect(groups.map((g) => g.count)).toEqual([...CATALOG_COUNTS]);
        expect(CATALOG_COUNTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16]);
        for (const g of groups) {
            expect(g.layouts.length).toBeGreaterThan(0);
            for (const def of g.layouts) expect(def.cells).toHaveLength(g.count);
        }
    });

    it('has no duplicate ids and no two layouts with the same geometry', () => {
        const ids = all().map((d) => d.id);
        expect(new Set(ids).size).toBe(ids.length);
        const shape = (d: LayoutDefinition): string => JSON.stringify(layoutRects(d).map((r) => r.map((v) => Math.round(v * 1000))));
        const shapes = all().map(shape);
        expect(new Set(shapes).size).toBe(shapes.length);
    });

    it('keeps the ids of the built-in presets, so saved layouts still mean the same thing', () => {
        const byCount = (n: number): string[] => layoutCatalog().find((g) => g.count === n)!.layouts.map((d) => d.id);
        expect(byCount(1)).toEqual(['1']);
        expect(byCount(2)).toEqual(['2h', '2v']);
        expect(byCount(4)).toContain('4');
        expect(byCount(8)).toContain('8');
        expect(byCount(6)).toContain('g2x3');
        expect(byCount(16)).toEqual(['g4x4']);
    });

    it('offers one-big-and-the-rest arrangements for 3 to 6 windows, in all four directions', () => {
        for (const n of [3, 4, 5, 6]) {
            const ids = layoutCatalog().find((g) => g.count === n)!.layouts.map((d) => d.id);
            for (const k of ['bl', 'br', 'bt', 'bb']) expect(ids).toContain(`${k}${n}`);
        }
    });

    it('every layout is a well-formed grid: tracks, slots c1..cN, areas covering every slot', () => {
        for (const def of all()) {
            expect(def.cols.length).toBeGreaterThan(0);
            expect(def.rows.length).toBeGreaterThan(0);
            expect(def.cells.map((c) => c.id)).toEqual(def.cells.map((_, i) => `c${i + 1}`));
            if (def.areas) {
                expect(def.areas).toHaveLength(def.rows.length);
                const grid = def.areas.map((r) => r.split(/\s+/));
                for (const row of grid) expect(row).toHaveLength(def.cols.length);
                const named = new Set(grid.flat());
                expect([...named].sort()).toEqual(def.cells.map((c) => c.area).sort());
            }
        }
    });

    it('every layout resolves by id, so a saved document restores it', () => {
        for (const def of all()) {
            const resolved = ensureLayout(def.id);
            expect(resolved, def.id).toBeDefined();
            expect(resolved!.cells).toHaveLength(def.cells.length);
            expect(layoutRects(resolved!)).toEqual(layoutRects(def));
        }
    });

    it('does not leak catalogue-only layouts into the plugin registry', () => {
        expect(layoutDefinition('bl3')).toBeUndefined();
        expect(catalogLayout('bl3')).toBeDefined();
        expect(catalogLayout('nope')).toBeUndefined();
    });
});

describe('the one-big layouts', () => {
    it('big-left 3: one tall window on the left, two stacked on the right, big = first slot', () => {
        const def = catalogLayout('bl3')!;
        const [big, a, b] = layoutRects(def);
        expect(big).toEqual([0, 0, 2 / 3, 1]);
        expect(a).toEqual([2 / 3, 0, 1 / 3, 0.5]);
        expect(b).toEqual([2 / 3, 0.5, 1 / 3, 0.5]);
    });

    it('big-top 4: a wide window on top, three side by side below', () => {
        const [big, ...rest] = layoutRects(catalogLayout('bt4')!);
        expect(big).toEqual([0, 0, 1, 2 / 3]);
        expect(rest).toHaveLength(3);
        for (const [i, r] of rest.entries()) expect(r).toEqual([i / 3, 2 / 3, 1 / 3, 1 / 3]);
    });

    it('mirrored variants put the big window on the right / at the bottom', () => {
        expect(layoutRects(catalogLayout('br3')!)[0]).toEqual([1 / 3, 0, 2 / 3, 1]);
        expect(layoutRects(catalogLayout('bb3')!)[0]).toEqual([0, 1 / 3, 1, 2 / 3]);
    });
});

describe('the half-and-half layout "3s" (one left column, two stacked right)', () => {
    it('is in the three-window row, after the plain rows and columns', () => {
        const ids = layoutCatalog().find((g) => g.count === 3)!.layouts.map((d) => d.id);
        expect(ids.slice(0, 3)).toEqual(['g1x3', 'g3x1', '3s']);
        expect(ids).toContain('bl3'); // the 2:1 variant stays
    });

    it('left half is the first window, right half is split in two even rows', () => {
        const [left, top, bottom] = layoutRects(catalogLayout('3s')!);
        expect(left).toEqual([0, 0, 0.5, 1]);
        expect(top).toEqual([0.5, 0, 0.5, 0.5]);
        expect(bottom).toEqual([0.5, 0.5, 0.5, 0.5]);
    });

    it('differs from the 2:1 one-big layout and resolves by id for a saved document', () => {
        expect(layoutRects(catalogLayout('3s')!)).not.toEqual(layoutRects(catalogLayout('bl3')!));
        expect(ensureLayout('3s')!.cells).toHaveLength(3);
    });
});

describe('layoutRects', () => {
    it('a uniform grid is cells in row-major order', () => {
        const rects = layoutRects(ensureLayout('g2x3')!);
        expect(rects).toHaveLength(6);
        expect(rects[0]).toEqual([0, 0, 1 / 3, 0.5]);
        expect(rects[2]).toEqual([2 / 3, 0, 1 / 3, 0.5]);
        expect(rects[3]).toEqual([0, 0.5, 1 / 3, 0.5]);
    });

    it('track weights decide the sizes', () => {
        const def: LayoutDefinition = { id: 'w', label: 'w', cols: [1, 3], rows: [1], cells: [{ id: 'c1' }, { id: 'c2' }] };
        expect(layoutRects(def)).toEqual([[0, 0, 0.25, 1], [0.25, 0, 0.75, 1]]);
    });

    it('stays inside the unit square and covers it completely', () => {
        for (const def of all()) {
            let area = 0;
            for (const [x, y, w, h] of layoutRects(def)) {
                expect(x).toBeGreaterThanOrEqual(0);
                expect(y).toBeGreaterThanOrEqual(0);
                expect(x + w).toBeLessThanOrEqual(1 + 1e-9);
                expect(y + h).toBeLessThanOrEqual(1 + 1e-9);
                area += w * h;
            }
            expect(area, def.id).toBeCloseTo(1, 9);
        }
    });
});
