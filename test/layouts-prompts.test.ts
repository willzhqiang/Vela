// @vitest-environment jsdom
// The two questions the layouts menu asks: a name, and "are you sure?".
import { describe, it, expect, afterEach } from 'vitest';
import { promptName, confirmAction } from '../src/widget/layouts-prompts';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

afterEach(() => {
    document.body.innerHTML = '';
});

const qa = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const button = (text: string): HTMLButtonElement => qa('button').find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const field = (): HTMLInputElement => document.querySelector<HTMLInputElement>('input[type="text"]')!;
const write = (el: HTMLInputElement, text: string): void => {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
};
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe('promptName', () => {
    it('opens with the title, the current value and Cancel / confirm buttons', async () => {
        const p = promptName({ title: 'Rename layout', value: 'Morning', confirmLabel: 'Save' });
        await flush();
        expect(document.querySelector('.vela-dialog-title')!.textContent).toBe('Rename layout');
        expect(field().value).toBe('Morning');
        expect(button('Cancel')).toBeTruthy();
        expect(button('Save')).toBeTruthy();
        button('Cancel').click();
        await p;
    });

    it('resolves the trimmed name on confirm and removes the dialog', async () => {
        const p = promptName({ title: 'Make a copy', value: 'A' });
        await flush();
        write(field(), '  A (copy)  ');
        button('OK').click();
        expect(await p).toBe('A (copy)');
        expect(document.querySelector('.vela-dialog')).toBeNull();
    });

    it('Enter confirms', async () => {
        const p = promptName({ title: 'x', value: 'one' });
        await flush();
        field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(await p).toBe('one');
    });

    it('cannot confirm an empty or blank name', async () => {
        const p = promptName({ title: 'x', value: '' });
        await flush();
        expect(button('OK').disabled).toBe(true);
        write(field(), '   ');
        expect(button('OK').disabled).toBe(true);
        button('OK').click();
        field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(document.querySelector('.vela-dialog')).not.toBeNull();
        write(field(), 'ok');
        expect(button('OK').disabled).toBe(false);
        button('OK').click();
        expect(await p).toBe('ok');
    });

    it('resolves null on Cancel and on Escape', async () => {
        const a = promptName({ title: 'x', value: 'one' });
        await flush();
        button('Cancel').click();
        expect(await a).toBeNull();
        const b = promptName({ title: 'x', value: 'one' });
        await flush();
        document.querySelector('.vela-dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(await b).toBeNull();
    });

    it('limits the name to 80 characters (the server refuses more)', async () => {
        const p = promptName({ title: 'x', value: '' });
        await flush();
        expect(field().maxLength).toBe(80);
        button('Cancel').click();
        await p;
    });
});

describe('confirmAction', () => {
    it('shows the message and resolves true on confirm', async () => {
        const p = confirmAction({ title: 'Delete layout', message: 'Delete "Morning"?', confirmLabel: 'Delete', danger: true });
        await flush();
        expect(document.querySelector('.vela-lay-prompt-message')!.textContent).toBe('Delete "Morning"?');
        button('Delete').click();
        expect(await p).toBe(true);
        expect(document.querySelector('.vela-dialog')).toBeNull();
    });

    it('resolves false on Cancel and on the close button', async () => {
        const a = confirmAction({ title: 't', message: 'm' });
        await flush();
        button('Cancel').click();
        expect(await a).toBe(false);
        const b = confirmAction({ title: 't', message: 'm' });
        await flush();
        document.querySelector<HTMLElement>('.vela-dialog-close')!.click();
        expect(await b).toBe(false);
    });
});
