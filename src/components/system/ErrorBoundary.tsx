import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence: a crash anywhere in the tree shows what went wrong
 * and a way out, instead of unmounting everything to a blank (black) page.
 * Your data is untouched by a render crash — it lives in browser storage.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[LifeOS] render crash', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-base p-6">
        <div className="w-full max-w-md rounded-panel p-6 shadow-panel surface-card">
          <h1 className="t-title">Something went wrong on this screen</h1>
          <p className="t-muted mt-2">Your data is safe — it is stored in this browser and was not changed.</p>
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-sunken p-3 text-xs text-ink-muted">
            {error.message}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-contrast"
              onClick={() => { window.location.href = '/'; }}
            >
              Go to Home
            </button>
            <button
              type="button"
              className="rounded-[var(--r-lg)] px-4 py-2 text-sm text-ink bg-surface-sunken/50"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
