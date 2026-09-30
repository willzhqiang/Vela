/** Height of one price-axis chip row, px. */
export const CHIP_H = 16;

interface Slot {
    top: number;
    height: number;
}

/**
 * Vertical placement of the axis chips: the regular last-price block (one row, or two when the
 * countdown is stacked under it) and, optionally, the pre/post-market chip. Each is centred on its
 * own price; when they would overlap the extended chip steps to the side its price lies on (equal
 * prices: above) so it stays touching the block, and flips to the other side when that would leave
 * the pane `[top, bottom]`.
 */
export function layoutPriceChips(o: { mainY: number; mainH: number; extY: number | null; top: number; bottom: number }): { main: Slot; ext: Slot | null } {
    const main: Slot = { top: o.mainY - CHIP_H / 2, height: o.mainH };
    if (o.extY === null) return { main, ext: null };
    let top = o.extY - CHIP_H / 2;
    const overlaps = top < main.top + main.height && top + CHIP_H > main.top;
    if (overlaps) {
        const above = main.top - CHIP_H;
        const below = main.top + main.height;
        const preferAbove = o.extY <= o.mainY;
        const fits = (t: number): boolean => t >= o.top && t + CHIP_H <= o.bottom;
        top = preferAbove ? (fits(above) ? above : below) : fits(below) ? below : above;
    }
    return { main, ext: { top, height: CHIP_H } };
}
