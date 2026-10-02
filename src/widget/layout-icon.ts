// A layout's little diagram: one outlined rectangle per window, drawn from the layout's own
// geometry (so every arrangement — a plugin's included — gets an icon without anyone drawing one).
import { layoutRects } from '../workspace/layout-catalog';
import type { LayoutDefinition } from '../workspace/layouts';

export const ICON_W = 36;
export const ICON_H = 26;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Gap between windows and to the icon's edge, in icon units. */
const GAP = 1.5;

/** The SVG for `def`: outlined rectangles in `currentColor`, `ICON_W × ICON_H` units. */
export function layoutIconEl(doc: Document, def: LayoutDefinition): SVGElement {
    const rects = layoutRects(def);
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'vela-layout-icon');
    svg.setAttribute('viewBox', `0 0 ${ICON_W} ${ICON_H}`);
    svg.setAttribute('width', String(ICON_W));
    svg.setAttribute('height', String(ICON_H));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', rects.length > 9 ? '0.8' : rects.length > 4 ? '1' : '1.3');
    svg.setAttribute('aria-hidden', 'true');
    const radius = rects.length > 9 ? 0.6 : 1.5;
    const inner = { w: ICON_W - GAP, h: ICON_H - GAP };
    for (const [x, y, w, h] of rects) {
        const r = doc.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', String(round(GAP / 2 + x * inner.w + GAP / 2)));
        r.setAttribute('y', String(round(GAP / 2 + y * inner.h + GAP / 2)));
        r.setAttribute('width', String(round(w * inner.w - GAP)));
        r.setAttribute('height', String(round(h * inner.h - GAP)));
        r.setAttribute('rx', String(radius));
        svg.appendChild(r);
    }
    return svg;
}

const round = (v: number): number => Math.round(v * 100) / 100;
