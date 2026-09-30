// DatePicker styles — the calendar content only; the host (a popover, a panel) owns the
// surface around it (background, border, shadow, padding).
export const DATE_PICKER_STYLE_ID = 'vela-date-picker-styles-3';

export const DATE_PICKER_CSS = `
.vela-date-picker{color:var(--vela-fg);font:14px var(--vela-font);user-select:none;}
.vela-date-picker [hidden]{display:none !important;}
.vela-date-picker-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}
.vela-date-picker-title{flex:1;display:flex;align-items:center;justify-content:center;gap:2px;min-width:0;}
.vela-date-picker-switch{border:none;background:transparent;color:var(--vela-fg-bright);font:inherit;font-weight:600;font-size:14px;padding:2px 6px;border-radius:4px;cursor:pointer;}
.vela-date-picker-switch:not(:disabled):hover{background:var(--vela-hover);}
.vela-date-picker-switch:disabled{cursor:default;}
.vela-date-picker-nav{width:24px;height:24px;border:none;background:transparent;color:var(--vela-fg-muted);border-radius:4px;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px;}
.vela-date-picker-nav:hover:not(:disabled){background:var(--vela-hover);color:var(--vela-fg-bright);}
.vela-date-picker-nav:disabled{opacity:0.35;cursor:default;}
.vela-date-picker-week,.vela-date-picker-grid{display:grid;grid-template-columns:repeat(7,var(--vela-date-picker-cell,28px));gap:2px;}
.vela-date-picker-week{margin-bottom:4px;color:var(--vela-fg-muted);font-size:11px;text-align:center;}
.vela-date-picker-week span{line-height:20px;}
.vela-date-picker-blank{width:var(--vela-date-picker-cell,28px);height:var(--vela-date-picker-cell,28px);}
.vela-date-picker-day{width:var(--vela-date-picker-cell,28px);height:var(--vela-date-picker-cell,28px);border:none;background:transparent;color:inherit;border-radius:4px;padding:0;cursor:pointer;font:inherit;font-size:14px;}
.vela-date-picker-day:hover:not(:disabled):not([data-checked]):not([data-in-range]){background:var(--vela-hover);}
.vela-date-picker-day[data-checked]{background:var(--vela-hover-strong);color:var(--vela-fg-bright);}
.vela-date-picker-day[data-today]:not([data-checked]){box-shadow:inset 0 0 0 1px var(--vela-border-strong);}
.vela-date-picker-day:disabled,.vela-date-picker-cell:disabled{color:var(--vela-fg-faint);cursor:default;}
.vela-date-picker-day[data-in-range]{background:var(--vela-hover);border-radius:0;}
.vela-date-picker-day[data-range-start]{border-top-right-radius:0;border-bottom-right-radius:0;}
.vela-date-picker-day[data-range-end]{border-top-left-radius:0;border-bottom-left-radius:0;}
.vela-date-picker-day[data-range-start][data-range-end]{border-radius:4px;}
.vela-date-picker-day[data-range-start],.vela-date-picker-day[data-range-end]{background:var(--vela-selected-bg);color:var(--vela-selected-fg);font-weight:600;}
.vela-date-picker-cells{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:calc(7 * var(--vela-date-picker-cell,28px) + 6 * 2px);}
.vela-date-picker-cell{height:36px;border:none;background:transparent;color:inherit;border-radius:4px;padding:0 4px;cursor:pointer;font:inherit;font-size:14px;}
.vela-date-picker-cell:hover:not(:disabled):not([data-checked]){background:var(--vela-hover);}
.vela-date-picker-cell[data-checked]{background:var(--vela-hover-strong);color:var(--vela-fg-bright);}
.vela-date-picker-cell[data-today]:not([data-checked]){box-shadow:inset 0 0 0 1px var(--vela-border-strong);}
.vela-date-picker-cell[data-outside]{opacity:0.45;}
`;
