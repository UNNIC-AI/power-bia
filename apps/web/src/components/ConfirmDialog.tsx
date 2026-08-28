import { AlertDialog } from 'radix-ui';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  title: string;
  body: string;
  /** Defaults to a plain "Delete"; pass one when the verb should differ. */
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Radix `AlertDialog` rather than the native `<dialog>` this used to be: same
 * focus trap, Esc handling and inert background, but driven by the `open` prop
 * instead of an effect calling `showModal()`. It also defaults focus to Cancel
 * and wires `aria-labelledby`/`aria-describedby` to the title and body, which is
 * the right shape for a destructive question.
 */
export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        {/*
         * Styled from tokens rather than with DaisyUI's `modal-box`: that class
         * is transparent and scaled down until an enclosing `.modal` opens it,
         * so on a Radix content element it rendered a perfectly invisible
         * dialog — present in the accessibility tree, absent on screen.
         */}
        <AlertDialog.Content className="bg-base-100 border-base-300 rounded-box fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 border p-6 shadow-xl">
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-base-content/70 mt-2 text-sm">
            {body}
          </AlertDialog.Description>

          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button type="button" className="btn btn-ghost btn-sm">
                {t('common.cancel')}
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button type="button" className="btn btn-error btn-sm" onClick={onConfirm}>
                {confirmLabel ?? t('common.delete')}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
