import type { User } from '@powerbia/contracts';
import { IconKey, IconTrash, IconUserPlus } from '@tabler/icons-react';
import { Collapsible, Dialog } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authErrorMessage } from '../lib/auth-errors.ts';
import { useCreateUser, useDeleteUser, useResetUserPassword, useUsers } from '../lib/queries.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { PasswordField } from './PasswordField.tsx';

interface Props {
  open: boolean;
  /** The signed-in admin; their own row cannot be removed. */
  currentUserId: string;
  onClose: () => void;
}

const SURFACE =
  'bg-base-100 border-base-300 rounded-box fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border p-6 shadow-xl';

/**
 * Admin-only account management. Self-registration is closed, so this is where
 * every account after the first one comes from.
 */
export function UsersDialog({ open, currentUserId, onClose }: Props) {
  const { t } = useTranslation();
  const users = useUsers(open);
  const remove = useDeleteUser();
  const [pendingRemoval, setPendingRemoval] = useState<User | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className={SURFACE}>
          <Dialog.Title className="text-base font-semibold">{t('users.title')}</Dialog.Title>
          <Dialog.Description className="text-base-content/70 mt-1 text-sm">
            {t('users.help')}
          </Dialog.Description>

          <div className="-mx-1 flex flex-1 flex-col gap-4 overflow-y-auto px-1 py-4">
            {users.isLoading && <span className="loading loading-spinner loading-sm self-center" />}

            {(users.error ?? remove.error) && (
              <div role="alert" className="alert alert-error py-2 text-sm">
                <span>{authErrorMessage((users.error ?? remove.error) as Error, t)}</span>
              </div>
            )}

            <ul className="flex flex-col gap-1">
              {users.data?.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isSelf={user.id === currentUserId}
                  onRemove={() => setPendingRemoval(user)}
                />
              ))}
            </ul>

            <CreateUserSection />
          </div>

          <div className="border-base-300 flex shrink-0 justify-end border-t pt-4">
            <Dialog.Close asChild>
              <button type="button" className="btn btn-ghost btn-sm">
                {t('common.close')}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      <ConfirmDialog
        open={pendingRemoval !== null}
        title={t('users.removeTitle')}
        body={t('users.removeBody', { email: pendingRemoval?.email ?? '' })}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) remove.mutate(pendingRemoval.id);
          setPendingRemoval(null);
        }}
      />
    </Dialog.Root>
  );
}

function UserRow({
  user,
  isSelf,
  onRemove,
}: {
  user: User;
  isSelf: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const reset = useResetUserPassword();
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');

  const close = () => {
    setResetting(false);
    setPassword('');
    reset.reset();
  };

  return (
    <li className="border-base-300 rounded-box border p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {user.displayName}
            {user.role === 'admin' && (
              <span className="badge badge-ghost badge-sm ml-2">{t('users.admin')}</span>
            )}
          </p>
          <p className="text-base-content/60 truncate text-xs">{user.email}</p>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={resetting}
          onClick={() => (resetting ? close() : setResetting(true))}
        >
          <IconKey size={14} stroke={1.75} />
          {t('users.resetPassword')}
        </button>

        {/* Removing yourself could leave the instance with no admin; the API refuses too. */}
        <button
          type="button"
          className={`btn btn-ghost btn-sm ${isSelf ? '' : 'text-error'}`}
          aria-label={t('users.remove')}
          title={isSelf ? t('users.cannotRemoveSelf') : t('users.remove')}
          disabled={isSelf}
          onClick={onRemove}
        >
          <IconTrash size={14} stroke={1.75} />
        </button>
      </div>

      {resetting && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            reset.mutate({ id: user.id, password });
          }}
        >
          <PasswordField
            label={t('users.newPassword')}
            value={password}
            autoComplete="new-password"
            minLength={12}
            onChange={setPassword}
          />
          <p className="text-base-content/60 text-xs">{t('users.resetHint')}</p>

          {reset.error && (
            <div role="alert" className="alert alert-error py-2 text-sm">
              <span>{authErrorMessage(reset.error, t)}</span>
            </div>
          )}

          {reset.isSuccess ? (
            <div role="alert" className="alert alert-success py-2 text-sm">
              <span>{t('users.resetDone')}</span>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={password.length < 12 || reset.isPending}
              >
                {reset.isPending && <span className="loading loading-spinner loading-xs" />}
                {t('users.setPassword')}
              </button>
            </div>
          )}
        </form>
      )}
    </li>
  );
}

function CreateUserSection() {
  const { t } = useTranslation();
  const create = useCreateUser();
  const [open, setOpen] = useState(false);

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [admin, setAdmin] = useState(false);

  const submittable = email.length > 0 && displayName.length > 0 && password.length >= 12;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-base-300 border-t pt-4">
      <Collapsible.Trigger asChild>
        <button type="button" className="btn btn-ghost btn-sm -ml-2">
          <IconUserPlus size={14} stroke={1.75} />
          {t('users.add')}
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content className="pt-3">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              { email, displayName, password, role: admin ? 'admin' : 'member' },
              {
                onSuccess: () => {
                  setEmail('');
                  setDisplayName('');
                  setPassword('');
                  setAdmin(false);
                  setOpen(false);
                },
              },
            );
          }}
        >
          <label className="floating-label">
            <span>{t('auth.displayName')}</span>
            <input
              className="input input-bordered w-full"
              value={displayName}
              required
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>

          <label className="floating-label">
            <span>{t('auth.email')}</span>
            <input
              type="email"
              className="input input-bordered w-full"
              value={email}
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <PasswordField
            label={t('auth.password')}
            value={password}
            autoComplete="new-password"
            minLength={12}
            onChange={setPassword}
          />
          <p className="text-base-content/60 text-xs">{t('users.addHint')}</p>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={admin}
              onChange={(event) => setAdmin(event.target.checked)}
            />
            {t('users.makeAdmin')}
          </label>

          {create.error && (
            <div role="alert" className="alert alert-error py-2 text-sm">
              <span>{authErrorMessage(create.error, t)}</span>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!submittable || create.isPending}
            >
              {create.isPending && <span className="loading loading-spinner loading-xs" />}
              {t('users.create')}
            </button>
          </div>
        </form>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
