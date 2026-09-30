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
