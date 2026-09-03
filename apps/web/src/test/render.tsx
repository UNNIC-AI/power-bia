import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * Renders a component the way the app does: inside a QueryClientProvider and a
 * real router, so hooks like `useNavigate` resolve and a navigation in a test is
 * the same call the app makes.
 *
 * `retry: false` so a failing request surfaces as an error state immediately
 * instead of after the app's retry budget.
 */
export function renderInApp(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{ui}</>,
  });

  // Somewhere for a successful sign-in to navigate to.
  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat',
    component: () => <div>chat</div>,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, chatRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {/* biome-ignore lint/suspicious/noExplicitAny: the throwaway tree is not the app's registered router type */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
}
