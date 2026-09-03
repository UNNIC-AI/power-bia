import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authErrorMessage } from '../lib/auth-errors.ts';
import { useLogin, useMe, useRegister, useSetupState } from '../lib/queries.ts';
import { PasswordField } from './PasswordField.tsx';

/**
 * The sign-in page, kept out of the route file so the route stays one
 * code-split unit and so the form can be rendered directly by a test.
 */
export function LoginForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const setup = useSetupState();
  const login = useLogin();
  const register = useRegister();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  if (me.data) {
    void navigate({ to: '/chat', search: { c: undefined } });
  }

  /*
   * Accounts are created by an admin, so there is no sign-up link. The one
   * exception is a brand new instance with no users at all: whoever fills this
   * in becomes the admin who then creates everyone else.
   */
  const firstRun = setup.data?.needsSetup === true;
  const pending = login.isPending || register.isPending;
  const error = login.error ?? register.error;

  const submit = async () => {
    try {
      if (firstRun) await register.mutateAsync({ email, password, displayName });
      else await login.mutateAsync({ email, password });
    } catch {
      /*
       * The alert below renders `login.error` / `register.error`, so there is
       * nothing to add here - but the rejection has to be caught. Letting it
       * escape made a wrong password an unhandled rejection in the console.
       */
      return;
    }

    void navigate({ to: '/chat', search: { c: undefined } });
  };

  return (
    <div className="bg-base-200 flex min-h-screen items-center justify-center p-4">
      <div className="card bg-base-100 w-full max-w-sm shadow-sm">
        <form
          className="card-body gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h1 className="text-xl font-semibold">{t('appName')}</h1>

          {firstRun && <p className="text-base-content/60 text-sm">{t('auth.firstRunHelp')}</p>}

          {firstRun && (
            <label className="floating-label">
              <span>{t('auth.displayName')}</span>
              <input
                className="input input-bordered w-full"
                value={displayName}
                required
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
          )}

          <label className="floating-label">
            <span>{t('auth.email')}</span>
            <input
              type="email"
              autoComplete="email"
              className="input input-bordered w-full"
              value={email}
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <PasswordField
            label={t('auth.password')}
            value={password}
            autoComplete={firstRun ? 'new-password' : 'current-password'}
            minLength={firstRun ? 12 : undefined}
            onChange={setPassword}
          />

          {firstRun && <p className="text-base-content/60 text-xs">{t('auth.passwordHint')}</p>}

          {error && (
            <div role="alert" className="alert alert-error py-2 text-sm">
              <span>{authErrorMessage(error, t)}</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <span className="loading loading-spinner loading-xs" />}
            {firstRun ? t('auth.createAdmin') : t('auth.signIn')}
          </button>

          {!firstRun && <p className="text-base-content/50 text-xs">{t('auth.noSignUp')}</p>}
        </form>
      </div>
    </div>
  );
}
