import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000,
    },
  },
});

function App() {
  return (
    <>
      {/* Top navigation bar */}
      <header className="topbar">
        <span className="topbar-logo">
          brimble<span>.</span>deploy
        </span>
        <span className="topbar-tag">v0.1.0-takehome</span>
      </header>

      {/* Main router content */}
      <main>
        <RouterProvider router={router} />
      </main>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
