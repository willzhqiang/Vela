// The replay UI's state machine: idle → picking → paused ⇄ playing → idle. The engine is the
// source of truth for paused/playing/ended; "picking" is the UI-only layer on top of it.
import { describe, it, expect } from 'vitest';
import { ReplayUiModel, REPLAY_SPEEDS, speedLabel } from '../src/widget/replay-ui-model';

describe('ReplayUiModel phases', () => {
    it('starts idle', () => {
        const m = new ReplayUiModel();
        expect(m.phase).toBe('idle');
        expect(m.active).toBe(false);
    });

    it('idle → picking → paused once the engine starts', () => {
        const m = new ReplayUiModel();
        expect(m.beginPick()).toBe(true);
        expect(m.phase).toBe('picking');
        m.engine('start');
        expect(m.phase).toBe('paused');
        expect(m.active).toBe(true);
    });

    it('cancelling a pick from idle returns to idle', () => {
        const m = new ReplayUiModel();
        m.beginPick();
        expect(m.endPick()).toBe(true);
        expect(m.phase).toBe('idle');
    });

    it('re-picking a start while replaying returns to where the engine is when cancelled', () => {
        const m = new ReplayUiModel();
        m.engine('start');
        m.engine('play');
        expect(m.phase).toBe('playing');
        m.beginPick();
        expect(m.phase).toBe('picking');
        m.engine('pause'); // the UI pauses the engine while a new start is chosen
        m.endPick();
        expect(m.phase).toBe('paused');
    });

    it('paused ⇄ playing follow the engine', () => {
        const m = new ReplayUiModel();
        m.engine('start');
        m.engine('play');
        expect(m.phase).toBe('playing');
        m.engine('pause');
        expect(m.phase).toBe('paused');
    });

    it('a play or pause with no replay running is ignored', () => {
        const m = new ReplayUiModel();
        m.engine('play');
        expect(m.phase).toBe('idle');
        m.engine('pause');
        expect(m.phase).toBe('idle');
    });

    it('the engine ending replay always returns to idle and clears a pick in progress', () => {
        const m = new ReplayUiModel();
        m.engine('start');
        m.engine('play');
        m.beginPick();
        m.engine('end');
        expect(m.phase).toBe('idle');
        expect(m.picking).toBe(false);
        expect(m.active).toBe(false);
    });

    it('reports every real change once, and nothing for a no-op', () => {
        const m = new ReplayUiModel();
        const seen: string[] = [];
        m.subscribe((s) => seen.push(s.phase));
        m.beginPick();
        m.beginPick(); // already picking
        m.engine('start');
        m.engine('start'); // already paused
        m.engine('play');
        m.engine('end');
        m.engine('end'); // already idle
        expect(seen).toEqual(['picking', 'paused', 'playing', 'idle']);
    });

    it('unsubscribing stops notifications', () => {
        const m = new ReplayUiModel();
        let n = 0;
        const off = m.subscribe(() => (n += 1));
        m.beginPick();
        off();
        m.endPick();
        expect(n).toBe(1);
    });
});

describe('ReplayUiModel controls availability', () => {
    it('stepping and play/pause need a running replay; leaving needs one too', () => {
        const m = new ReplayUiModel();
        expect(m.canStep).toBe(false);
        expect(m.canPlay).toBe(false);
        m.beginPick();
        expect(m.canStep).toBe(false); // a start is being chosen — nothing to step yet
        m.engine('start');
        expect(m.canStep).toBe(true);
        expect(m.canPlay).toBe(true);
        m.engine('end');
        expect(m.canStep).toBe(false);
    });
});

describe('replay speeds', () => {
    it('offers 1x / 3x / 10x at 1000 / 333 / 100 ms per bar', () => {
        expect(REPLAY_SPEEDS.map((s) => [s.label, s.intervalMs])).toEqual([
            ['1x', 1000],
            ['3x', 333],
            ['10x', 100],
        ]);
    });

    it('labels a preset by name and any other pace by its delay', () => {
        expect(speedLabel(1000)).toBe('1x');
        expect(speedLabel(100)).toBe('10x');
        expect(speedLabel(250)).toBe('250 ms');
        expect(speedLabel(2000)).toBe('2 s');
    });

    it('follows the interval the engine reports', () => {
        const m = new ReplayUiModel();
        expect(m.intervalMs).toBe(1000);
        m.engine('play', 333);
        expect(m.intervalMs).toBe(333);
        m.setInterval(100);
        expect(m.intervalMs).toBe(100);
    });

    it('ignores a non-positive or non-finite pace', () => {
        const m = new ReplayUiModel();
        m.setInterval(0);
        m.setInterval(NaN);
        m.setInterval(-5);
        expect(m.intervalMs).toBe(1000);
    });
});

import { placeBar, placementFromPixels, sanitizePlacement } from '../src/widget/replay-ui-model';

describe('bar placement', () => {
    const host = { w: 1000, h: 600 };
    const bar = { w: 400, h: 40 };

    it('turns fractions of the free space into pixels', () => {
        expect(placeBar(host, bar, { fx: 0, fy: 0 })).toEqual({ left: 0, top: 0 });
        expect(placeBar(host, bar, { fx: 1, fy: 1 })).toEqual({ left: 600, top: 560 });
        expect(placeBar(host, bar, { fx: 0.5, fy: 0.5 })).toEqual({ left: 300, top: 280 });
    });

    it('keeps the bar inside a host that shrank', () => {
        expect(placeBar({ w: 300, h: 30 }, bar, { fx: 0.5, fy: 0.5 })).toEqual({ left: 0, top: 0 }); // no free space at all
    });

    it('turns pixels back into fractions, clamped to the host', () => {
        expect(placementFromPixels(host, bar, 300, 280)).toEqual({ fx: 0.5, fy: 0.5 });
        expect(placementFromPixels(host, bar, -50, 9999)).toEqual({ fx: 0, fy: 1 });
        expect(placementFromPixels(host, bar, 5000, -5)).toEqual({ fx: 1, fy: 0 });
    });

    it('round-trips through the fractions', () => {
        const p = placementFromPixels(host, bar, 123, 456);
        const px = placeBar(host, bar, p);
        expect(px.left).toBeCloseTo(123, 6);
        expect(px.top).toBeCloseTo(456, 6);
    });

    it('a host with no free space gives the origin, not NaN', () => {
        expect(placementFromPixels({ w: 400, h: 40 }, bar, 10, 10)).toEqual({ fx: 0, fy: 0 });
    });

    it('accepts only two finite fractions from storage', () => {
        expect(sanitizePlacement({ fx: 0.25, fy: 0.75 })).toEqual({ fx: 0.25, fy: 0.75 });
        expect(sanitizePlacement({ fx: 2, fy: -1 })).toEqual({ fx: 1, fy: 0 });
        for (const bad of [null, undefined, 3, 'x', {}, { fx: 'a', fy: 1 }, { fx: NaN, fy: 0 }, { fx: 0.5 }]) expect(sanitizePlacement(bad)).toBeNull();
    });
});
