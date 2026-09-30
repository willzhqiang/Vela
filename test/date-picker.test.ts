// The DatePicker controller (vela/ui) — panel navigation and picking, no DOM.
import { describe, it, expect } from 'vitest';
import { datePickerController } from '../src/ui/components/date-picker';

const TODAY = new Date(2026, 8, 24);

describe('datePickerController', () => {
    it('opens on the selected month, pads the first week, rings today', () => {
        const c = datePickerController({ value: '2026-09-10', today: TODAY });
        expect(c.header()).toEqual({ month: 'September', monthVisible: true, year: '2026', yearDisabled: false });
        const cells = c.cells();
        expect(cells.filter((x) => x.blank)).toHaveLength(2); // 1 Sep 2026 is a Tuesday
        expect(cells.find((x) => x.checked)?.value).toBe('2026-09-10');
        expect(cells.find((x) => x.today)?.value).toBe('2026-09-24');
    });

    it('steps months across the year boundary, and years / decades on the other panels', () => {
        const c = datePickerController({ value: '2026-12-05', today: TODAY });
        c.step(1);
        expect([c.year, c.month]).toEqual([2027, 0]);
        c.showMonths();
        c.step(-1);
        expect(c.year).toBe(2026);
        c.showYears();
        expect(c.header().year).toBe('2020-2029');
        c.step(1);
        expect(c.header().year).toBe('2030-2039');
        expect(c.cells().filter((x) => x.outside).map((x) => x.value)).toEqual([2029, 2040]);
    });

    it('a year leads to its months, a month to its days, and only a day is a pick', () => {
        const c = datePickerController({ today: TODAY });
        c.showYears();
        expect(c.choose(c.cells().find((x) => x.value === 2021)!)).toBeNull();
        expect(c.panel).toBe('month');
        expect(c.choose(c.cells()[2]!)).toBeNull(); // March
        expect([c.panel, c.year, c.month]).toEqual(['date', 2021, 2]);
        const picked = c.choose(c.cells().find((x) => x.value === '2021-03-15')!);
        expect(picked).toBe('2021-03-15');
        expect(c.value).toBe('2021-03-15');
    });
});

describe('datePickerController: week start, limits and ranges', () => {
    it('starts the week on Monday when asked, padding the first week to match', () => {
        const c = datePickerController({ value: '2026-09-10', today: TODAY, weekStart: 1 });
        expect(c.weekdays()).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
        expect(c.cells().filter((x) => x.blank)).toHaveLength(1); // 1 Sep 2026 is a Tuesday
        const sunday = datePickerController({ value: '2026-11-10', today: TODAY, weekStart: 1 });
        expect(sunday.cells().filter((x) => x.blank)).toHaveLength(6); // 1 Nov 2026 is a Sunday
        expect(datePickerController({ today: TODAY }).weekdays()[0]).toBe('Su'); // default unchanged
    });

    it('disables days outside min/max and does not pick them', () => {
        const c = datePickerController({ value: '2026-09-10', today: TODAY, min: '2026-09-05', max: '2026-09-20' });
        const cells = c.cells();
        expect(cells.find((x) => x.value === '2026-09-04')!.disabled).toBe(true);
        expect(cells.find((x) => x.value === '2026-09-05')!.disabled).toBeFalsy();
        expect(cells.find((x) => x.value === '2026-09-20')!.disabled).toBeFalsy();
        expect(cells.find((x) => x.value === '2026-09-21')!.disabled).toBe(true);
        expect(c.choose(cells.find((x) => x.value === '2026-09-21')!)).toBeNull();
        expect(c.value).toBe('2026-09-10');
    });

    it('disables months and years wholly outside the limits, and the arrows that would leave them', () => {
        const c = datePickerController({ value: '2026-09-10', today: TODAY, max: '2026-09-20' });
        expect(c.nav()).toEqual({ prevDisabled: false, nextDisabled: true });
        c.showMonths();
        const months = c.cells();
        expect(months[8]!.disabled).toBeFalsy(); // September
        expect(months[9]!.disabled).toBe(true); // October
        expect(c.nav().nextDisabled).toBe(true);
        c.showYears();
        expect(c.cells().find((x) => x.value === 2027)!.disabled).toBe(true);
        expect(c.cells().find((x) => x.value === 2026)!.disabled).toBeFalsy();
    });

    it('marks the days of a range: both ends and the days between', () => {
        const c = datePickerController({ today: TODAY, value: '2026-09-10' });
        c.setRange('2026-09-12', '2026-09-15');
        const byDay = (d: string) => c.cells().find((x) => x.value === d)!;
        expect(byDay('2026-09-12')).toMatchObject({ rangeStart: true, checked: true });
        expect(byDay('2026-09-15')).toMatchObject({ rangeEnd: true, checked: true });
        expect(byDay('2026-09-13').inRange).toBe(true);
        expect(byDay('2026-09-16').inRange).toBeFalsy();
        expect(byDay('2026-09-10').checked).toBe(false); // the single selection gives way to the range
        c.setRange(null, null);
        expect(byDay('2026-09-13').inRange).toBeFalsy();
    });

    it('a one-day range marks that day as both ends', () => {
        const c = datePickerController({ today: TODAY, value: '2026-09-10' });
        c.setRange('2026-09-12', '2026-09-12');
        expect(c.cells().find((x) => x.value === '2026-09-12')).toMatchObject({ rangeStart: true, rangeEnd: true, checked: true });
    });

    it('opens on the month of the range start', () => {
        const c = datePickerController({ today: TODAY });
        c.setRange('2026-03-02', '2026-03-09');
        expect([c.year, c.month]).toEqual([2026, 2]);
    });
});

describe('date picker styles', () => {
    it('hovering a selected day or a range end never repaints it (it would lose its contrast)', async () => {
        const { DATE_PICKER_CSS } = await import('../src/ui/components/date-picker/styles');
        const hover = DATE_PICKER_CSS.split('\n').find((l) => l.startsWith('.vela-date-picker-day:hover'))!;
        expect(hover).toContain(':not([data-checked])');
        expect(hover).toContain(':not([data-in-range])');
        expect(DATE_PICKER_CSS.split('\n').find((l) => l.startsWith('.vela-date-picker-cell:hover'))).toContain(':not([data-checked])');
    });
});
