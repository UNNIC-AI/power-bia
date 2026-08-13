import { createRootRoute, Outlet } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-base-content/60">404</p>
    </div>
  ),
});
