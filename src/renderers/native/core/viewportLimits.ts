// Limits on where the newest bar may sit in the view. Pure, so the renderer's pan clamp and
// its post-replacement re-frame share one rule.

/**
 * The most whitespace (in bars) that may sit right of the newest bar while at least
 * `minVisible` candles stay on screen at this zoom. Bars in view depend on the effective
 * pitch — `barSpacing` times the spacing multiplier.
 */
export function maxRightOffset(width: number, barSpacing: number, spacingScale: number, barCount: number, minVisible: number): number {
    const visibleBars = width / (barSpacing * spacingScale);
    return visibleBars - (Math.min(minVisible, barCount) - 1);
}

/**
 * Where to anchor the newest bar after a series replacement that keeps the zoom: at the
 * configured right `margin` — unless the zoom is so deep that the margin alone would fill
 * the view, which would leave no candle on screen. Then it backs off to what
 * {@link maxRightOffset} allows.
 */
export function reframeRightOffset(margin: number, width: number, barSpacing: number, spacingScale: number, barCount: number, minVisible: number): number {
    return Math.min(margin, maxRightOffset(width, barSpacing, spacingScale, barCount, minVisible));
}
