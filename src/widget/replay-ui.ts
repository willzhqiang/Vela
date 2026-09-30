// Bar-replay UI: picking where a replay starts, and the floating control bar that drives it.
//
// It drives a workspace's replay (`workspace.replay`), so a start picked on one chart rewinds
// every chart on the shared clock. While a start is being picked, each chart shows a dashed
// vertical line at the bar under the pointer, with everything to its right veiled (the
// renderer's `crosshairOverride` seam); the other charts mirror the line as a ghost at the
// same time. A click on a bar starts the replay there, paused.
import type { RendererControl } from '../core/RendererControl';
import { ACCENT } from '../core/palette';
import type { WorkspaceReplay } from '../workspace/WorkspaceReplay';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { ReplayUiModel, REPLAY_SPEEDS, type ReplaySpeed, type ReplayUiPhase, type ReplayUiSnapshot } from './replay-ui-model';

const STYLE_ID = 'vela-replay-ui';
const CSS = `
.vela-replay {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    /* Above cell chrome (status line 10) and the splitters (30) — in a grid the bar sits on a seam —
       but below dialogs (40) and menus (50). */
    z-index: 35;
    display: flex;
    align-items: center;
    gap: var(--vela-space-1);
    padding: 3px;
    max-width: calc(100% - 20px);
    box-sizing: border-box;
    background: var(--vela-surface-elev);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border);
    border-radius: var(--vela-radius-md);
    box-shadow: var(--vela-shadow);
    font: var(--vela-font-size-md) var(--vela-font);
    user-select: none;
}
.vela-replay[hidden], .vela-replay [hidden] { display: none !important; }
.vela-replay-part { display: flex; align-items: center; gap: var(--vela-space-1); }
.vela-replay-btn {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 28px;
    height: 28px;
    padding: 0 6px;
    border-radius: var(--vela-radius-sm);
    color: var(--vela-fg-bright);
    cursor: pointer;
    white-space: nowrap;
}
.vela-replay-btn:hover { background: var(--vela-hover); }
.vela-replay-btn:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: -2px; }
.vela-replay-btn[disabled] { opacity: 0.4; cursor: default; pointer-events: none; }
.vela-replay-btn[aria-pressed='true'] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
.vela-replay-sep { width: 1px; height: 18px; background: var(--vela-border-soft); margin: 0 2px; }
.vela-replay-speeds { display: flex; align-items: center; gap: 1px; }
.vela-replay-speeds .vela-replay-btn { min-width: 34px; font-size: 12px; font-weight: 550; color: var(--vela-fg-muted); }
.vela-replay-speeds .vela-replay-btn[aria-pressed='true'] { color: var(--vela-selected-fg); }
.vela-replay-status { padding: 0 8px; color: var(--vela-fg-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.vela-replay-hint { padding: 0 8px; color: var(--vela-fg-bright); }
`;

/** The slice of a chart's renderer the picker drives. */
export type ReplayUiRenderer = Pick<RendererControl, 'get' | 'set' | 'onClick' | 'onCrosshairMove' | 'setExternalCrosshair'>;

export interface ReplayUiCell {
    readonly id: string;
    readonly chart: { readonly renderer: ReplayUiRenderer };
}

/** The verbs of a workspace replay the UI calls. */
export type ReplayUiReplay = Pick<WorkspaceReplay, 'start' | 'step' | 'play' | 'pause' | 'stop' | 'on' | 'state'>;

export interface ReplayUiOptions {
    /** A positioned element the bar floats in (the chart grid). */
    host: HTMLElement;
    replay: ReplayUiReplay;
    cells(): readonly ReplayUiCell[];
    activeId(): string | null;
    /** Cell lifecycle, so a chart added mid-pick joins it and a removed one is dropped. */
    onCells(handler: (e: { kind: 'created' | 'destroyed' | 'active'; id: string }) => void): () => void;
    /** Opens the host's date dialog; it reports the chosen time back through {@link ReplayUi.startFromDate}. */
    openDatePicker?(): void;
    toast?(message: string, kind?: 'info' | 'success' | 'error'): void;
    /** The speed selector's choices (default: 1x / 3x / 10x = 1000 / 333 / 100 ms per bar). */
    speeds?: readonly ReplaySpeed[];
    /** Called after every phase or pace change — hosts mirror it on a toolbar button. */
    onChange?(snapshot: ReplayUiSnapshot): void;
}

/** The keyboard chord that toggles replay. Alt+R already resets the view, so replay takes Alt+Shift+R. */
export const REPLAY_CHORD = 'alt+shift+r';

const FALLBACK_VEIL = '#000000';

export class ReplayUi {
    readonly model = new ReplayUiModel();
    private readonly doc: Document;
    private readonly root: HTMLElement;
    private readonly pickPart: HTMLElement;
    private readonly controlsPart: HTMLElement;
    private readonly playBtn: HTMLButtonElement;
    private readonly stepBtn: HTMLButtonElement;
    private readonly speedBtns = new Map<number, HTMLButtonElement>();
    private readonly statusEl: HTMLElement;
    private readonly speeds: readonly ReplaySpeed[];
    private readonly offs: Array<() => void> = [];
    /** Per-cell teardown of the pick listeners, and the crosshair override each cell had before. */
    private readonly cellOffs = new Map<string, () => void>();
    private readonly savedOverride = new Map<string, unknown>();
    private offCells: (() => void) | null = null;
    private armed = false;
    private destroyed = false;

    constructor(private readonly opts: ReplayUiOptions) {
        this.doc = opts.host.ownerDocument;
        this.speeds = opts.speeds ?? REPLAY_SPEEDS;
        injectStyles(STYLE_ID, CSS, this.doc);

        this.root = this.doc.createElement('div');
        this.root.className = 'vela-replay';
        this.root.setAttribute('role', 'toolbar');
        this.root.setAttribute('aria-label', 'Bar replay');
        this.root.hidden = true;

        this.pickPart = this.part();
        const hint = this.doc.createElement('span');
        hint.className = 'vela-replay-hint';
        hint.textContent = 'Click a bar to start the replay';
        this.pickPart.append(hint);
        if (opts.openDatePicker) this.pickPart.append(this.button('date', null, 'Select date…', () => opts.openDatePicker?.()));
        this.pickPart.append(this.button('cancel', null, 'Cancel', () => this.cancelPick()));

        this.controlsPart = this.part();
        this.playBtn = this.button('play', 'play', 'Play', () => this.togglePlay());
        this.stepBtn = this.button('step', 'step-forward', 'Step forward one bar', () => this.step());
        const speedsEl = this.doc.createElement('span');
        speedsEl.className = 'vela-replay-speeds';
        speedsEl.setAttribute('role', 'group');
        speedsEl.setAttribute('aria-label', 'Replay speed');
        for (const speed of this.speeds) {
            const b = this.button(`speed-${speed.label}`, null, speed.label, () => this.setSpeed(speed.intervalMs));
            b.title = `${speed.label} — one bar every ${speed.intervalMs} ms`;
            this.speedBtns.set(speed.intervalMs, b);
            speedsEl.append(b);
        }
        this.statusEl = this.doc.createElement('span');
        this.statusEl.className = 'vela-replay-status';
        this.statusEl.setAttribute('aria-live', 'polite');
        this.controlsPart.append(
            this.button('restart', 'replay', 'Choose a new start bar', () => this.beginPick()),
            this.sep(),
            this.playBtn,
            this.stepBtn,
            this.sep(),
            speedsEl,
            this.statusEl,
            this.button('exit', 'close', 'Exit replay', () => this.exit()),
        );

        this.root.append(this.pickPart, this.controlsPart);
        opts.host.appendChild(this.root);

        this.offs.push(
            opts.replay.on('replay:start', () => {
                this.model.engine('start');
                this.renderStatus();
            }),
            opts.replay.on('replay:play', ({ intervalMs }) => this.model.engine('play', intervalMs)),
            opts.replay.on('replay:pause', () => this.model.engine('pause')),
            opts.replay.on('replay:step', () => this.renderStatus()),
            opts.replay.on('replay:end', ({ reason }) => {
                this.model.engine('end');
                if (reason === 'finished') opts.toast?.('Replay reached the last bar');
            }),
            this.model.subscribe((s) => this.onModel(s)),
        );

        // A replay started through the API before this UI existed.
        const state = opts.replay.state;
        if (state.active) {
            this.model.engine('start');
            if (state.playing) this.model.engine('play', state.intervalMs);
        }
        this.onModel(this.model.snapshot());
    }

    get phase(): ReplayUiPhase {
        return this.model.phase;
    }

    subscribe(fn: (s: ReplayUiSnapshot) => void): () => void {
        return this.model.subscribe(fn);
    }

    /** Idle → choose a start; choosing → cancel; replaying → exit. */
    toggle(): void {
        if (this.model.picking) this.cancelPick();
        else if (this.model.active) this.exit();
        else this.beginPick();
    }

    /** Start choosing a start bar (from idle, or to move the start of a running replay). */
    beginPick(): void {
        if (this.destroyed || this.opts.cells().length === 0) return;
        if (this.opts.replay.state.playing) this.opts.replay.pause();
        this.model.beginPick();
    }

    cancelPick(): void {
        this.model.endPick();
    }

    /** Start (or restart) the replay at `time` (epoch ms): the chart keeps every bar opened at or before it. */
    async startFromDate(time: number, cell?: string): Promise<void> {
        const id = cell ?? this.opts.activeId() ?? this.opts.cells()[0]?.id;
        if (id === undefined) return;
        this.model.endPick();
        try {
            await this.opts.replay.start({ from: time, cell: id });
        } catch (err) {
            this.opts.toast?.(`Could not start the replay: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    }

    togglePlay(): void {
        if (!this.model.canPlay) return;
        if (this.model.phase === 'playing') this.opts.replay.pause();
        else this.opts.replay.play(this.model.intervalMs);
    }

    step(): void {
        if (!this.model.canStep) return;
        if (!this.opts.replay.step()) this.opts.toast?.('No more bars to reveal');
    }

    /** Set the pace (ms per bar); takes effect at once while playing. */
    setSpeed(intervalMs: number): void {
        this.model.setInterval(intervalMs);
        if (this.model.phase === 'playing') this.opts.replay.play(intervalMs);
    }

    /** Leave replay (or the start pick): every chart returns to its full history. */
    exit(): void {
        if (this.model.active) this.opts.replay.stop();
        else this.cancelPick();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.disarm();
        for (const off of this.offs.splice(0)) off();
        this.root.remove();
    }

    // ── model → DOM ──

    private onModel(s: ReplayUiSnapshot): void {
        if (this.destroyed) return;
        const wantArmed = s.phase === 'picking';
        if (wantArmed && !this.armed) this.arm();
        else if (!wantArmed && this.armed) this.disarm();
        this.root.hidden = s.phase === 'idle';
        this.root.dataset.phase = s.phase;
        this.pickPart.hidden = s.phase !== 'picking';
        this.controlsPart.hidden = s.phase === 'idle' || s.phase === 'picking';
        const playing = s.phase === 'playing';
        this.playBtn.replaceChildren(iconEl(playing ? 'pause' : 'play', this.doc));
        this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        this.playBtn.title = playing ? 'Pause' : 'Play';
        this.playBtn.disabled = !this.model.canPlay;
        this.stepBtn.disabled = !this.model.canStep;
        for (const [ms, b] of this.speedBtns) b.setAttribute('aria-pressed', String(ms === s.intervalMs));
        this.renderStatus();
        this.opts.onChange?.(s);
    }

    private renderStatus(): void {
        const { active, remaining } = this.opts.replay.state;
        this.statusEl.textContent = active ? `${remaining.toLocaleString('en-US')} ${remaining === 1 ? 'bar' : 'bars'} left` : '';
    }

    private part(): HTMLElement {
        const el = this.doc.createElement('span');
        el.className = 'vela-replay-part';
        return el;
    }

    private sep(): HTMLElement {
        const el = this.doc.createElement('span');
        el.className = 'vela-replay-sep';
        el.setAttribute('aria-hidden', 'true');
        return el;
    }

    private button(act: string, icon: string | null, label: string, onClick: () => void): HTMLButtonElement {
        const b = this.doc.createElement('button');
        b.type = 'button';
        b.className = 'vela-replay-btn';
        b.dataset.act = act;
        if (icon) {
            b.append(iconEl(icon, this.doc));
            b.setAttribute('aria-label', label);
            b.title = label;
        } else {
            b.textContent = label;
        }
        b.addEventListener('click', onClick);
        return b;
    }

    // ── picking ──

    private arm(): void {
        this.armed = true;
        for (const cell of this.opts.cells()) this.armCell(cell);
        this.offCells = this.opts.onCells((e) => {
            if (e.kind === 'created') {
                const cell = this.opts.cells().find((c) => c.id === e.id);
                if (cell) this.armCell(cell);
            } else if (e.kind === 'destroyed') {
                this.cellOffs.get(e.id)?.();
                this.cellOffs.delete(e.id);
                this.savedOverride.delete(e.id);
            }
        });
        this.doc.addEventListener('keydown', this.onKey, true);
    }

    private disarm(): void {
        if (!this.armed) return;
        this.armed = false;
        this.doc.removeEventListener('keydown', this.onKey, true);
        this.offCells?.();
        this.offCells = null;
        for (const cell of this.opts.cells()) {
            const off = this.cellOffs.get(cell.id);
            if (!off) continue;
            off();
            const r = cell.chart.renderer;
            r.set('crosshairOverride', this.savedOverride.get(cell.id) ?? null);
            r.setExternalCrosshair(null);
        }
        this.cellOffs.clear();
        this.savedOverride.clear();
    }

    private armCell(cell: ReplayUiCell): void {
        if (this.cellOffs.has(cell.id)) return;
        const r = cell.chart.renderer;
        this.savedOverride.set(cell.id, r.get('crosshairOverride'));
        r.set('crosshairOverride', this.pickStyle());
        const offs = [
            r.onClick(({ time }) => {
                if (time != null) void this.startFromDate(time, cell.id);
            }),
            r.onCrosshairMove(({ time }) => this.mirror(cell.id, time)),
        ];
        this.cellOffs.set(cell.id, () => {
            for (const off of offs) off();
        });
    }

    /** Show the hovered time as a ghost line on every OTHER chart. */
    private mirror(sourceId: string, time: number | null): void {
        for (const c of this.opts.cells()) c.chart.renderer.setExternalCrosshair(c.id === sourceId ? null : time);
    }

    private pickStyle(): Record<string, unknown> {
        const cs = this.doc.defaultView?.getComputedStyle(this.opts.host);
        const accent = cs?.getPropertyValue('--vela-accent').trim() || ACCENT;
        const veil = cs?.getPropertyValue('--vela-bg').trim() || FALLBACK_VEIL;
        return { vertical: true, horizontal: false, color: accent, width: 1, style: 'dashed', opacity: 1, shadeRight: { color: veil, opacity: 0.7 } };
    }

    private readonly onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape' || !this.model.picking) return;
        // Escape inside an open dialog (the date picker) closes that dialog, not the pick.
        if ((e.target as Element | null)?.closest?.('[role="dialog"]')) return;
        this.cancelPick();
    };
}
