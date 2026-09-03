import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { resources } from '../lib/i18n.ts';
import { renderInApp } from '../test/render.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';

const t = resources.es.translation;

const props = {
  open: true,
  title: 'Borrar la conversacion',
  body: 'Esta accion no se puede deshacer.',
};

/**
 * The behaviour is Radix's, but it is behaviour this app depends on: the
 * question is destructive, so it has to be answerable and dismissable from the
 * keyboard alone. A CSS-only dialog would pass a screenshot and fail this.
 */
describe('ConfirmDialog', () => {
  it('names itself and its question to assistive technology', async () => {
    renderInApp(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const dialog = await screen.findByRole('alertdialog', { name: props.title });
    expect(dialog).toHaveTextContent(props.body);
  });

  it('moves focus into the dialog, onto the non-destructive choice', async () => {
    renderInApp(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: t.common.cancel })).toHaveFocus(),
    );
  });

  it('confirms from the keyboard without a mouse ever being used', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderInApp(<ConfirmDialog {...props} onConfirm={onConfirm} onCancel={vi.fn()} />);

    await screen.findByRole('alertdialog');
    await user.tab();
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('cancels on Escape', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderInApp(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={onCancel} />);

    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
