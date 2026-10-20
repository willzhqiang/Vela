// The pure helpers behind the Layouts menu and dialog: recents, search, sort, the two-line subtitles.
import { describe, it, expect } from 'vitest';
import { recentLayouts, filterLayouts, sortLayouts, layoutSubtitle, layoutDetail, filterTemplates, currentTemplateId, type LayoutSummary, type LayoutTemplate } from '../src/widget/layouts-model';

const mk = (id: string, name: string, opened: number, symbol = 'SPY', timeframe = '10', saved = opened): LayoutSummary => ({ id, name, opened, saved, symbol, timeframe });

const ALL = [
    mk('a', 'SPY · Saty Indicators · 10m', 500),
    mk('b', 'SPX · ATR Map · 10m', 400, 'SPX'),
    mk('c', 'SPY · ATR Map · 10m', 300),
    mk('d', 'SPX Sniper Levels', 200, 'SPX', '5'),
    mk('e', 'SPX · Premarket Map · 5m', 100, 'SPX', '5'),
    mk('f', 'MNQ Saty V3 Deep Backtest', 50, 'MNQ1!', '10'),
];

describe('recentLayouts', () => {
    it('is the most recently opened first, capped at four', () => {
        expect(recentLayouts(ALL).map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(recentLayouts(ALL, 2).map((l) => l.id)).toEqual(['a', 'b']);
    });
    it('does not mutate what it is given, and copes with fewer than asked for', () => {
        const copy = [...ALL];
        recentLayouts(copy);
        expect(copy).toEqual(ALL);
        expect(recentLayouts([mk('z', 'only', 1)])).toHaveLength(1);
        expect(recentLayouts([])).toEqual([]);
    });
    it('breaks a tie on the opened time by the saved time', () => {
        const tie = [mk('x', 'x', 10, 'SPY', '10', 1), mk('y', 'y', 10, 'SPY', '10', 2)];
        expect(recentLayouts(tie).map((l) => l.id)).toEqual(['y', 'x']);
    });
});

describe('filterLayouts', () => {
    it('matches the name, case-insensitively, anywhere in it', () => {
        expect(filterLayouts(ALL, 'atr').map((l) => l.id)).toEqual(['b', 'c']);
        expect(filterLayouts(ALL, 'SATY').map((l) => l.id)).toEqual(['a', 'f']);
    });
    it('also matches the symbol and the timeframe shown under the name', () => {
        expect(filterLayouts(ALL, 'mnq').map((l) => l.id)).toEqual(['f']);
        expect(filterLayouts(ALL, '5m').map((l) => l.id)).toEqual(['d', 'e']);
    });
    it('every word must match, in any order', () => {
        expect(filterLayouts(ALL, 'map spx').map((l) => l.id)).toEqual(['b', 'e']);
    });
    it('an empty or blank query keeps everything; a miss gives nothing', () => {
        expect(filterLayouts(ALL, '')).toHaveLength(6);
        expect(filterLayouts(ALL, '   ')).toHaveLength(6);
        expect(filterLayouts(ALL, 'zzz')).toEqual([]);
    });
});

describe('sortLayouts', () => {
    it('by name, ascending or descending, ignoring case and reading numbers as numbers', () => {
        const rows = [mk('1', 'layout 10', 1), mk('2', 'Layout 2', 2), mk('3', 'alpha', 3)];
        expect(sortLayouts(rows, 'asc').map((l) => l.name)).toEqual(['alpha', 'Layout 2', 'layout 10']);
        expect(sortLayouts(rows, 'desc').map((l) => l.name)).toEqual(['layout 10', 'Layout 2', 'alpha']);
    });
    it('does not mutate its input', () => {
        const rows = [mk('1', 'b', 1), mk('2', 'a', 2)];
        sortLayouts(rows, 'asc');
        expect(rows.map((l) => l.name)).toEqual(['b', 'a']);
    });
});

describe('subtitles', () => {
    it('the menu shows the symbol and the raw timeframe', () => {
        expect(layoutSubtitle(mk('a', 'x', 1, 'SPX', '5'))).toBe('SPX, 5');
    });
    it('the dialog adds the timeframe label and when it was last saved, in the given zone', () => {
        const saved = Date.UTC(2026, 8, 29, 23, 56); // 19:56 in New York (UTC-4)
        expect(layoutDetail(mk('a', 'x', 1, 'SPY', '10', saved), 'America/New_York')).toBe('SPY, 10m (Sep 29, 2026, 19:56)');
        expect(layoutDetail(mk('a', 'x', 1, 'SPY', 'D', saved), 'UTC')).toBe('SPY, 1D (Sep 29, 2026, 23:56)');
    });
    it('a layout with no symbol yet shows just what it has', () => {
        expect(layoutSubtitle(mk('a', 'x', 1, '', ''))).toBe('');
        expect(layoutSubtitle(mk('a', 'x', 1, 'SPY', ''))).toBe('SPY');
    });
});

const tpl = (id: string, name: string, description?: string): LayoutTemplate => ({ id, name, description, open: () => undefined });
const TEMPLATES = [tpl('default', 'Default', 'One chart'), tpl('multi', 'Multi', '2×2: 10m / 1h / D / 5m'), tpl('casey', 'Casey', 'Left 2m EMA 13/48/200 · right 15m levels')];

describe('filterTemplates', () => {
    it('keeps the host order and matches every word in name, description or id', () => {
        expect(filterTemplates(TEMPLATES, '').map((t) => t.id)).toEqual(['default', 'multi', 'casey']);
        expect(filterTemplates(TEMPLATES, 'CASEY').map((t) => t.id)).toEqual(['casey']);
        expect(filterTemplates(TEMPLATES, '1h 5m').map((t) => t.id)).toEqual(['multi']);
        expect(filterTemplates(TEMPLATES, 'ema 15m').map((t) => t.id)).toEqual(['casey']);
        expect(filterTemplates(TEMPLATES, 'nothing')).toEqual([]);
    });

    it('a template without a description is searched by name and id', () => {
        expect(filterTemplates([tpl('dt', 'DT Charts')], 'dt').map((t) => t.id)).toEqual(['dt']);
    });
});

describe('currentTemplateId', () => {
    it('is the active template while no saved layout is current', () => {
        expect(currentTemplateId({ list: TEMPLATES, active: 'casey' }, { current: null })).toBe('casey');
    });

    it('is none once a saved layout is current, without an active id, or for an unknown id', () => {
        expect(currentTemplateId({ list: TEMPLATES, active: 'casey' }, { current: mk('a', 'x', 1) })).toBeNull();
        expect(currentTemplateId({ list: TEMPLATES }, { current: null })).toBeNull();
        expect(currentTemplateId({ list: TEMPLATES, active: 'nope' }, { current: null })).toBeNull();
        expect(currentTemplateId(undefined, { current: null })).toBeNull();
    });
});
