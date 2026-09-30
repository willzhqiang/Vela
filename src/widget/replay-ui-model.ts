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

// ── where the floating bar sits ──

/** The bar's spot as fractions (0..1) of the free space around it, so it survives a resized host. */
export interface BarPlacement {
    fx: number;
    fy: number;
}

interface Size {
    w: number;
    h: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Pixel position of the bar's top-left corner inside `host`; never outside it. */
export function placeBar(host: Size, bar: Size, p: BarPlacement): { left: number; top: number } {
    return { left: clamp01(p.fx) * Math.max(0, host.w - bar.w), top: clamp01(p.fy) * Math.max(0, host.h - bar.h) };
}

/** The fractions for a bar dragged to `left`/`top` (clamped to the host; no free space ⇒ the origin). */
export function placementFromPixels(host: Size, bar: Size, left: number, top: number): BarPlacement {
    const freeW = host.w - bar.w;
    const freeH = host.h - bar.h;
    return { fx: freeW > 0 ? clamp01(left / freeW) : 0, fy: freeH > 0 ? clamp01(top / freeH) : 0 };
}

/** A stored placement, or null when it is not two finite numbers (values outside 0..1 are clamped). */
export function sanitizePlacement(v: unknown): BarPlacement | null {
    if (v === null || typeof v !== 'object') return null;
    const { fx, fy } = v as { fx?: unknown; fy?: unknown };
    if (typeof fx !== 'number' || typeof fy !== 'number' || !Number.isFinite(fx) || !Number.isFinite(fy)) return null;
    return { fx: clamp01(fx), fy: clamp01(fy) };
}
