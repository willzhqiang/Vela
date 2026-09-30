// Layouts: which saved layout is current, whether the chart differs from it, autosave, and the
// actions behind the layouts menu. Host-agnostic — it talks to a LayoutStore and to a small view
// of the workspace (get/apply the state document, hear that it changed), so it is testable on its
// own and the workspace only wires it up.
import { recentLayouts, type LayoutRecord, type LayoutStore, type LayoutSummary, type LayoutsStatus } from '../widget/layouts-model';

export type { LayoutsStatus };

/** The slice of the workspace the controller drives. */
export interface LayoutsHost {
    getState(): unknown;
    applyState(state: unknown): void;
    /** The persistable state changed (the workspace debounces this ~500 ms). Returns the unsubscribe. */
    onStateChanged(fn: () => void): () => void;
}

export interface LayoutsControllerOptions {
    store: LayoutStore;
    host: LayoutsHost;
    /** Quiet time after the last change before autosave writes (default 1500 ms). */
    autosaveDelayMs?: number;
    /** Quiet time after a layout is applied before the chart counts as "as saved" (default 800 ms). A restore
     *  keeps changing the state for a moment (indicators load, bars deepen) — that is not the user's edit. */
    settleMs?: number;
    /** Initial autosave choice (default on). */
    autosave?: boolean;
    /** The autosave choice changed — persist it. */
    onAutosaveChange?(on: boolean): void;
    onError?(message: string): void;
}

/** A restore that keeps changing the state is given up on after this long (the baseline is taken then). */
const MAX_SETTLE_MS = 4_000;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class LayoutsController {
    private readonly store: LayoutStore;
    private readonly host: LayoutsHost;
    private readonly autosaveDelay: number;
    private readonly settleMs: number;
    private readonly opts: LayoutsControllerOptions;
    private cur: LayoutSummary | null = null;
    private layouts: LayoutSummary[] = [];
    private dirty = false;
    private auto: boolean;
    private busy = 0;
    private err: string | null = null;
    /** The chart's state as last saved or loaded (JSON); null = there is no saved copy to compare with. */
    private baseline: string | null = null;
    private initial: unknown = null;
    private started = false;
    private settleTimer: ReturnType<typeof setTimeout> | null = null;
    private settleDeadline = 0;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private saveAgain = false;
    private readonly listeners = new Set<(s: LayoutsStatus) => void>();
    private readonly offHost: () => void;
    private destroyed = false;

    constructor(opts: LayoutsControllerOptions) {
        this.opts = opts;
        this.store = opts.store;
        this.host = opts.host;
        this.autosaveDelay = opts.autosaveDelayMs ?? 1_500;
        this.settleMs = opts.settleMs ?? 800;
        this.auto = opts.autosave ?? true;
        this.offHost = this.host.onStateChanged(() => this.onHostChanged());
    }

    status(): LayoutsStatus {
        return { current: this.cur ? { ...this.cur } : null, dirty: this.dirty, autosave: this.auto, busy: this.busy > 0, error: this.err, layouts: [...this.layouts] };
    }

    subscribe(fn: (s: LayoutsStatus) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    /** Opening another layout would throw away changes that nothing will save. */
    requiresConfirm(): boolean {
        return this.dirty && !this.auto;
    }

    setAutosave(on: boolean): void {
        if (on === this.auto) return;
        this.auto = on;
        this.opts.onAutosaveChange?.(on);
        if (!on) this.clearSaveTimer();
        else if (this.dirty && this.cur) this.scheduleAutosave();
        this.notify();
    }

    /** Take stock at startup: remember the defaults, list the layouts, and open the most recently used one. */
    async bootstrap(): Promise<void> {
        this.started = true;
        this.initial = this.cloneState();
        const ok = await this.run(async () => {
            this.layouts = await this.store.list();
        });
        const latest = ok ? recentLayouts(this.layouts, 1)[0] : undefined;
        if (latest) await this.open(latest.id);
        else this.beginSettle();
    }

    async refresh(): Promise<boolean> {
        return this.run(async () => {
            this.layouts = await this.store.list();
        });
    }

    /** Write the chart to the current layout — or, with none, to a new one called `name`. */
    async save(name?: string): Promise<boolean> {
        if (this.cur) return this.doSave();
        const clean = name?.trim();
        if (!clean) return false;
        return this.createFrom(clean, this.host.getState());
    }

    /** Save what is on screen as a new layout and switch to it. */
    async makeCopy(name: string): Promise<boolean> {
        const clean = name.trim();
        return clean ? this.createFrom(clean, this.host.getState()) : false;
    }

    async rename(name: string): Promise<boolean> {
        const clean = name.trim();
        const cur = this.cur;
        if (!cur || !clean) return false;
        return this.run(async () => {
            const done = await this.store.rename(cur.id, clean);
            this.cur = { ...cur, name: done.name };
            this.layouts = this.layouts.map((l) => (l.id === cur.id ? { ...l, name: done.name } : l));
        });
    }

    /** A new layout from the defaults the chart had at startup; switch to it. */
    async createNew(name: string): Promise<boolean> {
        const clean = name.trim();
        if (!clean) return false;
        await this.flush();
        const state = this.initial ?? this.cloneState();
        return this.run(async () => {
            const rec = await this.store.create(clean, state);
            this.host.applyState(structuredClone(state));
            this.adopt(rec);
            this.beginSettle();
        });
    }

    async open(id: string): Promise<boolean> {
        let rec: LayoutRecord | null = null;
        const loaded = await this.run(async () => {
            rec = await this.store.load(id);
        });
        if (!loaded || !rec) return false;
        const target: LayoutRecord = rec;
        await this.flush(); // changes waiting for autosave belong to the layout being left
        this.clearSaveTimer();
        this.host.applyState(structuredClone(target.state));
        this.adopt(target);
        this.beginSettle();
        void this.store
            .touch(id)
            .then(() => {
                this.layouts = this.layouts.map((l) => (l.id === id ? { ...l, opened: Math.max(l.opened, Date.now()) } : l));
                this.notify();
            })
            .catch(() => undefined); // ordering of "recently used" is a nicety, not worth an error
        return true;
    }

    async remove(id: string): Promise<boolean> {
        return this.run(async () => {
            await this.store.remove(id);
            this.layouts = this.layouts.filter((l) => l.id !== id);
            if (this.cur?.id === id) {
                this.cur = null;
                this.baseline = null; // nothing saved to compare with any more
                this.dirty = true;
                this.clearSaveTimer();
            }
        });
    }

    /** Write pending changes now (used before switching layouts). */
    async flush(): Promise<void> {
        this.clearSaveTimer();
        if (this.dirty && this.auto && this.cur) await this.doSave();
    }

    destroy(): void {
        this.destroyed = true;
        this.offHost();
        this.clearSaveTimer();
        if (this.settleTimer) clearTimeout(this.settleTimer);
        this.settleTimer = null;
        this.listeners.clear();
    }

    // ── internals ──

    private cloneState(): unknown {
        return JSON.parse(JSON.stringify(this.host.getState()));
    }

    private snapshot(): string {
        return JSON.stringify(this.host.getState());
    }

    private adopt(rec: LayoutRecord): void {
        const summary: LayoutSummary = { id: rec.id, name: rec.name, saved: rec.saved, opened: rec.opened, symbol: rec.symbol, timeframe: rec.timeframe };
        this.cur = summary;
        this.layouts = [summary, ...this.layouts.filter((l) => l.id !== rec.id)];
        this.dirty = false;
    }

    private async createFrom(name: string, state: unknown): Promise<boolean> {
        const snap = JSON.stringify(state);
        return this.run(async () => {
            const rec = await this.store.create(name, state);
            this.adopt(rec);
            this.baseline = snap;
            this.dirty = this.snapshot() !== snap;
        });
    }

    private async doSave(): Promise<boolean> {
        const cur = this.cur;
        if (!cur) return false;
        this.clearSaveTimer();
        const snap = this.snapshot();
        const state = this.host.getState();
        const ok = await this.run(async () => {
            const rec = await this.store.save(cur.id, state);
            if (this.cur?.id === cur.id) this.cur = { ...cur, saved: rec.saved, symbol: rec.symbol, timeframe: rec.timeframe, name: rec.name };
            this.layouts = this.layouts.map((l) => (l.id === cur.id ? { ...l, saved: rec.saved, symbol: rec.symbol, timeframe: rec.timeframe, name: rec.name } : l));
            this.baseline = snap;
            this.dirty = this.snapshot() !== snap;
        });
        // Something changed while the write was in flight: write again (a failure waits for the next change).
        if (ok && (this.dirty || this.saveAgain) && this.auto && this.cur) this.scheduleAutosave();
        this.saveAgain = false;
        return ok;
    }

    private onHostChanged(): void {
        if (!this.started || this.destroyed) return;
        if (this.settleTimer) {
            // Still restoring: fold the change into the baseline instead of calling it an edit.
            if (Date.now() < this.settleDeadline) this.armSettle();
            return;
        }
        const dirty = this.baseline === null || this.snapshot() !== this.baseline;
        if (dirty !== this.dirty) this.dirty = dirty;
        if (dirty && this.cur && this.auto) this.scheduleAutosave();
        else if (!dirty) this.clearSaveTimer();
        this.notify();
    }

    private beginSettle(): void {
        this.settleDeadline = Date.now() + MAX_SETTLE_MS;
        this.armSettle();
    }

    private armSettle(): void {
        if (this.settleTimer) clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => {
            this.settleTimer = null;
            this.baseline = this.snapshot();
            this.dirty = false;
            this.notify();
        }, this.settleMs);
    }

    private scheduleAutosave(): void {
        this.clearSaveTimer();
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            if (this.busy > 0) {
                this.saveAgain = true; // the write in flight will look again when it finishes
                return;
            }
            void this.doSave();
        }, this.autosaveDelay);
    }

    private clearSaveTimer(): void {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = null;
    }

    /** Run one store interaction: track "busy", record a failure instead of throwing. */
    private async run(fn: () => Promise<void>): Promise<boolean> {
        this.busy += 1;
        this.notify();
        try {
            await fn();
            this.err = null;
            return true;
        } catch (e) {
            this.err = messageOf(e);
            this.opts.onError?.(this.err);
            return false;
        } finally {
            this.busy -= 1;
            this.notify();
        }
    }

    private notify(): void {
        if (this.destroyed) return;
        const s = this.status();
        for (const fn of [...this.listeners]) fn(s);
    }
}
