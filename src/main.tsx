import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { bootStorage, installUnsavedGuard } from './storage';
import './index.css';

/**
 * Hydrate the working set from the JSON data files BEFORE the first render,
 * so no screen ever paints against an empty database and then flips. If the
 * boot fails the app still starts — the Storage settings panel will explain
 * what went wrong rather than leaving a blank page.
 */
bootStorage()
  .catch((e) => {
    console.error('[storage] boot failed', e);
  })
  .finally(() => {
    installUnsavedGuard();
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    );
  });
