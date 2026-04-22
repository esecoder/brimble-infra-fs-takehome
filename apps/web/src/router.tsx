import { createRouter, createRoute, createRootRoute, Outlet } from '@tanstack/react-router';
import { IndexPage } from './routes/index';

// ─────────────────────────────────────────────────────────────────────────────
// TanStack Router — code-based setup (no file watcher / code generation needed)
// Single route at "/" renders the full one-pager.
// ─────────────────────────────────────────────────────────────────────────────

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexPage,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

// Register the router type for useRouter, useMatch, etc.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
