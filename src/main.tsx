import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/system/ErrorBoundary';
import { bootStorage, installUnsavedGuard } from './storage';
import './index.css';

/**
 * Hydrate the working set from the JSON data files BEFORE the first render,
 * so no screen ever paints against an empty database and then flips. If the
 * boot fails the app still starts — the Storage settings panel will explain
 * what went wrong rather than leaving a blank page.
 */
// Boot is time-boxed: if browser storage stalls (a known iPad Safari
// behaviour) the app still renders and explains instead of staying black.
const BOOT_TIMEOUT_MS = 12_000;

declare global {
  interface Window { __lifeosMounted?: boolean }
}

Promise.race([
  bootStorage(),
  new Promise((_, reject) => setTimeout(() => reject(new Error('storage boot timed out')), BOOT_TIMEOUT_MS)),
])
  .catch((e) => {
    console.error('[storage] boot failed', e);
  })
  .finally(() => {
    installUnsavedGuard();
    window.__lifeosMounted = true;
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <ErrorBoundary>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ErrorBoundary>
      </StrictMode>,
    );
  });
