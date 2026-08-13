import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogin, useMe, useRegister } from '../lib/queries.ts';

export const Route = createFileRoute('/login')({ component: LoginRoute });

function LoginRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const login = useLogin();
  const register = useRegister();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  if (me.data) {
    void navigate({ to: '/chat', search: { c: undefined } });
  }

  const pending = login.isPending || register.isPending;
  const error = login.error ?? register.error;

  const submit = async () => {
    if (mode === 'login') await login.mutateAsync({ email, password });
    else await register.mutateAsync({ email, password, displayName });

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

          {mode === 'register' && (
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

          <label className="floating-label">
            <span>{t('auth.password')}</span>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="input input-bordered w-full"
              value={password}
              required
              minLength={mode === 'register' ? 12 : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {mode === 'register' && (
            <p className="text-base-content/60 text-xs">{t('auth.passwordHint')}</p>
          )}

          {error && (
            <div role="alert" className="alert alert-error py-2 text-sm">
              <span>{error.message}</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <span className="loading loading-spinner loading-xs" />}
            {mode === 'login' ? t('auth.signIn') : t('auth.signUp')}
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}
          </button>
        </form>
      </div>
    </div>
  );
}
