// The layout catalogue — what the topbar's layout picker offers for each window count, and the
// geometry of each arrangement's little icon. Pure data + pure functions (no DOM).
//
// Uniform grids up to 4×4 reuse the registry's ids (`'2h'`, `'4'`, `'g2x3'`…), so a saved
// document keeps meaning the same thing. The arrangements the grid picker could not express —
// rows of five or six, and "one big window and the rest small" — live HERE rather than in the
// plugin registry: `ensureLayout` resolves their ids through {@link catalogLayout}, so a
// persisted pick restores across boots without registering anything. Ids are part of saved
// documents: add new ones, never rename or repurpose.
import { layoutForGrid, type LayoutDefinition } from './layouts';

/** The window counts the picker lists, ascending. */
export const CATALOG_COUNTS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16];

/** All the arrangements for one window count. */
export interface LayoutGroup {
    count: number;
    layouts: LayoutDefinition[];
}

/** A window as `[x, y, w, h]` fractions of the whole grid. */
export type LayoutRect = [number, number, number, number];

/** Area names `a`, `b`, … in slot order. */
const name = (i: number): string => String.fromCharCode(97 + i);

/** Rows × columns of one-weight tracks, windows flowing row-major. */
function uniform(id: string, label: string, rows: number, cols: number): LayoutDefinition {
    return {
        id,
        label,
        cols: Array.from({ length: cols }, () => 1),
        rows: Array.from({ length: rows }, () => 1),
        cells: Array.from({ length: rows * cols }, (_, i) => ({ id: `c${i + 1}` })),
    };
}

/** One big window (the first slot, two thirds of the grid) and `n − 1` small ones along an edge. */
function oneBig(side: 'l' | 'r' | 't' | 'b', n: number): LayoutDefinition {
    const small = n - 1;
    const names = Array.from({ length: small }, (_, i) => name(i + 1));
    const label = `1 big + ${small} ${{ l: 'on the left', r: 'on the right', t: 'above', b: 'below' }[side]}`;
    // Slots follow the area names a (big), b, c, … in order of first appearance.
    if (side === 'l' || side === 'r') {
        const areas = names.map((s) => (side === 'l' ? `a ${s}` : `${s} a`));
        return { id: `b${side}${n}`, label, cols: side === 'l' ? [2, 1] : [1, 2], rows: names.map(() => 1), areas, cells: bySlot('a', ...names) };
    }
    const big = Array.from({ length: small }, () => 'a').join(' ');
    const row = names.join(' ');
    const areas = side === 't' ? [big, row] : [row, big];
    return { id: `b${side}${n}`, label, cols: names.map(() => 1), rows: side === 't' ? [2, 1] : [1, 2], areas, cells: bySlot('a', ...names) };
}

/** Slots c1..cN bound to the given area names, in that order. */
function bySlot(...order: string[]): Array<{ id: string; area: string }> {
    return order.map((area, i) => ({ id: `c${i + 1}`, area }));
}

/** Half and half: one full-height window on the left, two stacked on the right (three windows, `3s`). */
const HALF_AND_HALF: LayoutDefinition = {
    id: '3s',
    label: '1 left, 2 right',
    cols: [1, 1],
    rows: [1, 1],
    areas: ['a b', 'a c'],
    cells: bySlot('a', 'b', 'c'),
};

/** Two on top, three below (five windows): six columns so both rows divide evenly. */
const TWO_OVER_THREE: LayoutDefinition = {
    id: 't2b3',
    label: '2 on top, 3 below',
    cols: [1, 1, 1, 1, 1, 1],
    rows: [1, 1],
    areas: ['a a a b b b', 'c c d d e e'],
    cells: bySlot('a', 'b', 'c', 'd', 'e'),
};

/** A row (`h`) or column (`v`) of five or six — beyond the 4×4 canvas. */
const line = (dir: 'h' | 'v', n: number): LayoutDefinition => ({
    ...(dir === 'h' ? uniform('', '', 1, n) : uniform('', '', n, 1)),
    id: `${dir}${n}`,
    label: dir === 'h' ? `${n} side by side` : `${n} stacked`,
});

/** Uniform grids (rows × cols) per count, in the order the picker shows them. */
const GRIDS: Record<number, Array<[number, number]>> = {
    1: [[1, 1]],
    2: [[1, 2], [2, 1]],
    3: [[1, 3], [3, 1]],
    4: [[2, 2], [1, 4], [4, 1]],
    6: [[2, 3], [3, 2]],
    8: [[2, 4], [4, 2]],
    9: [[3, 3]],
    12: [[3, 4], [4, 3]],
    16: [[4, 4]],
};

/** Everything that is not a plain 4×4-or-smaller grid, by id (what `ensureLayout` falls back to). */
const EXTRA: LayoutDefinition[] = [
    HALF_AND_HALF,
    ...[3, 4, 5, 6].flatMap((n) => (['l', 'r', 't', 'b'] as const).map((s) => oneBig(s, n))),
    ...[7, 8].flatMap((n) => (['l', 't'] as const).map((s) => oneBig(s, n))),
    TWO_OVER_THREE,
    line('h', 5),
    line('v', 5),
    line('h', 6),
    line('v', 6),
];

const EXTRA_BY_ID = new Map(EXTRA.map((d) => [d.id, d]));

/** The catalogue-only layout behind `id` (undefined for ids it does not own). */
export function catalogLayout(id: string): LayoutDefinition | undefined {
    return EXTRA_BY_ID.get(id);
}

/** Per window count, the arrangements to offer: plain grids first, then the catalogue-only ones. */
export function layoutCatalog(): LayoutGroup[] {
    return CATALOG_COUNTS.map((count) => ({
        count,
        layouts: [
            ...(GRIDS[count] ?? []).map(([r, c]) => layoutForGrid(r, c)),
            ...EXTRA.filter((d) => d.cells.length === count),
        ],
    }));
}

/**
 * Where each window sits, as fractions of the whole grid, in slot order. Uniform grids flow
 * row-major; area layouts take each slot's bounding box in the area grid. Track weights decide
 * the sizes.
 */
export function layoutRects(def: LayoutDefinition): LayoutRect[] {
    const cum = (w: number[]): number[] => w.reduce<number[]>((acc, v) => [...acc, acc[acc.length - 1]! + v], [0]);
    const cx = cum(def.cols);
    const cy = cum(def.rows);
    const W = cx[cx.length - 1]!;
    const H = cy[cy.length - 1]!;
    const box = (c0: number, c1: number, r0: number, r1: number): LayoutRect => [cx[c0]! / W, cy[r0]! / H, (cx[c1 + 1]! - cx[c0]!) / W, (cy[r1 + 1]! - cy[r0]!) / H];
    if (!def.areas) {
        const nc = def.cols.length;
        return def.cells.map((_, i) => box(i % nc, i % nc, Math.floor(i / nc), Math.floor(i / nc)));
    }
    const grid = def.areas.map((r) => r.split(/\s+/));
    return def.cells.map((cell) => {
        let c0 = Infinity;
        let c1 = -1;
        let r0 = Infinity;
        let r1 = -1;
        for (const [r, row] of grid.entries()) {
            for (const [c, a] of row.entries()) {
                if (a !== cell.area) continue;
                c0 = Math.min(c0, c);
                c1 = Math.max(c1, c);
                r0 = Math.min(r0, r);
                r1 = Math.max(r1, r);
            }
        }
        return box(c0, c1, r0, r1);
    });
}
