import { useEffect, useId, useRef } from 'react';
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
 * Native `<dialog>` rather than a div with a fixed overlay: `showModal()` brings
 * the focus trap, Esc handling, the inert background and the top-layer stacking
 * with it, none of which are worth reimplementing. The `open` attribute alone
 * would render the element but give up all of that, so the state is driven
 * imperatively.
 */
export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    // `close` covers Esc and the backdrop alike, so cancelling has one path.
    <dialog ref={dialog} className="modal" aria-labelledby={headingId} onClose={onCancel}>
      <div className="modal-box">
        <h3 id={headingId} className="text-base font-semibold">
          {title}
        </h3>
        <p className="text-base-content/70 mt-2 text-sm">{body}</p>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-error btn-sm" onClick={onConfirm}>
            {confirmLabel ?? t('common.delete')}
          </button>
        </div>
      </div>

      <form method="dialog" className="modal-backdrop">
        <button type="submit">{t('common.cancel')}</button>
      </form>
    </dialog>
  );
}
