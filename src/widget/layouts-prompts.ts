// Two small modal questions the layouts menu asks: "what should it be called?" and "are you sure?".
// Each opens a dialog, resolves once, and removes itself — dismissing (Escape, the X, a click outside)
// answers "no" (null / false).
import { Dialog } from '../ui/components/dialog';
import { injectStyles } from '../ui/styles';

const STYLE_ID = 'vela-widget-layouts-prompts';
const CSS = `
.vela-lay-prompt { width: 380px; }
.vela-lay-prompt [hidden] { display: none !important; }
.vela-lay-prompt .vela-dialog-body { display: flex; flex-direction: column; gap: 8px; padding: 16px 20px 14px; }
.vela-lay-prompt-label { color: var(--vela-fg-muted); font-size: 13px; }
.vela-lay-prompt-input {
    width: 100%;
    height: 40px;
    box-sizing: border-box;
    padding: 0 12px;
    background: transparent;
    border: 1px solid var(--vela-border-strong);
    border-radius: 8px;
    color: var(--vela-fg-bright);
    font: inherit;
    font-size: 15px;
    outline: none;
}
.vela-lay-prompt-input:focus { border-color: var(--vela-focus); }
.vela-lay-prompt-message { color: var(--vela-fg); font-size: 14px; line-height: 1.45; }
.vela-lay-prompt .vela-dialog-btn:disabled { opacity: 0.4; cursor: default; pointer-events: none; }
.vela-lay-prompt .vela-dialog-btn-danger { border-color: var(--vela-danger); background: var(--vela-danger); color: var(--vela-selected-fg); }
.vela-lay-prompt .vela-dialog-btn-danger:hover { background: var(--vela-danger); color: var(--vela-selected-fg); border-color: var(--vela-danger); opacity: 0.85; }
`;

/** The longest layout name (the server refuses more). */
export const MAX_LAYOUT_NAME = 80;

interface ShellOptions {
    host?: HTMLElement;
    title: string;
    confirmLabel: string;
    danger?: boolean;
    body: (body: HTMLElement) => void;
    /** The confirm button is available. */
    valid?: () => boolean;
    focus?: () => HTMLElement | null;
}

/** One modal: header + body + Cancel / confirm. `answer(true)` from the confirm button or Enter. */
function shell(opts: ShellOptions): Promise<boolean> {
    return new Promise((resolve) => {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        let done = false;
        const finish = (ok: boolean): void => {
            if (done) return;
            done = true;
            resolve(ok);
            dialog.destroy();
        };
        const button = (label: string, cls: string, onClick: () => void): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = `vela-dialog-btn ${cls}`.trim();
            b.textContent = label;
            b.addEventListener('click', onClick);
            return b;
        };
        const cancel = button('Cancel', '', () => finish(false));
        const confirm = button(opts.confirmLabel, opts.danger ? 'vela-dialog-btn-danger' : 'vela-dialog-btn-primary', () => {
            if (!opts.valid || opts.valid()) finish(true);
        });
        const dialog = new Dialog({
            title: opts.title,
            host: opts.host,
            draggable: true,
            closeOnInteractOutside: true,
            className: 'vela-dialog--form vela-lay-prompt',
            initialFocusEl: () => opts.focus?.() ?? confirm,
            content: (body) => {
                opts.body(body);
                body.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && (!opts.valid || opts.valid())) {
                        e.preventDefault();
                        finish(true);
                    }
                });
            },
            footer: (foot) => foot.append(cancel, confirm),
            onOpenChange: (open) => {
                if (!open) finish(false);
            },
        });
        const sync = (): void => {
            confirm.disabled = opts.valid ? !opts.valid() : false;
        };
        sync();
        (dialog.body as HTMLElement).addEventListener('input', sync);
        dialog.show();
        setTimeout(() => {
            const el = opts.focus?.() ?? confirm;
            el.focus();
            if (el instanceof HTMLInputElement) el.select();
        }, 0);
    });
}

export interface PromptNameOptions {
    host?: HTMLElement;
    title: string;
    /** The field's label. */
    label?: string;
    value?: string;
    confirmLabel?: string;
}

/** Ask for a name. Resolves the trimmed text, or null when cancelled. An empty name cannot be confirmed. */
export async function promptName(opts: PromptNameOptions): Promise<string | null> {
    const doc = (opts.host ?? document.body).ownerDocument;
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'vela-lay-prompt-input';
    input.maxLength = MAX_LAYOUT_NAME;
    input.value = opts.value ?? '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', opts.label ?? 'Name');
    const ok = await shell({
        host: opts.host,
        title: opts.title,
        confirmLabel: opts.confirmLabel ?? 'OK',
        body: (body) => {
            const label = doc.createElement('label');
            label.className = 'vela-lay-prompt-label';
            label.textContent = opts.label ?? 'Name';
            body.append(label, input);
        },
        valid: () => input.value.trim().length > 0,
        focus: () => input,
    });
    return ok ? input.value.trim() : null;
}

export interface ConfirmOptions {
    host?: HTMLElement;
    title: string;
    message: string;
    confirmLabel?: string;
    /** Style the confirm button as destructive. */
    danger?: boolean;
}

/** Ask "are you sure?". Resolves true only on the confirm button (or Enter). */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
    const doc = (opts.host ?? document.body).ownerDocument;
    return shell({
        host: opts.host,
        title: opts.title,
        confirmLabel: opts.confirmLabel ?? 'OK',
        danger: opts.danger,
        body: (body) => {
            const p = doc.createElement('div');
            p.className = 'vela-lay-prompt-message';
            p.textContent = opts.message;
            body.appendChild(p);
        },
    });
}

/** Before an action that replaces the chart with another layout: when its unsaved changes would be lost, ask. True = go ahead. */
export async function confirmLeave(actions: { requiresConfirm(): boolean }, host: HTMLElement | undefined, verb: string): Promise<boolean> {
    if (!actions.requiresConfirm()) return true;
    return confirmAction({
        host,
        title: 'Unsaved changes',
        message: 'This layout has unsaved changes. If you continue, they will be lost.',
        confirmLabel: `Discard and ${verb}`,
        danger: true,
    });
}
