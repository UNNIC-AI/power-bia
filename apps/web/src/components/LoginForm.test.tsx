import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { resources } from '../lib/i18n.ts';
import { renderInApp } from '../test/render.tsx';
import { server } from '../test/server.ts';
import { LoginForm } from './LoginForm.tsx';

const t = resources.es.translation;

/** No session: the login page is what an anonymous visitor gets. */
const anonymous = http.get('/api/auth/me', () =>
  HttpResponse.json({ message: 'Authentication required' }, { status: 401 }),
);

function setupState(needsSetup: boolean) {
  return http.get('/api/auth/setup', () => HttpResponse.json({ needsSetup }));
}

describe('the sign-in form', () => {
  it('asks for a password only, once the instance has accounts', async () => {
    server.use(anonymous, setupState(false));
    renderInApp(<LoginForm />);

    expect(await screen.findByRole('button', { name: t.auth.signIn })).toBeInTheDocument();
    expect(screen.getByLabelText(t.auth.email)).toBeInTheDocument();
    expect(screen.queryByLabelText(t.auth.displayName)).not.toBeInTheDocument();
    expect(screen.getByText(t.auth.noSignUp)).toBeInTheDocument();
  });

  it('offers the first-admin form while the instance has no accounts', async () => {
    server.use(anonymous, setupState(true));
    renderInApp(<LoginForm />);

    expect(await screen.findByRole('button', { name: t.auth.createAdmin })).toBeInTheDocument();
    expect(screen.getByLabelText(t.auth.displayName)).toBeInTheDocument();
    expect(screen.getByText(t.auth.firstRunHelp)).toBeInTheDocument();
  });

  it('signs in with the credentials the user typed', async () => {
    const submitted: unknown[] = [];

    server.use(
      anonymous,
      setupState(false),
      http.post('/api/auth/login', async ({ request }) => {
        submitted.push(await request.json());

        return HttpResponse.json({
          id: '00000000-0000-4000-8000-000000000000',
          email: 'admin@unnic.ai',
          displayName: 'Admin',
          role: 'admin',
        });
      }),
    );

    const user = userEvent.setup();
    renderInApp(<LoginForm />);

    await user.type(await screen.findByLabelText(t.auth.email), 'admin@unnic.ai');
    await user.type(screen.getByLabelText(t.auth.password), 'a-password-long-enough');
    await user.click(screen.getByRole('button', { name: t.auth.signIn }));

    await waitFor(() =>
      expect(submitted).toEqual([{ email: 'admin@unnic.ai', password: 'a-password-long-enough' }]),
    );
  });

  it('shows the rejection from the server rather than failing silently', async () => {
    server.use(
      anonymous,
      setupState(false),
      http.post('/api/auth/login', () =>
        HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 }),
      ),
    );

    const user = userEvent.setup();
    renderInApp(<LoginForm />);

    await user.type(await screen.findByLabelText(t.auth.email), 'admin@unnic.ai');
    await user.type(screen.getByLabelText(t.auth.password), 'wrong');
    await user.click(screen.getByRole('button', { name: t.auth.signIn }));

    expect(await screen.findByRole('alert')).toHaveTextContent(t.auth.errors.invalidCredentials);
  });
});
