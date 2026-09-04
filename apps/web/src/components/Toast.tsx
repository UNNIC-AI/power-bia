import { useEffect } from 'react';

const DISMISS_MS = 4_000;

/*
 * Pinning a card used to be completely silent: the request succeeded, the chat
 * did not change, and the only way to know it had worked was to open the view.
 * `role="status"` rather than `role="alert"` because this confirms an action the
 * reader just took - it should not interrupt what a screen reader is saying.
 */
export function Toast({
  message,
  failed = false,
  onDismiss,
}: {
  message: string;
  failed?: boolean;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, DISMISS_MS);

    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="toast toast-end toast-bottom z-50 print:hidden">
      <output className={`alert text-sm shadow-lg ${failed ? 'alert-error' : 'alert-success'}`}>
        {message}
      </output>
    </div>
  );
}
