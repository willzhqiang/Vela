// State of the bar-replay UI: idle → picking → paused ⇄ playing → idle.
//
// The engine owns "is a replay running, is it playing" — it reports each change as an event
// and the model just follows (`engine`). Only `picking` is the UI's own: the pointer is
// choosing where a replay starts, on top of whatever the engine is doing (idle, or a replay
// whose start is being moved). Pure state, no DOM: the controller in `replay-ui.ts` renders it.

export type ReplayUiPhase = 'idle' | 'picking' | 'paused' | 'playing';

/** What the engine reports (`replay:start` / `replay:play` / `replay:pause` / `replay:end`). */
export type ReplayEngineEvent = 'start' | 'play' | 'pause' | 'end';

export interface ReplayUiSnapshot {
    phase: ReplayUiPhase;
    /** A replay is running (paused or playing), whether or not a new start is being picked. */
    active: boolean;
    intervalMs: number;
}

/** One entry of the speed selector: `intervalMs` is the delay between two bars. */
export interface ReplaySpeed {
    label: string;
    intervalMs: number;
}

export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [
    { label: '1x', intervalMs: 1000 },
    { label: '3x', intervalMs: 333 },
    { label: '10x', intervalMs: 100 },
];

export const DEFAULT_REPLAY_INTERVAL_MS = 1000;

/** A preset's name, else the delay itself ("250 ms", "2 s"). */
export function speedLabel(intervalMs: number, speeds: readonly ReplaySpeed[] = REPLAY_SPEEDS): string {
    const preset = speeds.find((s) => s.intervalMs === intervalMs);
    if (preset) return preset.label;
    return intervalMs % 1000 === 0 ? `${intervalMs / 1000} s` : `${Math.round(intervalMs)} ms`;
}

type Base = 'idle' | 'paused' | 'playing';

export class ReplayUiModel {
    private base: Base = 'idle';
    private pick = false;
    private interval = DEFAULT_REPLAY_INTERVAL_MS;
    private readonly listeners = new Set<(s: ReplayUiSnapshot) => void>();

    get phase(): ReplayUiPhase {
        return this.pick ? 'picking' : this.base;
    }

    get picking(): boolean {
        return this.pick;
    }

    /** A replay is running on the engine. */
    get active(): boolean {
        return this.base !== 'idle';
    }

    get intervalMs(): number {
        return this.interval;
    }

    /** Play/pause and step act on a running replay, and not while its start is being chosen. */
    get canPlay(): boolean {
        return this.active && !this.pick;
    }

    get canStep(): boolean {
        return this.canPlay;
    }

    snapshot(): ReplayUiSnapshot {
        return { phase: this.phase, active: this.active, intervalMs: this.interval };
    }

    subscribe(fn: (s: ReplayUiSnapshot) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    /** Start choosing a start bar. False when already choosing. */
    beginPick(): boolean {
        if (this.pick) return false;
        return this.change(() => (this.pick = true));
    }

    /** Stop choosing (a start was picked, or the pick was cancelled). False when not choosing. */
    endPick(): boolean {
        if (!this.pick) return false;
        return this.change(() => (this.pick = false));
    }

    /** Follow the engine. `play` carries the pace it plays at. */
    engine(event: ReplayEngineEvent, intervalMs?: number): void {
        this.change(() => {
            if (event === 'play' && intervalMs !== undefined) this.setIntervalQuiet(intervalMs);
            switch (event) {
                case 'start':
                    this.base = 'paused';
                    this.pick = false;
                    break;
                case 'play':
                    if (this.base !== 'idle') this.base = 'playing';
                    break;
                case 'pause':
                    if (this.base !== 'idle') this.base = 'paused';
                    break;
                case 'end':
                    this.base = 'idle';
                    this.pick = false;
                    break;
            }
        });
    }

    /** The pace the next `play` uses. Ignores anything that is not a positive number of ms. */
    setInterval(intervalMs: number): void {
        this.change(() => this.setIntervalQuiet(intervalMs));
    }

    private setIntervalQuiet(intervalMs: number): void {
        if (Number.isFinite(intervalMs) && intervalMs > 0) this.interval = intervalMs;
    }

    /** Run a mutation, notify only when the visible state changed. */
    private change(mutate: () => unknown): boolean {
        const before = this.snapshot();
        mutate();
        const after = this.snapshot();
        if (before.phase === after.phase && before.active === after.active && before.intervalMs === after.intervalMs) return false;
        for (const fn of [...this.listeners]) fn(after);
        return true;
    }
}
