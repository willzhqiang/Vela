// @vitest-environment jsdom
// The Go to dialog as a user drives it: tabs, the date/time fields, the month calendar, Cancel / Go to.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { GoToDialog, type GoToDialogOptions } from '../src/widget/go-to';

// jsdom ships no CSS.escape; the kit's style injection needs it for its id lookup.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

const NOW = Date.UTC(2026, 8, 30, 11, 15); // 2026-09-30 11:15 UTC
const dialogs: GoToDialog[] = [];

function make(extra: Partial<GoToDialogOptions> = {}) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onGoToDate = vi.fn();
    const onGoToRange = vi.fn();
    const onOpenChange = vi.fn();
    const d = new GoToDialog({ host, zone: () => 'UTC', now: () => NOW, onGoToDate, onGoToRange, onOpenChange, ...extra });
    dialogs.push(d);
    d.open();
    return { d, host, onGoToDate, onGoToRange, onOpenChange };
}
afterEach(() => {
    for (const d of dialogs.splice(0)) d.destroy();
    document.body.innerHTML = '';
});

const q = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const qa = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const input = (label: string): HTMLInputElement => q<HTMLInputElement>(`input[aria-label="${label}"]`);
const day = (iso: string): HTMLButtonElement => qa('.vela-date-picker-day').find((b) => b.dataset.day === iso) as HTMLButtonElement;
const button = (text: string): HTMLButtonElement => qa('button').find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const tab = (name: string): HTMLElement => qa('[role="tab"]').find((t) => t.textContent === name)!;
/** Type into a field the way a browser reports it: `input` per edit, then a key. */
const write = (el: HTMLInputElement, text: string): void => {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
};
const type = (el: HTMLInputElement, text: string, key = 'Enter'): void => {
    write(el, text);
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
};
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe('opening', () => {
    it('shows "Go to" with Date and Custom range tabs, today in the fields, Cancel and Go to', async () => {
        const { onOpenChange } = make();
        expect(q('.vela-dialog-title').textContent).toBe('Go to');
        expect(qa('[role="tab"]').map((t) => t.textContent)).toEqual(['Date', 'Custom range']);
        expect(tab('Date').getAttribute('aria-selected')).toBe('true');
        expect(input('Date').value).toBe('2026-09-30');
        expect(input('Time').value).toBe('00:00');
        expect(button('Cancel')).toBeTruthy();
        expect(button('Go to')).toBeTruthy();
        await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(true));
    });

    it('the calendar starts the week on Monday, opens on the current month and cannot pick the future', () => {
        make();
        expect(qa('.vela-date-picker-week span').map((s) => s.textContent)).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
        expect(q('.vela-date-picker-switch').textContent).toBe('September');
        expect(day('2026-09-30').dataset.checked).toBe('1');
        expect(qa('.vela-date-picker-day').filter((b) => b.dataset.disabled)).toHaveLength(0); // 30 is the last day of the month
        expect(q<HTMLButtonElement>('button[aria-label="Next month"]').disabled).toBe(true); // nothing to go to after today
        expect(q<HTMLButtonElement>('button[aria-label="Previous month"]').disabled).toBe(false);
    });

    it('focuses the date field', async () => {
        make();
        await new Promise((r) => setTimeout(r, 5));
        expect(document.activeElement).toBe(input('Date'));
    });
});

describe('Date tab', () => {
    it('a calendar click fills the date field; Go to applies it and closes', async () => {
        const { onGoToDate, onOpenChange } = make();
        await vi.waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(true)); // let it finish opening
        day('2026-09-10').click();
        expect(input('Date').value).toBe('2026-09-10');
        button('Go to').click();
        expect(onGoToDate).toHaveBeenCalledWith(Date.UTC(2026, 8, 10, 0, 0));
        await vi.waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(false));
    });

    it('typed date and time apply on Enter', () => {
        const { onGoToDate } = make();
        write(input('Time'), '10:30');
        input('Time').dispatchEvent(new Event('change', { bubbles: true }));
        type(input('Date'), '2026-06-15');
        expect(onGoToDate).toHaveBeenCalledWith(Date.UTC(2026, 5, 15, 10, 30));
    });

    it('words work in the date field, as they did in Alt+G', () => {
        const { onGoToDate } = make();
        type(input('Date'), 'yesterday');
        expect(onGoToDate).toHaveBeenCalledWith(Date.UTC(2026, 8, 29, 0, 0));
    });

    it('a typed day moves the calendar and its selection', () => {
        make();
        type(input('Date'), '2026-03-05', 'Tab');
        expect(q('.vela-date-picker-switch').textContent).toBe('March');
        expect(day('2026-03-05').dataset.checked).toBe('1');
    });

    it('a bad date is flagged, reverts on blur, and Go to does not fire', () => {
        const { onGoToDate } = make();
        write(input('Date'), 'nonsense');
        expect(input('Date').dataset.invalid).toBe('1');
        input('Date').dispatchEvent(new Event('blur'));
        expect(input('Date').value).toBe('2026-09-30');
        expect(input('Date').dataset.invalid).toBeUndefined();
        expect(onGoToDate).not.toHaveBeenCalled();
    });

    it('Cancel closes without applying, and reopening starts fresh', () => {
        const { d, onGoToDate } = make();
        day('2026-09-10').click();
        button('Cancel').click();
        expect(document.querySelector('.vela-goto')?.closest('[hidden]') ?? true).toBeTruthy();
        expect(onGoToDate).not.toHaveBeenCalled();
        d.open();
        expect(input('Date').value).toBe('2026-09-30');
    });
});

describe('Custom range tab', () => {
    it('shows start and end rows, seeded from the chart\'s visible range', () => {
        make({ current: () => ({ from: Date.UTC(2026, 8, 28, 13, 30), to: Date.UTC(2026, 8, 29, 15, 50) }) });
        tab('Custom range').click();
        expect(tab('Custom range').getAttribute('aria-selected')).toBe('true');
        expect(input('Start date').value).toBe('2026-09-28');
        expect(input('Start time').value).toBe('13:30');
        expect(input('End date').value).toBe('2026-09-29');
        expect(input('End time').value).toBe('15:50');
        expect(qa('input[aria-label="Date"]')).toHaveLength(0);
        expect(day('2026-09-28').dataset.rangeStart).toBe('1');
        expect(day('2026-09-29').dataset.rangeEnd).toBe('1');
    });

    it('two calendar clicks pick the range; Go to hands both ends over', () => {
        const { onGoToRange, onGoToDate } = make();
        tab('Custom range').click();
        day('2026-09-01').click();
        day('2026-09-05').click();
        expect(input('Start date').value).toBe('2026-09-01');
        expect(input('End date').value).toBe('2026-09-05');
        expect(qa('.vela-date-picker-day').filter((b) => b.dataset.inRange)).toHaveLength(3);
        button('Go to').click();
        expect(onGoToRange).toHaveBeenCalledTimes(1);
        const [from, to] = onGoToRange.mock.calls[0]!;
        expect(from).toBe(Date.UTC(2026, 8, 1, 0, 0));
        expect(to).toBe(Date.UTC(2026, 8, 5, 11, 15)); // the end keeps its default time (now)
        expect(onGoToDate).not.toHaveBeenCalled();
    });

    it('the active field is marked, and follows the clicks', () => {
        make();
        tab('Custom range').click();
        expect(input('Start date').dataset.active).toBe('1');
        day('2026-09-01').click();
        expect(input('End date').dataset.active).toBe('1');
        expect(input('Start date').dataset.active).toBeUndefined();
    });

    it('picking the end in another month keeps that month on screen', () => {
        make({ current: () => ({ from: Date.UTC(2026, 7, 10, 9, 0), to: Date.UTC(2026, 7, 12, 9, 0) }) });
        tab('Custom range').click();
        expect(q('.vela-date-picker-switch').textContent).toBe('August');
        day('2026-08-20').click(); // start again
        q('button[aria-label="Next month"]').click();
        day('2026-09-03').click(); // end, in September
        expect(q('.vela-date-picker-switch').textContent).toBe('September');
        expect(input('End date').value).toBe('2026-09-03');
    });

    it('an end before the start on one day disables Go to and says why', () => {
        const { onGoToRange } = make({ current: () => ({ from: Date.UTC(2026, 8, 28, 13, 30), to: Date.UTC(2026, 8, 28, 15, 0) }) });
        tab('Custom range').click();
        type(input('End time'), '09:00', 'Tab');
        expect(button('Go to').disabled).toBe(true);
        expect(q('.vela-goto-error').textContent).toBe('The end is before the start');
        button('Go to').click();
        expect(onGoToRange).not.toHaveBeenCalled();
        type(input('End time'), '16:00', 'Tab');
        expect(button('Go to').disabled).toBe(false);
        expect(q('.vela-goto-error').textContent).toBe('');
    });
});

describe('options', () => {
    it('without ranges there is no tab strip, just a date; title and button follow the options', () => {
        const { onGoToDate } = make({ ranges: false, title: 'Replay from', applyLabel: 'Start' });
        expect(q('.vela-dialog-title').textContent).toBe('Replay from');
        expect(qa('[role="tab"]')).toHaveLength(0);
        day('2026-09-10').click();
        button('Start').click();
        expect(onGoToDate).toHaveBeenCalledWith(Date.UTC(2026, 8, 10, 0, 0));
    });

    it('reads days and times in the chart zone', () => {
        const { onGoToDate } = make({ zone: () => 'America/New_York' });
        day('2026-09-10').click();
        button('Go to').click();
        expect(onGoToDate).toHaveBeenCalledWith(Date.UTC(2026, 8, 10, 4, 0)); // midnight in New York (UTC-4)
    });

    it('a dialog that outlives midnight opens on the new day, and that day is pickable', () => {
        let now = NOW;
        const { d } = make({ now: () => now });
        expect(day('2026-09-30').dataset.checked).toBe('1');
        d.close();
        now = Date.UTC(2026, 9, 1, 11, 15); // the next day
        d.open();
        expect(input('Date').value).toBe('2026-10-01');
        expect(day('2026-10-01').dataset.checked).toBe('1');
        expect(day('2026-10-01').disabled).toBe(false);
    });

    it('destroy removes the dialog', () => {
        const { d } = make();
        d.destroy();
        expect(document.querySelector('.vela-goto')).toBeNull();
    });
});
