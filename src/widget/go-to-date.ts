// Go to date — the "jump to a day" dialog (Alt+G). Opens empty; shows a live echo of what
// was understood (in the chart's display time zone); Enter applies the epoch-ms it resolved.
import { Dialog } from '../ui/components/dialog';
import { injectStyles } from '../ui/styles';
import { parseGoToDate } from '../core/go-to-date';

const STYLE_ID = 'vela-widget-gotodate';
const CSS = `
.vela-gd-input {
    display: block;
    margin: 0 auto;
    width: 260px;
    box-sizing: border-box;
    height: 40px;
    background: var(--vela-surface-elev);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    padding: 0 12px;
    font-size: 18px;
    text-align: center;
    outline: none;
}
.vela-gd-input:focus { border-color: var(--vela-border-strong); }
.vela-gd-hint { margin-top: var(--vela-space-2); text-align: center; color: var(--vela-fg-muted); min-height: 1.2em; }
.vela-gd-hint[data-invalid] { color: var(--vela-danger); }
`;

export interface GoToDateDialogOptions {
    /** The IANA zone typed dates are read in — the chart's display time zone. */
    zone: () => string;
    onApply: (ts: number) => void;
    onOpenChange?: (open: boolean) => void;
    host?: HTMLElement;
    /** Dialog title and input label (default `Go to date`) — for a host that reuses the dialog to pick a date for something else. */
    title?: string;
}

export class GoToDateDialog {
    private readonly dialog: Dialog;
    private readonly input: HTMLInputElement;
    private readonly hint: HTMLElement;

    constructor(private readonly opts: GoToDateDialogOptions) {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.input = doc.createElement('input');
        this.input.className = 'vela-gd-input';
        this.input.setAttribute('spellcheck', 'false');
        const title = opts.title ?? 'Go to date';
        this.input.setAttribute('aria-label', title);
        this.hint = doc.createElement('div');
        this.hint.className = 'vela-gd-hint';
        this.dialog = new Dialog({
            title,
            host: opts.host,
            draggable: true,
            closeOnInteractOutside: true,
            content: (body) => body.append(this.input, this.hint),
            onOpenChange: (open) => opts.onOpenChange?.(open),
        });
        this.input.addEventListener('input', () => this.renderHint());
        this.input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const parsed = parseGoToDate(this.input.value, opts.zone());
            if (parsed) {
                this.close();
                opts.onApply(parsed.ts);
            }
        });
    }

    open(): void {
        this.dialog.show();
        this.input.value = '';
        this.renderHint();
        setTimeout(() => this.input.focus(), 0);
    }

    get isOpen(): boolean {
        return this.dialog.open;
    }

    close(): void {
        this.dialog.hide();
    }

    destroy(): void {
        this.dialog.destroy();
    }

    private renderHint(): void {
        const raw = this.input.value.trim();
        const parsed = raw ? parseGoToDate(raw, this.opts.zone()) : null;
        if (!raw) {
            this.hint.textContent = 'e.g. 2026-06-15, 2026-06-15 10:30, 06-15, yesterday';
            delete this.hint.dataset.invalid;
        } else if (parsed) {
            this.hint.textContent = parsed.label;
            delete this.hint.dataset.invalid;
        } else {
            this.hint.textContent = 'Not a date';
            this.hint.dataset.invalid = '1';
        }
    }
}
