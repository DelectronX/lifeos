/** @type {import('tailwindcss').Config} */
/**
 * Every colour, radius, shadow and duration below resolves to a CSS custom
 * property declared in src/index.css. Utilities therefore stay SEMANTIC
 * (bg-surface-raised, text-ink-dim, border-line) and both themes are a
 * single variable swap. See src/components/ui/README.md.
 */
export default {
  // Dark is the :root default; `.light` opts out. `darkMode: 'class'` is kept
  // so the legacy `dark:` variants scattered through feature code still apply
  // (the <html> element carries `dark` whenever the light class is absent).
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)',
          base: 'rgb(var(--c-surface-base) / <alpha-value>)',
          raised: 'rgb(var(--c-surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--c-surface-sunken) / <alpha-value>)',
          overlay: 'rgb(var(--c-surface-overlay) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--c-line) / <alpha-value>)',
          strong: 'rgb(var(--c-line-strong) / <alpha-value>)',
          faint: 'rgb(var(--c-line-faint) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          // `dim` is an alias of `muted` — both names are supported.
          dim: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--c-ink-faint) / <alpha-value>)',
          inverse: 'rgb(var(--c-ink-inverse) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          soft: 'rgb(var(--c-accent-soft) / <alpha-value>)',
          ink: 'rgb(var(--c-accent-ink) / <alpha-value>)',
          contrast: 'rgb(var(--c-accent-contrast) / <alpha-value>)',
        },
        positive: 'rgb(var(--c-positive) / <alpha-value>)',
        caution: 'rgb(var(--c-caution) / <alpha-value>)',
        critical: 'rgb(var(--c-critical) / <alpha-value>)',
      },
      fontFamily: {
        // System stack only — works fully offline, no CDN, no vendored font.
        sans: [
          'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont',
          'Segoe UI Variable Text', 'Segoe UI', 'Inter', 'Roboto',
          'Helvetica Neue', 'Arial', 'sans-serif',
        ],
        mono: [
          'ui-monospace', 'SFMono-Regular', 'SF Mono', 'Cascadia Mono',
          'Menlo', 'Consolas', 'Liberation Mono', 'monospace',
        ],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        card: 'var(--r-lg)',
        panel: 'var(--r-xl)',
        window: 'var(--r-2xl)',
      },
      boxShadow: {
        ambient: 'var(--shadow-ambient)',
        card: 'var(--shadow-panel)',
        panel: 'var(--shadow-panel)',
        pop: 'var(--shadow-pop)',
        overlay: 'var(--shadow-overlay)',
        // A 1px inner hairline highlight, used on the top edge of chrome.
        edge: 'inset 0 1px 0 0 rgb(255 255 255 / 0.04)',
      },
      transitionTimingFunction: {
        calm: 'var(--ease-out)',
        out: 'var(--ease-out)',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        slow: 'var(--dur-slow)',
      },
      spacing: {
        rail: 'var(--rail-w)',
        'rail-collapsed': 'var(--rail-w-collapsed)',
        chrome: 'var(--chrome-h)',
      },
      keyframes: {
        'lo-fade': { from: { opacity: '0' }, to: { opacity: '1' } },
        'lo-rise': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'lo-scale': {
          from: { opacity: '0', transform: 'translateY(-4px) scale(0.985)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'lo-shimmer': {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        fade: 'lo-fade var(--dur-base) var(--ease-out) both',
        rise: 'lo-rise var(--dur-slow) var(--ease-out) both',
        scale: 'lo-scale var(--dur-slow) var(--ease-out) both',
        shimmer: 'lo-shimmer 1.8s linear infinite',
      },
      zIndex: {
        rail: '30',
        chrome: '35',
        overlay: '50',
        toast: '60',
        palette: '80',
      },
    },
  },
  plugins: [],
};
