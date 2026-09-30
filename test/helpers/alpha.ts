/** The alpha of a CSS colour string as jsdom reports it (`rgba(r, g, b, a)`, or `rgb(...)` ⇒ 1). */
export function parseAlpha(css: string): number {
    const m = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(css);
    return m ? Number(m[1]) : 1;
}
