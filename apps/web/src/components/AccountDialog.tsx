import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authErrorMessage } from '../lib/auth-errors.ts';
import { useChangePassword } from '../lib/queries.ts';
import { PasswordField } from './PasswordField.tsx';

interface Props {
  open: boolean;
  email: string;
  onClose: () => void;
}

const SURFACE =
  'bg-base-100 border-base-300 rounded-box fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border p-6 shadow-xl';

/**
 * The whole of a member's self-service: email, name and role belong to an admin,
 * so the only thing here is the password. Changing it drops every other session
 * of the account server-side, which is why the confirmation says so.
 */
export function AccountDialog({ open, email, onClose }: Props) {
  const { t } = useTranslation();
  const change = useChangePassword();
  const { reset } = change;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');

  /* Nothing is carried over between openings - not the error, not the fields. */
  useEffect(() => {
    if (!open) return;

    reset();
    setCurrent('');
    setNext('');
    setRepeat('');
  }, [open, reset]);

  const mismatch = repeat.length > 0 && next !== repeat;
  const submittable = current.length > 0 && next.length >= 12 && next === repeat;

  return (
    <Dialog.Root open={open} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className={SURFACE}>
          <Dialog.Title className="text-base font-semibold">{t('account.title')}</Dialog.Title>
          <Dialog.Description className="text-base-content/70 mt-1 text-sm">
            {email}
          </Dialog.Description>

          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              change.mutate({ currentPassword: current, newPassword: next });
            }}
          >
            <PasswordField
              label={t('account.currentPassword')}
              value={current}
              autoComplete="current-password"
              onChange={setCurrent}
            />
            <PasswordField
              label={t('account.newPassword')}
              value={next}
              autoComplete="new-password"
              minLength={12}
              onChange={setNext}
            />
            <PasswordField
              label={t('account.repeatPassword')}
              value={repeat}
              autoComplete="new-password"
              minLength={12}
              onChange={setRepeat}
            />
            <p className="text-base-content/60 text-xs">{t('auth.passwordHint')}</p>

            {mismatch && (
              <div role="alert" className="alert alert-warning py-2 text-sm">
                <span>{t('account.mismatch')}</span>
              </div>
            )}

            {change.error && (
              <div role="alert" className="alert alert-error py-2 text-sm">
                <span>{authErrorMessage(change.error, t)}</span>
              </div>
            )}

            {change.isSuccess && (
              <div role="alert" className="alert alert-success py-2 text-sm">
                <span>{t('account.changed')}</span>
              </div>
            )}

            <div className="mt-2 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="btn btn-ghost btn-sm">
                  {change.isSuccess ? t('common.close') : t('common.cancel')}
                </button>
              </Dialog.Close>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!submittable || change.isPending}
              >
                {change.isPending && <span className="loading loading-spinner loading-xs" />}
                {t('account.save')}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
