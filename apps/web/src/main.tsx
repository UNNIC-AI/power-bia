import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { Tooltip } from 'radix-ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'react-grid-layout/css/styles.css';
import './styles.css';
import './lib/i18n.ts';
import { SidebarProvider } from './lib/sidebar-context.tsx';
import { ThemeProvider } from './lib/theme-context.tsx';
import { routeTree } from './routeTree.gen.ts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* One provider owns the shared open/close delays, so moving between
            two icon buttons shows the second tooltip immediately. */}
        <SidebarProvider>
          <Tooltip.Provider delayDuration={300}>
            <RouterProvider router={router} />
          </Tooltip.Provider>
        </SidebarProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
