// The Go to dialog's state: a single date (Date tab) or a range (Custom range tab), each a day plus a time,
// read in the chart's time zone. No DOM.
import { describe, it, expect } from 'vitest';
import { GoToModel, parseTimeInput } from '../src/widget/go-to-model';
import { zonedWallToEpoch } from '../src/core/go-to-date';

const ZONE = 'America/New_York';
const NOW = zonedWallToEpoch(2026, 9, 30, 11, 15, ZONE);
const at = (y: number, m: number, d: number, h = 0, mi = 0): number => zonedWallToEpoch(y, m, d, h, mi, ZONE);
const make = (extra: Partial<ConstructorParameters<typeof GoToModel>[0]> = {}) => new GoToModel({ zone: ZONE, now: NOW, ...extra });

describe('parseTimeInput', () => {
    it('accepts H, HH, H:mm, HH:mm and HHmm, and pads', () => {
        expect(parseTimeInput('9')).toBe('09:00');
        expect(parseTimeInput('09')).toBe('09:00');
        expect(parseTimeInput('9:05')).toBe('09:05');
        expect(parseTimeInput('13:30')).toBe('13:30');
        expect(parseTimeInput('1330')).toBe('13:30');
        expect(parseTimeInput(' 0:00 ')).toBe('00:00');
    });
    it('rejects what is not a time', () => {
        for (const bad of ['', '24:00', '12:60', 'ab', '1:2:3', '930pm', '-1']) expect(parseTimeInput(bad), bad).toBeNull();
    });
});

describe('GoToModel defaults', () => {
    it('opens on the Date tab at today 00:00 in the zone', () => {
        const m = make();
        expect(m.tab).toBe('date');
        expect(m.stamp('date')).toEqual({ day: '2026-09-30', time: '00:00' });
        expect(m.result()).toEqual({ kind: 'date', ts: at(2026, 9, 30) });
    });
    it('seeds the range from the current visible range, in the zone', () => {
        const m = make({ current: { from: at(2026, 9, 28, 13, 30), to: at(2026, 9, 29, 15, 50) } });
        expect(m.stamp('from')).toEqual({ day: '2026-09-28', time: '13:30' });
        expect(m.stamp('to')).toEqual({ day: '2026-09-29', time: '15:50' });
        expect(m.rangeDays()).toBeNull(); // the Date tab marks no range
        m.setTab('range');
        expect(m.rangeDays()).toEqual({ from: '2026-09-28', to: '2026-09-29' });
    });
    it('without a visible range the range is yesterday 00:00 to now', () => {
        const m = make();
        expect(m.stamp('from')).toEqual({ day: '2026-09-29', time: '00:00' });
        expect(m.stamp('to')).toEqual({ day: '2026-09-30', time: '11:15' });
    });
    it('today is the last pickable day', () => {
        expect(make().maxDay).toBe('2026-09-30');
    });
});

describe('tabs and fields', () => {
    it('switching tabs changes what result() returns and keeps each tab\'s own values', () => {
        const m = make();
        m.pickDay('2026-09-10');
        m.setTab('range');
        expect(m.result()!.kind).toBe('range');
        m.setTab('date');
        expect(m.stamp('date').day).toBe('2026-09-10');
    });
    it('the range tab starts on the start field, the date tab on the date field', () => {
        const m = make();
        expect(m.field).toBe('date');
        m.setTab('range');
        expect(m.field).toBe('from');
        m.setTab('date');
        expect(m.field).toBe('date');
    });
    it('a dialog without ranges stays on the Date tab', () => {
        const m = make({ ranges: false });
        m.setTab('range');
        expect(m.tab).toBe('date');
    });
});

describe('picking days on the calendar', () => {
    it('Date tab: a day replaces the date and keeps the time', () => {
        const m = make();
        m.typeTime('date', '10:30');
        m.pickDay('2026-09-10');
        expect(m.result()).toEqual({ kind: 'date', ts: at(2026, 9, 10, 10, 30) });
    });
    it('Range tab: the first click sets the start and moves on to the end; the second sets the end', () => {
        const m = make();
        m.setTab('range');
        m.pickDay('2026-09-01');
        expect(m.stamp('from').day).toBe('2026-09-01');
        expect(m.field).toBe('to');
        m.pickDay('2026-09-05');
        expect(m.stamp('to').day).toBe('2026-09-05');
        expect(m.field).toBe('from'); // the next click starts over
        expect(m.rangeDays()).toEqual({ from: '2026-09-01', to: '2026-09-05' });
    });
    it('an end picked before the start swaps them', () => {
        const m = make();
        m.setTab('range');
        m.pickDay('2026-09-10');
        m.pickDay('2026-09-03');
        expect(m.rangeDays()).toEqual({ from: '2026-09-03', to: '2026-09-10' });
    });
    it('clicking while the end field is active sets the end directly', () => {
        const m = make({ current: { from: at(2026, 9, 10, 9, 30), to: at(2026, 9, 12, 16, 0) } });
        m.setTab('range');
        m.focusField('to');
        m.pickDay('2026-09-20');
        expect(m.stamp('to')).toEqual({ day: '2026-09-20', time: '16:00' });
        expect(m.stamp('from').day).toBe('2026-09-10');
    });
    it('a future day is not pickable', () => {
        const m = make();
        m.pickDay('2026-10-01');
        expect(m.stamp('date').day).toBe('2026-09-30');
    });
});

describe('typing', () => {
    it('a typed day is normalised; words and short forms work like Alt+G always did', () => {
        const m = make();
        expect(m.typeDay('date', '2026-9-5')).toBe(true);
        expect(m.stamp('date').day).toBe('2026-09-05');
        expect(m.typeDay('date', 'yesterday')).toBe(true);
        expect(m.stamp('date').day).toBe('2026-09-29');
        expect(m.typeDay('date', '06-15')).toBe(true);
        expect(m.stamp('date').day).toBe('2026-06-15');
    });
    it('junk, impossible and future days are refused and change nothing', () => {
        const m = make();
        for (const bad of ['', 'abc', '2026-02-30', '2026-10-01', '2027-01-01']) {
            expect(m.typeDay('date', bad), bad).toBe(false);
        }
        expect(m.stamp('date').day).toBe('2026-09-30');
    });
    it('a typed time is normalised; a bad one is refused', () => {
        const m = make();
        expect(m.typeTime('date', '9:05')).toBe(true);
        expect(m.stamp('date').time).toBe('09:05');
        expect(m.typeTime('date', '25:00')).toBe(false);
        expect(m.stamp('date').time).toBe('09:05');
    });
    it('a date typed with a time in it sets both', () => {
        const m = make();
        expect(m.typeDay('date', '2026-06-15 10:30')).toBe(true);
        expect(m.stamp('date')).toEqual({ day: '2026-06-15', time: '10:30' });
    });
});

describe('result and errors', () => {
    it('a range is epoch-ms in the zone, start first', () => {
        const m = make({ current: { from: at(2026, 9, 28, 13, 30), to: at(2026, 9, 29, 15, 50) } });
        m.setTab('range');
        expect(m.result()).toEqual({ kind: 'range', from: at(2026, 9, 28, 13, 30), to: at(2026, 9, 29, 15, 50) });
        expect(m.error()).toBeNull();
    });
    it('the same day with the end time before the start time is an error and gives no result', () => {
        const m = make({ current: { from: at(2026, 9, 28, 13, 30), to: at(2026, 9, 28, 15, 0) } });
        m.setTab('range');
        expect(m.typeTime('to', '09:00')).toBe(true);
        expect(m.error()).toBe('The end is before the start');
        expect(m.result()).toBeNull();
        expect(m.typeTime('to', '16:00')).toBe(true);
        expect(m.error()).toBeNull();
        expect(m.result()).not.toBeNull();
    });
    it('reads the wall clock in the given zone, DST included', () => {
        const m = make({ zone: 'UTC', now: Date.UTC(2026, 8, 30, 12, 0) });
        m.typeDay('date', '2026-06-15');
        m.typeTime('date', '10:30');
        expect(m.result()).toEqual({ kind: 'date', ts: Date.UTC(2026, 5, 15, 10, 30) });
    });
});

describe('change notifications', () => {
    it('reports real changes only', () => {
        const m = make();
        let n = 0;
        m.subscribe(() => (n += 1));
        m.pickDay('2026-09-10');
        m.pickDay('2026-09-10'); // same day
        m.typeTime('date', '00:00'); // same time
        m.setTab('range');
        expect(n).toBe(2);
    });
});
