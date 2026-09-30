// Saved chart layouts: the store contract a host implements, and the pure helpers the Layouts
// menu and dialog are built from (recents, search, sort, the two-line subtitles). No DOM.
import { timeframeLabel } from './timeframe';

/** What a listing shows about one saved layout — never the document itself. */
export interface LayoutSummary {
    id: string;
    name: string;
    /** Epoch ms of the last save. */
    saved: number;
    /** Epoch ms of the last time it was opened — orders "recently used". */
    opened: number;
    /** The active chart's symbol (without its provider prefix) and timeframe. */
    symbol: string;
    timeframe: string;
}

/** A saved layout with its document: the state `workspace.getState()` produced. */
export interface LayoutRecord extends LayoutSummary {
    state: unknown;
}

/**
 * Where a host keeps saved layouts (a REST API, IndexedDB, files…). Every call may fail — the
 * shell reports the error and keeps the chart as it is. Ids are the store's to make.
 */
export interface LayoutStore {
    list(): Promise<LayoutSummary[]>;
    load(id: string): Promise<LayoutRecord>;
    create(name: string, state: unknown): Promise<LayoutRecord>;
    /** Replace the document (and optionally the name). */
    save(id: string, state: unknown, name?: string): Promise<LayoutRecord>;
    rename(id: string, name: string): Promise<LayoutSummary>;
    /** Mark it opened now (orders "recently used"). */
    touch(id: string): Promise<void>;
    remove(id: string): Promise<void>;
}

/** How many layouts the menu lists under "Recently used". */
export const RECENT_LAYOUTS = 4;

/** The most recently opened layouts, newest first (a tie goes to the more recently saved one). */
export function recentLayouts(layouts: readonly LayoutSummary[], count: number = RECENT_LAYOUTS): LayoutSummary[] {
    return [...layouts].sort((a, b) => b.opened - a.opened || b.saved - a.saved).slice(0, count);
}

/** Layouts whose name, symbol or timeframe label contain every word of `query` (case-insensitive). */
export function filterLayouts(layouts: readonly LayoutSummary[], query: string): LayoutSummary[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [...layouts];
    return layouts.filter((l) => {
        const hay = `${l.name} ${l.symbol} ${l.timeframe} ${l.timeframe ? timeframeLabel(l.timeframe) : ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
    });
}

/** By name — case-insensitive, numbers read as numbers ("layout 2" before "layout 10"). */
export function sortLayouts(layouts: readonly LayoutSummary[], dir: 'asc' | 'desc'): LayoutSummary[] {
    const out = [...layouts].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return dir === 'desc' ? out.reverse() : out;
}

/** The menu's second line: "SPX, 5". */
export function layoutSubtitle(l: LayoutSummary): string {
    return [l.symbol, l.timeframe].filter(Boolean).join(', ');
}

/** The dialog's second line: "SPY, 10m (Sep 29, 2026, 19:56)" — when it was last saved, in `zone`. */
export function layoutDetail(l: LayoutSummary, zone?: string): string {
    const head = [l.symbol, l.timeframe ? timeframeLabel(l.timeframe) : ''].filter(Boolean).join(', ');
    const when = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(zone ? { timeZone: zone } : {}) }).format(new Date(l.saved));
    return head ? `${head} (${when})` : `(${when})`;
}

/** What the layouts menu and dialog show: which layout is current and how it stands. */
export interface LayoutsStatus {
    /** The saved layout the chart is bound to, or null when it is not (yet) saved under a name. */
    current: LayoutSummary | null;
    /** The chart differs from the saved layout (or there is none to compare with). */
    dirty: boolean;
    autosave: boolean;
    /** A store call is in flight. */
    busy: boolean;
    /** The last store error, until the next action succeeds. */
    error: string | null;
    layouts: LayoutSummary[];
}


/** What the menu and dialog ask of the shell (`LayoutsController` implements it). Every action resolves false when it failed or was skipped. */
export interface LayoutsActions {
    status(): LayoutsStatus;
    subscribe(fn: (s: LayoutsStatus) => void): () => void;
    /** Leaving this chart would lose changes (unsaved and autosave is off). */
    requiresConfirm(): boolean;
    setAutosave(on: boolean): void;
    refresh(): Promise<boolean>;
    save(name?: string): Promise<boolean>;
    makeCopy(name: string): Promise<boolean>;
    rename(name: string): Promise<boolean>;
    createNew(name: string): Promise<boolean>;
    open(id: string): Promise<boolean>;
    remove(id: string): Promise<boolean>;
}
